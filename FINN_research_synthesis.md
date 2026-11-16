# FINN: research synthesis and build spec

Prepared 15 Nov 2026, for the ENAM AI Engineer Build Challenge (deadline 15 Nov 2026).
Inputs:
- the ENAM brief and reference document
- our problem breakdown (`01_problem_breakdown.md`)
- 16 competitor GitHub repos and 9 live demos, checked at phone width on 12 Nov and re-checked for new commits on 15 Nov
- ENAM's website text (culture, philosophy, team)
- 8 YC-backed companies in AI investment research

---

## 0. The short version

1. **ENAM grades judgment, not coverage.** They want a point of view on how an investor should interact, analysis rather than summary, a demo that runs on a phone and on a ticker they choose, smart cost choices, and a visible AI build history.
2. **"Promised vs delivered" is table stakes.** 12 of the 15 competing projects have it. We win on **verdict quality** and **where it appears**: on the push card when new guidance lands, not as a separate tab.
3. **ENAM cares most about management quality, governance and capital allocation.** It invests for the long term, keeps an ethical mandate (no intoxication, gambling, or harm to living creatures), and has an understated tone. Most partners are chartered accountants: accuracy beats breadth.
4. **Most competitor demos were broken when opened later.** Of 9 live demos on 12 Nov, only 3 showed fresh real filings on the first screen. NSE blocks GitHub's servers, so plan for that.
5. **The open space:** Indian filings (LODR disclosures, NSE XBRL results, appointment-profile disclosures) on a phone, judged through ENAM's own philosophy. None of the 15 student projects or 8 YC companies does this.
6. **Our point of view:** *FINN keeps a record of what each management has promised, checks every new filing against it, and puts governance first, in a calm, sourced, phone-sized form.*

---

## 1. What ENAM is grading (from the brief)

| What they say | What it means for us |
|---|---|
| "What you choose to build, and how, is the signal." | What we leave out counts as much as what we build. Write it up. |
| "Show a point of view about how an investor should interact… try more than the obvious." | A chat box alone is the default answer. We need an interaction idea. |
| Promised vs delivered is "the kind of thing we value most." | This is the hero, done carefully. |
| "No AI slop… feel like a product someone thought hard about." | Production wording, density, design. |
| Model routing, caching, chunking earn bonus points; free tiers are enough. | Rules first, cheap model when unsure, strong model only where reasoning is needed. |
| "Thin-but-working beats broad-but-broken. A demo that doesn't run is the worst outcome." | Reliability is the first feature. |
| "We may point it at a company you didn't pick." | Research on an unseen ticker must work **in the deployed app**. |
| Submit the AI build history. | Raw exports plus a decision log. |
| Pull side: primary sources only. Push-side enrichment like a person's background is fine. | No news, broker notes or model memory in research. |

**The brief's feature menu:**
- **Push:** a windowed digest (24h default, choosable window, prioritised, routine folded) and triggered alerts (category, plus configurable price/volume). Presentation examples: a management-change bio, and a results card with Revenue, EBITDA, PBT and PAT, QoQ and YoY. Everything else: a one-liner or just the right priority.
- **Pull:** business snapshot, financial snapshot, trajectory, balance sheet, cash quality, narrative vs numbers, guidance, bull vs bear. Worked example: 4 quarters of promised vs delivered.

---

## 2. ENAM: who they are and what that means for FINN

### 2.1 Culture and philosophy (from their website)

| ENAM principle | Their words, paraphrased | Product meaning |
|---|---|---|
| Long-term investing | Invest long term; don't change decisions with market cycles; unlevered own capital; ignore benchmarks and macro | No index tickers, macro or daily P&L. Price moves matter only when fundamentals moved. Multi-year views in research. |
| Margin of safety | Highest upside with lowest risk of loss; capital preservation first | Risk first: governance flags, balance sheet and cash conversion early; "What could go wrong" before upside. |
| Bottom-up approach | Understand each lever of a company's system | Segment drivers, cost structure, working capital, not just headline numbers. |
| Invest in management | Value management's leadership and capital allocation | Management record (say vs do), capital allocation trail, senior-exit patterns. |
| Contrarian | Don't hesitate to differ from the Street; value independence | No consensus, broker views or price targets. Show "price moved, filings didn't". |
| Degree of upside | Size of returns over frequency of wins | Concentrated book: rank by impact on the portfolio (position size). |
| Governance focus | "Extremely focussed on the quality of management teams and governance frameworks" | Governance and promoter items always at the top. |
| Ethical mandate | No businesses involving intoxication, gambling, or harm to living creatures | Clean demo portfolio; a **Mandate check** in research; mandate-breach alerts. |
| Relationship-oriented | Work closely with owners and senior management | "Questions for management" built from the record. A respectful, factual tone (no snark). |
| Understated character | "Deeply spiritual, balanced, and understated" | A calm UI: muted palette, no hype, no emojis, no gamification. |

