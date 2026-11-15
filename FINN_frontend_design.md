# FINN: frontend design and build spec

Version 2 · 15 Nov 2026 · companion to `FINN_research_synthesis.md` (feature IDs like P-6, PL-2, U-1 refer to its section 5) and `FINN_backend_architecture.md` (API in its section 10).

**Constraints from you:**
1. Light theme only. No dark mode.
2. A floating bottom nav with separate pages, not one long home page.
3. No page scrolls endlessly.
4. A reviewer at ENAM should find the brief's major ideas (push, pull, portfolio) in one tap each.

**What changed in v2:** sections 2.3, 4.3, 5, 6, 7, 9, 10, 11 and 12 are rewritten for the tab structure and the page-length rule.

---

## 1. The brief, in one paragraph

FINN is used by a small, long-term, management-focused investment team: most partners are chartered accountants, and their culture is understated. They open it on a phone between meetings to answer one question: *did anything happen to a company I own that changes what I think of its management or its numbers?* The screen must answer that in about 30 seconds, show where every claim came from, and stay quiet when nothing matters. It should feel like a careful analyst's working file, not a trading app and not a news feed. It also has a second audience this week: **the ENAM reviewer**, who needs to see push, pull and portfolio within a minute of opening the link.

---

## 2. What we looked at, and what we take from each

### 2.1 Real products

| Product | What it does well (relevant to us) | Borrow | Avoid |
|---|---|---|---|
| **Quartr** (IR research, mobile + desktop) | Built only on first-party IR material; any AI answer opens the exact slide in the original PDF; a daily recap every morning | Source chip that jumps to the exact page; morning recap rhythm | Their breadth (16,000+ companies, live audio); we do one portfolio deeply |
| **Zerodha Kite** (Indian investors know it) | Minimal and fast; reviewers note its colours don't interfere with reading numbers; it stays neutral where other apps gamify with confetti, streaks or leaderboards | Restraint, neutral colour, speed, Indian number conventions | Trading-first layout (order windows, tickers) |
| **Fiscal.ai** (formerly FinChat) | Users can audit data back to source filings; segment and KPI data; earnings-release notifications | "Audit to source" on every number | Terminal density and screener breadth |
| **Koyfin** | Dense research dashboards with customisable layouts and themes | Density where it earns its place (tables) | Drag-and-drop customisation; nobody at ENAM wants to configure widgets on a phone |
| **Mercury** (premium fintech) | A colour system built for calm: green for growth, blue for stability, red and yellow kept for errors and warnings; precisely tuned typography | The discipline: few colours, each with one job | Its dark-first look (you asked for light) |
| **Linear** | Supporting elements recede and only task-central parts stay in focus; principle: "Don't compete for attention you haven't earned" | Hierarchy by recession, not decoration | — |
| **Financial Times** | Light, editorial finance; market-up/down colours | Calm, serious reading tone | The salmon-paper serif broadsheet look is now an AI-design cliché; don't imitate it |
| **Hudson Labs** (YC) | Citations name the exact disclosure, e.g. "COST 10-Q · Q4 2025" | Our source-chip format: "Q2 FY27 call, p.9" | — |
| **Astor** (YC) | Short text first, each linking to a full brief with numbers, risks and sources | Telegram message → card rhythm | Chatty retail tone |
| **Screener.in** | The tables Indian CAs already read daily (₹ crore, Indian digit grouping, consolidated/standalone toggle) | Familiar table conventions so numbers read instantly | Its plain web-1.0 chrome |

### 2.2 Design galleries (Dribbble, Kombai, Contra)

Light investing screens in current galleries converge on a white or off-white canvas, grey secondary text and one emerald or teal accent for gains, often with a mint panel. That confirms light + one accent is the professional norm. It also means emerald-on-white is the default look, so **our identity comes from a different place**: the auditor's tick mark and the split between management's words and our words (section 3).

### 2.3 Lessons from the 15 competitor demos (synthesis section 3)

- Warm-dark plus a serif display is already used by two of the best competitors (geekyparas, CinnamonRoll10). Light-only already sets us apart; we also avoid their cream-and-terracotta palette.
- No number tiles, greetings, ticker strips, badge clutter, raw exchange subjects, visible scores or token costs on any page.
- **Bottom nav:** most competitors used a fixed four-tab bar with a chat tab (Brief / Alerts / Research / Ask). We keep a bottom nav because it is the clearest way to move around on a phone, but:
  - it **floats**
  - its tabs are named after the brief's own ideas (push brief, push alerts, portfolio, pull research)
  - there is **no chat tab** (questions are scoped to a card)
  - every page is short (section 5.3)
- Test at 360px and 375px; one competitor's thesis page overflowed.

---

## 3. Design direction: "working papers"

An auditor's working file has three habits we copy:
1. **Every figure is vouched:** a tick and a reference to where it came from.
2. **The client's words are kept separate from the auditor's conclusions.**
3. **Nothing is decorated.**

