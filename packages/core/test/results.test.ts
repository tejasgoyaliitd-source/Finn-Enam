import assert from "node:assert/strict";
import { test } from "node:test";
import { ResultsCard, type ResultsCheck } from "@finn/shared";
import {
  buildResultsCard,
  detectComparability,
  extractResults,
  normalizeNumbers,
  onPage,
  parseResultsXbrl,
  preferConsolidated,
  ResultsExtraction,
  toCrore,
  toStatement,
  unitFromLabel,
  XbrlError,
  type BuildInput,
  type LlmClient,
  type LlmRequest,
  type Statement,
} from "../src/index";
import { makeDeps, makePdf } from "./fakes";
import { DIXON, DIXON_PAGES, HDFCBANK, HDFCBANK_PAGES, SCREENER, dixonModelOutput, xbrl } from "./fixtures/results/data";

const FILED = "2026-10-30T16:19:51+05:30" as const;
const DIXON_PDF = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/d7b8fffb-7a5f-4efa-9241-482c5d765f1d.pdf";
const HDFC_PDF = "https://www.bseindia.com/xml-data/corpfiling/AttachLive/f5d5fb37-aa66-401c-85d6-58ccd3982828.pdf";

const pagesOf = (pages: string[]) => pages.map((text, i) => ({ text, page: i + 1 }));
const check = (card: ResultsCard, id: ResultsCheck["id"]) => card.checks.find((c) => c.id === id)!;

function dixonCard(over: Partial<BuildInput> = {}): ResultsCard {
  return buildResultsCard({
    symbol: "DIXON",
    is_bank: false,
    statement: parseResultsXbrl(xbrl({ scrip: "540699", basis: "Consolidated", cols: DIXON })),
    source: { kind: "xbrl", url: "https://nsearchives.nseindia.com/corporate/xbrl/DIXON_Q2FY27.xml", page: null },
    filed_at: FILED,
    comparability: detectComparability(pagesOf(DIXON_PAGES)),
    screener: SCREENER.DIXON,
    ...over,
  });
}

function hdfcCard(over: Partial<BuildInput> = {}): ResultsCard {
  return buildResultsCard({
    symbol: "HDFCBANK",
    is_bank: true,
    statement: parseResultsXbrl(xbrl({ scrip: "500180", basis: "Consolidated", cols: HDFCBANK, bank: true })),
    source: { kind: "xbrl", url: "https://nsearchives.nseindia.com/corporate/xbrl/HDFCBANK_Q2FY27.xml", page: null },
    filed_at: "2026-10-17T13:56:34+05:30",
    comparability: detectComparability(pagesOf(HDFCBANK_PAGES)),
    screener: SCREENER.HDFCBANK,
    ...over,
  });
}

// ─── Units and XBRL ──────────────────────────────────────────────────────────

test("units: rupees, thousands, lakhs, millions and crores all land in ₹ crore", () => {
  assert.equal(toCrore(217_936_400_000, "rupees"), 21793.64);
  assert.equal(toCrore(21_793_640, "thousands"), 2179.36);
  assert.equal(toCrore(2_179_364, "lakhs"), 21793.64);
  assert.equal(toCrore(217_936.4, "millions"), 21793.64);
  assert.equal(toCrore(21793.64, "crores"), 21793.64);
  assert.equal(unitFromLabel("(Rupees in Crores unless otherwise stated)"), "crores");
  assert.equal(unitFromLabel("(₹ in lakhs, except per share data)"), "lakhs");
  assert.equal(unitFromLabel("Rs. in Millions"), "millions");
});

test("XBRL: rupee facts become crore, consolidated basis read, segment facts ignored", () => {
  const s = parseResultsXbrl(xbrl({ scrip: "540699", basis: "Consolidated", cols: DIXON }));
  assert.equal(s.basis, "consolidated");
  const q2 = s.columns.find((c) => c.start === "2026-07-01")!;
  assert.equal(q2.values.revenue, 21793.64, "the 99,99,999 cr segment fact must not leak in");
  assert.equal(q2.values.pat, 410.87);
  assert.equal(q2.values.share_of_associates_in_pbt, 2.81);
  const h1 = s.columns.find((c) => c.start === "2026-04-01" && c.end === "2026-09-30")!;
  assert.equal(h1.values.operating_cash_flow, -280.02);
});

