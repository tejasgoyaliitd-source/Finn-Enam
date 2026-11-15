import { Hono } from "hono";
import { callQuarter, countSeniorExits, diffCalls, extractPeopleChange, fmtTarget, periodLabel, quarterOrdinal, SENIOR_ROLES } from "@finn/core";
import type { ResultsCheck, ResultsMetrics } from "@finn/shared";
import type { ApiCtx } from "../ctx";
import { company, holdings, ist, records, recordStrip } from "../data";
import { freshness, sourceStatus } from "../fresh";
import { ApiError, cdn, ok } from "../http";

/**
 * The item sheet: one filing, opened from any list. Everything here is read from stored data;
 * nothing is fetched from an exchange on the request path.
 */

const DAY = 864e5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Status = "pass" | "flag" | "fail" | "skipped";
interface Check { status: Status; text: string; page: number | null }
interface Source { label: string; url: string; page: number | null }
interface Row { label: string; kind: "cr" | "margin"; value: number | null; qoq: number | null; yoy: number | null }

const pct = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
const bps = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 100));
const margin = (num: number | null | undefined, den: number | null | undefined) => (num == null || den == null || den === 0 ? null : (num / den) * 100);
const fmt = (x: number) => Math.round(x).toLocaleString("en-IN");

/** "Q2 FY27" in the headline or subject, else the quarter just before the filing month. */
function resultsPeriod(text: string, filedAt: string): string | null {
  const m = /\bQ([1-4])\s?FY\s?'?(\d{2})\b/i.exec(text);
  if (m) return `Q${m[1]}FY${m[2]}`;
  const d = new Date(filedAt);
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return callQuarter(`${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`);
}
const shift = (q: string, by: number) => {
  const o = quarterOrdinal(q) + by;
  return `Q${((o - 1) % 4) + 1}FY${String(Math.floor((o - 1) / 4)).padStart(2, "0")}`;
};

/** One judgement line from the numbers: "Profit up 41% on 26% sales growth." */
function judgement(revYoy: number | null, patYoy: number | null): string | null {
  if (revYoy == null || patYoy == null) return null;
  const p = patYoy >= 0 ? `Profit up ${Math.abs(patYoy).toFixed(0)}%` : `Profit down ${Math.abs(patYoy).toFixed(0)}%`;
  const r = revYoy >= 0 ? `${Math.abs(revYoy).toFixed(0)}% sales growth` : `a ${Math.abs(revYoy).toFixed(0)}% fall in sales`;
  return `${p} on ${r}, year on year.`;
}


