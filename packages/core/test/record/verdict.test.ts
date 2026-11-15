/**
 * Verdict engine, against real statements from KPIT and Dixon earnings calls (quotes are cut
 * verbatim from the transcripts in fixtures/record/transcripts.json) and real Screener actuals.
 * Cases neither company produced in these six calls (a revision, tolerance boundaries) are
 * labelled SYNTHETIC and built by changing one field of a real statement.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GuidanceStatement, GuidanceTarget } from "@finn/shared";
import {
  ActualsBook,
  canonicalMetric,
  compareTargets,
  computeVerdicts,
  credibilityLine,
  diffCalls,
  processExtraction,
  quoteMatchRatio,
  type ActualRow,
} from "../../src/index";

const FX = JSON.parse(readFileSync(new URL("../fixtures/record/transcripts.json", import.meta.url), "utf8")) as {
  pages: Record<string, Record<string, string>>;
  quotes: Record<string, { symbol: string; call: string; page: number; quote: string }>;
};
const AS_OF = "2026-11-15T12:00:00+05:30" as const;
const CALLS = ["Q1FY26", "Q2FY26", "Q3FY26", "Q4FY26", "Q1FY27", "Q2FY27"];
const hash = { sha256: async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex") };

// Screener, consolidated, ₹ cr: [quarter, sales, operating profit, net profit]
const Q = (symbol: string, rows: [string, number, number, number][], annual: [string, number, number, number][]): ActualRow[] =>
  [...rows, ...annual].flatMap(([period, s, op, np]) =>
    ([["sales", s], ["operating_profit", op], ["net_profit", np]] as const).map(([metric, value]) => ({
      symbol, period, metric, basis: "consolidated" as const, value, unit: "inr_cr" as const, source: "screener" as const,
    })),
  );
const KPIT_ACTUALS = Q("KPITTECH",
  [["Q4FY25", 1528, 323, 245], ["Q1FY26", 1539, 295, 172], ["Q2FY26", 1588, 298, 169], ["Q3FY26", 1617, 311, 133], ["Q4FY26", 1711, 317, 163], ["Q1FY27", 1675, 257, 116], ["Q2FY27", 1691, 267, 121]],
  [["FY25", 5842, 1230, 840], ["FY26", 6455, 1220, 637]]);
const DIXON_ACTUALS = Q("DIXON",
  [["Q4FY25", 10293, 443, 465], ["Q1FY26", 12836, 482, 280], ["Q2FY26", 14855, 561, 746], ["Q3FY26", 10672, 414, 321], ["Q4FY26", 10511, 408, 298], ["Q1FY27", 15548, 463, 718], ["Q2FY27", 21794, 597, 411]],
  [["FY25", 38860, 1515, 1233], ["FY26", 48873, 1873, 1644]]);
/** KPIT, Q4 FY26 call p.3: "EBITDA growth margin is for the year 20.8%". */
const KPIT_REPORTED = (value = 20.8): ActualRow => ({ symbol: "KPITTECH", period: "FY26", metric: "ebitda_margin", basis: "consolidated", value, unit: "pct", source: "transcript" });

let n = 0;
function st(id: string, f: { metric_label: string; metric_kind: GuidanceStatement["metric_kind"]; target: GuidanceTarget; unit: GuidanceStatement["unit"]; period_target: string | null; segment?: string; hedges?: string[]; call?: string }): GuidanceStatement {
  const q = FX.quotes[id]!;
  const page = FX.pages[`${q.symbol}-${q.call}`]![String(q.page)]!;
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    symbol: q.symbol,
    doc_id: "00000000-0000-4000-8000-0000000000aa",
    call_period: f.call ?? q.call,
    metric: canonicalMetric(f.metric_label, f.metric_kind, f.unit),
    metric_label: f.metric_label,
    metric_kind: f.metric_kind,
    scope: f.segment ? "segment" : "company",
    segment: f.segment ?? null,
    target: f.target,
    unit: f.unit,
    period_target: f.period_target,
    hedges: f.hedges ?? [],
    quote: q.quote,
    page: q.page,
    quote_match: quoteMatchRatio(q.quote, page),
  };
}