test("XBRL: missing basis, malformed XML or an unknown taxonomy are errors, never guesses", () => {
  assert.throws(() => parseResultsXbrl(xbrl({ scrip: "540699", basis: null, cols: DIXON })), /cannot tell consolidated from standalone/);
  assert.throws(() => parseResultsXbrl("<xbrl><unclosed>"), XbrlError);
  assert.throws(() => parseResultsXbrl(`<xbrl><NatureOfReportStandaloneConsolidated contextRef="a">Consolidated</NatureOfReportStandaloneConsolidated></xbrl>`), /no period has both revenue and profit/);
});

// ─── Dixon (industrial) ──────────────────────────────────────────────────────

test("Dixon: EBITDA is exact for every quarter, and ties to Screener's operating profit", () => {
  const card = dixonCard();
  assert.equal(card.period, "Q2FY27");
  assert.equal(card.basis, "consolidated");
  // PBT before exceptional + finance costs + D&A − other income − share of JV profit
  assert.equal(card.current.ebitda, 596.82); //  532.35 + 25.95 + 110.06 − 68.73 − 2.81
  assert.equal(card.prior_quarter!.ebitda, 463.12); // 868.98 + 24.12 + 106.95 − 528.29 − 8.64
  assert.equal(card.year_ago!.ebitda, 561.33); // 923.59 + 38.35 + 96.28 − 495.74 − 1.15
  assert.equal(
    card.ebitda_formula,
    "EBITDA = PBT before exceptional items ₹532.35 cr + finance costs ₹25.95 cr + depreciation and amortisation ₹110.06 cr − other income ₹68.73 cr − share of JV/associate profit ₹2.81 cr = ₹596.82 cr",
  );
  assert.equal(check(card, "screener_ebitda").status, "pass", "Screener operating profit 597");
});

test("Dixon: other income would have masked operations — Q1 PBT beat Q2, Q1 EBITDA did not", () => {
  const card = dixonCard();
  assert.ok(card.prior_quarter!.pbt > card.current.pbt, "Q1 PBT 868.98 > Q2 532.35");
  assert.ok(card.prior_quarter!.ebitda! < card.current.ebitda!, "Q1 EBITDA 463.12 < Q2 596.82 once ₹528 cr other income is removed");
});

test("Dixon: PBT − tax = PAT in all three quarters; revenue, PBT and PAT tie to Screener", () => {
  const card = dixonCard();
  assert.deepEqual(
    Object.fromEntries(card.checks.map((c) => [c.id, c.status])),
    {
      pat_tie: "pass",
      ebitda: "pass",
      screener_revenue: "pass",
      screener_pbt: "pass",
      screener_pat: "pass",
      screener_ebitda: "pass",
      exceptional_items: "pass",
      comparability: "flag",
      cash_conversion: "flag",
    },
  );
  assert.equal(check(card, "pat_tie").note, "PBT − tax = PAT in all 3 quarters");
  assert.equal(check(card, "screener_revenue").note, "Revenue: ₹21,793.64 cr vs Screener ₹21,794.00 cr");
});

test("Dixon: the filing says the quarter is not comparable (lighting business moved to a JV), so no growth figures", () => {
  const card = dixonCard();
  assert.equal(card.comparable, false);
  assert.match(card.comparability_note!, /not comparable .* due to the transfer of the lighting business to a Joint Venture company with effect from 01 August 2025/);
  assert.equal(card.growth, null, "no bogus QoQ/YoY across a business transfer");
  assert.equal(check(card, "comparability").page, 12);
});

