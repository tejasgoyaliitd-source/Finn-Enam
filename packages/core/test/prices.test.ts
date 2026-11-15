import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPrices, MIN_SESSIONS, normalizeQuotes, type ChartQuote } from "../src/index";
import { makeDeps } from "./fakes";

/** n weekday sessions ending the day before `end`, as Yahoo returns them (09:15 IST = 03:45Z). */
function sessions(n: number, end = "2026-11-14"): ChartQuote[] {
  const out: ChartQuote[] = [];
  const d = new Date(`${end}T03:45:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.unshift({ date: new Date(d), close: 1000 + out.length, volume: 50_000 });
  }
  return out;
}

test("normalizeQuotes: drops nulls and zero closes, dedupes by IST date, drops today's bar before 16:00 IST", () => {
  const base = sessions(3);
  const quotes: ChartQuote[] = [
    ...base,
    { date: base[2]!.date, close: 1234, volume: 1 }, // duplicate date: last wins
    { date: new Date("2026-11-12T03:45:00Z"), close: null, volume: 10 },
    { date: new Date("2026-11-13T03:45:00Z"), close: 0, volume: 10 },
    { date: new Date("2026-11-15T03:45:00Z"), close: 999, volume: 10 }, // today, intraday
  ];
  const before = normalizeQuotes("DIXON", quotes, new Date("2026-11-15T14:00:00+05:30"));
  assert.deepEqual(before.map((r) => r.date), ["2026-11-11", "2026-11-12", "2026-11-13"]);
  assert.equal(before.at(-1)!.close, 1234);
  const after = normalizeQuotes("DIXON", quotes, new Date("2026-11-15T16:30:00+05:30"));
  assert.equal(after.at(-1)!.date, "2026-11-15", "settled after 16:00 IST");
});

test("fetchPrices: .NS symbols, 120+ sessions → ok, run logged with rows", async () => {
  const { deps, store } = makeDeps(() => ({}));
  const asked: string[] = [];
  const chart = { daily: async (s: string) => (asked.push(s), sessions(180)) };
  const out = await fetchPrices({ ...deps, chart }, ["DIXON", "M&M"]);
  assert.deepEqual(asked, ["DIXON.NS", "M&M.NS"]);
  assert.ok(out.ok);
  assert.equal(out.status, "ok");
  assert.equal(out.result.sessions.DIXON, 180);
  assert.equal(store.prices.size, 360);
  assert.deepEqual(store.runs.map((r) => [r.source, r.status, r.rows_ingested]), [["yahoo", "ok", 360]]);
});

test("fetchPrices: a short history or one failing symbol makes the run partial, not failed", async () => {
  const { deps, store } = makeDeps(() => ({}));
  const chart = {
    daily: async (s: string) => {
      if (s === "NEWIPO.NS") return sessions(40);
      if (s === "GONE.NS") throw new Error("No data found, symbol may be delisted");
      return sessions(MIN_SESSIONS + 5);
    },
  };
  const out = await fetchPrices({ ...deps, chart }, ["DIXON", "NEWIPO", "GONE"]);
  assert.ok(out.ok);
  assert.equal(out.status, "partial");
  assert.equal(store.runs[0]!.error, "failed: GONE; under 120 sessions: NEWIPO (40)");
});

test("fetchPrices: nothing at all → failed run with the error recorded, no throw", async () => {
  const { deps, store } = makeDeps(() => ({}));
  const chart = { daily: async () => { throw new Error("getaddrinfo ENOTFOUND query2.finance.yahoo.com"); } };
  const out = await fetchPrices({ ...deps, chart }, ["DIXON"]);
  assert.equal(out.ok, false);
  assert.equal(store.runs[0]!.status, "failed");
  assert.match(store.runs[0]!.error!, /ENOTFOUND/);
});
