# FINN: backend architecture

Version 1 · 15 Nov 2026 · companion to `FINN_research_synthesis.md` (feature IDs like P-6, PL-2, D-1 refer to its section 5) and `FINN_frontend_design.md`.

Stack you asked for: React frontend and a separate Node backend, both on Vercel; cloud LLMs; Supabase as the cloud database; everything over APIs. This document keeps that stack and changes one thing about *when* data is fetched (section 1.2), because the competitor teardown showed that fetching exchange data when a page loads is the most common way these demos die.

---

## 1. Shape of the system

### 1.1 Diagram

```
                ┌──────────────────────────┐
  Phone / web   │  finn-web (Vercel)       │  React + Vite PWA, static, CDN
  ───────────►  │  calls only finn-api     │
                └────────────┬─────────────┘
                             │ HTTPS JSON (/v1/*), CDN-cached GETs
                ┌────────────▼─────────────┐
                │  finn-api (Vercel)       │  Node + Hono, Fluid compute
                │  region: bom1 (Mumbai)   │  read API + ingestion + jobs + LLM router
                └──┬──────────┬─────────┬──┘
                   │          │         │
      ┌────────────▼──┐  ┌────▼─────┐  ┌▼───────────────────────┐
      │ Supabase      │  │ LLMs     │  │ Sources (server side)  │
      │ ap-south-1    │  │ Gemini   │  │ NSE / BSE filings      │
      │ Postgres +    │  │ Groq     │  │ NSE XBRL results       │
      │ Storage       │  │ (opt.    │  │ Yahoo (prices)         │
      └───────▲───────┘  │ Claude)  │  │ Screener (docs, table) │
              │          └──────────┘  └────────────────────────┘
              │ same ingestion code, run from an Indian home connection
      ┌───────┴──────────────┐         ┌────────────────────────┐
      │ refresher CLI        │         │ Schedulers             │
      │ (laptop fallback)    │         │ Vercel cron (daily)    │
      └──────────────────────┘         │ + external pinger      │
                                       └────────────────────────┘
      Telegram Bot API ◄── finn-api (push)
```

### 1.2 The one rule that changes your proposal

**Live APIs, yes. Live exchange calls on page load, no.**

- The frontend always reads **our** API, which reads Supabase. That is fast (one Postgres query, CDN-cached) and never depends on NSE being reachable at that moment.
- Exchange data is pulled **by ingestion jobs** (scheduled, or triggered by "research this ticker") and written to Supabase.
- Why: CinnamonRoll10 called NSE at page load from Render and showed an empty brief ("NSE did not respond for" all 20 companies). geekyparas found NSE returns 403 to GitHub's runners and had to refresh by hand. In May 2025 NSE and BSE also blocked their websites for overseas users, citing cyber threats, and said access would be restored case by case. Developers separately report NSE scripts that work locally failing on AWS, Google Cloud and other servers. We can't know in advance which cloud IPs are allowed today, so the design runs exchange calls from Mumbai and keeps a home-connection fallback.

So the backend is "live" in the sense that matters to the investor (fresh data, on-demand research for any ticker) without making each screen load a bet on NSE.

### 1.3 Two Vercel projects, one repo

```
finn/
  apps/web/          React + Vite + TS (see frontend doc)
  apps/api/          Node + Hono + TS  → Vercel project "finn-api"
  packages/core/     ingestion, parsers, rules, verdict engine, LLM router (pure TS)
  packages/shared/   zod schemas + API types shared by web and api
  tools/refresher/   CLI wrapping packages/core for laptop runs
  supabase/          migrations (SQL), seed (demo portfolio), pg_cron jobs
```

- **Why Hono:** Vercel deploys Hono and Express with zero configuration. Hono is small and built on web standards, which keeps cold starts low. Express also works if you prefer it; nothing else in this design changes.
- **`packages/core` holds all logic** and has no HTTP in it, so the same code runs in the API, in cron handlers and in the refresher CLI. This is what makes the laptop fallback a five-minute job instead of a rewrite.

---

## 2. Platform limits that shape the design (checked 15 Nov 2026)