test("Dixon: H1 cash conversion from the half-year cash flow (Q2) — negative, flagged", () => {
  const card = dixonCard();
  assert.deepEqual(card.cash_conversion, {
    period: "H1FY27",
    operating_cash_flow: -280.02,
    pat: 1128.7,
    ratio: -0.25,
    note: "H1 operating cash −₹280 cr vs PAT ₹1,129 cr (−0.2x)",
    page: null,
  });
  assert.equal(check(card, "cash_conversion").status, "flag");
});

// ─── HDFC Bank ───────────────────────────────────────────────────────────────

test("HDFC Bank: banking schema — NII, provisions and PAT; EBITDA null with a note", () => {
  const card = hdfcCard();
  for (const m of [card.current, card.prior_quarter!, card.year_ago!]) {
    assert.equal(m.ebitda, null);
    assert.equal(m.finance_costs, null);
    assert.equal(m.depreciation, null);
  }
  assert.equal(card.ebitda_formula, null);
  assert.deepEqual(check(card, "ebitda"), {
    id: "ebitda",
    status: "skipped",
    note: "EBITDA is not applicable to banks; showing net interest income, provisions and PAT instead",
    page: null,
  });
  assert.equal(card.current.nii, 44464.2, "95,131.63 interest earned − 50,667.43 interest expended");
  assert.equal(card.prior_quarter!.nii, 42949.7);
  assert.equal(card.current.provisions, 4209);
  assert.equal(card.current.pat, 21537.09, "PAT before minority interest");
  assert.equal(card.current.pat_owners, 20700.03);
  assert.equal(check(card, "screener_ebitda"), undefined, "no EBITDA cross-check for a bank");
});

test("HDFC Bank: PPOP − provisions = PBT and PBT − tax = PAT in every quarter; ties to Screener", () => {
  const card = hdfcCard();
  for (const id of ["pat_tie", "ppop_tie", "screener_revenue", "screener_pbt", "screener_pat"] as const) {
    assert.equal(check(card, id).status, "pass", `${id}: ${check(card, id).note}`);
  }
  assert.equal(check(card, "ppop_tie").note, "Operating profit − provisions = PBT in all 3 quarters");
});

test("HDFC Bank: 'figures regrouped / reclassified' is boilerplate, so growth is computed", () => {
  const card = hdfcCard();
  assert.equal(card.comparable, true);
  assert.deepEqual(card.growth, {
    revenue_qoq_pct: 5.0,
    revenue_yoy_pct: 9.4,
    pat_qoq_pct: 5.7,
    pat_yoy_pct: 5.8,
    ebitda_margin_pct: null,
    ebitda_margin_yoy_pp: null,
  });
});

test("HDFC Bank: no cash conversion for a bank", () => {
  const card = hdfcCard();
  assert.equal(card.cash_conversion, null);
  assert.match(check(card, "cash_conversion").note, /not meaningful for banks/);
});

test("bank overrides are enforced by the schema: a bank card carrying EBITDA is rejected", () => {
  const card = hdfcCard();
  assert.throws(() => ResultsCard.parse({ ...card, current: { ...card.current, ebitda: 1000 } }), /must be null for banks/);
  assert.throws(() => ResultsCard.parse({ ...card, ebitda_formula: "EBITDA = …" }), /banks must not/);
  assert.throws(() => ResultsCard.parse({ ...card, current: { ...card.current, nii: 44000 } }), /NII must equal/);
});

test("is_bank drives the schema: bank numbers on a non-bank company fail closed", () => {
  assert.throws(() => hdfcCard({ is_bank: false }), /finance costs missing/);
});

// ─── PDF path, against the real page text ───────────────────────────────────

test("PDF text noise from the real filings is normalised before tracing numbers", () => {
  const h = normalizeNumbers(HDFCBANK_PAGES[8]!);
  assert.ok(onPage(90575.33, h), "'9O575.33' with a letter O");
  assert.ok(onPage(30996, h), "'3O996.OO'");
  assert.ok(onPage(95131.63, h) && onPage(50667.43, h), "neighbouring values are not fused");
  const d = normalizeNumbers(DIXON_PAGES[10]!);
  assert.ok(onPage(21793.64, d), "'21,793.64'");
  assert.ok(onPage(25.95, d), "finance cost displaced to the top of the page is still found");
  assert.ok(!onPage(21800, d), "a number that isn't there is not found");
  assert.ok(onPage(-280.02, normalizeNumbers(DIXON_PAGES[13]!)), "'(280.02)' on the cash flow page");
});

