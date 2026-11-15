import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  classifyByRules,
  detectAlwaysAct,
  findDuplicate,
  foldFeed,
  ingestFilings,
  MemoryStore,
  normalizeBse,
  normalizeNse,
  scoreFiling,
  type CoreDeps,
  type FilingRow,
  type LlmClient,
  type LlmRequest,
} from "../src/index";
import { FakeClock, FakeLog } from "./fakes";
import { BSE_DUPLICATES, NSE_FIXTURE, WEIGHTS } from "./fixtures/filings";

const hash = { sha256: async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex") };

async function nseRows(): Promise<Map<string, FilingRow>> {
  const out = new Map<string, FilingRow>();
  for (const f of NSE_FIXTURE) {
    const r = await normalizeNse(hash, f.raw.symbol, f.raw);
    assert.ok(r.ok, `${f.id}: ${!r.ok && r.reason}`);
    out.set(f.id, r.filing);
  }
  return out;
}

async function bseRows(): Promise<FilingRow[]> {
  const out: FilingRow[] = [];
  for (const b of BSE_DUPLICATES) {
    const r = await normalizeBse(hash, b.symbol, b.raw);
    assert.ok(r.ok);
    out.push(r.filing);
  }
  return out;
}

/** Counts model calls; answers classification and headlines like a cooperative model would. */
function fakeLlm(opts: { classify?: object; headline?: (input: string) => string; fail?: boolean } = {}) {
  const calls: LlmRequest<unknown>[] = [];
  const llm: LlmClient = {
    async run<T>(req: LlmRequest<T>) {
      calls.push(req as LlmRequest<unknown>);
      if (opts.fail) throw new Error("429 Too Many Requests");
      const data =
        req.task === "classify_filing"
          ? (opts.classify ?? { category: "press_release", sub_kind: "business_update", routine: false })
          : { headline: opts.headline?.(req.input) ?? "Model headline" };
      return { data: req.schema.parse(data), model: "gemini-flash-lite-test" };
    },
  };
  return { llm, calls };
}

function setup(llm?: LlmClient) {
  const store = new MemoryStore(
    Object.keys(WEIGHTS).map((symbol) => ({ symbol, bse_code: null, is_bank: symbol === "HDFCBANK" || symbol === "BAJFINANCE" })),
    WEIGHTS,
  );
  const log = new FakeLog();
  const deps: CoreDeps = {
    http: { request: async () => { throw new Error("no network in pipeline tests"); } },
    clock: new FakeClock(),
    hash,
    log,
    store,
    runner: "manual",
    ...(llm ? { llm } : {}),
  };
  return { deps, store, log };
}

const analysisOf = (store: MemoryStore, row: FilingRow) => {
  const f = [...store.filings.values()].find((x) => x.dedupe_key === row.dedupe_key)!;
  return { filing: f, analysis: store.analyses.get(f.id) };
};

// ─── The fixture, end to end ──────────────────────────────────────────────────

test("fixture: every NSE filing lands in the expected category and tier", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values(), ...(await bseRows())]);

  const wrong: string[] = [];
  for (const f of NSE_FIXTURE) {
    const a = analysisOf(store, nse.get(f.id)!).analysis!;
    if (a.category !== f.expect.category || a.tier !== f.expect.tier) {
      wrong.push(`${f.id}: got ${a.category}/${a.tier}, expected ${f.expect.category}/${f.expect.tier}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("fixture: every Always-Act trigger fires, and nothing else is forced to Act", async () => {
  for (const f of NSE_FIXTURE) {
    const { triggers } = detectAlwaysAct(f.raw.desc, f.raw.attchmntText);
    const ids = triggers.map((t) => t.id);
    if (f.expect.trigger) assert.ok(ids.includes(f.expect.trigger), `${f.id} should fire ${f.expect.trigger}, fired [${ids}]`);
    else assert.deepEqual(ids, [], `${f.id} should fire nothing, fired [${ids}]`);
  }
});

test("fixture: Always-Act items are Act with plain-language reasons", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  const report = await ingestFilings(deps, [...nse.values()]);

  const want: Record<string, string> = {
    "polycab-cfo-out": "CFO resigned",
    "kaynes-auditor": "Auditor resigned",
    "titan-downgrade": "Credit rating downgraded from AA+ to AA",
    "sona-promoter-sale": "Promoter sold shares in open market",
    "page-pledge": "Promoter pledged more shares",
    "havells-penalty": "Regulator imposed a penalty",
    "cgpower-ibc": "Insolvency proceedings filed",
    "persistent-qualified": "Auditor qualified the accounts",
  };
  for (const [id, reason] of Object.entries(want)) {
    const a = analysisOf(store, nse.get(id)!).analysis!;
    assert.equal(a.tier, "act", id);
    assert.ok(a.reasons.includes(reason), `${id}: reasons were ${JSON.stringify(a.reasons)}`);
    assert.ok(a.reasons.includes("Always flagged: governance red flag"), id);
  }
  assert.equal(report.always_act.length, 8);
});

test("fixture: reasons are human sentences with no score arithmetic", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values()]);
  const all = [...store.analyses.values()];
  for (const a of all) {
    for (const r of a.reasons) {
      assert.doesNotMatch(r, /(^|\s)[+−-]\s?\d+\b|\bscore\b|\bpoints?\b/i, `bad reason "${r}"`);
    }
  }
  const dixon = analysisOf(store, nse.get("dixon-results")!).analysis!;
  assert.deepEqual(dixon.reasons, ["Results filing for 6.5% position"]);
  const hdfc = analysisOf(store, nse.get("hdfc-results")!).analysis!;
  assert.deepEqual(hdfc.reasons, ["Results filing for 9% position", "Large position makes this material"]);
});

test("fixture: position size moves Results from Read (6.5%) to Act (9%)", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values()]);
  const dixon = analysisOf(store, nse.get("dixon-results")!).analysis!;
  const hdfc = analysisOf(store, nse.get("hdfc-results")!).analysis!;
  assert.equal(dixon.tier, "read");
  assert.equal(hdfc.tier, "act");
  assert.ok(hdfc.score > dixon.score);
});

test("fixture: mandatory auditor rotation is Read with an explanation, not Act", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values()]);
  const a = analysisOf(store, nse.get("astral-rotation")!).analysis!;
  assert.equal(a.tier, "read");
  assert.ok(a.reasons.includes("Auditor change is mandatory rotation under the Companies Act: normal compliance"));
  assert.equal(a.headline, "Auditor changed on mandatory rotation");
});

test("fixture: rules classify at least 85% of filings without a model", async () => {
  const byRule = NSE_FIXTURE.filter((f) => classifyByRules(f.raw.desc, f.raw.attchmntText).kind === "match").length;
  assert.ok(byRule / NSE_FIXTURE.length >= 0.85, `${byRule}/${NSE_FIXTURE.length} by rule`);
  assert.equal(byRule, 19, "only the business update needs the model");
});

// ─── Duplicates ──────────────────────────────────────────────────────────────

test("fixture: the three BSE copies are stored, linked to their NSE originals, and never analysed", async () => {
  const nse = await nseRows();
  const bse = await bseRows();
  const { deps, store } = setup();
  const report = await ingestFilings(deps, [...nse.values(), ...bse]);

  assert.equal(report.inserted, 23, "all 23 stored: nothing deleted");
  assert.equal(report.duplicates.length, 3);
  for (const [i, b] of BSE_DUPLICATES.entries()) {
    const dup = analysisOf(store, bse[i]!);
    const original = analysisOf(store, nse.get(b.of)!);
    assert.equal(dup.filing.duplicate_of, original.filing.id, `${b.of}: BSE copy should link to NSE original`);
    assert.equal(dup.analysis, undefined, `${b.of}: duplicates get no analysis, so no second alert`);
  }
  assert.equal(store.analyses.size, 20);
});

test("BSE copies arriving in a later run (the NSE→BSE fallback path) still link to stored NSE filings", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values()]);
  const report = await ingestFilings(deps, await bseRows());
  assert.equal(report.duplicates.length, 3);
  assert.equal(report.tiers.act + report.tiers.read + report.tiers.routine, 0, "nothing new to alert on");
  assert.equal(store.analyses.size, 20);
});

test("dedupe never merges a resignation with an appointment of the same role", async () => {
  const nse = await nseRows();
  const bse = await bseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values(), ...bse]);
  const appointment = analysisOf(store, nse.get("polycab-cfo-in")!);
  assert.equal(appointment.filing.duplicate_of, null);
  assert.ok(appointment.analysis);
});

test("10-minute window is a sliding window, not a clock bucket", () => {
  const base = { symbol: "DIXON", subject: "Closure of Trading Window", subject_hash: "h" };
  const a = { ...base, ref: 1, exchange: "NSE" as const, filed_at: "2026-11-14T16:39:59+05:30" as const };
  const across = { ...base, ref: "b", exchange: "BSE" as const, filed_at: "2026-11-14T16:40:01+05:30" as const };
  const late = { ...base, ref: "c", exchange: "BSE" as const, filed_at: "2026-11-14T16:50:01+05:30" as const };
  assert.ok(findDuplicate(across, [a]), "2 seconds apart across a 10-minute boundary is a duplicate");
  assert.equal(findDuplicate(late, [a]), null, "10 min 2 s apart is not");
  assert.equal(findDuplicate({ ...across, symbol: "KAYNES" }, [a]), null, "different company is not");
});

test("re-polling the same records is a no-op: no new rows, no new analysis, no model calls", async () => {
  const nse = await nseRows();
  const { llm, calls } = fakeLlm();
  const { deps, store } = setup(llm);
  await ingestFilings(deps, [...nse.values()]);
  const callsAfterFirst = calls.length;
  const again = await ingestFilings(deps, [...nse.values()]);
  assert.equal(again.inserted, 0);
  assert.equal(again.already_had, 20);
  assert.equal(calls.length, callsAfterFirst, "headlines are generated once per filing id");
  assert.equal(store.filings.size, 20);
});

// ─── Grouping and folding ────────────────────────────────────────────────────

test("fixture: Dixon's results, deck, press release and newspaper ad become one event with results as primary", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values(), ...(await bseRows())]);

  const ids = ["dixon-results", "dixon-deck", "dixon-pr", "dixon-ad"].map((id) => analysisOf(store, nse.get(id)!));
  const eventIds = new Set(ids.map((x) => x.analysis!.event_id));
  assert.equal(eventIds.size, 1, "one event");
  const event = store.events.get([...eventIds][0]!)!;
  assert.equal(event.kind, "results");
  assert.equal(event.primary_filing_id, ids[0]!.filing.id);

  const cfo = ["polycab-cfo-out", "polycab-cfo-in"].map((id) => analysisOf(store, nse.get(id)!));
  assert.equal(cfo[0]!.analysis!.event_id, cfo[1]!.analysis!.event_id, "CFO exit and replacement are one event");
  assert.equal(store.events.get(cfo[0]!.analysis!.event_id!)!.primary_filing_id, cfo[0]!.filing.id, "resignation leads");
});

test("a later, more important filing takes over as the event's primary", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  // Deck arrives in one poll, results in the next.
  await ingestFilings(deps, [nse.get("dixon-deck")!]);
  await ingestFilings(deps, [nse.get("dixon-results")!]);
  assert.equal(store.events.size, 1);
  const results = analysisOf(store, nse.get("dixon-results")!);
  assert.equal([...store.events.values()][0]!.primary_filing_id, results.filing.id);
});

test("fixture: the feed shows one card per event; routine items fold behind a count, none deleted", async () => {
  const nse = await nseRows();
  const { deps, store } = setup();
  await ingestFilings(deps, [...nse.values(), ...(await bseRows())]);

  const items = [...store.analyses.values()].map((a) => {
    const f = store.filings.get(a.filing_id)!;
    return { filing_id: a.filing_id, event_id: a.event_id!, symbol: f.symbol, tier: a.tier, score: a.score, headline: a.headline, reasons: a.reasons, filed_at: f.filed_at };
  });
  const feed = foldFeed(items, (id) => store.events.get(id)!.primary_filing_id);

  assert.equal(feed.act.length, 9, feed.act.map((c) => c.primary.headline).join(" | "));
  assert.equal(feed.read.length, 3);
  assert.equal(feed.routine.count, 4, "trading window, lost certificates, meet schedule, clean-opinion declaration");
  const dixon = feed.read.find((c) => c.symbol === "DIXON")!;
  assert.equal(dixon.related.length, 3, "deck, press release and newspaper ad folded under results");
  assert.equal(dixon.primary.headline, "Q2 FY27 results announced");
  const polycab = feed.act.find((c) => c.symbol === "POLYCAB")!;
  assert.equal(polycab.primary.headline, "CFO Rakesh Sharma resigned");
  assert.equal(polycab.related[0]!.headline, "Anil Mehta appointed as CFO");
  // Every one of the 20 analysed filings is reachable from the feed.
  const shown = [...feed.act, ...feed.read, ...feed.routine.cards].reduce((n, c) => n + 1 + c.related.length, 0);
  assert.equal(shown, 20);
});

// ─── Model use ───────────────────────────────────────────────────────────────

test("the model is called only for filings the rules can't settle, and for non-routine headlines", async () => {
  const nse = await nseRows();
  const { llm, calls } = fakeLlm();
  const { deps, store } = setup(llm);
  const report = await ingestFilings(deps, [...nse.values()]);

  const classifyCalls = calls.filter((c) => c.task === "classify_filing");
  assert.equal(classifyCalls.length, 1);
  assert.match(classifyCalls[0]!.input, /business performance/);
  assert.deepEqual(report.methods, { rule: 19, model: 1, fallback: 0 });
  const biz = analysisOf(store, nse.get("bajfinance-update")!).analysis!;
  assert.equal(biz.method, "model");
  assert.equal(biz.model, "gemini-flash-lite-test");

  const headlineCalls = calls.filter((c) => c.task === "rewrite_headline");
  // 5 routine filings (4 standalone + Dixon's newspaper ad) use templates, no model call.
  assert.equal(headlineCalls.length, 20 - 5, "routine items use templates, no model call");
});

test("model headlines are used when clean; boilerplate from the model is rejected for the template", async () => {
  const nse = await nseRows();
  const { llm } = fakeLlm({
    headline: (input) => (input.includes("Resignation of Mr. Rakesh") ? "CFO Rakesh Sharma resigned, effective 30 Nov" : "Disclosure under Regulation 30 of LODR"),
  });
  const { deps, store, log } = setup(llm);
  await ingestFilings(deps, [...nse.values()]);
  assert.equal(analysisOf(store, nse.get("polycab-cfo-out")!).analysis!.headline, "CFO Rakesh Sharma resigned, effective 30 Nov");
  assert.equal(analysisOf(store, nse.get("kaynes-auditor")!).analysis!.headline, "Statutory auditor resigned");
  assert.ok(log.lines.some((l) => l.includes("headline: model output rejected")));
});

test("model down: everything still gets a tier, a headline and a reason; unmatched is marked fallback", async () => {
  const nse = await nseRows();
  const { llm } = fakeLlm({ fail: true });
  const { deps, store } = setup(llm);
  const report = await ingestFilings(deps, [...nse.values()]);
  assert.deepEqual(report.methods, { rule: 19, model: 0, fallback: 1 });
  const biz = analysisOf(store, nse.get("bajfinance-update")!).analysis!;
  assert.equal(biz.category, "unclassified");
  assert.equal(biz.headline, "Update on business performance for October 2026");
  assert.ok(biz.reasons.some((r) => r.startsWith("No rule matched")));
  assert.equal(report.tiers.act, 9, "red flags don't depend on the model");
});

test("a model that calls a red flag 'routine' cannot hide it", () => {
  const act = detectAlwaysAct("General Updates", "Mr. A, Managing Director, has tendered his resignation");
  const s = scoreFiling({ category: "routine", sub_kind: "other", routine: true, triggers: act.triggers, rotation: null, weight: 2 });
  assert.equal(s.tier, "act");
  assert.deepEqual(s.reasons.slice(0, 1), ["Managing Director resigned"]);
});

test("rotation stays Read even for the largest position", () => {
  const act = detectAlwaysAct("Change in Auditor", "Change in statutory auditors due to completion of second term under Section 139(2)");
  assert.deepEqual(act.triggers, []);
  const s = scoreFiling({ category: "auditor_change", sub_kind: "auditor_change", routine: false, triggers: [], rotation: act.rotation, weight: 10 });
  assert.equal(s.tier, "read");
});

test("near-misses do not fire Always-Act", () => {
  const none = (cat: string, subj: string) => assert.deepEqual(detectAlwaysAct(cat, subj).triggers.map((t) => t.id), [], subj);
  none("Pledge", "Release of pledge on promoter shares");
  none("Disclosure", "Declaration under Regulation 31(4): no encumbrance on promoter shares");
  none("Credit Rating", "ICRA upgraded long term rating from [ICRA]AA to [ICRA]AA+");
  none("Credit Rating", "CRISIL reaffirmed rating at CRISIL AAA/Stable");
  none("Change in Director(s)", "Resignation of Mr. B as Independent Director due to pre-occupation");
  none("Disclosure", "Acquisition of shares by promoter group in open market");
  none("Appointment", "Appointment of Ms. C as Chief Financial Officer");
});