That gives FINN its look without borrowing any brand.

**The one bold element: the Record strip.** A row of small tick marks showing what management promised and what happened: ✓ met, ✕ missed, ↻ revised, ◷ too early, – not mentioned since. It appears on every holding row, in the company header and on concall cards. Everything else stays quiet so this reads instantly.

**Two voices, two typefaces:**
- **IBM Plex Serif** is used only for management's own words (quotes from calls and filings).
- **IBM Plex Sans** is used for everything FINN says and every number.

A reader can tell at a glance what is a claim and what is a check.

### 3.1 What we deliberately avoid (and why)

| Default we're not using | Why not | What we do instead |
|---|---|---|
| Cream background + serif headlines + terracotta accent | The current AI-design default; also two competitors' look | Cool white paper, ink-blue accent; serif only for quotes |
| Broadsheet hairlines, zero radius, dense columns | Second most common default; reads like an FT imitation | Rows and generous spacing; rules only inside tables |
| Identical rounded cards with soft grey shadows | The SaaS kit look | Lists for items; a card only when it holds a table (results); radius changes with hierarchy |
| ALL-CAPS labels above every section | Template chrome | Sentence-case section titles, only where a section needs naming |
| Middle-dot metadata strings ("A · B · C") | Template chrome | Short sentences or two lines ("Results. 9% of your book. Stock down 6%.") |
| Monospace for small data labels | Template chrome; competitors did it | Plex Sans with tabular figures |
| Arrows appended to links ("Open →") | Template chrome | Verbs that say what happens ("Open filing, p.10") |
| Emerald-on-white "gain" accent | Gallery default | Ink blue for interaction; green only means "met" or "verified" |
| Infinite feeds | Turns a calm tool into a news app | Capped lists, segments, "See all" pages with plain paging (section 5.3) |

---

## 4. Design tokens

### 4.1 Colour (light only)

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `paper` | `#F5F7F6` | App background (cool, not cream) | — |
| `sheet` | `#FFFFFF` | Cards, sheets, tables, floating nav | — |
| `ledger` | `#EEF3EF` | Quiet fill: table header, selected row, active nav item, "Coming up" line | — |
| `rule` | `#E2E6E3` | Hairlines inside tables and lists; nav border | — |
| `ink` | `#17212E` | Primary text and numbers (blue-black, like pen ink) | 16.2:1 on white |
| `ink-2` | `#4B5563` | Secondary text | 7.6:1 on white |
| `ink-3` | `#5F6B78` | Captions, timestamps, inactive nav labels, "too early" | 5.4:1 on white, 5.1:1 on paper |
| `royal` | `#2B4C9A` | The one accent: links, selection, focus ring, active nav label, "revised" | 8.1:1 on white |
| `met` | `#1E7A45` | Met, verified tick, healthy state | 5.4:1 on white |
| `behind-mark` / `behind-text` | `#A87A12` / `#8A6410` | Behind, watch (mark ≥3:1; text 5.4:1) | — |
| `missed` | `#B23A2E` | Missed, concern, governance flag | 5.9:1 on white |

Rules:
- **Status colours never appear alone.** They always come with a glyph (✓ ✕ ↻ ◷ –) and a word.
- **Price moves are written in ink with a sign** ("−9.7%"). They only take `met`/`missed` colour when they cross the investor's own threshold.
- **No gradients, no tinted backgrounds behind numbers, no red/green flashing.**
- I ran the status palette (met, behind-mark, missed, royal) through the dataviz validator:
  - all four pass the lightness, chroma, normal-vision and 3:1 contrast checks
  - amber vs green is only 6.7 apart for protanopia (the legal floor *with* secondary encoding)
  - that is one more reason every status shows its glyph and word

### 4.2 Type

| Role | Face | Size / line height | Weight | Notes |
|---|---|---|---|---|
| Page title | Plex Sans | 23 / 28 | 600 | One per page, in the top bar area |
| Section title | Plex Sans | 16 / 22 | 600 | Sentence case |
| Body | Plex Sans | 16 / 24 | 400 | Max 66 characters per line |
| Row headline | Plex Sans | 16 / 22 | 500 | The one plain line per item |
| Caption / meta | Plex Sans | 13 / 18 | 400 | `ink-3` |
| Nav label | Plex Sans | 12 / 16 | 500 | Always visible under the icon |
| Numbers in tables | Plex Sans | 15 / 20 | 500 | `font-variant-numeric: tabular-nums lining-nums` |
| Hero number (e.g. "2") | Plex Sans | 28 / 32 | 600 | Only the Brief headline |
| Management quote | **Plex Serif** | 16 / 26 | 400 | The only serif in the app |

