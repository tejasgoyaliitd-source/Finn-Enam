import assert from "node:assert/strict";
import { test } from "node:test";
import { NormalizedFiling } from "@finn/shared";
import { fetchAnnouncements, normalizeBse, normalizeNse, parseExchangeIst } from "../src/index";
import { makeDeps } from "./fakes";

const hash = { sha256: async (d: Uint8Array | string) => (await import("node:crypto")).createHash("sha256").update(d).digest("hex") };

// Shape of a record from /api/corporate-announcements (extra fields trimmed).
const NSE_RECORD = {
  symbol: "DIXON",
  desc: "Outcome of Board Meeting",
  dt: "14112026164205",
  attchmntFile: "https://nsearchives.nseindia.com/corporate/DIXON_14112026164205_Outcome.pdf",
  sm_name: "Dixon Technologies (India) Limited",
  sm_isin: "INE935N01020",
  an_dt: "14-Nov-2026 16:42:05",
  sort_date: "2026-11-14 16:42:05",
  seq_id: "107712345",
  smIndustry: "Consumer Electronics",
  attchmntText: "Dixon Technologies (India) Limited has informed the Exchange  regarding Outcome of Board Meeting held on November 14, 2026.",
  exchdisstime: "14-Nov-2026 16:42:07",
};

const BSE_RECORD = {
  NEWSID: "a1b2c3",
  SCRIP_CD: 540699,
  HEADLINE: "Outcome of Board Meeting - Unaudited Financial Results for Q2 FY27",
  NEWSSUB: "Dixon Technologies (India) Ltd - 540699 - Board Meeting Outcome",
  CATEGORYNAME: "Board Meeting",
  SUBCATNAME: "Outcome of Board Meeting",
  ATTACHMENTNAME: "c3d4e5f6-1234.pdf",
  News_submission_dt: "2026-11-14T16:43:11",
  DT_TM: "2026-11-14T16:43:11.877",
};

const COMPANIES = [
  { symbol: "DIXON", bse_code: "540699", is_bank: false },
  { symbol: "KAYNES", bse_code: "543664", is_bank: false },
];

test("exchange timestamps parse to IST with an explicit offset, and junk is rejected", () => {
  assert.equal(parseExchangeIst("14-Nov-2026 16:42:05"), "2026-11-14T16:42:05+05:30");
  assert.equal(parseExchangeIst("2026-11-14 16:42:05"), "2026-11-14T16:42:05+05:30");
  assert.equal(parseExchangeIst("2026-11-14T16:43:11.877"), "2026-11-14T16:43:11+05:30");
  assert.equal(parseExchangeIst("31-Feb-2026 10:00:00"), null);
  assert.equal(parseExchangeIst("yesterday"), null);
  assert.equal(parseExchangeIst(undefined), null);
});

test("an NSE announcement normalises into the shared filing schema", async () => {
  const r = await normalizeNse(hash, "DIXON", NSE_RECORD);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  const f = r.filing;
  const { raw, ...filing } = f;
  assert.ok(NormalizedFiling.safeParse(filing).success, "everything but raw is exactly the shared schema");
  assert.equal(f.exchange, "NSE");
  assert.equal(f.exch_category, "Outcome of Board Meeting");
  assert.equal(f.filed_at, "2026-11-14T16:42:05+05:30");
  assert.match(f.subject, /^Dixon Technologies .* regarding Outcome/);
  assert.ok(!f.subject.includes("  "), "whitespace collapsed");
  assert.equal(f.attachment_url, NSE_RECORD.attchmntFile);
  assert.match(f.dedupe_key, /^[a-f0-9]{64}$/);
  assert.equal(raw.seq_id, "107712345");
});

test("NSE records for another symbol or with no usable time are skipped, not stored", async () => {
  assert.equal((await normalizeNse(hash, "KAYNES", NSE_RECORD)).ok, false);
  const r = await normalizeNse(hash, "DIXON", { ...NSE_RECORD, an_dt: "soon", sort_date: null, exchdisstime: null });
  assert.deepEqual(r, { ok: false, reason: "unparseable timestamp" });
});

test("a BSE announcement normalises with the attachment URL and category built", async () => {
  const r = await normalizeBse(hash, "DIXON", BSE_RECORD);
  assert.ok(r.ok);
  assert.equal(r.filing.exchange, "BSE");
  assert.equal(r.filing.exch_category, "Board Meeting / Outcome of Board Meeting");
  assert.equal(r.filing.filed_at, "2026-11-14T16:43:11+05:30");
  assert.equal(r.filing.attachment_url, "https://www.bseindia.com/xml-data/corpfiling/AttachLive/c3d4e5f6-1234.pdf");
});