test("PDF: model output for Dixon traces to pages 11 and 14 and builds the same card as XBRL", () => {
  const out = ResultsExtraction.parse(dixonModelOutput((v, i) => i === 3 && (v.finance_costs = null)));
  const { statement, trace } = toStatement(out.statements[0]!, DIXON_PAGES);
  assert.deepEqual(trace.missing, []);
  const card = dixonCard({ statement, source: { kind: "pdf", url: DIXON_PDF, page: 11 }, trace });
  assert.equal(card.current.ebitda, 596.82);
  assert.equal(check(card, "source_trace").status, "pass");
  assert.equal(card.cash_conversion!.page, 14);
});

test("PDF: HDFC Bank figures trace to page 9 despite letter-O-for-zero noise", () => {
  const blank = Object.fromEntries(Object.keys(dixonModelOutput().statements[0]!.columns[0]!.values).map((k) => [k, null]));
  const out = ResultsExtraction.parse({
    statements: [{
      basis: "consolidated", unit: "crores", page: 9,
      columns: HDFCBANK.slice(0, 3).map((c) => ({ period_start: c.start, period_end: c.end, values: { ...blank, ...c.values }, cash_flow_page: null })),
    }],
  });
  const { statement, trace } = toStatement(out.statements[0]!, HDFCBANK_PAGES);
  assert.deepEqual(trace.missing, []);
  const card = hdfcCard({ statement, source: { kind: "pdf", url: HDFC_PDF, page: 9 }, trace });
  assert.equal(card.current.nii, 44464.2);
  assert.equal(card.current.ebitda, null);
});

test("PDF: an H1 operating cash figure that isn't on the cash flow page is never used for cash conversion", () => {
  const out = ResultsExtraction.parse(
    dixonModelOutput((v, i) => {
      if (i === 3) {
        v.finance_costs = null;
        v.operating_cash_flow = 420.0; // not in the filing
      }
    }),
  );
  const { statement, trace } = toStatement(out.statements[0]!, DIXON_PAGES);
  const card = dixonCard({ statement, source: { kind: "pdf", url: DIXON_PDF, page: 11 }, trace });
  assert.equal(card.cash_conversion, null);
  assert.equal(check(card, "cash_conversion").note, "Operating cash or PAT for the cash period could not be traced to the filing");
  assert.equal(check(card, "source_trace").status, "flag");
  assert.match(check(card, "source_trace").note, /operating cash flow 420\.00 \(p\.14\)/);
});

test("PDF: the model has no EBITDA field — output that includes one is rejected", () => {
  const out = dixonModelOutput((v) => ((v as Record<string, unknown>).ebitda = 599.63));
  assert.throws(() => ResultsExtraction.parse(out), /ebitda/i);
});

// ─── Orchestrator ────────────────────────────────────────────────────────────

const DIXON_CO = { symbol: "DIXON", bse_code: "540699", is_bank: false };
const XBRL_URL = "https://nsearchives.nseindia.com/corporate/xbrl/DIXON_Q2FY27.xml";

function seedScreener(store: ReturnType<typeof makeDeps>["store"]) {
  const s = SCREENER.DIXON;
  return store.upsertActuals([
    ["sales", s.revenue], ["profit_before_tax", s.pbt], ["net_profit", s.pat], ["operating_profit", s.operating_profit],
  ].map(([metric, value]) => ({ symbol: "DIXON", period: "Q2FY27", metric: metric as string, basis: "consolidated" as const, value: value as number, unit: "inr_cr" as const, source: "screener" as const })));
}