- Scale ratio about 1.2 from a 16 px base.
- Self-host with `@fontsource/ibm-plex-sans` (400, 500, 600) and `@fontsource/ibm-plex-serif` (400).
- **Numbers:** `Intl.NumberFormat('en-IN')` for Indian grouping (1,23,456); true minus sign (−); "₹1,988 cr"; whole-number percentages unless the decimal changes a decision.

### 4.3 Space, shape, depth, motion

| Token | Value |
|---|---|
| Spacing scale | 4, 8, 12, 16, 24, 32, 48 px |
| Page padding | 16 px (phone), 24 px (≥600 px); bottom padding = nav height + 24 px + safe-area inset |
| Row height | min 56 px; touch targets ≥ 44 px |
| Radius | 0 for list rows (separated by space and a hairline); 8 px for buttons, chips and segmented controls; 12 px for cards holding tables; 16 px top corners for bottom sheets; 20 px for the floating nav |
| Depth | Borders, not shadows. Only two elevated surfaces: the floating nav and bottom sheets, both `0 8px 24px rgba(23,33,46,.08)` plus a `rule` border |
| Motion | One moment only: on opening a company, the Record strip ticks appear left to right in 240 ms. Tab switches are instant; sheets slide in 150 ms. `prefers-reduced-motion` disables both. |

---

## 5. Navigation and page structure

### 5.1 The floating bottom nav

```
                       page content
   ┌──────────────────────────────────────────────┐
   │  ▣ Brief    🔔 Alerts   ◫ Portfolio  ⌕ Research │   ← floats 12 px above the
   │    (2)        (4)                              │     safe area, 16 px side margins
   └──────────────────────────────────────────────┘
```

| Property | Spec |
|---|---|
| Position | Fixed; 12 px above the bottom safe-area inset; 16 px from each side; max width 440 px, centred on larger screens |
| Surface | `sheet` (white), 1 px `rule` border, 20 px radius, the shared soft shadow |
| Height | 64 px; four equal items; each item ≥ 44 px wide and tall |
| Item | Lucide icon (22 px, 1.75 stroke) + label always visible (12/16, 500). Labels never hide; reviewers should not have to guess icons. |
| Active item | Label and icon in `royal`; a `ledger` pill behind the icon (40 × 28 px). No underline, no bounce. |
| Badges | Brief: number of "Needs you" items. Alerts: new triggered alerts since last visit. Small `royal` text count, not a red dot. Hidden when zero. |
| Behaviour | Always visible. It doesn't hide on scroll, so the layout stays predictable. Tapping the active tab returns that tab to its top and its default segment. |
| Company pages | Opening a company keeps the nav visible, with the tab you came from still active. "Back" in the top bar returns you to that tab. |
| Keyboard / screen readers | `nav` landmark with `aria-label="Main"`; each item `aria-current="page"` when active; badge text read as "2 need your attention". |

### 5.2 The four tabs, mapped to the ENAM brief

| Tab | What it is in the ENAM brief | What's on it | Synthesis IDs |
|---|---|---|---|
| **Brief** | Push, flavour 1: "a windowed digest… filtered and prioritised" | What changed in your portfolio for a window you pick; the few items that need you; routine folded | P-1, P-2, P-3, P-4, P-5, P-6–P-11, P-14, P-15 |
| **Alerts** | Push, flavour 2: "triggered alerts… I decide what unusual means" | Alerts that fired (unusual moves, material types) and the rules that fire them; Telegram delivery | P-12, P-13, P-16, P-17, P-18 |
| **Portfolio** | "Your companies": the 15–20 holdings | Each holding's state, Record strip, weight and move; mandate status | U-1, PL-3, PL-4, PL-5 |
| **Research** | Pull: "you ask it to research or analyse something on demand", for any NSE ticker | Search any company; ready research; a company you don't hold | PL-1, PL-2, PL-6–PL-9, PL-14 |

**Top bar on every tab:**
- page title on the left
- an absolute "As of 15 Nov, 18:40" under it
- two icons on the right: **?** (Reviewer guide, section 6.8) and **⚙** (Settings: House view, How FINN decides)

### 5.3 The page-length rule (no endless scrolling)

Every page is designed to fit in **one phone screen above the nav at first view, and never more than about two screens in total**. Five devices keep it that way:

1. **Segmented controls** split a page into views, so only one list shows at a time (e.g. Brief: Needs you / Worth a look / Routine).
2. **Capped lists:** at most 6 rows in a segment. Beyond that, a "See all 14" row opens a **dedicated list page** with filters and plain paging ("Next 20"), never infinite scroll.
3. **Bottom sheets** for detail: a results card or a management change opens over the page instead of growing it.
4. **Collapsed groups:** quiet things fold (e.g. "13 on track" on Portfolio is one row until opened).
5. **Company pages use tabs** (Overview / Record / Results / Filings / Research); each tab follows the same caps.

```
Rule of thumb: if a page needs a third screen, the extra part becomes a segment,
a sheet or its own page.
```

---

## 6. Pages

All company names, numbers, dates and quotes in these wireframes are **layout placeholders, not real data**. The built app shows only what the API returns from filings.