const K = {
  fy26: () => st("kpit_fy26_margin", { metric_label: "EBITDA margin", metric_kind: "margin", target: { kind: "point", value: 21 }, unit: "pct", period_target: "FY26" }),
  m2224: () => st("kpit_margin_22_24", { metric_label: "EBITDA margin", metric_kind: "margin", target: { kind: "range", low: 22, high: 24 }, unit: "pct", period_target: null }),
  vague: () => st("kpit_profitable_growth", { metric_label: "profitable growth", metric_kind: "other", target: { kind: "none" }, unit: null, period_target: null }),
  up: () => st("kpit_margin_up", { metric_label: "EBITDA margin", metric_kind: "margin", target: { kind: "direction", direction: "up" }, unit: "pct", period_target: "Q3FY27" }),
  trucks: () => st("kpit_trucks", { metric_label: "revenue growth", metric_kind: "growth", target: { kind: "direction", direction: "up" }, unit: null, period_target: null, segment: "Trucks and off-highway", hedges: ["hopefully"] }),
};
const D = {
  fy27: (call?: string, value = 56000) => st("dixon_fy27_revenue", { metric_label: "revenue", metric_kind: "absolute", target: { kind: "point", value }, unit: "inr_cr", period_target: "FY27", ...(call ? { call } : {}) }),
  growth: () => st("dixon_growth_15_17", { metric_label: "revenue growth", metric_kind: "growth", target: { kind: "range", low: 15, high: 17 }, unit: "pct", period_target: null }),
  itHw: () => st("dixon_it_hardware", { metric_label: "revenue", metric_kind: "absolute", target: { kind: "point", value: 1500 }, unit: "inr_cr", period_target: "FY26", segment: "IT hardware" }),
  qtech: () => st("dixon_qtech_aspire", { metric_label: "revenue", metric_kind: "absolute", target: { kind: "point", value: 5000 }, unit: "inr_cr", period_target: null, segment: "Q Tech", hedges: ["we aspire to"] }),
  capex: () => st("dixon_capex", { metric_label: "capex", metric_kind: "absolute", target: { kind: "range", low: 1150, high: 1200 }, unit: "inr_cr", period_target: "FY26" }),
};

const run = (statements: GuidanceStatement[], rows: ActualRow[]) => {
  const verdicts = computeVerdicts(statements, { calls: CALLS, actuals: new ActualsBook(rows), as_of: AS_OF });
  return { verdicts, of: (s: GuidanceStatement) => verdicts.find((v) => v.statement_id === s.id)! };
};

// ─── Quotes ──────────────────────────────────────────────────────────────────

test("every fixture quote matches its cited page at ≥ 0.85", () => {
  for (const s of [...Object.values(K), ...Object.values(D)].map((f) => f())) assert.ok(s.quote_match >= 0.85, `${s.quote} → ${s.quote_match}`);
});