### 2.2 Who will look at it (inferred from public bios; these are guesses)

| Person | Background | Likely to check first |
|---|---|---|
| Vallabh Bhanshali | CA + law; investment banker; interest in behavioural science | Accounting accuracy, legal and regulatory filings, management behaviour over time |
| Nemish Shah | Long-term investor; values-led (founded FLAME) | Respect for the long view and the ethics mandate; calm tone |
| Akash Bhanshali | CA; principal investments; scaling mid-size businesses | Mid-cap execution: capex, capacity, how growth is funded |
| Manish Chokhani | CA, LBS MBA; ex-CEO Enam Securities; listed-company boards | Board-level governance, capital-market deals, disclosure quality |
| Gautam Jain | 25 years in investment banking | M&A and fund-raise terms: price, dilution, use of money |
| Sridhar Sivaram | Ex lead PM, Morgan Stanley India; CA, CS, cost accountant | Portfolio view and position sizing; correct filing categories; cost and margin drivers |
| Ajay Bhatia | Analyst since 1992; runs research and broker relationships | Faster and more trustworthy than broker notes? Is every claim from a primary source? |

**Implication:** most of the people judging this are CAs. A wrong number, a consolidated/standalone mix-up, or an unflagged one-off costs more than a missing feature.

### 2.3 Brief features upgraded through ENAM's lens

| Feature | What the brief asks | ENAM-specific upgrade | Why ENAM cares | Priority |
|---|---|---|---|---|
| Windowed digest | 24h default, choosable, ranked, routine folded | Open on "since you last looked"; add a "since last results" view; rank by impact on the book; keep it short | Long holds, concentrated book, size of upside over number of wins | Must |
| Category alerts | Material types I care about | Governance and promoter items always top: auditor resignation or qualification, pledge, promoter selling, senior exits, regulatory orders, related-party deals | Governance focus | Must |
| Price/volume alerts | 2× volume, ±X%, configurable | Relative to the stock's own volatility; pair with the explaining filing, or say "no filing explains this" | They disregard market cycles | Must (cheap) |
| Results card | Revenue, EBITDA, PBT, PAT, QoQ and YoY | Add a guidance line; flag exceptional items and other income; state consolidated; Q2/Q4 half-year cash vs PAT; ₹ crore | CAs check definitions, one-offs, cash conversion | Must |
| Management change | Bio of the incoming person | Leaver's tenure and stated reason; senior exits in the last 12 months; prior roles from the filing; promoter-family flag | Invest in management; churn is a governance signal | Must |
| Other filings | One-liner or right priority | Capital filings get the money in one line (deal price, QIP size and dilution, capex vs asset base); dividends and bonus issues fold | Capital allocation; bankers read terms first | Should |
| Business snapshot | Segments, mix | "How it makes money", lever by lever | Bottom-up | Should |
| Financial snapshot + trajectory | Headline numbers, multi-year | 5–10 year view: ROCE/ROE trend, segment growth | Long term | Should |
| Balance sheet + cash quality | Debt, working capital, cash conversion | Put these early: 5-year cash vs PAT, working-capital days, debt, contingent liabilities, related-party deals | Margin of safety | Must (cash conversion at least) |
| Promised vs delivered | 4 quarters | **Management record**: say vs do plus capital-allocation trail; neutral verdict words | Invest in management | Must (hero) |
| Bull vs bear | A tight case each way | "What could go wrong" first; every point cited; no targets, no Street view | Margin of safety, contrarian | Should |
| Interaction model | Experiment | Company-first, each holding with a state; not chat-first | They think in companies; relationship-oriented | Must |
| Cost and routing | Cheap bulk, strong where needed | Keep it; ₹ cost in the writeup, not in the UI | Lean firm; bonus points | Must (writeup) |