### 6.1 Brief (push: windowed digest)

```
┌─────────────────────────────────────┐
│ Brief                     [?]  [⚙]  │
│ As of 15 Nov, 18:40                 │
├─────────────────────────────────────┤
│ 2 need your attention               │  hero count + judgment
│ Since your last visit, Thu 18:40.   │
│ [ Since last visit ▾ ]              │  window: since last visit / 24 h /
│                                     │  7 days / since last results / custom
│ ▢ Next: Dixon results, Fri 21 Nov   │  one "Coming up" line, ledger fill;
│                                     │  tap → sheet with the next 5 dates
│ ┌───────────┬─────────────┬────────┐│
│ │Needs you 2│Worth a look 6│Routine 31│  segmented control
│ └───────────┴─────────────┴────────┘│
│ Dixon                    ✓✓✕◷  6%   │
│ Profit up 41% on 26% sales growth.  │
│ Revenue behind the FY27 guide       │
│ (15–18%) for a second quarter.      │
│ Results. Stock down 6% on 4× volume.│
│ ─────────────────────────────────── │
│ HDFC Bank                ✓✓✓    9%  │
│ New CFO: [name], 18 years at [firm],│
│ joins 1 Dec. Second senior exit     │
│ this year.                          │
│ Management change.                  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ▣ Brief  🔔 Alerts ◫ Portfolio ⌕ │ │  floating nav
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- **Default segment** is "Needs you". If it's empty, the page opens on "Worth a look" and the hero says "Nothing needs you since Thursday."
- **If the whole window is empty,** it widens to the last material item and says so: "Quiet since Tuesday. Showing the last material item."
- **Each segment shows up to 6 rows,** then "See all 14 worth a look" → a list page with filters (category, company) and paging.
- **Routine segment:** a single summary ("31 routine filings: 12 trading-window notices, 9 newspaper ads, …") plus its own capped list. Nothing is deleted; it's just folded.
- **Tapping a row** opens the item sheet (6.6). Row overflow menu: Seen, Mute this kind.

### 6.2 Alerts (push: triggered alerts)

```
┌─────────────────────────────────────┐
│ Alerts                    [?]  [⚙]  │
│ As of 15 Nov, 18:40                 │
├─────────────────────────────────────┤
│ ┌──────────────┬──────────────────┐ │
│ │ Triggered 4  │ Rules            │ │  segmented control
│ └──────────────┴──────────────────┘ │
│ Today                               │
│ Dixon fell 6%, 3× its usual daily   │
│ move, on 4× normal volume.          │
│ Results were filed the day before.  │  explaining filing (tap → sheet)
│ ─────────────────────────────────── │
│ Tata Power rose 5% on 3× volume.    │
│ No filing explains this move.       │  said plainly
│ ─────────────────────────────────── │
│ Yesterday                           │
│ HDFC Bank: senior management change │
│ Always shown first.                 │
│                                     │
│ Delivered to Telegram: 2 of 3 today │  budget line (if connected)
│ ┌─────────────────────────────────┐ │
│ │      floating nav               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Rules segment:**
- **Unusual price moves.** Three presets plus custom: "Only big surprises (3× the usual daily move)", "Anything unusual (2×)", "Custom".
- **Unusual volume.** "3× / 2× the 20-day average" presets plus custom.
- **Live preview** under the controls: "With these settings, 4 alerts would have fired in the last 30 days." This makes "I decide what unusual means" visible to the reviewer.
- **Filing types.** A toggle per category (results, M&A, fund raise, management change, …). A fixed, non-toggle row states: "Always shown first: auditor changes, pledges, promoter selling, senior exits, regulatory orders."
- **Delivery.** "Get alerts on Telegram", with "At most 3 messages a day".

Triggered alerts are capped at the last 7 days, 6 per day group; older ones go to "See all alerts" (list page with paging).

### 6.3 Portfolio

