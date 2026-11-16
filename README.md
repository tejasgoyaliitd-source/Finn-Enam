# FINN

**Investment monitoring and research for Indian equities, built for a phone and for an investor who reads filings, not headlines.**

FINN keeps a record of what each management has promised, checks every new filing against it, and puts governance first, in a calm, sourced, phone-sized form. Every number traces to a primary disclosure and a page. Where FINN doesn't know something, it says so instead of guessing.

---

## Try it in two minutes

> **Live app:** https://finn-enam-taupe.vercel.app/

**What to tap first** (the same six steps are in the app under **?**, "FINN in two minutes"):

| Step | Where                                                                                  | What you'll see                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Feed → Needs you**                                                                   | Filings ranked by impact on the book, each with the reason it ranks there. Opens on "Since last results".                                    |
| 2    | **Feed → a results filing** (e.g. Dixon, Page Industries)                              | Revenue, EBITDA, margin in bps, PBT and PAT with QoQ and YoY, and checks that the lines add up.                                              |
| 3    | **Alerts → Rules**                                                                     | Change "unusual" from 3× to 2× the usual daily move; the line updates: "With these settings, N alerts would have fired in the last 30 days." |
| 4    | **Holdings → Dixon or Polycab → Guidance**                                             | What management promised on each call, grouped by call, with a **p. N** link that opens the transcript at that page.                         |
| 5    | **Research → search a company you don't hold** (try **Sun Pharma, L&T or Tata Elxsi**) | FINN reads its annual report and calls live: "✓ Found FY26 annual report (212 pages)… Reading Q1 FY27 call". Usually 1 to 3 minutes.         |
| 6    | **⚙ → How FINN decides**                                                               | Ranking rules, formulas, which model does what, and what it has cost.                                                                        |

Holdings to try: **DIXON** and **KPITTECH** (research already done), **HDFCBANK** and **BAJFINANCE** (the bank results card: no EBITDA, net interest income instead).

### Run it locally

Requirements: Node 22+, pnpm 11, a Supabase project in `ap-south-1`, and (for guidance extraction and scoped Q&A) a Gemini and/or Groq API key. Free tiers are enough.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `GEMINI_API_KEY` / `GROQ_API_KEY`. Then apply the schema and the demo portfolio, either through the Supabase SQL editor (run `supabase/migrations/*.sql` in order, then `supabase/seed.sql`) or with the Supabase CLI:

```bash
npx supabase db push --db-url "postgresql://postgres.<project-ref>:<db-password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" --include-seed
```

(Use the session pooler connection string from Project Settings → Database; the direct host may refuse connections.)

