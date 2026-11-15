import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDocument, extractPdfPages } from "../src/index";
import { makeDeps, makePdf } from "./fakes";

const TRANSCRIPT = [
  "Dixon Technologies Q2 FY27 Earnings Conference Call\nModerator: Ladies and gentlemen, good day and welcome.",
  "Management: We expect EBITDA margin of 4 to 4.5% for FY27,\nsubject to component availability in the second half.",
];

test("extractPdfPages: text per page, in order", async () => {
  const r = await extractPdfPages(makePdf(TRANSCRIPT));
  assert.ok(r.ok);
  assert.equal(r.pages.length, 2);
  assert.match(r.pages[0]!, /Earnings Conference Call/);
  assert.match(r.pages[1]!, /EBITDA margin of 4 to 4\.5%/);
  assert.equal(r.readable, true);
});

test("extractPdfPages: a PDF with no text layer is unreadable, not an error", async () => {
  const r = await extractPdfPages(makePdf(["", "", "3"]));
  assert.ok(r.ok);
  assert.equal(r.readable, false);
});

test("extractPdfPages: garbage bytes return an error instead of throwing", async () => {
  const r = await extractPdfPages(new TextEncoder().encode("%PDF-1.4 truncated nonsense"));
  assert.equal(r.ok, false);
});

test("extractDocument: stores text once, skips the same bytes the second time (SHA-256)", async () => {
  const pdf = makePdf(TRANSCRIPT);
  const { deps, store } = makeDeps(() => ({ body: pdf, headers: { "content-type": "application/pdf" } }));
  const input = { symbol: "DIXON", type: "transcript" as const, period: "Q2FY27", url: "https://example.com/t.pdf" };

  const first = await extractDocument(deps, input);
  assert.ok(first.ok);
  assert.equal(first.result.outcome, "new");
  assert.equal(first.result.readable, true);
  const doc = store.documents.get(first.result.sha256)!;
  assert.equal(doc.storage_path, `${first.result.sha256}.json.gz`);
  assert.equal(store.texts.get(first.result.sha256)!.length, 2);

  const second = await extractDocument(deps, { ...input, url: "https://mirror.example.com/same.pdf" });
  assert.ok(second.ok);
  assert.equal(second.result.outcome, "already_have");
  assert.equal(store.documents.size, 1);
  assert.deepEqual(store.runs.map((r) => [r.source, r.status, r.rows_ingested]), [["documents", "ok", 1], ["documents", "ok", 0]]);
});

test("extractDocument: a scanned transcript is recorded readable=false, logged, and the run is partial", async () => {
  const { deps, store, log } = makeDeps(() => ({ body: makePdf(["", ""]) }));
  const out = await extractDocument(deps, { symbol: "DIXON", type: "transcript", period: "Q1FY27", url: "https://example.com/scan.pdf" });
  assert.ok(out.ok);
  assert.equal(out.status, "partial");
  assert.equal(out.result.readable, false);
  const doc = [...store.documents.values()][0]!;
  assert.equal(doc.readable, false);
  assert.equal(doc.storage_path, null);
  assert.equal(store.texts.size, 0, "no text stored for a scan");
  assert.ok(log.lines.some((l) => /warn documents: DIXON transcript Q1FY27: looks like a scan/.test(l)));
});

test("extractDocument: an HTML error page instead of a PDF fails the run with a clear message", async () => {
  const { deps, store } = makeDeps(() => ({ body: "<html>Session expired</html>", headers: { "content-type": "text/html" } }));
  const out = await extractDocument(deps, { symbol: "DIXON", type: "results", period: null, url: "https://example.com/r.pdf" });
  assert.equal(out.ok, false);
  assert.match(store.runs[0]!.error!, /is not a PDF \(content-type text\/html\)/);
});