### 2.4 New features from ENAM's philosophy

| New feature | What it does | Why ENAM | Effort | Priority |
|---|---|---|---|---|
| Mandate check | Read the annual report's segment note and flag revenue from alcohol, tobacco, gambling or real-money gaming, and businesses that harm animals. The list is editable (where to draw the line is their call). | Stated ethical exclusions; nobody else built it | Low | Must |
| Governance strip | "No governance flags in 12 months", or the flag (auditor change or qualification, pledge %, promoter buying/selling, related-party approvals, senior exits, regulatory orders) | Governance focus; the reference glossary defines related-party deals, auditor qualification and contingent liabilities | Medium | Must |
| Questions for management | 3–5 sourced questions from record gaps (missed targets, topics not mentioned since a call, unexplained exits) | Relationship with management; research-head workflow | Low (built on the record) | Should |
| "Price moved, filings didn't" | A sharp move with no change in filings or the record; never a buy call | Contrarian, long term | Low | Should |
| Capital allocation trail | Capex, acquisitions, fund raises, buybacks: what was said then vs what happened since | Their top criterion | Medium-high | Could (1–2 companies) |

### 2.5 Language and tone

| Write this | Not this | Why |
|---|---|---|
| ₹1,988 cr · Q2 FY27 · consolidated | 1988.3 Cr · $ · INR 19.9bn · Q2'27 | Indian CA conventions; always state consolidated or standalone |
| Revenue +26% YoY; EBITDA margin 13.1% (−320 bps) | +26.04%, "+3.2pp", decimals everywhere | Round to what matters; one consistent unit for margins |
| "Guided 20.5–21.2% EBITDA margin for FY27 (Q4 FY26 call, p.17). H1: 15.6%." | "Management failed to deliver" | Facts plus source; let them judge |
| "Target revised from 20% to 15% (Q1 FY27 call)" | "Moved the goalposts" | They work with managements; snark reads junior |
| "Not mentioned since the Q4 FY26 call" | "Quietly dropped" | Factual and understated |
| Verdicts: Met · Missed · Behind · Revised · Too early · Not measurable | Kept / Broke promise · scores · grades | Neutral, precise |
| "Stock −9.7% on 13× usual volume, the day after results" | "crashed", "tanked", "bearish", "rally" | Understated house style |
| "Auditor resigned, citing [reason from the filing]" | 🚩 RED FLAG, exclamation marks, emojis | Calm and serious |
| PAT, PBT, EBITDA, ROCE used without inline explanation; glossary one tap away | "PAT (Profit After Tax) is…" on cards | The audience is CAs |
| "Needs your attention: 2" | "AI insights", "Smart alerts", "Powered by AI" | The product shouldn't talk about itself |
| No buy/sell/hold, targets, "upside of X%", "Street expects" | — | Independence; the brief bans broker views |
| Absolute dates ("as of 15 Nov, 18:30 IST") | "2h ago" on old data | Trust |


---

## 3. YC-backed companies doing something similar

None covers Indian NSE/BSE filings. Only Astor (retail) is mobile-first.