test("quote verification drops paraphrases, wrong pages and analyst remarks", async () => {
  const pagesObj = FX.pages["KPITTECH-Q2FY26"]!;
  const pages = Array.from({ length: 24 }, (_, i) => pagesObj[String(i + 1)] ?? "");
  const g = (quote: string, page: number, speaker_role: "management" | "analyst" = "management") => ({
    speaker_role, metric_label: "EBITDA margin", metric_kind: "margin" as const, scope: "company" as const, segment: null,
    target_kind: "point" as const, low: null, high: null, value: 21, direction: null, unit: "pct" as const, period_target: "FY'26", hedges: [], quote, page,
  });
  const real = FX.quotes.kpit_fy26_margin!.quote;
  const p = await processExtraction(
    { guidance: [g(real, 5), g("We are confident EBITDA margins will comfortably exceed 21% for the full year", 5), g(real, 9), g(real, 5, "analyst")], reported: [] },
    pages,
    { symbol: "KPITTECH", doc_id: "00000000-0000-4000-8000-0000000000aa", call_period: "Q2FY26", hash },
  );
  assert.equal(p.statements.length, 1);
  assert.equal(p.statements[0]!.period_target, "FY26", "FY'26 normalised");
  assert.equal(p.statements[0]!.metric, "ebitda_margin");
  assert.deepEqual(p.dropped.map((d) => d.reason.replace(/\(match [\d.]+\)/, "(match …)")), [
    "quote not found on p.5 (match …)",
    "quote not found on p.9 (match …)",
    "spoken by analyst, not management",
  ]);
});

// ─── Verdicts, one per condition ─────────────────────────────────────────────

test("Met: KPIT guided 21% FY26 EBITDA margin and reported 20.8% — within 0.5 pp, with FINN's 18.9% shown", () => {
  const s = K.fy26();
  const v = run([s], [...KPIT_ACTUALS, KPIT_REPORTED()]).of(s);
  assert.equal(v.verdict, "met");
  assert.equal(v.reason, "Guided 21%, delivered 20.8% (within 0.5 pp of the target) as reported by the company; 18.9% on FINN's standard EBITDA margin");
});

test("Missed: the same promise against FINN's standard EBITDA alone (₹1,220 cr on ₹6,455 cr = 18.9%)", () => {
  const s = K.fy26();
  const v = run([s], KPIT_ACTUALS).of(s);
  assert.equal(v.verdict, "missed");
  assert.equal(v.reason, "Guided 21%, delivered 18.9%");
});

test("SYNTHETIC tolerance edges: 0.5 pp short is Met, anything more is Missed; growth uses 2% relative", () => {
  const s = K.fy26();
  assert.equal(run([s], [...KPIT_ACTUALS, KPIT_REPORTED(20.5)]).of(s).verdict, "met");
  assert.equal(run([s], [...KPIT_ACTUALS, KPIT_REPORTED(20.49)]).of(s).verdict, "missed");
  // Dixon FY26 revenue growth was 48,873 / 38,860 − 1 = 25.77%.
  const g = (v: number) => ({ ...D.fy27(), id: "00000000-0000-4000-8000-0000000000f1", metric: "revenue_growth", metric_label: "revenue growth", metric_kind: "growth" as const, unit: "pct" as const, period_target: "FY26", target: { kind: "point" as const, value: v } });
  assert.equal(run([g(26)], DIXON_ACTUALS).of(g(26)).verdict, "met", "short by 0.23 pp, tolerance 0.52");
  assert.equal(run([g(26.5)], DIXON_ACTUALS).of(g(26.5)).verdict, "missed", "short by 0.73 pp, tolerance 0.53");
  const range = { ...g(0), target: { kind: "range" as const, low: 15, high: 17 } };
  assert.equal(run([range], DIXON_ACTUALS).of(range).reason, "Guided 15–17%, delivered 25.8% (above the range)");
});

test("Not measurable: vague, no period, segment, and no actual for the metric", () => {
  const ss = [K.vague(), K.m2224(), D.growth(), D.itHw(), D.capex()];
  const r = run(ss, [...KPIT_ACTUALS, ...DIXON_ACTUALS]);
  assert.deepEqual(ss.map((s) => [r.of(s).verdict, r.of(s).reason]), [
    ["not_measurable", "Not a measurable target: no number or direction"],
    ["not_measurable", "Not a measurable target: no period given"],
    ["not_measurable", "Not a measurable target: no period given"],
    ["not_measurable", "Segment target (IT hardware); FINN has company-level figures only"],
    ["not_measurable", "No capex figure in FINN's data yet"],
  ]);
});