test("NSE: cookie handshake first, cookies and referer on the API call, 1 s+ throttle, dedupe, run logged", async () => {
  const { deps, http, clock, store } = makeDeps((req) => {
    if (req.url === "https://www.nseindia.com/") {
      return { body: "<html>", setCookies: ["nsit=abc; Path=/; HttpOnly", "nseappid=xyz; Path=/", "bm_sv=q; Domain=.nseindia.com"] };
    }
    if (req.url.includes("symbol=DIXON")) return { body: JSON.stringify([NSE_RECORD, NSE_RECORD, { junk: true }]) };
    return { body: "[]" };
  }, COMPANIES);

  const out = await fetchAnnouncements(deps, COMPANIES, { from: new Date("2026-11-08"), to: new Date("2026-11-15") });

  assert.equal(http.requests[0]!.url, "https://www.nseindia.com/");
  const api = http.requests[1]!;
  assert.match(api.url, /corporate-announcements\?index=equities&from_date=08-11-2026&to_date=15-11-2026&symbol=DIXON$/);
  assert.equal(api.headers!.cookie, "nsit=abc; nseappid=xyz; bm_sv=q");
  assert.equal(api.headers!.referer, "https://www.nseindia.com/companies-listing/corporate-filings-announcements");
  assert.match(api.headers!["user-agent"]!, /Chrome/);
  // All three requests hit the same host: each later one waited ≥ 1 s (1000 + jitter).
  assert.equal(http.requests.length, 3);
  assert.deepEqual(clock.sleeps, [1250, 1250]);

  assert.equal(store.filings.size, 1, "duplicate record collapsed");
  assert.ok(out.nse?.ok);
  assert.equal(out.nse.status, "partial", "the junk record makes the run partial");
  assert.equal(out.nse.result.skipped.length, 1);
  assert.equal(out.bse, null);
  assert.deepEqual(store.runs.map((r) => [r.source, r.status, r.rows_ingested]), [["nse", "partial", 1]]);
  assert.match(store.runs[0]!.error!, /1 records skipped/);
});

test("NSE 403 → one re-handshake → BSE fallback by scrip code; both runs logged", async () => {
  const { deps, http, store } = makeDeps((req) => {
    if (req.url === "https://www.nseindia.com/") return { setCookies: ["nsit=abc"] };
    if (req.url.includes("nseindia.com/api")) return { status: 403, body: "Access Denied" };
    if (req.url.includes("strScrip=540699")) return { body: JSON.stringify({ Table: [BSE_RECORD], Table1: [{ ROWCNT: 1 }] }) };
    if (req.url.includes("strScrip=543664")) return { body: JSON.stringify({ Table: [], Table1: [{ ROWCNT: 0 }] }) };
    return { status: 404 };
  }, COMPANIES);

  const out = await fetchAnnouncements(deps, COMPANIES, { from: new Date("2026-11-08"), to: new Date("2026-11-15") });

  const nseCalls = http.requests.filter((r) => r.url.includes("nseindia.com")).map((r) => r.url.endsWith("/") ? "home" : "api");
  assert.deepEqual(nseCalls, ["home", "api", "home", "api"], "re-handshakes exactly once, then stops calling NSE");
  assert.equal(out.nse?.ok, false);
  assert.ok(out.bse?.ok);
  assert.equal(out.bse.rows, 1);
  assert.deepEqual(out.missed, []);
  assert.deepEqual(store.runs.map((r) => [r.source, r.status]), [["nse", "failed"], ["bse", "ok"]]);
  assert.match(store.runs[0]!.error!, /NSE blocked the request: API returned 403/);
  assert.equal([...store.filings.values()][0]!.exchange, "BSE");
});

test("NSE hanging (timeout) is treated as a block: fast hand-off to BSE, NSE run failed", async () => {
  const { deps, http, store } = makeDeps((req) => {
    if (req.url === "https://www.nseindia.com/") return { setCookies: ["ak_bmsc=1"] };
    if (req.url.includes("nseindia.com/api")) throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    return { body: JSON.stringify({ Table: [BSE_RECORD], Table1: [{ ROWCNT: 1 }] }) };
  }, COMPANIES);
  const out = await fetchAnnouncements(deps, COMPANIES, { from: new Date("2026-11-08"), to: new Date("2026-11-15") });
  const nseApiCalls = http.requests.filter((r) => r.url.includes("nseindia.com/api")).length;
  assert.equal(nseApiCalls, 2, "one try + one after re-handshake, then NSE is abandoned for every company");
  assert.equal(http.requests.find((r) => r.url.includes("nseindia.com/api"))!.timeoutMs, 10_000);
  assert.deepEqual(store.runs.map((r) => [r.source, r.status]), [["nse", "failed"], ["bse", "ok"]]);
  assert.match(store.runs[0]!.error!, /no response \(TimeoutError\)/);
  assert.equal(out.bse?.ok && out.bse.rows, 2, "both companies recovered via BSE");
});

test("an HTML challenge page with status 200 counts as blocked, not as data", async () => {
  const { deps, store } = makeDeps((req) => {
    if (req.url.includes("nseindia.com/api")) return { status: 200, body: "<!DOCTYPE html><title>Just a moment</title>" };
    if (req.url.includes("bseindia")) return { body: JSON.stringify({ Table: [], Table1: [{ ROWCNT: 0 }] }) };
    return { setCookies: ["a=b"] };
  }, COMPANIES);
  await fetchAnnouncements(deps, COMPANIES, { from: new Date("2026-11-08"), to: new Date("2026-11-15") });
  assert.equal(store.runs[0]!.status, "failed");
  assert.match(store.runs[0]!.error!, /with HTML/);
});