| Company (batch) | Website | Brief features they have, and how they do them better | Missing vs the brief | What to borrow for FINN |
|---|---|---|---|---|
| Hudson Labs (S21) | hudson-labs.com | Guidance captured in full **including hedged language**; shows which managements revise guidance; separates reported values from guidance. Forensic risk scores across 8 categories (Earnings & Accounting, Liquidity/Credit/Financing, Related Parties & Conflict, Resignations & Dismissals, Internal Controls, Legal & Regulatory, Governance, Strategic Complexity), shown as change over time. Event-triggered or scheduled agents email structured reports. Answers cite the disclosure. | US issuers and ADRs only; no price/volume alerts, no bios, inbox not phone | Keep hedge words in the record; governance strip structured on their categories, shown as change since last year; concall transcript triggers a record update |
| Fintool (W23; acquired by Microsoft, Apr 2026) | fintool.com | Chat; a screener on factors mentioned in calls and filings; a real-time feed on news and 8-Ks; "spreadsheets and reports that update themselves" | US only; no per-holding results card or bios; not mobile | A living research note that updates when a filing lands ("updated after Q2 FY27 results"); skip consensus tracking |
| Astor (S25) | astor.app | Morning brief, market alerts, evening recap; line-crossing triggers (e.g. concentration limit); text-first (iMessage) plus iPhone app; each text links to a brief with thesis, numbers, risks and sources; alerts filtered by holdings and risk; insider-activity alerts | Retail and trading (Text to Trade); research mixes expert commentary; no results card or record; US only | One short message, then a sourced brief, via Telegram; concentration alert; drop the trading, tax and chatty tone |
| Cohesion (Spring 2026) | cohesionplatform.com | Agents track earnings, news, podcasts and X for covered companies; setup is sending 20 tickers (~2 min) | Alerts and UI not described; social sources go against the primary-source rule | "Paste your holdings" setup in two minutes; avoid social sources |
| finbar (W25) | finbar.com | Data within minutes of release; time series; prebuilt Excel models; handles restatements, accounting changes, mergers, divestments | Push and citations not described; not mobile | "Prior period restated / not comparable" on the results card |
| Multiplier (formerly WithAI, Spring 2026) | multiplier.ai | Connects AI to the fund's research, data and tacit knowledge; interface like an IDE rather than a chat window | Enterprise, on-site; specifics not described | A "House view" page: ENAM's materiality rules, exclusions and horizon visibly driving the ranking |
| KelAI (Spring 2026) | kelaitech.com | Connects to the fund's mandate, universe, risk rules and research history; tracks why ideas worked or failed; learns from PM feedback; humans decide | Quant and signal focused | Learn from feedback ("Muted: investor meet notices"); human-decides framing |
| Kimpton AI (Spring 2026) | kimpton.ai | Ingests mandate, strategy and positions; built to challenge consensus and surface breaches and risks a PM might miss | Outputs trade proposals; US; not mobile | Mandate-breach alerts (e.g. an acquisition into alcohol, gaming or tobacco) |