| Platform | Limit that matters | Design response |
|---|---|---|
| Vercel Functions (Hobby, Fluid compute) | 300 s default and maximum duration on Hobby | Every job step must finish well under 300 s. Research runs as resumable steps (section 7). |
| Vercel Cron (Hobby) | Cron jobs can only run once per day, and timing is only guaranteed within the hour | One daily cron for prices, digest and keep-alive. Intraday filing polls come from an external pinger (section 8). |
| Vercel regions (Hobby) | A single function region | Set finn-api to `bom1` (Mumbai) so exchange requests come from an Indian IP. The default is iad1 (Washington), which is overseas from NSE's point of view. Mumbai is a datacenter IP, so it may still be blocked: test it on day one, and keep the refresher fallback either way. |
| Supabase Free | 500 MB database per project; free projects pause after 1 week of inactivity; 1 GB file storage | Keep raw text in Storage, not Postgres. The daily cron touches the database so the project never pauses while ENAM is evaluating. |
| Gemini API free tier | Free tier restricted to Flash and Flash-Lite models since April 2026 (pricing page also still marks some others free); Google no longer publishes per-model free RPM/RPD on its rate-limits page; limits are per project, not per key | All model IDs live in env vars; the router handles 429s with backoff and failover; heavy work is cached by document hash. |
| Groq free tier | Sample free limits for text models such as gpt-oss-120b: 30 requests a minute, 1,000 a day, 200,000 tokens a day | Use as the failover for cheap and mid tasks when Gemini rate-limits. |

---

## 3. Data sources and how we fetch each one

All fetchers live in `packages/core/sources/*`, return typed records, and never call an LLM. Every fetch is logged to `ingest_runs` (source, status, row counts, error, duration) so `/v1/health` can say exactly what is fresh.

| Data | Source | How | Fallback | Feeds |
|---|---|---|---|---|
| End-of-day price and volume | Yahoo via `yahoo-finance2` (`chart` module, `.NS` symbols) | Daily after close; keep 120 sessions per holding | None needed (Yahoo serves cloud IPs) | P-12 alerts, sparklines, reactions |
| Corporate announcements | NSE JSON endpoint `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY&symbol=SYM` | Cookie handshake (GET homepage, reuse cookies), browser-like headers, 1 request per second, from `bom1` | BSE `AnnSubCategoryGetData` endpoint with scrip code; then the refresher CLI from home | All push features |
| Quarterly results numbers | NSE XBRL. Results for quarters ended March 2025 onward sit under "Integrated Filing – Financials" | Download XBRL XML, parse with `fast-xml-parser`, map tags to Revenue, EBITDA inputs, PBT, tax, PAT, exceptional items, other income | Results PDF → text (`unpdf`) → mid model extraction with arithmetic checks | P-6 results card |
| Cross-check numbers, multi-year financials | Screener company page (`/company/SYM/consolidated/`) quarterly and annual tables | Fetch HTML, parse tables with `cheerio`; cache 24 h | Standalone page if no consolidated | P-6 checks, PL-6, PL-7 |
| Annual reports and concall transcripts | Links on the Screener company page (company IR sites as backup) | Download PDF → extract text per page (`unpdf`) → gzip JSON in Supabase Storage keyed by SHA-256 | If a transcript is a scan: mark "not readable", skip; never OCR on the request path | PL-2, PL-4, PL-5, PL-6 |
| Appointment and resignation profiles | The filing PDF itself (SEBI requires a brief profile in appointment disclosures) | Mid model extraction to a fixed JSON shape | Optional labelled web-search snippet (P2; Tavily or Brave) | P-9 |
| Upcoming results and concall dates | Board-meeting notices in the announcements feed | Rules plus a cheap model to read the date | Leave blank | P-14 "Coming up" |
| Ticker search list | NSE equity list CSV (symbol, name, ISIN) | Load once into `companies`; refresh weekly | Screener search | PL-1 search |
| News | **None, by design** | — | — | ENAM ignores macro and news; the pull side must use primary sources. Filings are the news. |

**Politeness and safety:** one request per second per host, exponential backoff with jitter, a hard cap per run, a descriptive user agent, no CAPTCHA bypass. Cache everything (filings never change once filed).

---

## 4. Processing pipeline

### 4.1 Push pipeline (per new filing)

```
fetch → normalise → dedupe → classify → tier + score → enrich by type → headline → group → notify
```