test("Hedges keep the maths and are appended verbatim", () => {
  const ss = [D.qtech(), K.trucks()];
  const r = run(ss, [...KPIT_ACTUALS, ...DIXON_ACTUALS]);
  assert.equal(r.of(ss[0]!).reason, 'Not a measurable target: no period given · Hedged: "we aspire to"');
  assert.equal(r.of(ss[1]!).reason, 'Not a measurable target: no period given · Hedged: "hopefully"');
});

test("Not mentioned since: Dixon's ₹56,000 cr FY27 target is absent from the Q1 and Q2 FY27 calls", () => {
  const s = D.fy27();
  const v = run([s], DIXON_ACTUALS).of(s);
  assert.equal(v.verdict, "not_mentioned_since");
  assert.equal(v.last_mentioned_in, "Q4FY26");
  assert.equal(v.reason, "Not mentioned since the Q4 FY26 call (2 calls since)");
});

test("Too early with a pace note: KPIT says margins go up every quarter (Q3 FY27 not reported)", () => {
  const s = K.up();
  const v = run([s], KPIT_ACTUALS).of(s);
  assert.equal(v.verdict, "too_early");
  assert.equal(v.reason, "Q3 FY27 not over: 0 of 1 quarter reported");
  assert.equal(v.pace_note, "No quarter of Q3 FY27 reported yet; Q2 FY27 EBITDA margin 15.8%");
});

test("SYNTHETIC Too early with run rate: Dixon restating ₹56,000 cr on the Q2 FY27 call", () => {
  const a = D.fy27();
  const b = D.fy27("Q2FY27");
  const r = run([a, b], DIXON_ACTUALS);
  assert.equal(r.of(b).verdict, "too_early");
  assert.equal(r.of(b).pace_note, "H1 FY27 revenue ₹37,342 cr, 67% of the FY27 target of ₹56,000 cr with 2 of 4 quarters reported");
  assert.equal(r.of(a).verdict, "too_early", "the same promise made earlier shares the verdict");
});

test("SYNTHETIC Revised: a later call gives a different FY27 number", () => {
  const a = D.fy27();
  const b = D.fy27("Q1FY27", 60000);
  const r = run([a, b], DIXON_ACTUALS);
  assert.equal(r.of(a).verdict, "revised");
  assert.equal(r.of(a).reason, "Target revised from ₹56,000 cr to ₹60,000 cr (Q1 FY27 call)");
  assert.equal(r.of(a).superseded_by_statement_id, b.id);
  assert.notEqual(r.of(b).verdict, "revised");
});

// ─── Credibility and concall diff ───────────────────────────────────────────

test("credibility counts only Met and Missed, once per target", () => {
  const k = [K.fy26(), K.m2224(), K.up(), K.vague()];
  const r = run(k, [...KPIT_ACTUALS, KPIT_REPORTED()]);
  assert.equal(credibilityLine(k, r.verdicts).line, "Met 1 of 1 target that is due");
  const d = [D.fy27(), D.itHw(), D.capex()];
  assert.equal(credibilityLine(d, run(d, DIXON_ACTUALS).verdicts).line, "No targets due yet");
});

test("concall diff: Dixon's FY27 target is dropped on the next call; targets compare raised / lowered", () => {
  const items = diffCalls([D.fy27()], [], "Q1FY27");
  assert.deepEqual(items.map((i) => [i.status, i.from]), [["dropped", "₹56,000 cr"]]);
  assert.equal(compareTargets({ kind: "range", low: 18, high: 20 }, { kind: "range", low: 19, high: 21 }), "raised");
  assert.equal(compareTargets({ kind: "point", value: 21 }, { kind: "point", value: 20 }), "lowered");
  assert.equal(compareTargets({ kind: "point", value: 21 }, { kind: "point", value: 21 }), "unchanged");
  assert.deepEqual(diffCalls([], [D.fy27()], "Q4FY26").map((i) => i.status), ["new"]);
});