Left out as not close enough: Trata (anonymous analysts' views, the opposite of primary sources), Formula Insight (KPI search across Excel and filings), Groww (broker).

**Takeaways:**
1. Push format: Astor's rhythm in ENAM's voice, on Telegram.
2. Precision: match Hudson Labs on hedged guidance and governance categories.
3. Mandate: three of these companies build the fund's mandate into the product. Our version, a House view plus a Mandate check, is current practice and tailored to ENAM.
4. Open space: Indian filings on a phone.

---

## 4. Final build spec (synthesis of everything above)

### 4.1 Reference key
- **[B]** ENAM brief · **[RD]** ENAM reference document (categories and glossary)
- **[E-Phil]** ENAM investment philosophy · **[E-Cult]** ENAM culture and ethics · **[E-Team]** ENAM team backgrounds
- **[Plan]** our problem breakdown
- **[YC: name]** YC-backed company

**Priority:**
- **P0:** ship today
- **P1:** ship if time allows today
- **P2:** put in "where I'd take it next"
- **Won't:** deliberately left out

**Effort:** S < 2h · M 2–5h · L > 5h

### 4.2 Push (the app reaches out)

| ID | Feature | What it does | Why (references) | Priority | Language / UI notes | Effort |
|---|---|---|---|---|---|---|
| P-1 | "Since you last looked" brief | Opens on items since the last visit; widens itself to the last material item when empty; secondary chips 24h / 7d / since results / custom | [B] digest; [E-Phil] long term; [Repo: Dhruv] auto-widen; [Mistake: geekyparas, Dhruv] empty 24h | P0 | Headline is a count plus judgment: "2 need you · 31 routine folded". Absolute "as of" time | S |
| P-2 | Three tiers: Act / Read / Routine | Routine folded behind a count, never deleted; each item shows why it sits in its tier | [B]; [Plan] P1/P2 fold-never-hide; LISA under-triage logic | P0 | Reason in words, not a score | S |
| P-3 | Always-Act list | Auditor resignation or qualification, pledge change, promoter selling, senior/CFO exit, regulatory order, insolvency, rating downgrade, related-party approvals | [E-Cult] governance; [RD] related-party deals, auditor qualification; [YC: Hudson Labs] risk categories; [Plan] red-flag list | P0 | "Auditor resigned, citing …" No emoji | S |
| P-4 | Rank by impact on the book | Score uses category, position weight and the stock's reaction | [E-Phil] degree of upside, concentrated book; [Repo: Dhruv] weights | P0 | "Results · 9% of your book · stock −6%" | S |
| P-5 | Rewritten headlines | Never show a raw exchange subject; one plain line | [Mistake: Harsh, sssinghm, Vikash]; [B] no slop | P0 | "HDFC Bank has a new CEO" | S (cheap model) |
| P-6 | Results card | Revenue, EBITDA, PBT, PAT, QoQ and YoY, margins; consolidated stated; ₹ crore; one-offs flagged (exceptional items, other income); Screener cross-check, flag mismatches; "prior period restated / not comparable"; bank variant | [B]; [RD]; [E-Team] CAs; [Repo: Harsh, ayansh] XBRL; [Repo: geekyparas, Dhruv] cross-check; [YC: finbar] restatements | P0 | Colour only big moves; tabular numbers; EBITDA definition in the method sheet | M |
| P-7 | Guidance line on the results card | "Revenue +11% YoY; FY27 guidance 15–18%; behind for the second quarter" | [B] worked example; [Plan] push and pull meet; [E-Phil] invest in management | P0 (where a record exists) | Neutral verdict words | S (after PL-2) |
| P-8 | Half-year cash vs PAT on Q2/Q4 cards | Uses the half-year cash-flow statement in Q2/Q4 results | [E-Phil] margin of safety; [RD] cash conversion; [E-Team] CAs | P1 | "H1 operating cash ₹X cr vs PAT ₹Y cr (0.8×)" | M |
| P-9 | Management-change card | Who, role, prior roles (from the appointment profile in the filing), effective date; for exits: tenure, stated reason; senior exits in last 12 months; promoter-family flag | [B]; [Plan] filing has a brief profile; LinkedIn scraping legally risky; [E-Phil] invest in management | P0 | "CFO resigned after 3 years, citing personal reasons. Second senior exit this year." | M |
| P-10 | **Concall card: new guidance vs the record** | When a transcript lands, show new or changed guidance vs the last call, plus the track record | **Gap: no repo or YC company does this for India**; [YC: Hudson Labs] guidance revisions + event triggers; [E-Phil] invest in management; Q2 transcripts are landing now | P0 (our differentiator) | "New FY27 guidance 18–20% (last call 20–22%). Record: 1 of 4 targets met." | M |
| P-11 | Capital-allocation one-liners | Acquisitions, QIPs, preferential issues, capex: amount, dilution, what it buys | [E-Phil] capital allocation; [E-Team] bankers | P1 | "Raising ₹1,200 cr via QIP, about 4% dilution" | S |
| P-12 | Price/volume alerts relative to own volatility | Move in standard deviations of its last 60 days; volume vs 20-day average; plain presets; editable; pair with the explaining filing or say none | [B] configurable; [Plan] P7; [E-Phil] ignore market noise; nobody did this | P0 | "−9.7% (3× its usual daily swing) on 13× volume, the day after results" | S |
| P-13 | Real push via Telegram | Morning brief plus Act-tier alerts only; at most 3 messages a day; link opens the card | [B] "tell me the moment"; [YC: Astor] rhythm; only 2 of 15 repos push | P1 | One line plus "Open". Calm | M |
| P-14 | "Coming up" strip | Results and concall dates from board-meeting notices | Nobody used them; fixes dead empty states | P1 | "Next: Dixon results Fri 14 Nov" | S |
| P-15 | Event grouping | Related filings on the same event become one card | [Repo: Dhruv, Kshitiz, geekyparas, ARYAMANN] | P1 | "+2 related filings" | S–M |
| P-16 | Concentration alert | A holding crosses X% of the book | [YC: Astor] | P2 | — | S |
| P-17 | Learn from feedback | Seen / Mute this kind; FINN says what it changed | [Repo: geekyparas] Seen/Star/Mute; [YC: KelAI] | P2 | "Muted: investor meet notices" | S |
| P-18 | Mandate-breach alert | An acquisition or new segment in an excluded activity goes to Act | [E-Cult] ethics; [YC: Kimpton] breaches | P2 | "Outside your mandate: …" | S |

### 4.3 Pull (research on demand)

| ID | Feature | What it does | Why (references) | Priority | Language / UI notes | Effort |
|---|---|---|---|---|---|---|
| PL-1 | Research any NSE ticker **in the deployed app** | Background job showing its steps; cached; shows what's available and says what isn't | [B] "we may point it at a company you didn't pick"; [Mistake: Harsh, ARYAMANN] command line only; [Plan] launch gate | P0 | "Found FY26 annual report (212 pages) · reading 4 concalls…" | M–L |
| PL-2 | **Management record** (promised vs delivered) | Guidance from the last 4–8 calls with quote and page; matched to actuals in code; hedges kept; part-year rule; segment rule; vague statements marked not measurable | [B] valued most; [E-Phil] invest in management; [YC: Hudson Labs] hedged language; [Repo: geekyparas, Dhruv]; [Mistake: geekyparas] vague → Delivered, H1 vs FY | P0 (hero) | Met · Missed · Behind · Revised · Too early · Not measurable · Not mentioned since | L |
| PL-3 | Credibility line | "Met 2 of 5 targets due" at the top of the record and on push cards | [Repo: geekyparas] list line; joins push and pull | P0 | Plain count, no grade | S |
| PL-4 | Governance strip | "No governance flags in 12 months", or the flags | [E-Cult]; [RD]; [YC: Hudson Labs] categories | P0 | Quiet when clean | M |
| PL-5 | Mandate check | Annual-report segment pass for excluded activities; editable list | [E-Cult] ethics; [YC: Kimpton, KelAI, Multiplier] mandate-aware; nobody else for India | P0 (cheap, very ENAM) | "Outside your mandate: about 12% of revenue from alcoholic beverages (AR FY26, p.34)" | S |
| PL-6 | Cash quality and balance sheet | 5-year cash vs PAT, working-capital days, debt, contingent liabilities, related-party deals | [B]; [RD]; [E-Phil] margin of safety; [E-Team] CAs | P1 (cash conversion line P0 if possible) | Numbers in code from Screener; cite AR pages for related-party deals and contingent liabilities | M |
| PL-7 | Financial snapshot and trajectory | 5–10 years of revenue, margin, ROCE; segment growth | [B]; [E-Phil] long term | P1 | Small charts, tabular numbers | S–M |
| PL-8 | Questions for management | 3–5 sourced questions from gaps in the record | [E-Cult] relationship-oriented; [E-Team] research head | P1 | "In Q4 FY26 you guided 21% margin; H1 is 15.6%. What changes in H2?" | S |
| PL-9 | What could go wrong / what could go right | Downside first; every point cited; no targets | [B] bull/bear; [E-Phil] margin of safety, contrarian | P1 | Short, cited bullets | S |
| PL-10 | "Price moved, filings didn't" | A sharp move with no change in filings or record | [E-Phil] contrarian, long term | P2 | Never a buy call | S |
| PL-11 | Living research note | Updates when a new filing lands, stamped | [YC: Fintool] | P2 | "Updated after Q2 FY27 results" | M |
| PL-12 | Business snapshot | How it makes money, lever by lever | [B]; [E-Phil] bottom-up | P2 | — | S |
| PL-13 | Capital allocation trail | Past big decisions vs what happened since | [E-Phil] capital allocation | P2 (1–2 companies if time) | — | L |
| PL-14 | "Ask about this" | A question pre-filled from a card, answered only from that company's documents with citations; refuses otherwise | [Repo: Cinnamon]; [Repo: Yash] cite-or-refuse; [B] try more than chat | P1 | Scoped, never the home screen | M |

### 4.4 Interaction model and UI

| ID | Decision | Why (references) | Priority | Notes |
|---|---|---|---|---|
| U-1 | Company-first home: holdings with a state (On track / Watch / Concern) plus today's items | [E-Phil] invest in management; [Repo: Dhruv] "Theses intact"; [B] point of view | P0 | The state comes from the record and governance, not from price |
| U-2 | Every push card opens that company's page in one tap | [Plan] stakeholder insight (PM hat vs analyst hat) | P0 | — |
| U-3 | Progressive disclosure: one line, tap for the table, method one more tap away | [Mistake: geekyparas] everything equally loud | P0 | — |
| U-4 | "How FINN decides" sheet (ranking rules, EBITDA formula, sources, model routing, ₹ cost) | [Mistake] engineer info on the home screen; [B] cost scored | P0 | Cost stays here and in the writeup |
| U-5 | House view settings: materiality rules, exclusions, thresholds, horizon, in ENAM's words | [YC: Multiplier, KelAI, Kimpton]; [E-Cult] | P1 | Shows how the ranking is driven |
| U-6 | Not chat-first; chat only scoped to a card | [B] go beyond the obvious; [YC: Multiplier] not a chat window | P0 | — |
| U-7 | Visual system: muted palette, one accent, colour only on material moves, tabular numbers, one serif display plus one clean sans, generous whitespace | [E-Phil] understated; [Mistake] purple, glass, neon, tiles | P0 | Choose the look for a reason; avoid the warm-dark template if possible |
| U-8 | Phone QA at 360px and 375px; installable PWA | [B] mobile-first; [Mistake: Dhruv] overflow | P0 | — |
| U-9 | Two-minute setup: paste holdings | [YC: Cohesion] | P2 | — |
| U-10 | No number tiles, greetings, ticker strips, index tickers, macro panels or gamification | [E-Phil]; [Mistake: Vikash, sssinghm, ARYAMANN] | P0 | — |

### 4.5 Language rules (apply everywhere)

| ID | Rule | Why (references) | Priority |
|---|---|---|---|
| L-1 | ₹ crore, Q2 FY27, consolidated or standalone always stated; Indian digit grouping | [E-Team] CAs | P0 |
| L-2 | Verdicts: Met · Missed · Behind · Revised · Too early · Not measurable · Not mentioned since | [E-Cult] relationship-oriented; [Mistake: geekyparas] snark, generous scoring | P0 |
| L-3 | Every claim has a source: document, period, page | [B] primary sources; [YC: Hudson Labs] enforced sourcing | P0 |
| L-4 | No buy/sell/hold, targets, "Street expects", hype verbs, emojis or exclamation marks | [E-Phil] contrarian, understated; [B] no broker views | P0 |
| L-5 | Don't explain PAT, EBITDA or ROCE inline; glossary one tap away | [E-Team] CAs | P0 |
| L-6 | The product never talks about itself ("AI insights", "Powered by AI") | [Mistake] | P0 |
| L-7 | Absolute timestamps; never relative times on a snapshot | [Mistake: ARYAMANN] "2h ago" | P0 |
| L-8 | Round to what matters (growth %, margin in bps); no "+0.0%" | [Mistake: geekyparas] precision theatre | P0 |
| L-9 | Name the hero "Management record", not "Promise Ledger/Tracker" | 5 repos use those names; plain investor language | P0 |

### 4.6 Data and reliability

| ID | Decision | Why (references) | Priority |
|---|---|---|---|
| D-1 | Never call NSE when the page loads; serve precomputed data | [Mistake: Cinnamon] empty brief | P0 |
| D-2 | Refresh from the laptop right before sending (NSE blocks GitHub's servers); keep the scheduled job if it works; health line showing the last successful refresh | [Repo: geekyparas] build log (403 on NSE's homepage) | P0 |
| D-3 | Ship a data copy with the frontend as fallback | [Repo: geekyparas] | P0 |
| D-4 | Results: XBRL first, Screener cross-check, LLM fallback with arithmetic checks (PBT − tax = PAT, etc.) | [Repo: Harsh, ayansh, geekyparas]; [Plan] | P0 |
| D-5 | Clean demo portfolio: no ITC, United Spirits, Radico, United Breweries, Delta Corp, real-money gaming, meat or poultry | [E-Cult]; [Repo: Dhruv] had RADICO, [Repo: geekyparas] had ITC | P0 |
| D-6 | Bank variant for results (no EBITDA; show "not applicable" or NII-based lines) | [Plan]; [Repo: Dhruv] BANKBARODA | P1 |
| D-7 | Demo set: several Q2 reporters this week, one recent management change, one pledge case, one volatile small cap, one bank, mixed sectors | [Plan] section 10 | P0 |

### 4.7 Architecture, cost, evaluation

| ID | Decision | Why (references) | Priority |
|---|---|---|---|
| A-1 | Rules on subject lines first (~87% handled in other repos); cheap model only when unsure; strong model only for verdict wording | [B] routing bonus; [Repo: geekyparas, Dhruv] | P0 |
| A-2 | Numbers computed in code, never by the model; cache by document hash | [Plan] MCP Analytics Agent pattern; [Mistake: Aayush] LLM maths | P0 |
| A-3 | Check each quote against its source page before showing it | [Repo: ayansh, ARYAMANN] | P1 |
| A-4 | ₹ cost per filing and per research run in the writeup | [Repo: Dhruv] ₹86.51 list / ₹0 actual | P0 (writeup) |
| E-1 | Triage eval on ~60 labelled filings: report **material recall** ("missed 0 of N material") and precision | [Plan]; [Repo: geekyparas] accuracy only; under-triage costs more | P1 |
| E-2 | Results accuracy vs Screener on N companies | [Repo: Dhruv] 13/18 | P1 |

### 4.8 Submission

| ID | Item | Why (references) | Priority |
|---|---|---|---|
| S-1 | Raw AI history exports plus a short build log (decisions, dead ends) | [B]; [Repo: geekyparas] good; [Mistake: Cinnamon, Aayush, ARYAMANN] | P0 |
| S-2 | README: "try it in 2 minutes" path, QR code, an unseen-ticker example | [Repo: geekyparas] | P0 |
| S-3 | Writeup: what was built, decisions and trade-offs, what we left out (section 6), what's next (P2 list), tied to ENAM's philosophy | [B] | P0 |
| S-4 | Don't commit ENAM's PDFs or secrets; few docs (2–4) | [Mistake: Aayush]; [Mistake: Vikash, Harsh] doc bloat | P0 |
| S-5 | Final phone test on 2 tickers we didn't pick, after the last data refresh | [B]; [Plan] | P0 |

---

## 5. Deliberately left out (for the writeup)

| Left out | Reason |
|---|---|
| Chat-first home screen | The obvious answer; the brief asks us to go beyond it. Chat is scoped to a card instead. |
| Index tickers, macro news, sector rotation, daily gainers/losers | ENAM ignores market cycles and benchmarks. |
| Consensus, broker notes, price targets, buy/sell signals | Independence from the Street; the brief bans secondary sources in research. |
| LinkedIn scraping for bios | The appointment filing already carries a profile; scraping is legally risky (LinkedIn sued Proxycurl, which shut down in July 2025). |
| Accounts, logins, CSV import, theme switchers | Scope creep without signal (see codehub19). |
| Social, podcast or X sources | Not primary sources. |
| Trading, tax, gamification | Wrong user; ENAM's style is understated and long term. |
| Consolidating every tool | Weeks of work; listed as "next". |

---

## 6. Ship order for today (P0 first)
1. D-5 clean portfolio → D-1/D-3 precomputed data and fallback → D-2 refresh from the laptop.
2. P-2, P-3, P-4, P-5 triage with reasons → P-1 brief home.
3. P-6 results card (XBRL → Screener check) → P-12 volatility-relative alerts.
4. PL-2 management record (neutral verdicts, hedges kept) → PL-3 credibility line → P-7 guidance line → P-10 concall card.
5. P-9 management card → PL-4 governance strip → PL-5 mandate check.
6. PL-1 unseen-ticker research in the deployed app.
7. U-1 to U-4, U-6 to U-8, L-1 to L-9 wording pass.
8. S-1 to S-5: history, README, writeup, phone test, send.

---

## 7. Sources

**ENAM**
- ENAM AI Engineer Build Challenge brief and reference document (shared PDFs)
- ENAM website text: culture, investment philosophy, team (as pasted)


**YC-backed companies**
- Hudson Labs: https://www.ycombinator.com/companies/hudson-labs · https://hudson-labs.com/products · https://hudson-labs.com/llms.txt
- Fintool: https://www.ycombinator.com/companies/fintool · https://fintool.com · Microsoft acquisition (Apr 2026): https://pulse2.com/microsoft-acquisition-of-fintool-expands-ai-capabilities-for-financial-research-and-microsoft-365/
- Astor: https://www.ycombinator.com/companies/astor · https://astor.app/
- Cohesion: https://www.ycombinator.com/companies/cohesion
- finbar: https://www.ycombinator.com/companies/finbar
- Multiplier (WithAI): https://www.ycombinator.com/companies/withai
- KelAI: https://www.ycombinator.com/companies/kelai
- Kimpton AI: https://www.ycombinator.com/companies/kimpton-ai

**Background from the problem breakdown**
SEBI's 2023 LODR amendment requiring a brief profile in appointment disclosures; results timelines (45 days; within 30 minutes of the board meeting); transcripts within 5 working days; Proxycurl shutdown (July 2025). Full links are in `01_problem_breakdown.md`.