| Stage | What happens | Tool | Feature |
|---|---|---|---|
| Normalise | Map NSE/BSE fields to one shape: symbol, exchange category, subject, attachment URL, filed_at (IST) | Code | — |
| Dedupe | Same symbol, near-identical subject, within 10 minutes across NSE and BSE → one filing | Code (normalised subject hash + time window) | — |
| Classify | Map to the reference categories (results, M&A, fund_raise, management_change, litigation, insider_trading, earnings_call, investor_meetings, credit_rating, dividend, bonus_split, capex, press_release, postal_ballot, agm_egm, pledging, unclassified) plus our sub-kinds (newspaper ad, transcript posted, board-meeting notice, auditor change). | Rules on subject and exchange category first; tier-1 model only when no rule matches or rules conflict. Store `method: rule | model`. | P-2 |
| Tier and score | Act / Read / Routine. Score = category base + position weight + stock reaction + always-Act override. Reasons are stored as plain-language strings, never as "+80". | Code | P-2, P-3, P-4 |
| Enrich | Results → results card. Management change → people card. Earnings call transcript → concall card. Fund raise, M&A, capex → capital one-liner. | Code + tier-2 model where text must be read | P-6, P-9, P-10, P-11 |
| Headline | One plain line, never the raw exchange subject | Tier-1 model, cached by filing ID; template fallback | P-5 |
| Group | Same company, same event (results PDF + newspaper ad + press release + investor deck) → one event with related filings folded | Code | P-15 |
| Notify | If Act tier and inside the notification budget → Telegram | Code | P-13 |

**Always-Act list (code, not model):** auditor resignation or qualification; pledge creation or increase; promoter selling; resignation of MD, CEO, CFO, company secretary or auditor; regulatory orders and insolvency; credit-rating downgrade; related-party approvals above a size threshold; any acquisition or new segment in an excluded activity (P-18). Mandatory auditor rotation is *not* a red flag (rotation keywords downgrade it to Read).

### 4.2 Results card logic (P-6, P-7, P-8)

1. Prefer consolidated; record `basis`. Convert lakh to crore; store everything in ₹ crore.
2. EBITDA = PBT before exceptional items + finance costs + depreciation and amortisation − other income. Store the formula with the card.
3. Checks, each stored as pass/fail with a note:
   - PBT − tax = PAT (±1%) for all three quarters
   - Revenue, PBT and PAT tie to Screener (±1%)
   - Exceptional items present → flag "one-off of ₹X cr in PBT"
   - Prior period restated, or a merger or demerger in the period → "not comparable" instead of a QoQ figure
4. Banks and NBFCs: no EBITDA. Show net interest income, pre-provision operating profit (if available), provisions and PAT, with "EBITDA not applicable to banks".
5. Guidance line: if the company has a management record (PL-2), compare the latest number with the matching guidance and attach the verdict.
6. Half-year cash (Q2 and Q4 only): operating cash flow vs PAT, read from the half-year cash-flow statement in the results filing.
7. All arithmetic in code. The model only ever extracts numbers it can point to on a page.

### 4.3 Pull pipeline (research job for any ticker)

```
resolve ticker → find documents → download + extract → guidance extraction → quote check
   → actuals → verdict engine → governance strip → mandate check → wording → snapshot
```

| Step | Detail | Tool | Typical time |
|---|---|---|---|
| Find documents | Latest annual report; last 4–8 concall transcripts | Screener page parse | < 5 s |
| Download + extract | PDF → page texts → Storage (skip if SHA-256 already present) | `unpdf` | 5–40 s per document |
| Guidance extraction | Per transcript, one call: list forward-looking statements as JSON (metric, target value or range, unit, period, hedge words verbatim, quote, page) | Tier-2 model, long context, structured output | 10–30 s per transcript |
| Quote check | Fuzzy-match each quote against the cited page; drop or flag anything under the match threshold | Code | < 1 s |
| Actuals | Quarterly and annual figures from Screener and stored results cards, period-aligned | Code | < 2 s |
| Verdict engine | Rules in section 5 | Code | < 1 s |
| Governance strip | 12 months of this company's filings: auditor changes, pledge, promoter trades, senior exits, regulatory orders, related-party approvals | Code over stored filings (fetch if missing) | < 5 s |
| Mandate check | Annual-report segment note → classify segments against the excluded list; output % of revenue with page | Tier-1 model + code | < 10 s |
| Wording | Short verdict sentences, "what could go wrong", 3–5 questions for management, all citing pages | Tier-3 model, once per company per new document | 10–20 s |
| Snapshot | Write `research_snapshots` row; frontend reads this | Code | — |