```
┌─────────────────────────────────────┐
│ Portfolio                 [?]  [⚙]  │
│ As of 15 Nov, 18:40                 │
├─────────────────────────────────────┤
│ 18 holdings                         │
│ ✕ 1 concern   ! 3 watch   ✓ 14 on track │  glyph + word + count, no tiles
│ All within your exclusions.         │  mandate status (PL-5)
│                                     │
│ [All] [Concern] [Watch] [On track]  │  filter chips
│                                     │
│ Concern                             │
│ Delhivery   ✕ Concern ✓✕✕   4%  −2% │  name, state, strip, weight, move
│ ─────────────────────────────────── │
│ Watch                               │
│ Dixon       ! Watch   ✓✓✕◷  6%  −6% │
│ KPIT        ! Watch   ✓✕◷   5%  +1% │
│ Astral      ! Watch   ◷◷    4%  +2% │
│ ─────────────────────────────────── │
│ ✓ 14 on track                  Show │  collapsed group
│                                     │
│ [Edit holdings]                     │
│ ┌─────────────────────────────────┐ │
│ │      floating nav               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- **Sort:** attention first (Concern → Watch → On track), then weight.
- **On track starts collapsed** with "All" selected. Choosing the "On track" chip shows it as a capped list.
- **Tapping a row** opens the company page (6.5).
- **"Edit holdings"** opens a sheet to paste or edit symbols and weights. The mandate check runs on save.

### 6.4 Research (pull)

```
┌─────────────────────────────────────┐
│ Research                  [?]  [⚙]  │
│ Any NSE company, from its annual    │
│ report and earnings calls only.     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ ⌕ Company name or NSE symbol    │ │  search (focus on tab open? no:
│ └─────────────────────────────────┘ │  tap to focus; keyboard stays down)
│                                     │
│ Ready to read                       │
│ Dixon     Met 2 of 3 targets due    │
│ KPIT      Met 1 of 2 targets due    │
│ Persistent  Met 3 of 3 targets due  │
│ See all 6                           │
│                                     │
│ Try a company you don't hold        │
│ [Cipla] [Polycab] [Kaynes]          │  three suggestion chips
│                                     │
│ Recent: ASTRAL, TITAN               │
│ ┌─────────────────────────────────┐ │
│ │      floating nav               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Searching:**
- Typing shows up to 8 matches. Choosing one opens its company page.
- If no research exists yet, the page opens in the **Reading** state:

```
KAYNES. Kaynes Technology India
Reading primary sources…

✓ Found FY26 annual report (212 pages)
✓ Found 6 concall transcripts
✓ Read Q4 FY26 call: 7 guidance statements
… Reading Q1 FY27 call
○ Check results against guidance
○ Governance and mandate check

Usually takes 1–3 minutes. You can switch tabs;
the result will be on this company's page.
```

- Partial results fill in tab by tab as they arrive.
- If documents are missing, the page says exactly which ones and shows what is available (filings and prices).

### 6.5 Company page (opened from Portfolio, Research, Brief or Alerts)

```
┌─────────────────────────────────────┐
│ ‹ Portfolio                    [⋯]  │  back to the tab you came from
│ Dixon Technologies                  │
│ DIXON. 6% of your book.             │
│ ₹12,603, −6% today.  ╱╲╱‾╲_         │  sparkline (60 sessions)
│                                     │
│ ! Watch                             │
│ Missed one revenue target and is    │
│ behind on the current one.          │
│ ✓ ✓ ✕ ↻ ◷ ◷   Met 2 of 3 due        │  Record strip (animated once)
│                                     │
│ [Overview][Record][Results][Filings][Research]  │ sticky, scrolls sideways
│                                     │
│ (tab content, max ~1.5 screens)     │
│ ┌─────────────────────────────────┐ │
│ │      floating nav               │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

| Company tab | Content | Cap |
|---|---|---|
| **Overview** | Latest event (opens sheet); governance strip ("No governance flags in 12 months" or the flags); mandate note; next date; "Questions for management (3)" (opens sheet) | Fixed, short |
| **Record** | Credibility line; statements grouped by verdict (Missed, Revised, Behind, Too early, Met); each with a serif quote, source chip and delivered figure; "4 statements too vague to score" folded | 3 per group, "See all" per group |
| **Results** | Latest results card; a quarter picker for the previous 4 quarters; half-year cash line when available | One quarter at a time |
| **Filings** | Last 30 days, grouped into events, tiered | 8 events, then "Older filings" list page |
| **Research** | Segmented: Cash quality / Trajectory / Risks. Cash quality = CFO/PAT bars with a 1.0× line + table toggle; Trajectory = revenue, EBITDA margin, ROCE small multiples; Risks = "What could go wrong" then "What could go right", each point cited | One segment at a time |

**Record tab detail (the hero, PL-2):**
```
Met 2 of 3 targets due.

Missed                                    FY26
Revenue growth
  "[management's exact words from the call]"    ← Plex Serif
  Q4 FY25 call, p.7
Delivered 22%.  ✕ Missed

Revised                                   FY27
EBITDA margin
  "[management's exact words from the call]"
  Q4 FY26 call, p.12
Revised to 4.0–4.5% in the Q1 FY27 call (p.9).  ↻ Revised

Too early                                 FY27
Revenue growth 15–18%
H1 FY27: 12% (2 of 4 quarters).  ◷ Too early