export async function resultsDetail(ctx: ApiCtx, symbol: string, period: string, filingUrl: string | null) {
  const card = (
    await ctx.db.from("results").select("*").eq("symbol", symbol).eq("period", period).order("basis").limit(2)
  ).data?.sort((a, b) => (a.basis === "consolidated" ? -1 : b.basis === "consolidated" ? 1 : 0))[0] as
    | { basis: string; is_bank: boolean; metrics: { current: ResultsMetrics; prior_quarter: ResultsMetrics | null; year_ago: ResultsMetrics | null }; checks: ResultsCheck[]; source_url: string | null; page: number | null; source: string; comparable: boolean; comparability_note: string | null }
    | undefined;

  if (card) {
    const { current: c, prior_quarter: q, year_ago: y } = card.metrics;
    const em = (m: ResultsMetrics | null) => (m ? margin(m.ebitda, m.revenue) : null);
    const rows: Row[] = card.is_bank
      ? [
          { label: "Interest earned", kind: "cr", value: c.revenue, qoq: pct(c.revenue, q?.revenue), yoy: pct(c.revenue, y?.revenue) },
          { label: "Net interest income", kind: "cr", value: c.nii, qoq: pct(c.nii, q?.nii), yoy: pct(c.nii, y?.nii) },
          { label: "Operating profit", kind: "cr", value: c.ppop, qoq: pct(c.ppop, q?.ppop), yoy: pct(c.ppop, y?.ppop) },
          { label: "PBT", kind: "cr", value: c.pbt, qoq: pct(c.pbt, q?.pbt), yoy: pct(c.pbt, y?.pbt) },
          { label: "PAT", kind: "cr", value: c.pat, qoq: pct(c.pat, q?.pat), yoy: pct(c.pat, y?.pat) },
        ]
      : [
          { label: "Revenue", kind: "cr", value: c.revenue, qoq: pct(c.revenue, q?.revenue), yoy: pct(c.revenue, y?.revenue) },
          { label: "EBITDA", kind: "cr", value: c.ebitda, qoq: pct(c.ebitda, q?.ebitda), yoy: pct(c.ebitda, y?.ebitda) },
          { label: "EBITDA margin", kind: "margin", value: em(c), qoq: bps(em(c), em(q)), yoy: bps(em(c), em(y)) },
          { label: "PBT", kind: "cr", value: c.pbt, qoq: pct(c.pbt, q?.pbt), yoy: pct(c.pbt, y?.pbt) },
          { label: "PAT", kind: "cr", value: c.pat, qoq: pct(c.pat, q?.pat), yoy: pct(c.pat, y?.pat) },
        ];
    const checks: Check[] = card.checks
      .filter((x) => x.status !== "skipped")
      .map((x) => ({ status: x.status, text: x.note, page: x.page }));
    if (!card.comparable && card.comparability_note) checks.push({ status: "flag", text: card.comparability_note, page: null });
    const url = card.source_url ?? filingUrl;
    return {
      period: periodLabel(period),
      basis: card.basis,
      is_bank: card.is_bank,
      from: "filing" as const,
      rows,
      judgement: judgement(rows[0]!.yoy, rows.at(-1)!.yoy),
      checks,
      source: url ? { label: card.page ? `Results filing, p.${card.page}` : "Results filing", url, page: card.page } : null,
    };
  }

  // No card yet: Screener's figures for the same quarter, labelled as such, with the checks
  // its own lines allow (they tie, or they don't).
  const want = [period, shift(period, -1), shift(period, -4)];
  const rows = (await ctx.db.from("actuals").select("period, metric, basis, value").eq("symbol", symbol).in("period", want)).data ?? [];
  if (!rows.some((r) => r.period === period && (r.metric === "sales" || r.metric === "revenue"))) {
    return { period: periodLabel(period), basis: null, is_bank: false, from: "none" as const, rows: [], judgement: null, checks: [{ status: "flag" as Status, text: `Screener doesn't have ${periodLabel(period)} figures yet, and FINN hasn't read the results filing.`, page: null }], source: filingUrl ? { label: "Results filing", url: filingUrl, page: null } : null };
  }
  const basis = rows.some((r) => r.period === period && r.basis === "consolidated") ? "consolidated" : "standalone";
  const get = (p: string, m: string) => {
    const v = rows.find((r) => r.period === p && r.basis === basis && r.metric === m)?.value;
    return v == null ? null : Number(v);
  };
  const [cur, prev, ya] = want;
  const line = (label: string, m: string): Row => ({ label, kind: "cr", value: get(cur!, m), qoq: pct(get(cur!, m), get(prev!, m)), yoy: pct(get(cur!, m), get(ya!, m)) });
  // Banks and NBFCs: Screener reports interest earned as "revenue" and has no sales or EBITDA line.
  if (get(cur!, "sales") == null && get(cur!, "revenue") != null) {
    const nii = (p: string) => {
      const r = get(p, "revenue");
      const i = get(p, "interest");
      return r != null && i != null ? r - i : null;
    };
    const npa = (p: string) => get(p, "gross_npa_pct");
    const rowsB: Row[] = [
      line("Interest earned", "revenue"),
      { label: "Net interest income", kind: "cr", value: nii(cur!), qoq: pct(nii(cur!), nii(prev!)), yoy: pct(nii(cur!), nii(ya!)) },
      line("PBT", "profit_before_tax"),
      line("PAT", "net_profit"),
      ...(npa(cur!) != null ? [{ label: "Gross NPA", kind: "margin" as const, value: npa(cur!), qoq: bps(npa(cur!), npa(prev!)), yoy: bps(npa(cur!), npa(ya!)) }] : []),
    ];
    const checksB: Check[] = [{ status: "flag", text: "Figures from Screener. FINN hasn't read the results filing yet.", page: null }];
    const fp = get(cur!, "financing_profit");
    const oiB = get(cur!, "other_income");
    const depB = get(cur!, "depreciation") ?? 0;
    const pbtB = get(cur!, "profit_before_tax");
    if (fp != null && oiB != null && pbtB != null) {
      const gap = fp + oiB - depB - pbtB;
      checksB.push(
        Math.abs(gap) <= Math.max(2, Math.abs(pbtB) * 0.01)
          ? { status: "pass", text: "Financing profit + other income − depreciation = PBT", page: null }
          : { status: "flag", text: `₹${fmt(Math.abs(gap))} cr between the operating lines and PBT: likely an exceptional item`, page: null },
      );
    }
    const n0 = npa(ya!);
    const n1 = npa(cur!);
    if (n0 != null && n1 != null && n1 > n0) checksB.push({ status: "flag", text: `Gross NPA rose from ${n0}% to ${n1}% year on year.`, page: null });
    const patY = rowsB[3]!.yoy;
    const niiY = rowsB[1]!.yoy;
    return {
      period: periodLabel(period),
      basis,
      is_bank: true,
      from: "screener" as const,
      rows: rowsB,
      judgement:
        patY != null && niiY != null
          ? `${patY >= 0 ? "Profit up" : "Profit down"} ${Math.abs(patY).toFixed(0)}% on ${niiY >= 0 ? "" : "a "}${Math.abs(niiY).toFixed(0)}% ${niiY >= 0 ? "growth" : "fall"} in net interest income, year on year.`
          : null,
      checks: checksB,
      source: filingUrl ? { label: "Results filing", url: filingUrl, page: null } : null,
    };
  }

  const om = (p: string) => margin(get(p, "operating_profit"), get(p, "sales"));
  const out: Row[] = [
    line("Revenue", "sales"),
    line("EBITDA", "operating_profit"),
    { label: "EBITDA margin", kind: "margin", value: om(cur!), qoq: bps(om(cur!), om(prev!)), yoy: bps(om(cur!), om(ya!)) },
    line("PBT", "profit_before_tax"),
    line("PAT", "net_profit"),
  ];

  const checks: Check[] = [{ status: "flag", text: "Figures from Screener. FINN hasn't read the results filing yet, so its own EBITDA formula isn't applied.", page: null }];
  const sales = get(cur!, "sales");
  const exp = get(cur!, "expenses");
  const op = get(cur!, "operating_profit");
  const oi = get(cur!, "other_income");
  const int = get(cur!, "interest");
  const dep = get(cur!, "depreciation");
  const pbt = get(cur!, "profit_before_tax");
  if (sales != null && exp != null && op != null) {
    const gap = sales - exp - op;
    checks.push(Math.abs(gap) <= 2 ? { status: "pass", text: "Revenue − expenses = EBITDA", page: null } : { status: "flag", text: `Revenue − expenses differs from EBITDA by ₹${fmt(Math.abs(gap))} cr`, page: null });
  }
  if (op != null && oi != null && int != null && dep != null && pbt != null) {
    const gap = op + oi - int - dep - pbt;
    checks.push(
      Math.abs(gap) <= Math.max(2, Math.abs(pbt) * 0.01)
        ? { status: "pass", text: "EBITDA + other income − interest − depreciation = PBT", page: null }
        : { status: "flag", text: `₹${fmt(Math.abs(gap))} cr between the operating lines and PBT: likely an exceptional ${gap > 0 ? "charge" : "gain"}`, page: null },
    );
  }
  if (oi != null && pbt != null && pbt > 0 && oi / pbt >= 0.25) {
    checks.push({ status: "flag", text: `Other income of ₹${fmt(oi)} cr is ${Math.round((oi / pbt) * 100)}% of PBT. Check for a one-off gain.`, page: null });
  }
  return {
    period: periodLabel(period),
    basis,
    is_bank: false,
    from: "screener" as const,
    rows: out,
    judgement: judgement(out[0]!.yoy, out[4]!.yoy),
    checks,
    source: filingUrl ? { label: "Results filing", url: filingUrl, page: null } : null,
  };
}