Load data from your own machine (NSE blocks cloud IPs; see [Exchange connectivity](#4-assumptions)):

```bash
pnpm refresh --companies
```

```bash
pnpm refresh --portfolio --only prices,filings,screener --since 30d
```

Start the API (port 8787) and the web app (port 5173) together, then open `http://localhost:5173` at phone width:

```bash
pnpm dev
```

Checks:

```bash
pnpm typecheck
```

```bash
pnpm --filter @finn/core test
```

```bash
pnpm --filter @finn/api test:live
```

The core suite has 141 tests; the live API suite (15 tests) runs against your Supabase project.

---

## 1. The brief, and what we built

The challenge: an investment monitoring and research tool for Indian equities that delivers real signal on a phone, works on any NSE ticker the reviewer chooses (including one we never saw), and replaces generic AI summaries with something an investor can audit.

Our reading of the brief: ENAM grades judgment, not coverage. A chat box over filings is the obvious answer; most of the 15 competing projects we reviewed built some version of it, and most of their live demos were broken or stale when opened later. So FINN is built around one idea, and reliability comes first.

**The idea:** _a management's word is a record._ FINN extracts every forward-looking statement from the earnings calls, with the exact quote and page, and checks it against what the company later reported, in code, with stated tolerances. That record then shows up wherever it matters: next to a holding, on a company page, and as questions to ask management.

**What FINN does**

| Side | Feature                                                                                                                                                                                         | In the app                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Push | **Feed:** a windowed digest of exchange filings for your holdings, ranked by impact on the book, routine filings folded, each item with a plain reason                                          | Feed tab                        |
| Push | **Results card:** Revenue, EBITDA (one stated formula), margin, PBT, PAT, QoQ and YoY in ₹ crore, consolidated preferred, with arithmetic checks and one-off flags; a bank variant              | Item sheet, company Results tab |
| Push | **Alerts:** price moves relative to each stock's own volatility and volume relative to its 20-day average, each paired with the filing that explains it, or the words "No filing explains this" | Alerts tab                      |
| Push | **Governance first:** auditor changes, pledges, promoter selling, senior exits and regulatory orders always rank first                                                                          | Feed, company Overview          |
| Pull | **Research on any NSE company:** annual report, four calls, prices and five years of numbers, read as resumable steps you can watch                                                             | Research tab, company page      |
| Pull | **Guidance (promised vs delivered):** Met / Missed / Pending, grouped by the call it was said on, page links to the source                                                                      | Company → Guidance              |
| Pull | **Cash quality and trajectory:** CFO ÷ PAT against a 1.0× line; revenue, margin and ROCE as small multiples; every chart has a table                                                            | Company → Research              |
| Pull | **Questions for management:** built from gaps in the record and the numbers, each with its source                                                                                               | Company → Overview              |
| Pull | **Mandate check:** the annual report's segment note against ENAM's exclusions                                                                                                                   | Company → Overview, Holdings    |

---

## 2. Research foundation: building for ENAM

We started from ENAM's stated philosophy and from who will judge the work. The full synthesis, including the competitor teardown, is in [`FINN_research_synthesis.md`](FINN_research_synthesis.md).

| ENAM principle                                                             | What it changed in FINN                                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Long-term, fundamental ownership**; ignore market cycles and benchmarks  | No index tickers, macro news or daily gainers. A price move matters only when it's unusual for that stock, and then FINN looks for the filing behind it. Research looks across years. |
| **Margin of safety**; capital preservation first                           | Risk first: governance flags and cash conversion sit early; "What could go wrong" comes before "What could go right".                                                                 |
| **Bottom-up**: understand each lever                                       | Margins in bps, other income and exceptional items flagged separately, segment targets kept apart from company targets.                                                               |
| **Invest in management**                                                   | The management record is the hero feature. Verdicts are neutral and factual ("Revised", "Not mentioned since"), never "broke a promise".                                              |
| **Governance focus**                                                       | Governance and promoter events always rank first in the Feed and colour a holding's status.                                                                                           |
| **Concentrated book; size of upside**                                      | Ranking weighs each filing by the holding's weight in the portfolio.                                                                                                                  |
| **Contrarian, independent**                                                | No consensus estimates, broker targets or buy/sell language anywhere.                                                                                                                 |
| **Ethical mandate**: no intoxication, gambling or harm to living creatures | A clean demo portfolio, a mandate check in research, and edits to holdings that refuse excluded names.                                                                                |
| **Understated character**                                                  | A calm, light palette; no emojis, hype or gamification; plain sentences.                                                                                                              |

**Built for a room of chartered accountants.** Most of the people reading this are CAs, and a wrong number costs more than a missing feature. So:

- **Numbers are computed in code, never by a model.** Models extract text; arithmetic happens in TypeScript.
- **Every results card states its basis** (consolidated or standalone) and its EBITDA formula: _PBT before exceptional items + finance costs + depreciation − other income − share of JV/associate profit_. Banks get net interest income instead of EBITDA.
- **Every card checks itself:** PBT − tax = PAT; operating lines tie to PBT; figures cross-checked against Screener; other income above 25% of PBT is flagged as a possible one-off.
- **Every quote is matched word by word against its cited page.** Below an 85% match it is dropped, and the drop is counted ("5 quotes failed verification and were dropped").
- **Absolute dates in IST, ₹ crore with Indian grouping, true minus signs, tabular figures.**

---

## 3. Architecture and stack

Details: [`FINN_backend_architecture.md`](FINN_backend_architecture.md) and [`FINN_frontend_design.md`](FINN_frontend_design.md).

```
 Your laptop (residential IP)          Vercel bom1 (Mumbai)                    Supabase ap-south-1
 ┌──────────────────────────┐          ┌──────────────────────────────┐        ┌──────────────────────────┐
 │ tools/refresher (CLI)    │  writes  │ apps/api: Hono on Node        │ reads  │ Postgres: companies,     │
 │  NSE → BSE fallback      │ ───────▶ │  /v1 read endpoints (cached)  │ ◀────▶ │ filings, results,        │
 │  Yahoo prices, Screener  │          │  research jobs (resumable)    │        │ guidance, verdicts, ...  │
 │  packages/core           │          │  cron endpoints (secret)      │        │ Storage: document text,  │
 └──────────────────────────┘          │  packages/core (same code)    │        │ large model outputs      │
                                       └──────────────▲───────────────┘        └──────────────────────────┘
                                                      │ JSON only
                                       ┌──────────────┴───────────────┐
                                       │ apps/web: React 19 + Vite    │
                                       │ talks only to /v1            │
                                       └──────────────────────────────┘
```

**Monorepo** (pnpm workspace, TypeScript throughout):

| Package             | Role                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared`   | zod schemas and types shared by everything: results cards, guidance, verdicts, the API envelope                                                                                                                                            |
| `packages/core`     | All domain logic as pure TypeScript with injected ports (HTTP, clock, store, model): fetchers, triage pipeline, results engine, verdict engine, governance, model router. No I/O of its own, so the same code runs in the API and the CLI. |
| `packages/adapters` | Node implementations of the ports: fetch, Yahoo chart client, Supabase store                                                                                                                                                               |
| `apps/api`          | Hono API under `/v1`, deployed to Vercel `bom1` with fluid compute                                                                                                                                                                         |
| `apps/web`          | The phone app                                                                                                                                                                                                                              |
| `tools/refresher`   | CLI for ingestion from a residential connection                                                                                                                                                                                            |
| `supabase/`         | Migrations (row-level security on, no public policies: only the API's service key reads) and the demo-portfolio seed                                                                                                                       |

**Frontend:** React 19, Vite, TypeScript, React Router, TanStack Query (cached responses persist to local storage, so the last data shows offline), Tailwind v4 with the default palette switched off, so only FINN's tokens exist. A light-only "working papers" look: IBM Plex Sans for everything, IBM Plex Serif only for management's own words. Status colour always comes with a word and a glyph (✓ Met, ✕ Missed, ! Watch). A fixed bottom tab bar (Feed, Holdings, Alerts, Research); detail opens in bottom sheets (Vaul) instead of growing the page. **No infinite scroll:** segments show at most six rows, then "See all" opens a list page with filters and "Next 20" paging. Main bundle about 145 KB gzipped; the company page and the sheet code load on first use.

**Backend:** Hono on Node, Vercel `bom1` (Mumbai, next to the data), one response envelope `{ ok, data, as_of, stale, stale_reason }` with a single error contract, CDN caching (`s-maxage=60, stale-while-revalidate=600`) on read endpoints. Supabase Postgres holds structured rows; raw document text and large model outputs live in Storage, which keeps the database small.

**Decoupled ingestion.** NSE returns 403 to cloud IP ranges. So the app reads precomputed rows (one exception is listed under [known limitations](#current-status-and-known-limitations)), and every response carries `as_of` so staleness is visible ("Updated 15:03", amber when old). Filings come from NSE when reachable and from BSE as the designed fallback; the refresher CLI runs the same `packages/core` code from a laptop. Research jobs fetch from Screener, BSE document links and Yahoo, which are reachable from the cloud.

---

## 4. Assumptions

| Area                      | Assumption                                                                                                                       | Why                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Demo portfolio**        | 18 stocks, weights summing to exactly 100%, no single name above 10%                                                             | A concentrated, realistic book; the seed fails if any of this is violated.                                                                                           |
|                           | 100% inside ENAM's ethical mandate: no alcohol, tobacco, gambling or real-money gaming, or businesses that harm animals          | Several competing demos held ITC or United Spirits. A reviewer at ENAM would notice.                                                                                 |
|                           | Includes a bank (HDFC Bank) and an NBFC (Bajaj Finance)                                                                          | EBITDA doesn't apply to lenders; the results card must handle them correctly.                                                                                        |
|                           | Mixed sectors and several companies that reported Q2 FY27 in the week before submission                                          | So the Feed and results cards show fresh, real filings on the first screen.                                                                                          |
|                           | Weights, not quantities                                                                                                          | The ledger stores each holding's weight. The Holdings value line is an index (first session = 100) from real closes; there is no ₹ total until quantities are added. |
| **Exchange connectivity** | NSE blocks cloud IPs (403); BSE does not                                                                                         | Observed while building. Ingestion runs from a residential machine; BSE is the fallback, and screens read stored data rather than calling an exchange.               |
|                           | Filings are tracked for holdings only                                                                                            | Companies you don't hold get research (documents, prices, numbers) but not a filings feed; the app says "Not tracked" instead of "On track".                         |
| **Sources**               | Primary disclosures only: exchange filings, annual reports, earnings call transcripts, results                                   | The brief bans secondary sources in research. No news, broker notes or model memory.                                                                                 |
|                           | Screener's tables are used to cross-check results and for multi-year figures, labelled as Screener wherever shown                | XBRL from NSE isn't reachable from the cloud; Screener is a cross-check, never presented as the filing.                                                              |
|                           | Prices from Yahoo Finance daily closes                                                                                           | Free, reachable, enough for volatility-relative alerts.                                                                                                              |
| **Accounting**            | Consolidated preferred; standalone only when consolidated isn't reported; the basis is always stated                             | CAs compare like with like.                                                                                                                                          |
|                           | All amounts in ₹ crore; lakh converted                                                                                           | One unit, Indian convention.                                                                                                                                         |
| **Verdicts**              | A target is "due" only after its period has been reported; tolerance 0.5 pp for margins, 2% of the target for growth and amounts | Avoids calling a target missed early, and states exactly how close counts as met.                                                                                    |
| **Time**                  | All times in IST and absolute ("Updated 14 Nov, 19:30")                                                                          | "2h ago" on old data misleads.                                                                                                                                       |

---

## 5. Key architectural decisions

### Four-tier model routing (rules first)

| Tier          | Used for                                                                                               | Primary (env var)                                                                    | Failover                   |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------- |
| **0: code**   | Classification by rules, scoring, headlines from templates, arithmetic, verdicts, grouping, alerts     | none                                                                                 | none                       |
| **1: cheap**  | Filings the rules can't place, headline rewrites, meeting dates, segment tagging for the mandate check | `MODEL_CHEAP=gemini-3.1-flash-lite`                                                  | Groq `openai/gpt-oss-20b`  |
| **2: mid**    | Guidance extraction from long transcripts, results-PDF fallback, people profiles, scoped Q&A           | `MODEL_MID=gemini-3.5-flash`                                                         | Groq `openai/gpt-oss-120b` |
| **3: strong** | Risk write-ups and question wording (once per company per new document)                                | `MODEL_STRONG=gemini-2.5-pro`, or a `claude-…` model (the provider follows the name) | Groq `openai/gpt-oss-120b` |

Each task maps to a tier in one config table, so changing a model is a config change. Every model call asks for JSON against a zod schema (sent as JSON Schema), gets one repair retry, and fails over to the next provider on rate limits or errors. The 241 analysed filings in the demo data were triaged with no model call at all; the 32 that no rule could place are marked "Unclassified" and still ranked by position size, which is where tier 1 would step in.

**Caching.** The cache key is a SHA-256 of task, prompt version, model and input. Results are stored inline when small and in Storage when large; a document is never sent to a model twice for the same task. Every call is logged to `llm_calls` with tokens and cost at list price, which is where these figures come from: **100 model calls so far, ₹26.54 in total**, of which ₹25.79 was guidance extraction across 17 companies' transcripts.

### A deterministic verdict engine

Models extract statements; code decides verdicts. For each guidance thread (the latest statement on a metric and period), the engine compares the target with reported actuals of the same basis and returns one of:

| Verdict                 | Meaning                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| **Met**                 | Delivered within tolerance                                                                  |
| **Missed**              | Period reported; outside tolerance                                                          |
| **Behind**              | Period still running; pace says it won't get there                                          |
| **Revised**             | A later call changed the target (both quotes kept)                                          |
| **Too early**           | The period hasn't been reported yet                                                         |
| **Not measurable**      | No period, segment-level, or no comparable actual (shown as "Can't check", with the reason) |
| **Not mentioned since** | Dropped from later calls without a revision                                                 |

The credibility line counts only Met and Missed: "Met X of Y targets that are due". Rule version, tolerances and the quote-match threshold are listed in the app under **How FINN decides**.

### Results: extract, then prove

XBRL first where available; otherwise the results PDF read by the mid-tier model, where every extracted figure must be found on its cited page; otherwise Screener's figures, labelled as such. Every card runs its checks before it's shown.

### Research as resumable steps

A research job is a list of bounded steps (find documents, prices, annual report, mandate, read each call, extract guidance, verdicts, snapshot). Each step saves its result, so a job survives timeouts and restarts; on Vercel it hands itself on after 240 seconds, and a stalled job resumes on the next poll. The phone polls every 2 seconds and shows each step in plain words.

### A Feed window that adapts

The Feed opens on **since the latest results season began**, the window an investor checks after results week. "Since last visit", 24 hours, 7 days and a custom range are one tap away. If a window has nothing material, FINN widens back to the last material item and says so ("Quiet since Tuesday. Showing the last material item.") rather than showing an empty screen.

---

## 6. Trade-offs we accepted

| We chose                                                  | Over                                      | Because                                                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Precomputed data served from Supabase**                 | Fetching from exchanges when a page loads | NSE blocks cloud IPs, and most competing demos broke for exactly this reason. The cost: data is as fresh as the last refresh, and the app says when that was. |
| **A calm, light-only "working papers" palette**           | A trendy dark mode or a theme picker      | One carefully checked design reads better in a review than two half-checked ones; the audience reads documents, not dashboards.                               |
| **Card-scoped, cited Q&A** ("Ask about this" on a filing) | An open chat box                          | Answers come only from that company's numbered sources; citations are checked against the sources given, and the model refuses when the sources don't answer. |
| **Code for every number and verdict**                     | Letting a model summarise performance     | Reproducible, testable, and nothing a CA would catch as a hallucinated figure.                                                                                |
| **Saying "Can't check" or "Not read yet"**                | Filling gaps with estimates               | An honest blank is better than a confident wrong number.                                                                                                      |
| **Weights only, with a value index**                      | Inventing quantities to show a ₹ total    | The ₹ total needs real quantities; the index is computed from real closes.                                                                                    |
| **Rules-first triage**                                    | Sending every filing to a model           | Cheaper, faster, explainable ("Results filing. Large position makes this material"), and it keeps working when a model is down.                               |

---

## 7. What we deliberately left out

| Left out                                                        | Why                                                                                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A chat-first home screen**                                    | It's the obvious answer, and the brief asks for more. Investors think in companies, so FINN is company-first; Q&A is scoped to one filing or company. |
| **Index tickers, macro news, sector rotation, daily gainers**   | ENAM ignores market cycles and benchmarks.                                                                                                            |
| **Broker target prices, consensus estimates, buy/sell signals** | Independence from the Street, and the brief bans secondary sources.                                                                                   |
| **LinkedIn scraping for executive bios**                        | The appointment filing already carries a profile, and scraping is legally risky.                                                                      |
| **Logins, accounts, theme pickers, CSV import**                 | Scope without signal for a single-user prototype.                                                                                                     |
| **Social, podcast or X sources**                                | Not primary sources.                                                                                                                                  |
| **Trading, tax or gamification**                                | The wrong user and the wrong tone.                                                                                                                    |

---

## 8. Roadmap: where FINN goes next

| Next                               | What it adds                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Push delivery**                  | Web push and the Telegram digest within a daily budget (at most 3 messages), wired to the Act tier and the category switches already stored in Alerts → Rules.  |
| **Portfolio concentration alerts** | An alert when a holding drifts above the house limit (the 10% rule exists today as a warning when holdings are edited).                                         |
| **Continuous mandate monitoring**  | Scan every new exchange announcement (acquisitions, new segments, subsidiaries) for activity that would breach the ethical mandate, not only the annual report. |
| **Capital-allocation trail**       | Multi-year audit of capex, acquisitions, fund raises and buybacks: what was said at the time vs what happened since.                                            |
| **Quantities and cost basis**      | A real ₹ book value and gains, once holdings carry quantities.                                                                                                  |
| **Wider guidance coverage**        | Annual-report targets alongside call guidance; segment-level actuals so segment targets can be checked.                                                         |
| **Evaluation**                     | Triage recall on a labelled set of filings ("missed 0 of N material") and results accuracy against filings across the portfolio.                                |

---

## Current status and known limitations

Stated plainly, so nothing surprises a reviewer:

- **Not deployed yet.** The API is configured for Vercel `bom1` (`apps/api/vercel.json`); no Vercel cron schedule is configured, so data refreshes run from the refresher CLI.
- **Guidance coverage:** 15 of the 18 holdings have extracted guidance (plus Reliance and Urban Company from test research). Asian Paints, Supreme Industries and Sona Comstar still need a research run. Some calls failed extraction (very long transcripts exceeded the failover model's request limit; one BSE transcript link returned a web page instead of a PDF), and those show fewer promises.
- **Few verdicts are due yet.** Most extracted targets are for FY27 or later, so they read as Pending until those periods are reported.
- **Risk write-ups** ("What could go wrong") need the tier-3 step, which isn't wired into research jobs yet; the Research tab says so instead of showing an empty section.
- **Results cards** come from Screener's figures, labelled as such, until a results filing is read; the arithmetic checks still run.
- **No authentication.** This is a single-user prototype; the write endpoints (holdings, alert rules, settings) are open to anyone with the API URL.
- **Telegram and WhatsApp delivery** are shown in Alerts → Rules but nothing sends messages yet: no Telegram bot is configured, and the WhatsApp form only saves the number to settings.
- **One request-path download:** opening a management-change filing's sheet fetches that filing's PDF from BSE to read the people details, when they haven't been read before. Every other screen reads stored data only.

---

## Repository guide

| Path                                                           | What's there                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`FINN_research_synthesis.md`](FINN_research_synthesis.md)     | ENAM's philosophy, the competitor teardown, and the build spec this README summarises       |
| [`FINN_backend_architecture.md`](FINN_backend_architecture.md) | Data sources, pipelines, verdict engine, model routing, database and API design             |
| [`FINN_frontend_design.md`](FINN_frontend_design.md)           | Design tokens, page-length rules, components and wording                                    |
| `packages/core/test`                                           | Unit tests: triage, results arithmetic, verdicts, governance, people, model router failover |
| `apps/api/test/live.test.ts`                                   | End-to-end tests against the live database                                                  |
| `.env.example`                                                 | Every setting, with the model IDs and failover mapping                                      |

Source PDFs from ENAM or the exchanges are never committed (`*.pdf` is git-ignored), and no secrets are in the repository.