function fakeLlm(output: unknown) {
  const calls: LlmRequest<unknown>[] = [];
  const llm: LlmClient = {
    async run<T>(req: LlmRequest<T>) {
      calls.push(req as LlmRequest<unknown>);
      return { data: req.schema.parse(output), model: "gemini-mid-test" };
    },
  };
  return { llm, calls };
}

const pdfBytes = makePdf(DIXON_PAGES);

test("orchestrator: XBRL first; card stored; run logged; notes read from the PDF", async () => {
  const { deps, store } = makeDeps((req) =>
    req.url === XBRL_URL ? { body: xbrl({ scrip: "540699", basis: "Consolidated", cols: DIXON }) } : req.url === DIXON_PDF ? { body: pdfBytes } : { status: 404 },
  );
  await seedScreener(store);
  const out = await extractResults(deps, { company: DIXON_CO, filing_id: 42, filed_at: FILED, xbrl_url: XBRL_URL, pdf_url: DIXON_PDF });
  assert.ok(out.ok, !out.ok ? out.error : "");
  const stored = store.results.get("DIXON|Q2FY27|consolidated")!;
  assert.equal(stored.card.source.kind, "xbrl");
  assert.equal(stored.filing_id, 42);
  assert.equal(stored.card.comparable, false, "notes came from the PDF even though numbers came from XBRL");
  assert.equal(store.runs.at(-1)!.source, "results");
  assert.equal(store.runs.at(-1)!.status, "partial", "flags (comparability, cash) are surfaced in the run");
});

test("orchestrator: unusable XBRL falls back to the PDF read by the mid-tier model", async () => {
  const { deps, store } = makeDeps((req) => (req.url === XBRL_URL ? { body: "<html>Not Found</html>" } : req.url === DIXON_PDF ? { body: pdfBytes } : { status: 404 }));
  await seedScreener(store);
  const { llm, calls } = fakeLlm(dixonModelOutput((v, i) => i === 3 && (v.finance_costs = null)));
  const out = await extractResults({ ...deps, llm }, { company: DIXON_CO, filing_id: 42, filed_at: FILED, xbrl_url: XBRL_URL, pdf_url: DIXON_PDF });
  assert.ok(out.ok, !out.ok ? out.error : "");
  assert.equal(out.result.source.kind, "pdf");
  assert.equal(out.result.current.ebitda, 596.82, "EBITDA computed in code from what the model read");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.tier, "mid");
  assert.match(calls[0]!.input, /=== Page 11 ===/);
  assert.match(store.runs.at(-1)!.error!, /XBRL unusable/);
});

test("orchestrator: a figure the model 'read' that is not on the page fails closed — nothing stored", async () => {
  const { deps, store } = makeDeps((req) => (req.url === DIXON_PDF ? { body: pdfBytes } : { status: 404 }));
  await seedScreener(store);
  const { llm } = fakeLlm(dixonModelOutput((v, i) => i === 0 && (v.revenue = 21800.0)));
  const out = await extractResults({ ...deps, llm }, { company: DIXON_CO, filing_id: 42, filed_at: FILED, pdf_url: DIXON_PDF });
  assert.equal(out.ok, false);
  assert.match(!out.ok ? out.error : "", /not found on the cited page: revenue 21800 \(p\.11\)/);
  assert.equal(store.results.size, 0);
});

test("orchestrator: no XBRL and no model configured fails closed with a clear reason", async () => {
  const { deps, store } = makeDeps((req) => (req.url === DIXON_PDF ? { body: pdfBytes } : { status: 404 }));
  const out = await extractResults(deps, { company: DIXON_CO, filing_id: 42, filed_at: FILED, pdf_url: DIXON_PDF });
  assert.equal(out.ok, false);
  assert.match(!out.ok ? out.error : "", /needs the mid-tier model/);
  assert.equal(store.results.size, 0);
  assert.equal(store.runs.at(-1)!.status, "failed");
});

// ─── Edge cases (synthetic variations on the Dixon numbers) ─────────────────

function variant(edit: (q2: Record<string, number>) => void): Statement {
  const cols = DIXON.map((c, i) => {
    const values = { ...c.values } as Record<string, number>;
    if (i === 0) edit(values);
    return { ...c, values };
  });
  return parseResultsXbrl(xbrl({ scrip: "540699", basis: "Consolidated", cols }));
}