The output is cached per company and recomputed only when a new transcript, results filing or annual report lands (P-10 triggers a partial re-run: extract the new transcript, re-run the verdict engine and wording).

---

## 5. Verdict engine (code, not model)

This is where we beat the competition (synthesis section 3.4), so the rules are deterministic and stored with each verdict.

| Situation | Verdict | Wording pattern |
|---|---|---|
| Statement has no number or direction that can be checked ("meaningful growth", "strong year") | **Not measurable** | "Not a measurable target" (grouped as one line) |
| Target period not finished (e.g. FY27 target, 2 of 4 quarters reported) | **Too early** + a pace note | "H1 margin 15.6% vs FY27 guide 20.5–21.2%. Management expects a stronger H2 (Q2 FY27 call, p.9)." |
| Period finished, actual inside the range or at/above a point target | **Met** | "Guided 18–20%, delivered 19.1%" |
| Period finished, actual below the low end by more than the tolerance (0.5 pp for margins, 2% relative for growth) | **Missed** | "Guided 21%, delivered 18.9%" |
| Same metric and period restated with a different number in a later call | **Revised** | "Target revised from 20% to 15% (Q1 FY27 call)" |
| Stated in call N, absent from the next two or more calls, period not reached | **Not mentioned since** | "Not mentioned since the Q4 FY26 call" |
| Segment target but only company-level actuals available | **Not measurable** | "Segment figures not disclosed" |
| Hedge words present ("aspire", "endeavour", "subject to") | Score as above, show the hedge | "Hedged: 'we aspire to…'" |

**Credibility line** (PL-3): "Met X of Y targets that are due", counting only Met and Missed. Never a grade or a score.

**Concall card** (P-10): for each statement in the new transcript, compare with the previous call's statement on the same metric and period → new / unchanged / raised / lowered / dropped. Attach the credibility line.

---

## 6. Model routing

### 6.1 Tiers