4 statements too vague to score.    Show
```

### 6.6 Item sheet (bottom sheet, from any tab)

Results variant:
```
┌─────────────────────────────────────┐
│ ▔▔▔                                 │  drag handle; covers ~85% height;
│ Dixon Technologies                  │  content inside scrolls only if
│ Q2 FY27 results, consolidated       │  needed, never past one table
│                                     │
│ Profit up 41% on 26% sales growth.  │
│ Revenue behind the FY27 guide       │
│ (15–18%) for a second quarter.      │
│                                     │
│ ₹ cr          Q2 FY27   QoQ    YoY  │  tabular nums
│ Revenue        12,850   +8%   +26%  │
│ EBITDA            514   +6%   +22%  │
│ EBITDA margin    4.0%   −10 bps     │
│ PBT               402  +11%   +38%  │
│ PAT               301  +12%   +41%  │
│                                     │
│ ✓ PBT − tax = PAT in all quarters   │
│ ✓ Revenue and PAT match Screener    │
│ ! One-off gain of ₹38 cr in PBT     │
│                                     │
│ [Results filing, p.10]  [Q1 call]   │  source chips
│ [Ask about this]   [Open Dixon]     │
└─────────────────────────────────────┘
```

- **Management change variant:** who, role, prior roles (from the filing's profile), effective date, the leaver's tenure and stated reason, "second senior exit in 12 months", source chip.
- **Concall variant:** new or changed guidance vs the last call (raised / lowered / unchanged / dropped), the credibility line, each statement as a serif quote with its page.
- The nav stays visible behind the sheet's scrim; closing the sheet returns to the same scroll position.

### 6.7 Settings sheet (⚙)

- **House view:** what counts as material; exclusions (defaults from ENAM's stated mandate: alcohol, tobacco, gambling and real-money gaming, businesses that harm animals; editable); muted kinds with Unmute.
- **How FINN decides:** ranking rules in words, the EBITDA formula, sources, which model does what, cost so far (from `/v1/method`).
- **About this prototype:** data sources, last refresh, link to the repo.

### 6.8 Reviewer guide (?)

Built for the ENAM reviewer: a sheet titled **"FINN in two minutes"**, opened from **?** on any page. On the very first visit it also shows as a single dismissible line at the top of Brief: "New here? See FINN in two minutes."

| Step | Takes you to | What it shows |
|---|---|---|
| 1. See what needs you today | Brief, "Needs you" | Push digest, ranking with reasons |
| 2. Open a results card | Item sheet for the top results item | Four numbers, QoQ/YoY, checks, sources |
| 3. Decide what "unusual" means | Alerts, Rules | Thresholds with live preview |
| 4. Check a management's record | Portfolio → a Watch company → Record | Promised vs delivered, quotes with pages |
| 5. Research a company you don't hold | Research search, focused | Pull on any NSE ticker, live progress |
| 6. See how FINN decides | Settings → How FINN decides | Sources, model routing, cost |

Each step is a button that deep-links to the right tab and segment. The guide never blocks the app and never reappears once dismissed (stored in local storage, with try/catch).

### 6.9 States

| State | Copy |
|---|---|
| Loading (first) | A skeleton of the hero line and 3 rows; no spinner text |
| Stale data | The as-of line turns `behind-text`: "As of 14 Nov, 19:30. Exchange feed paused; retrying." |
| Error on an action | "Couldn't start research for XYZ: Screener has no page for it. Try the NSE symbol." |
| Nothing material | "Nothing needs you since Thursday. Next: …" |
| Empty Alerts | "No alerts in the last 7 days with your current rules." + "Change rules" button |
| Offline | Last loaded data, with "Offline. Showing what was loaded at 18:40." |

---

## 7. Components

| Component | Purpose | Key rules |
|---|---|---|
| `FloatingNav` | The four tabs | Spec in 5.1; labels always visible; badges as counts |
| `TopBar` | Page title, absolute as-of time, ?, ⚙ (or back + overflow on company pages) | Time always absolute; turns amber when stale |
| `SegmentedControl` | Splits a page into views | 2–5 segments; counts in the label; 44 px tall; remembers the last segment per tab |
| `CappedList` | Any list on a page | Max 6 rows; "See all N" row opens a list page with filters and "Next 20" paging |
| `WindowPicker` | Brief's time window | Since last visit / 24 h / 7 days / since last results / custom range |
| `HeroCount` | "2 need your attention" + subline | Only place a large number appears |
| `ItemRow` | Company, Record strip, weight, headline, guidance line, reasons | No card chrome; whole row tappable; 56 px+ |
| `RecordStrip` | ✓ ✕ ↻ ◷ – glyph sequence + "Met X of Y due" | Signature element; glyph shape carries meaning; `aria-label` reads the full sentence |
| `StateWord` | On track / Watch / Concern | Glyph + word + status colour |
| `StateSummary` | "✕ 1 concern ! 3 watch ✓ 14 on track" | Text with glyphs; no tiles or donut |
| `ResultsTable` | Four lines, QoQ, YoY, margins | Tabular numbers; ₹ cr header; colour only past threshold; bank variant |
| `CheckList` | ✓ / ! lines under the table | ✓ in `met`, ! in `behind` |
| `QuoteBlock` | Management's words | Plex Serif; left rule; source chip below |
| `SourceChip` | "Q2 FY27 call, p.9" | Opens the PDF at the page or a page-text viewer; never a bare "Source" |
| `VerdictRow` | Metric, quote, delivered, verdict | Verdict word + glyph; pace note for "Too early" |
| `GovernanceStrip` | Flags or "No flags in 12 months" | Quiet when clean |
| `MandateNote` | "Within your exclusions" or the excluded share with page | `missed` colour when outside |
| `ThresholdControl` | Presets + custom + live preview count | Preview updates as the value changes |
| `Sparkline` | 60-session price line on the company header | Single series, no legend, `ink-2` 1.5 px line, last-point dot |
| `SmallMultiple` | Revenue / margin / ROCE trajectory | One axis each; never dual axis; table toggle |
| `CashBars` | CFO / PAT by year with 1.0× line | Thin bars, 2 px gaps, direct labels on first and last only |
| `JobSteps` | Research progress | Sentences; ✓ done / … running / ○ pending |
| `Sheet` | Item detail, settings, guide | Vaul drawer; focus trap; swipe to close; ~85% height max |
| `ReviewerGuide` | "FINN in two minutes" | Deep-link buttons; dismissible; never blocking |
| `Toast` | Feedback after actions | Same verb as the action ("Muted investor meet notices") |

**Chart rules** (from the dataviz method):
- one axis per chart
- a single series needs no legend
- text in ink, never series colour
- tooltips on marks
- a table view for every chart
- recessive grid
- check each chart at 360 px for label collisions

---

## 8. Copy rules for the interface

These are the synthesis language rules (L-1 to L-9) applied to UI:

1. **Sentence case everywhere.** No all-caps labels.
2. **Name things by what the investor understands:** "Mute investor meet notices", not "Suppress category".
3. **Buttons say exactly what happens**, and the toast repeats the verb: "Start research" → "Research started".
4. **Indian conventions:** ₹ crore, Q2 FY27, Indian digit grouping, consolidated/standalone stated.
5. **Neutral verdict words:** Met, Missed, Behind, Revised, Too early, Not measurable, Not mentioned since.
6. **Every claim carries a source chip.** Quotes are always in the serif.
7. **No buy/sell/hold**, no targets, no "Street", no hype verbs, no emojis, no exclamation marks.
8. **The app never talks about itself.** No "AI insights", "Smart", "Powered by".
9. **Absolute times.** Never "2h ago" on data that isn't live.
10. **Reasons are sentences**, not scores: "Results. 9% of your book. Stock down 6%."
11. **Errors say what happened and what to do**, without apologising.
12. **Tab names stay the same everywhere** (Brief, Alerts, Portfolio, Research): in the nav, the guide and the writeup.

---

## 9. Tech stack (frontend)

| Need | Choice | Why |
|---|---|---|
| Framework | React 19 + Vite + TypeScript | Your preference; static build deploys to Vercel CDN; fast |
| Routing | React Router | `/brief`, `/alerts`, `/portfolio`, `/research`, `/c/:symbol/:tab?`, `/list/:kind` (See all pages); sheets open via search params (`?sheet=event:8412`) so deep links and back work |
| Data | TanStack Query | Caching, stale-while-revalidate, polling for research jobs, offline last data |
| Styling | Tailwind v4 with tokens as CSS variables (`@theme`) | Tokens in one file; quick to build |
| Accessible primitives | Radix (Tabs, Popover, Dialog) + Vaul (bottom sheet) | Focus management and swipe sheets done right |
| Charts | Hand-written SVG components | Tiny; full control; no chart-library look |
| Fonts | `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-serif` | Self-hosted, subset |
| PWA | `vite-plugin-pwa` | Add to home screen; offline shell; cached last brief |
| Icons | Lucide, used sparingly (nav, search, settings, close, info) | Thin and neutral |
| Dates | `date-fns` + `Asia/Kolkata` formatting | IST everywhere |
| Shared types | `packages/shared` (zod) | Same schemas as the API |

**Per-tab state:**
- each tab keeps its own scroll position and selected segment when you switch away and back (keep-alive routes or a small store)
- tapping the active tab resets it

**Performance budget:**
- JS under ~150 KB gzipped on first load
- each tab renders from at most two API calls
- prefetch Brief and Portfolio data on app load
- prefetch a company on touchstart
- skeletons, not spinners

**Accessibility:**
- WCAG AA contrast
- visible `royal` focus ring
- 44 px targets
- `prefers-reduced-motion`
- every glyph has an `aria-label`
- charts have table equivalents
- the nav is a landmark

---

## 10. Pre-ship QA checklist

- [ ] 360 px and 375 px: no horizontal scroll on any page or sheet
- [ ] **No page needs more than two screens** at 375 × 812 with the nav visible; every list has a cap and "See all"
- [ ] The floating nav never covers the last row or button (bottom padding + safe area on iOS)
- [ ] Each tab remembers its segment and scroll; tapping the active tab resets it
- [ ] iOS Safari and Android Chrome; add-to-home-screen works
- [ ] Brief never renders blank: quiet days show the widened window and the next date
- [ ] Every number has a source chip; every quote is in the serif with a page
- [ ] No raw exchange subjects, enums, scores, token costs or greetings anywhere
- [ ] Status colours always with glyph + word; only large moves are coloured
- [ ] ₹ crore, Q2 FY27, Indian grouping, true minus sign everywhere
- [ ] Reviewer guide: each of the 6 steps lands on the right tab, segment or sheet
- [ ] Two tickers you didn't pick: research runs from the Research tab and the company page fills in
- [ ] Stale and offline states read correctly
- [ ] One motion moment only; reduced motion respected
- [ ] Lighthouse mobile: performance ≥ 90, accessibility ≥ 95

---

## 11. Feature map (synthesis IDs → pages and components)

| Feature IDs | Where it lives |
|---|---|
| P-1, P-2, P-4, P-5 | Brief: `HeroCount`, `WindowPicker`, segments, `ItemRow` |
| P-3, PL-4 | Brief "Needs you"; Alerts "Always shown first"; company Overview `GovernanceStrip` |
| P-6, P-7, P-8 | Item sheet (results) from Brief or Alerts; company Results tab |
| P-9 | Item sheet (management change) |
| P-10, PL-3 | Item sheet (concall); `RecordStrip`; credibility line on Portfolio and Research |
| P-11 | Item sheet (capital one-liner) |
| P-12, P-16 | Alerts: Triggered + Rules with live preview |
| P-13 | Alerts → Rules → Delivery (Telegram) |
| P-14 | Brief "Next:" line + sheet; company Overview |
| P-15 | Related filings folded inside the item sheet |
| P-17 | Row overflow (Seen, Mute this kind); Settings → muted kinds |
| P-18, PL-5 | Alerts (mandate breach); Portfolio mandate line; company `MandateNote`; Settings exclusions |
| U-1 | Portfolio tab |
| PL-1 | Research tab search → company page (Reading state, `JobSteps`) |
| PL-2 | Company → Record tab |
| PL-6, PL-7, PL-9 | Company → Research tab segments |
| PL-8 | Company → Overview → Questions for management |
| PL-14 | Item sheet: Ask about this (scoped) |
| U-4 | Settings → How FINN decides |
| U-2 to U-10 | Sections 4–7, 9, 10 |
| L-1 to L-9 | Section 8 |
| S-2 (reviewer path) | Reviewer guide (6.8) |

---

## 12. Build order for today (frontend)

1. Tokens + fonts + `FloatingNav`, `TopBar`, routes for the four tabs (empty pages wired to the API).
2. Brief: `HeroCount`, `WindowPicker`, `SegmentedControl`, `CappedList`, `ItemRow`, `RecordStrip`.
3. Item sheet: results variant (`ResultsTable`, `CheckList`, `SourceChip`), then management change and concall.
4. Portfolio: `StateSummary`, filter chips, grouped list → company page header + Overview + Record tab.
5. Research: search, ready list, Reading state with `JobSteps`.
6. Alerts: Triggered list; Rules with `ThresholdControl` live preview; Telegram connect.
7. Reviewer guide with deep links; Settings sheet with How FINN decides.
8. Company Results / Filings / Research tabs (charts last, if time).
9. QA checklist on a real phone at 360/375 px.

---

## Sources
- Quartr (first-party only; open the exact slide; daily recap): https://quartr.com/pro · https://www.ir-impact.com/2025/10/introducing-quartrs-ai-chat-on-mobile-purpose-built-for-public-market-research/ · https://quartr.com/products/web-app
- Zerodha Kite (minimal; colours that don't interfere with numbers; no gamification): https://yourstory.com/2020/11/app-kite-zerodha-speed-simplicity-first-time-stock-trader · https://www.zoho.com/the-long-game/companies-you-didnt-know-were-bootstrapped-part-3.html
- Fiscal.ai (audit to source filings, segments, notifications): https://topai.tools/t/finchat · https://ryanoconnellfinance.com/?p=15061
- Koyfin (customisable layouts and themes): https://koyfin.com/
- Mercury (calm colour system; typography): https://www.925studios.co/blog/mercury-design-breakdown · https://blakecrosley.com/guides/design/mercury
- Linear design refresh: https://linear.app/now/behind-the-latest-design-refresh
- Financial Times design tokens: https://www.shadcn.io/design/ft
- Light investing screens (galleries): https://kombai.com/gallery/inspirations/charts-ios-165/ · https://ww2.kombai.com/gallery/inspirations/charts-ios-145/
- Hudson Labs citation format: https://hudson-labs.com/products
- Astor message → brief rhythm: https://astor.app/
- Tabular figures for financial UI: https://fontalternatives.com/best-fonts-for/fintech/
- Competitor demos and repos: see `FINN_research_synthesis.md`, section 3