test("exceptional item: flagged as a one-off in PBT; EBITDA unaffected (it starts from PBT before exceptionals)", () => {
  const card = dixonCard({
    statement: variant((v) => {
      v.exceptional_items = -38;
      v.pbt = 494.35;
      v.pat = 372.87;
    }),
    screener: null,
  });
  assert.deepEqual(check(card, "exceptional_items"), { id: "exceptional_items", status: "flag", note: "One-off charge of ₹38 cr in PBT", page: null });
  assert.equal(card.current.ebitda, 596.82);
  assert.equal(check(card, "pat_tie").status, "pass");
});

test("PAT that doesn't tie is reported, never hidden", () => {
  const card = dixonCard({ statement: variant((v) => (v.pat = 400)), screener: null });
  assert.deepEqual(check(card, "pat_tie"), {
    id: "pat_tie",
    status: "fail",
    note: "Q2 FY27: 532.35 − 121.48 = 410.87, filing says PAT 400.00",
    page: null,
  });
});

test("a unit error (figures 100× too large) is caught by the Screener cross-check", () => {
  const cols = DIXON.map((c) => ({ ...c, values: Object.fromEntries(Object.entries(c.values).map(([k, v]) => [k, v * 100])) }));
  const card = dixonCard({ statement: parseResultsXbrl(xbrl({ scrip: "540699", basis: "Consolidated", cols })) });
  assert.equal(check(card, "screener_revenue").status, "fail");
  assert.match(check(card, "screener_revenue").note, /does not tie/);
});

test("consolidated is preferred; a standalone-only card is never compared with consolidated Screener figures", () => {
  const cons = parseResultsXbrl(xbrl({ scrip: "540699", basis: "Consolidated", cols: DIXON }));
  const stand = parseResultsXbrl(xbrl({ scrip: "540699", basis: "Standalone", cols: DIXON }));
  assert.equal(preferConsolidated([stand, cons]), cons);
  assert.equal(preferConsolidated([stand]), stand);
  const card = dixonCard({ statement: stand });
  assert.equal(card.basis, "standalone");
  for (const id of ["screener_revenue", "screener_pbt", "screener_pat", "screener_ebitda"] as const) {
    assert.equal(check(card, id).status, "skipped");
    assert.equal(check(card, id).note, "Screener has only consolidated figures; not compared with standalone");
  }
});

test("comparability: what counts as a restatement and what doesn't", () => {
  const c = (text: string) => detectComparability([{ text, page: 1 }]).comparable;
  assert.equal(c("Figures of the previous periods have been regrouped / reclassified wherever necessary."), true);
  assert.equal(c("The Board approved a scheme of demerger of the cables business, subject to NCLT approval."), true, "not yet effective");
  assert.equal(c("Figures for the comparative periods have been restated to give effect to the merger."), false);
  assert.equal(c("Pursuant to the scheme of arrangement, the demerger became effective from the appointed date of 1 April 2026."), false);
  assert.equal(c("The results of the healthcare business are presented as discontinued operations."), false);
  assert.equal(c("No restatement of prior periods was required."), true);
});

test("Q1 and Q3 have no cash flow statement; the card says so instead of guessing", () => {
  const q1 = DIXON.filter((c) => c.end <= "2026-06-30").map((c) => ({ ...c }));
  // Q1 FY27 is current; Q2 FY26 would be its… no: year-ago of Q1 FY27 is Q1 FY26, not present.
  const card = dixonCard({ statement: parseResultsXbrl(xbrl({ scrip: "540699", basis: "Consolidated", cols: q1 })), screener: null, comparability: null });
  assert.equal(card.period, "Q1FY27");
  assert.equal(card.cash_conversion, null);
  assert.equal(check(card, "cash_conversion").note, "Q1 and Q3 filings carry no cash flow statement");
  assert.equal(check(card, "comparability").status, "skipped");
});