| Tier | Used for | Primary model (env var) | Failover | Why |
|---|---|---|---|---|
| 0: code | Classification for most filings, all arithmetic, scoring, verdicts, grouping, alerts | — | — | Free, exact, testable. Competitors handled ~87% of filings with rules alone. |
| 1: cheap | Unmatched classification, headline rewrite, board-meeting date reading, mandate segment tagging | `MODEL_CHEAP=gemini-3.1-flash-lite` (marked free of charge on Google's pricing page) | Groq `openai/gpt-oss-120b` | Many short calls |
| 2: mid | Results PDF fallback extraction, people profiles, guidance extraction from long transcripts, scoped Q&A | `MODEL_MID=gemini-3.5-flash` (free tier listed) | Groq, then tier 3 | Long context, structured JSON |
| 3: strong | Verdict sentences, "what could go wrong", questions for management (once per company per new document) | `MODEL_STRONG=gemini-2.5-pro` if your AI Studio shows it free; otherwise a paid model with a hard budget (e.g. `gemini-3.1-pro-preview` or Anthropic `claude-sonnet-5-5`) | Tier 2 with a stricter prompt | Few calls; reasoning quality matters |

Google's own model pages disagree slightly on which IDs are current, so **confirm the exact IDs in AI Studio** before deploying and keep them in env vars. Free-tier content may be used by Google to improve its products; that is acceptable here because everything we send is public filings, but say so in the writeup.

### 6.2 Router contract (`packages/core/llm/router.ts`)

```ts
type Task =
  | 'classify_filing' | 'rewrite_headline' | 'read_meeting_date' | 'tag_segments'
  | 'extract_results' | 'extract_people' | 'extract_guidance' | 'answer_scoped'
  | 'write_verdicts' | 'write_risks' | 'write_questions';

llm.run<T>(task: Task, input: object, schema: ZodSchema<T>): Promise<{ data: T; meta: CallMeta }>
```

- Task → tier → model from a config map (`TASK_TIER`), so changing a model is a config change.
- **Structured output only:** JSON schema per task, validated with zod; one repair retry, then fail closed (the feature shows "Not available" instead of guessing).
- **Cache:** key = SHA-256(task + prompt version + model + normalised input). Stored in `llm_cache` (Postgres for small outputs, Storage for large). Re-runs cost nothing.
- **Rate limits:** token bucket per provider; on 429, back off with jitter, then fail over to the next provider in the tier.
- **Logging:** every call writes `llm_calls` (task, model, input/output tokens, cached, latency, cost at list price in ₹). This produces the cost numbers for the writeup and the "How FINN decides" sheet.
- **Grounding rules in every prompt:** use only the provided pages; return page numbers; return `null` rather than guess; no outside knowledge of the company.

---

## 7. Jobs and long-running work

Research for an unseen ticker takes 1–4 minutes. A single Hobby invocation can't be trusted for all of it, so jobs are **resumable steps**:

- `research_jobs` row: `id, symbol, status, steps[] (name, state, started_at, finished_at, note), error`.
- `POST /v1/research/:symbol` creates the job (idempotent: an existing running or fresh job is returned) and runs the first step.
- After each step finishes, the function starts the next one before returning: `waitUntil(fetch('/v1/jobs/:id/advance'))` with the cron secret. Each step does one bounded piece of work (one document, one transcript).
- The frontend polls `GET /v1/jobs/:id` every 2 s and renders the steps as plain sentences ("Read FY26 annual report (212 pages)", "Reading Q2 FY27 call").
- Safety net: if a step stalls (no progress for 2 minutes), the next poll re-triggers `advance`. The pinger also sweeps stalled jobs.
- If you have an extra 30 minutes, Inngest's free tier (50,000 step runs a month) gives durable steps with retries and is a drop-in replacement for `advance`. Not required.

---

## 8. Scheduling

| Job | When (IST) | Trigger | What it does |
|---|---|---|---|
| Daily close | ~19:30 | Vercel cron (once a day, Hobby) | Prices for all holdings; recompute alerts; process the day's filings; send the morning digest the next morning (queued); touch the DB (keeps Supabase awake) |
| Filing poll | Every 20–30 min, 09:00–23:00 | External pinger (cron-job.org free) or Supabase `pg_cron` + `pg_net` calling `/v1/cron/filings` with the secret | Fetch announcements since the last cursor; run the push pipeline; send Act-tier alerts |
| Morning digest | 08:00 | Same pinger | One Telegram message: the top items since yesterday's digest |
| Job sweeper | Every 5 min while jobs run | Pinger | Advance stalled research steps |
| Refresher (fallback) | Before submission and whenever `/health` shows NSE degraded | You, from the laptop: `pnpm refresh --since 7d` | Same ingestion code, writes straight to Supabase |

Hobby crons fire somewhere in the scheduled hour, so nothing user-visible depends on exact cron timing.

---

## 9. Database (Supabase Postgres, ap-south-1)

Raw document text and large LLM outputs go to Storage; Postgres holds structured rows only, which keeps us far under 500 MB.

| Table | Key columns | Notes |
|---|---|---|
| `companies` | symbol PK, name, isin, bse_code, sector, is_bank | From NSE equity list |
| `portfolios` | id, name, settings jsonb (house view) | One demo portfolio plus any the user creates |
| `holdings` | portfolio_id, symbol, weight_pct, added_at | Demo set must pass the mandate check (D-5) |
| `prices_daily` | symbol, date, close, volume | 120 sessions per holding |
| `filings` | id, symbol, exchange, exch_category, subject, attachment_url, filed_at, raw jsonb, dedupe_key | Immutable |
| `filing_analysis` | filing_id, category, sub_kind, tier, score, reasons text[], headline, method, model, event_id | Recomputable |
| `events` | id, symbol, kind, primary_filing_id, filed_at | Grouping (P-15) |
| `results` | symbol, period, basis, unit, metrics jsonb, checks jsonb, source, page, ebitda_formula | One row per company per quarter |
| `people_events` | filing_id, name, role, action, effective_date, prior_roles jsonb, tenure, stated_reason, source_page | P-9 |
| `documents` | id, symbol, type (AR / transcript / results / filing), period, url, sha256, pages, storage_path, readable | Text lives in Storage |
| `guidance_statements` | id, symbol, doc_id, call_period, metric, scope (company / segment), target_low, target_high, unit, direction, period_target, hedge, quote, page, quote_match | PL-2 |
| `actuals` | symbol, period, metric, value, unit, source | From results and Screener |
| `verdicts` | statement_id, verdict, reason, pace_note, as_of, rule_version | Deterministic |
| `governance_flags` | symbol, filing_id, kind, detail, filed_at | PL-4 |
| `research_snapshots` | symbol, built_at, sections jsonb, inputs_hash | What the company page reads |
| `research_jobs` | id, symbol, status, steps jsonb, error, created_at | Section 7 |
| `alert_rules` | portfolio_id, kind (move_sigma / volume_x / category), params jsonb | P-12 |
| `alerts` | id, portfolio_id, symbol, kind, payload, triggered_at, sent_at | |
| `feedback` | portfolio_id, filing_id, action (seen / mute_kind), sub_kind | P-17 |
| `push_targets` | portfolio_id, channel (telegram), chat_id, created_at | P-13 |
| `llm_cache` | key PK, task, model, output jsonb or storage_path, created_at | |
| `llm_calls` | id, task, model, tokens_in, tokens_out, cached, latency_ms, cost_inr, created_at | Cost reporting |
| `ingest_runs` | id, source, status, started_at, finished_at, rows, error | `/health` |

**Access:** the frontend never talks to Supabase directly. Only finn-api holds the service key. Row-level security is enabled on every table with no public policies, so a leaked anon key exposes nothing.

---

## 10. API (finn-api, `/v1`)

All responses are JSON. Every response that carries data includes `as_of` (ISO, IST) and `stale: boolean`. GETs set `Cache-Control: public, s-maxage=60, stale-while-revalidate=600` unless noted, so the Vercel CDN serves repeat reads.

| Method and path | Returns | Notes |
|---|---|---|
| `GET /v1/health` | Last successful run per source, degraded flags, data as-of | Never cached |
| `GET /v1/brief?since=ISO&segment=act|read|routine&cursor=` | `{ as_of, window_used, widened, counts {act, read, routine}, items[] (max 6 by default), next_cursor, routine_summary, coming_up[] }` | Brief tab. No `since` = since last visit (client sends it). Widens itself to the last material item if empty (P-1). `cursor` serves the "See all" list pages, 20 per page. |
| `GET /v1/holdings` | Each holding: state, weight, last move, record summary (credibility), governance flag count, mandate status, plus portfolio-level state counts | Portfolio tab |
| `GET /v1/companies/:symbol` | Header, state, latest results card, record summary, governance strip, mandate note, coming up | |
| `GET /v1/companies/:symbol/filings?since=` | Grouped events with related filings | |
| `GET /v1/companies/:symbol/record` | Statements with verdicts, quotes, pages, credibility | `s-maxage=3600` |
| `GET /v1/companies/:symbol/research` | Snapshot sections, or `202 { job_id }` if none yet | `s-maxage=3600` |
| `POST /v1/research/:symbol` | `{ job_id }` | Idempotent |
| `GET /v1/jobs/:id` | Steps with plain-language notes and status | Polled; never cached |
| `GET /v1/search?q=` | Up to 8 matches (symbol, name) | `s-maxage=86400` |
| `GET /v1/alerts?cursor=` | Triggered alerts (last 7 days, grouped by day) with the explaining filing, or "no filing explains this" | Alerts tab, Triggered segment |
| `GET /v1/alerts/preview?move_sigma=&volume_x=` | `{ would_have_fired_30d, examples[] }` | Live preview under the threshold controls (Alerts → Rules) |
| `GET /v1/settings` / `PUT /v1/settings` | House view: thresholds, exclusions, muted kinds, holdings | |
| `POST /v1/feedback` | 204 | Seen / mute this kind |
| `POST /v1/ask` | `{ answer, citations[] }` or `{ refused: true, reason }` | Scoped to one company's documents (PL-14, P1) |
| `GET /v1/method` | "How FINN decides": ranking rules, formulas, sources, model routing, cost so far | |
| `POST /v1/telegram/webhook` | 200 | Verifies Telegram's secret-token header |
| `POST /v1/cron/daily`, `/v1/cron/filings`, `/v1/cron/digest`, `/v1/jobs/:id/advance` | 202 | Require `Authorization: Bearer CRON_SECRET` |

**Error shape** (all endpoints): `{ error: { code, message, retry_after? } }`. Messages are written for the screen ("NSE has not responded since 14:10; showing filings up to then").

---

## 11. Push to the phone (Telegram)

- Create the bot with BotFather; store `TELEGRAM_BOT_TOKEN`; set the webhook to `/v1/telegram/webhook` with a secret token.
- Connect flow: "Get alerts on Telegram" in the app → deep link `t.me/<bot>?start=<one-time token>` → the bot receives `/start <token>` → we store `chat_id` against the portfolio.
- What gets sent: the 08:00 digest (top items since yesterday) and Act-tier items as they arrive. **Budget: at most 3 messages a day**, deduplicated by event.
- Message format: one plain line plus a link that opens the card in the web app.

```
HDFC Bank has a new CEO, [name], ex-[firm], from 1 Dec. 6% of your book.
Open in FINN: https://finn.app/c/HDFCBANK/e/8412
```

Web push is P2 (it needs a home-screen install on iOS); Telegram works on any phone with no install for us to manage.

---

## 12. Security, config and environments

**Env vars (finn-api):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `GEMINI_API_KEY`, `GROQ_API_KEY`, optional `ANTHROPIC_API_KEY`
- `MODEL_CHEAP`, `MODEL_MID`, `MODEL_STRONG`
- `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- `WEB_ORIGIN`, `LLM_MONTHLY_BUDGET_INR`

**Other rules:**
- **CORS:** allow only `WEB_ORIGIN` (plus localhost in dev).
- **Rate limits:** simple per-IP limits on `POST /research` and `POST /ask` (stored in Postgres), so an evaluator can't accidentally burn the free tier.
- **No secrets in the repo**, and don't commit ENAM's PDFs (one competitor did).
- **Vercel settings:** `regions: ["bom1"]` in finn-api's `vercel.json`; Fluid compute on (the default for new projects).

---

## 13. Failure modes and what the user sees

| Failure | Detection | Behaviour | User sees |
|---|---|---|---|
| NSE returns 403 or times out | `ingest_runs` error | Try BSE; mark source degraded; keep last data | "Exchange feed paused since 14:10. Showing filings up to then." |
| Both exchanges blocked from the cloud | Two consecutive failed runs | Health goes degraded; you run the refresher | Same message plus an absolute as-of time |
| Gemini 429 | Router | Back off, then Groq, then queue | Headline falls back to a cleaned subject; card still appears |
| Model returns invalid JSON | zod | One repair retry, then fail closed | That field shows "Not available" |
| Results numbers don't reconcile | Checks fail | Card still shows, with a flag | "Numbers in the filing and on Screener disagree on EBITDA; check p.10" |
| Transcript is a scanned PDF | No text extracted | Mark unreadable; continue with the others | "Q1 FY27 transcript is a scan and wasn't read" |
| Unseen ticker with no Screener page | Lookup fails | Job ends early with what is available | "No annual report or transcripts found for XYZ. Filings and prices only." |
| Supabase paused | Connection error | Daily cron prevents this; the first request after a pause retries | One slow first load at worst |
| Function hits 300 s | Step timeout | Step marked failed; the sweeper retries once | Job step shows "Retrying" |
| Empty brief (quiet day) | Count = 0 | Widen to the last material item | "Quiet since Tuesday. Next: Dixon results Fri 14 Nov." |

---

## 14. Cost and efficiency (what to report in the writeup)

- Report from `llm_calls`, not estimates: tokens and ₹ at list price per filing, per results card and per research run, plus the share of filings handled by rules alone.
- Levers already in the design:
  - rules first
  - cheap → mid → strong routing
  - cache by document hash
  - extract each transcript once
  - re-run only what a new document changes
  - CDN caching of reads
  - free tiers everywhere
- If a paid strong model is used, `LLM_MONTHLY_BUDGET_INR` hard-stops tier 3 and falls back to tier 2.

---

## 15. Testing (small, targeted)

| Test | What |
|---|---|
| Classifier eval (E-1) | 60 hand-labelled filings from your portfolio: report **material recall** ("missed 0 of N material") and precision of the Act tier |
| Results reconciliation (E-2) | For each demo company: XBRL/PDF numbers vs Screener; list mismatches |
| Verdict engine unit tests | One fixture per row of the section 5 table |
| Quote check | Known-good and known-bad quotes against stored pages |
| Unseen ticker smoke test | Two tickers you didn't pick, run end to end on the deployed API after the last refresh |

---

## 16. Feature map (synthesis IDs → backend pieces)

| Feature IDs | Backend pieces |
|---|---|
| P-1, P-14 | `/v1/brief` widening logic; board-meeting date parser; `coming_up` |
| P-2, P-3, P-4, P-5 | Classifier rules + tier-1 model; scorer; always-Act list; headline task |
| P-6, P-7, P-8 | XBRL parser; PDF fallback; checks; bank variant; guidance join; H1 cash |
| P-9 | People extraction from the filing; senior-exit counter |
| P-10 | Transcript-arrival trigger → partial research re-run → concall card |
| P-11 | Capital one-liner extractor |
| P-12, P-16 | Alert engine (σ moves, volume multiple, concentration) |
| P-13 | Telegram webhook, digest, budget |
| P-15, P-17, P-18 | Event grouping; feedback table; mandate-breach rule |
| PL-1 | Search + research jobs (section 7) |
| PL-2, PL-3 | Guidance extraction, quote check, actuals, verdict engine, credibility |
| PL-4, PL-5 | Governance flags; mandate segment tagging |
| PL-6, PL-7 | Screener tables → cash quality, trajectory |
| PL-8, PL-9 | Tier-3 wording tasks |
| PL-14 | `/v1/ask` scoped Q&A with refusal |
| D-1 to D-7 | Ingestion design, refresher, fallbacks, demo seed |
| A-1 to A-4 | Router, cache, quote check, cost log |
| U-4 | `/v1/method` |

---

## 17. Build order for today (backend)

1. Supabase project in ap-south-1; run migrations; seed the demo portfolio (mandate-clean) and the company list.
2. `packages/core/sources`: prices, NSE announcements (+ BSE fallback), Screener page parser. Run them from the refresher CLI first, then deploy finn-api to `bom1` and test the same calls from Vercel.
3. Push pipeline: classifier rules, always-Act list, scorer, headline task, grouping. Then `/v1/brief`, `/v1/holdings`, `/v1/health`.
4. Results card: XBRL first, then PDF fallback, then checks and bank variant.
5. Research job: documents → guidance extraction → quote check → verdict engine → `/record` and `/research`. Then the concall card trigger.
6. Governance strip, mandate check, people card.
7. Daily cron + pinger + Telegram (if time).
8. Refresh from the laptop, run the evals, smoke-test two unseen tickers on the deployed API.

---

## Sources
- Vercel function duration on Hobby with Fluid compute: https://vercel.com/docs/functions/limitations
- Vercel Cron Hobby limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel function regions (Hobby single region; default iad1; bom1 available): https://vercel.com/docs/functions/configuring-functions/region
- Hono and Express zero-config on Vercel: https://vercel.com/changelog/deploy-hono-backends-with-zero-configuration · https://vercel.com/docs/frameworks/backend/express
- Supabase pricing and pausing: https://supabase.com/pricing
- Gemini models and pricing: https://ai.google.dev/gemini-api/docs/models · https://ai.google.dev/gemini-api/docs/pricing
- Gemini free-tier changes (April 2026): https://agentdeals.dev/gemini-api-pricing-changes
- Groq free-tier limits: https://benchlm.ai/free-tier/groq
- NSE/BSE overseas access restriction: https://www.business-standard.com/amp/markets/news/nse-bse-restrict-website-access-for-overseas-users-amid-cyber-risks-125050700568_1.html
- NSE blocking cloud servers (developer reports): https://forum.unofficed.com/t/update-nsepython-not-working-in-aws-google-cloud-and-webservers/670
- NSE announcements endpoint pattern and BSE route: https://www.browserless.io/skills/nseindia.com/research-corporate-filings
- NSE results under Integrated Filing – Financials: https://www.nseindia.com/companies-listing/corporate-filings-financial-results
- yahoo-finance2: https://github.com/gadicc/yahoo-finance2
- Inngest free tier: https://www.inngest.com/pricing
- Competitor evidence (geekyparas build log, CinnamonRoll10 live demo): see `FINN_research_synthesis.md`, section 3