const ACTION_WORD: Record<string, string> = { appointed: "Appointed", resigned: "Resigned", retired: "Retired", removed: "Removed", redesignated: "Redesignated", ceased: "Ceased" };
const EXIT = /\bresign|\bcessation\b|\bceased?\b|\bretire|\bstep(?:ped|s)? down\b|\bremov/i;

function parsePeopleFromHeadline(headline: string, subject: string) {
  const text = `${headline} ${subject}`;
  const m1 = /([A-Z][a-zA-Z.\s'-]{2,50}?)\s+(re-appointed|appointed|resigned|stepped down|ceased|retired|redesignated)\s+as\s+([A-Za-z0-9\s-]+)/i.exec(headline);
  if (m1) {
    const rawAction = m1[2]!.toLowerCase();
    const action = rawAction.includes("appoint") ? "appointed" : rawAction.includes("resign") || rawAction.includes("step") ? "resigned" : rawAction.includes("retire") ? "retired" : rawAction.includes("redesignat") ? "redesignated" : "ceased";
    return [{
      name: m1[1]!.trim(),
      role: m1[3]!.trim(),
      action,
      effective_date: null,
      prior_roles: [],
      tenure_months: null,
      stated_reason: null,
      source_page: null,
    }];
  }
  const m2 = /(?:Appointment|Re-appointment|Resignation|Cessation|Retirement)\s+of\s+(?:Mr\.|Ms\.|Dr\.)?\s*([A-Z][a-zA-Z.\s'-]{2,50}?)\s+as\s+([A-Za-z0-9\s-]+)/i.exec(text);
  if (m2) {
    const action = /resign/i.test(text) ? "resigned" : /retire/i.test(text) ? "retired" : /cess/i.test(text) ? "ceased" : "appointed";
    return [{
      name: m2[1]!.trim(),
      role: m2[2]!.trim(),
      action,
      effective_date: null,
      prior_roles: [],
      tenure_months: null,
      stated_reason: null,
      source_page: null,
    }];
  }
  return [];
}

async function peopleDetail(
  ctx: ApiCtx,
  symbol: string,
  filingId: number,
  now: Date,
  filingMeta?: { attachment_url: string | null; headline: string; subject: string },
) {
  const yearAgo = new Date(now.getTime() - 365 * DAY).toISOString();
  let [mine, history, exitsByFiling] = await Promise.all([
    ctx.db.from("people_events").select("name, role, action, effective_date, prior_roles, tenure_months, stated_reason, source_page").eq("filing_id", filingId),
    ctx.db.from("people_events").select("role, action, effective_date, created_at").eq("symbol", symbol).gte("created_at", yearAgo),
    // Until every change filing has been read, count senior exits from what the exchange filing says.
    ctx.db.from("filings").select("id, subject, filed_at, filing_analysis!inner(headline, category)").eq("symbol", symbol).eq("filing_analysis.category", "management_change").gte("filed_at", yearAgo).is("duplicate_of", null),
  ]);

  if ((mine.data ?? []).length === 0 && filingMeta) {
    if (filingMeta.attachment_url) {
      try {
        const outcome = await extractPeopleChange(ctx.deps, { symbol, filing_id: filingId, pdf_url: filingMeta.attachment_url });
        if (outcome.ok && outcome.result.events.length > 0) {
          mine = await ctx.db.from("people_events").select("name, role, action, effective_date, prior_roles, tenure_months, stated_reason, source_page").eq("filing_id", filingId);
        }
      } catch (err) {
        ctx.deps.log.warn("peopleDetail: extractPeopleChange error", { filingId, error: String(err) });
      }
    }
    if ((mine.data ?? []).length === 0) {
      const parsed = parsePeopleFromHeadline(filingMeta.headline, filingMeta.subject);
      if (parsed.length > 0) {
        if (ctx.deps.store.upsertPeopleEvents) {
          ctx.deps.store.upsertPeopleEvents(
            parsed.map((p) => ({
              symbol,
              filing_id: filingId,
              name: p.name,
              role: p.role,
              action: p.action as any,
              effective_date: p.effective_date,
              prior_roles: p.prior_roles,
              tenure_months: p.tenure_months,
              stated_reason: p.stated_reason,
              source_page: p.source_page,
            })),
          ).catch(() => {});
        }
        mine.data = parsed as any;
      }
    }
  }

  const people = (mine.data ?? []).map((p) => ({
    name: p.name as string,
    role: p.role as string,
    action: ACTION_WORD[p.action as string] ?? (p.action as string),
    effective_date: p.effective_date as string | null,
    prior_roles: (p.prior_roles as string[]) ?? [],
    tenure_months: p.tenure_months as number | null,
    stated_reason: p.stated_reason as string | null,
    page: p.source_page as number | null,
  }));
  const fromEvents = countSeniorExits((history.data ?? []).map((h) => ({ role: h.role, action: h.action, effective_date: h.effective_date, filed_at: h.created_at })), now);
  const fromFilings = (exitsByFiling.data ?? []).filter((f) => {
    const a = f.filing_analysis as unknown as { headline: string } | { headline: string }[];
    const text = `${f.subject} ${(Array.isArray(a) ? a[0]?.headline : a.headline) ?? ""}`;
    return EXIT.test(text) && SENIOR_ROLES.test(text);
  }).length;
  const count = Math.max(fromEvents.count, fromFilings);
  const ORD = ["", "First", "Second", "Third", "Fourth", "Fifth"];
  return {
    people,
    senior_exits_12m: count,
    senior_exit_line: count === 0 ? "No senior exits in the last 12 months." : `${ORD[count] ?? `${count}th`} senior exit in the last 12 months.`,
    note: people.length ? null : "The appointee's profile, the leaver's tenure and the stated reason are read from the filing by the model, which isn't set up yet.",
  };
}

async function concallDetail(ctx: ApiCtx, symbol: string, call: string) {
  const rec = (await records(ctx, [symbol])).get(symbol)!;
  const calls = [...new Set(rec.statements.map((s) => s.call_period))].sort((a, b) => quarterOrdinal(a) - quarterOrdinal(b));
  const curr = rec.statements.filter((s) => s.call_period === call);
  const prevCall = calls.filter((c) => quarterOrdinal(c) < quarterOrdinal(call)).at(-1) ?? null;
  const prev = prevCall ? rec.statements.filter((s) => s.call_period === prevCall) : [];
  const doc = curr[0] ? (await ctx.db.from("documents").select("url").eq("id", curr[0].doc_id).maybeSingle()).data : null;
  const items = curr.length ? diffCalls(prev, curr, call) : [];
  return {
    call: periodLabel(call),
    previous_call: prevCall ? periodLabel(prevCall) : null,
    credibility: rec.credibility.line,
    revisions: items.map((i) => ({ status: i.status, metric: i.metric_label, period: i.period_target ? periodLabel(i.period_target) : null, from: i.from, to: i.to, quote: i.quote, page: i.page, call: periodLabel(i.call_period) })),
    quotes: curr.slice(0, 6).map((s) => ({ quote: s.quote, page: s.page, metric: s.metric_label ?? s.metric, target: fmtTarget(s.target, s.unit) })),
    transcript_url: (doc?.url as string | undefined) ?? null,
    note: curr.length ? null : `FINN hasn't read the ${periodLabel(call)} call yet. Guidance is read by the model, which isn't set up yet.`,
  };
}

export function itemRoutes(ctx: ApiCtx) {
  const r = new Hono();

  r.get("/items/:id", cdn(), async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "bad_request", "id must be a filing id");
    const now = ctx.deps.clock.now();
    const f = (
      await ctx.db
        .from("filings")
        .select("id, symbol, subject, filed_at, attachment_url, filing_analysis!inner(tier, headline, reasons, category, sub_kind, event_id)")
        .eq("id", id)
        .maybeSingle()
    ).data as
      | { id: number; symbol: string; subject: string; filed_at: string; attachment_url: string | null; filing_analysis: { tier: string; headline: string; reasons: string[]; category: string; sub_kind: string | null; event_id: number | null } | { tier: string; headline: string; reasons: string[]; category: string; sub_kind: string | null; event_id: number | null }[] }
      | null;
    if (!f) throw new ApiError(404, "not_found", `No analysed filing with id ${id}`);
    const a = Array.isArray(f.filing_analysis) ? f.filing_analysis[0]! : f.filing_analysis;
    const [co, hs, recs] = await Promise.all([company(ctx, f.symbol), holdings(ctx), records(ctx, [f.symbol])]);
    const weight = hs.find((h) => h.symbol === f.symbol)?.weight_pct ?? null;

    // Other filings in the same event, newest first.
    const related = a.event_id
      ? (((await ctx.db.from("filing_analysis").select("headline, filings!inner(id, filed_at, attachment_url)").eq("event_id", a.event_id)).data ?? []) as unknown as { headline: string; filings: { id: number; filed_at: string; attachment_url: string | null } }[])
          .filter((x) => x.filings.id !== f.id)
          .map((x) => ({ id: x.filings.id, headline: x.headline, filed_at: ist(x.filings.filed_at), url: x.filings.attachment_url }))
          .sort((x, y) => y.filed_at.localeCompare(x.filed_at))
          .slice(0, 5)
      : [];

    const kind = a.category === "results" && a.sub_kind === "results" ? "results" : a.category === "management_change" ? "people" : a.category === "earnings_call" && a.sub_kind === "transcript" ? "concall" : "filing";
    const text = `${a.headline} ${f.subject}`;
    const period = resultsPeriod(text, f.filed_at);

    const sources: Source[] = [];
    const filingLabel = kind === "results" ? "Results filing" : kind === "people" ? "Change-in-management filing" : kind === "concall" ? `${period ? periodLabel(period) : ""} call transcript`.trim() : "Exchange filing";
    if (f.attachment_url) sources.push({ label: filingLabel, url: f.attachment_url, page: null });

    const detail =
      kind === "results" && period
        ? { results: await resultsDetail(ctx, f.symbol, period, f.attachment_url) }
        : kind === "people"
          ? { people: await peopleDetail(ctx, f.symbol, f.id, now, { attachment_url: f.attachment_url, headline: a.headline, subject: f.subject }) }
          : kind === "concall" && period
            ? { concall: await concallDetail(ctx, f.symbol, period) }
            : {};

    const fr = freshness(await sourceStatus(ctx), ["filings", "screener"], now);
    return ok(c, {
      filing_id: f.id,
      kind,
      symbol: f.symbol,
      name: co?.name ?? f.symbol,
      weight_pct: weight,
      tier: a.tier,
      headline: a.headline,
      reasons: a.reasons,
      filed_at: ist(f.filed_at),
      subject: f.subject,
      record: recordStrip(recs.get(f.symbol)),
      credibility: recs.get(f.symbol)?.credibility.line ?? "No targets due yet",
      sources,
      related,
      ...detail,
    }, fr);
  });

  return r;
}
