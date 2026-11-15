/**
 * Boots the Hono app in-process against the LIVE Supabase project in .env and checks the
 * main endpoints. Read-only: nothing here writes to the database.
 *   pnpm --filter @finn/api test:live
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { apiSuccess, ApiFailure } from "@finn/shared";

const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.CRON_SECRET ??= "test-secret-not-for-production";
process.env.WEB_ORIGIN ??= "https://finn.example";

const { createApp } = await import("../src/app");
const { createCtx } = await import("../src/ctx");
const app = createApp(createCtx());
const Envelope = apiSuccess(z.unknown());

async function get(path: string, init?: RequestInit) {
  const res = await app.request(path, init);
  return { res, body: (await res.json()) as any };
}

test("GET /v1/health: envelope, never cached, one entry per source", async () => {
  const { res, body } = await get("/v1/health");
  assert.equal(res.status, 200);
  assert.ok(Envelope.safeParse(body).success, JSON.stringify(Envelope.safeParse(body).error?.issues));
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(body.as_of, /\+05:30$/);
  assert.deepEqual(body.data.sources.map((s: any) => s.source).sort(), ["bse", "nse", "screener", "yahoo"]);
  const yahoo = body.data.sources.find((s: any) => s.source === "yahoo");
  assert.ok(yahoo.last_success_at, "prices were loaded into the live DB");
  console.log("  health:", body.data.status, "|", body.data.sources.map((s: any) => s.note).join(" | "));
});

test("GET /v1/brief: counts, capped items, routine summary, CDN headers", async () => {
  const { res, body } = await get("/v1/brief?since=" + encodeURIComponent(new Date(Date.now() - 30 * 864e5).toISOString()));
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Envelope.safeParse(body).success);
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=60, stale-while-revalidate=600");
  const d = body.data;
  assert.ok(d.items.length <= 6, "default page is 6");
  assert.equal(d.counts.routine, d.routine_summary.count);
  assert.ok(d.counts.act + d.counts.read + d.counts.routine > 0, "the live DB has 30 days of filings");
  for (const i of d.items) assert.ok(["act", "read"].includes(i.tier) && i.headline && i.reasons.length);
  console.log(`  brief: act ${d.counts.act}, read ${d.counts.read}, routine ${d.counts.routine}; first: ${d.items[0]?.symbol} — ${d.items[0]?.headline}`);
  if (d.coming_up.length) console.log("  coming up:", d.coming_up.map((x: any) => `${x.symbol} ${x.date}`).join(", "));
});

test("GET /v1/brief: an empty window widens back to the last material item", async () => {
  const since = new Date(Date.now() - 60 * 1000).toISOString(); // the last minute: nothing filed
  const { body } = await get("/v1/brief?since=" + encodeURIComponent(since));
  assert.equal(body.data.widened, true);
  assert.match(body.data.message, /^Quiet since \w+\. Showing the last material item\.$/);
  assert.ok(body.data.items.length >= 1, "widened window shows something material");
});

test("GET /v1/brief: pagination with a cursor, and bad input is a 400 in the error contract", async () => {
  const since = encodeURIComponent(new Date(Date.now() - 30 * 864e5).toISOString());
  const p1 = (await get(`/v1/brief?since=${since}&segment=read&limit=2`)).body.data;
  if (p1.next_cursor) {
    const p2 = (await get(`/v1/brief?since=${since}&segment=read&limit=2&cursor=${p1.next_cursor}`)).body.data;
    assert.notDeepEqual(p1.items[0], p2.items[0]);
  }
  const bad = await get("/v1/brief?segment=everything");
  assert.equal(bad.res.status, 400);
  assert.ok(ApiFailure.safeParse(bad.body).success);
  assert.equal(bad.body.error.code, "bad_request");
});

test("GET /v1/holdings: 18 holdings with state, weight, reaction, credibility, governance, mandate", async () => {
  const { res, body } = await get("/v1/holdings");
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Envelope.safeParse(body).success);
  const d = body.data;
  assert.equal(d.items.length, 18);
  assert.equal(d.counts.concern + d.counts.watch + d.counts.on_track, 18);
  const sum = d.items.reduce((s: number, i: any) => s + i.weight_pct, 0);
  assert.equal(Math.round(sum * 100) / 100, 100);
  for (const i of d.items) {
    assert.ok(["Concern", "Watch", "On track"].includes(i.state));
    assert.ok(i.state_reasons.length >= 1);
    assert.ok(i.reaction && typeof i.reaction.change_pct === "number", `${i.symbol} has a price reaction`);
    assert.equal(typeof i.credibility, "string");
    assert.equal(typeof i.governance.line, "string");
    assert.ok(i.mandate.line);
  }
  console.log("  holdings:", d.counts, "|", d.items.slice(0, 3).map((i: any) => `${i.symbol} ${i.state}: ${i.state_reasons[0]}`).join(" | "));
});

test("company, record, alerts preview, search and method answer from the live DB", async () => {
  const co = await get("/v1/companies/DIXON");
  assert.equal(co.res.status, 200, JSON.stringify(co.body));
  assert.equal(co.body.data.header.symbol, "DIXON");
  assert.equal(co.body.data.governance.symbol, "DIXON");
  const missing = await get("/v1/companies/NOPE");
  assert.equal(missing.res.status, 404);
  assert.equal(missing.body.error.code, "not_found");
  const rec = await get("/v1/companies/KPITTECH/record");
  assert.equal(rec.res.status, 200);
  const prev = await get("/v1/alerts/preview?move_sigma=2.5&volume_x=3");
  assert.equal(prev.res.status, 200);
  assert.equal(typeof prev.body.data.would_have_fired_30d, "number");
  console.log(`  preview: ${prev.body.data.would_have_fired_30d} alerts in 30 sessions; e.g. ${prev.body.data.examples[0]?.symbol} ${prev.body.data.examples[0]?.text} → ${prev.body.data.examples[0]?.explanation}`);
  const s = await get("/v1/search?q=dix");
  assert.equal(s.body.data.items[0].symbol, "DIXON");
  const m = await get("/v1/method");
  assert.match(m.body.data.formulas.ebitda, /^EBITDA = /);
});

test("CORS: the web origin is allowed, an unknown origin is not", async () => {
  const okRes = await app.request("/v1/health", { headers: { origin: "https://finn.example" } });
  assert.equal(okRes.headers.get("access-control-allow-origin"), "https://finn.example");
  const bad = await app.request("/v1/health", { headers: { origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("cron: refused without the bearer secret; unknown paths use the error contract", async () => {
  const noAuth = await get("/v1/cron/digest", { method: "POST" });
  assert.equal(noAuth.res.status, 401);
  assert.equal(noAuth.body.error.code, "unauthorized");
  const wrong = await get("/v1/cron/digest", { method: "POST", headers: { authorization: "Bearer nope" } });
  assert.equal(wrong.res.status, 401);
  const okRes = await get("/v1/cron/digest", { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal(okRes.res.status, 202);
  const nf = await get("/v1/nope");
  assert.equal(nf.res.status, 404);
  assert.ok(ApiFailure.safeParse(nf.body).success);
});

test("GET /v1/brief: window=results, filters, facets, segment rows and record strip field", async () => {
  const { res, body } = await get("/v1/brief?window=results");
  assert.equal(res.status, 200);
  const d = body.data as { window_used: { kind: string }; segments: Record<string, { filing_id: number; name: string; record: unknown }[]>; facets: { categories: string[] }; routine_summary: { groups: { label: string }[] } };
  assert.equal(d.window_used.kind, "results");
  for (const k of ["act", "read", "routine"]) assert.ok(d.segments[k]!.length <= 6, `${k} capped at 6`);
  const row = d.segments.read![0]!;
  assert.ok(row.filing_id > 0 && row.name.length > 0 && "record" in row);
  assert.ok(d.routine_summary.groups.every((g) => !/^Link of|Statement Of/.test(g.label)), "routine groups use plain labels");

  const only = await get("/v1/brief?window=results&segment=read&category=results&limit=20");
  const items = (only.body.data as { items: { category: string }[]; total: number }).items;
  assert.ok(items.length > 0 && items.every((i) => i.category === "results"));

  const bad = await get("/v1/brief?window=yesterday");
  assert.equal(bad.res.status, 400);
});

test("GET /v1/items/:id: results sheet with table and checks; people and concall say what isn't read", async () => {
  const list = await get("/v1/brief?window=results&segment=read&category=results&limit=20");
  const ids = (list.body.data as { items: { filing_id: number; symbol: string }[] }).items;
  const page = ids.find((i) => i.symbol === "PAGEIND") ?? ids[0]!;
  const { res, body } = await get(`/v1/items/${page.filing_id}`);
  assert.equal(res.status, 200);
  const d = body.data as { kind: string; results: { rows: { label: string }[]; checks: { status: string; text: string }[]; from: string } };
  assert.equal(d.kind, "results");
  if (d.results.from !== "none") {
    assert.deepEqual(d.results.rows.map((r) => r.label), ["Revenue", "EBITDA", "EBITDA margin", "PBT", "PAT"]);
    assert.ok(d.results.checks.some((c) => c.status === "pass"));
  }
  // Screener-sourced figures always say so.
  if (d.results.from === "screener") assert.match(d.results.checks[0]!.text, /Screener/);

  const missing = await get("/v1/items/999999999");
  assert.equal(missing.res.status, 404);
  assert.equal(ApiFailure.safeParse(missing.body).success, true);
});

test("alerts: one row per company-day in plain words, each explained or saying no filing explains it; delivery line", async () => {
  const { res, body } = await get("/v1/alerts");
  assert.equal(res.status, 200);
  const d = body.data as { days: { items: { symbol: string; text: string; explanation: { filing_id: number } | null; explanation_text: string }[] }[]; delivery: { line: string; budget: number } };
  for (const day of d.days) {
    const keys = day.items.map((i) => i.symbol);
    assert.equal(new Set(keys).size, keys.length, "one row per company per day");
    for (const i of day.items) {
      assert.doesNotMatch(i.text, /σ/, "no sigma jargon");
      assert.ok(i.explanation ? i.explanation.filing_id > 0 : i.explanation_text === "No filing explains this move");
    }
  }
  assert.match(d.delivery.line, /Telegram/);
  assert.equal(d.delivery.budget, 3);
});

test("alerts rules: read, reject bad input; preview counts company-days and moves with the threshold", async () => {
  const rules = await get("/v1/alerts/rules");
  assert.equal(rules.res.status, 200);
  assert.match(rules.body.data.always_first, /auditor changes, pledges, promoter selling, senior exits, regulatory orders/);
  const bad = await get("/v1/alerts/rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ move_sigma: 0.2, volume_x: 3, categories: {} }) });
  assert.equal(bad.res.status, 400);
  const loose = (await get("/v1/alerts/preview?move_sigma=2&volume_x=3")).body.data.would_have_fired_30d as number;
  const strict = (await get("/v1/alerts/preview?move_sigma=4&volume_x=3")).body.data.would_have_fired_30d as number;
  assert.ok(loose >= strict, "a stricter threshold never fires more");
});

test("holdings: attention-sorted with mandate line; edits are validated before anything is written", async () => {
  const { body } = await get("/v1/holdings");
  const d = body.data as { items: { state: string; weight_pct: number }[]; mandate: { status: string; line: string } };
  const rank = { Concern: 0, Watch: 1, "On track": 2 } as Record<string, number>;
  for (let i = 1; i < d.items.length; i++) {
    const a = d.items[i - 1]!, b = d.items[i]!;
    assert.ok(rank[a.state]! < rank[b.state]! || (rank[a.state] === rank[b.state] && a.weight_pct >= b.weight_pct), "attention first, then weight");
  }
  assert.match(d.mandate.line, /exclusions/);
  const put = (holdings: unknown) => get("/v1/holdings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ holdings }) });
  assert.equal((await put([{ symbol: "NOSUCHCO", weight_pct: 5 }])).res.status, 400);
  assert.equal((await put([{ symbol: "DIXON", weight_pct: 70 }, { symbol: "TITAN", weight_pct: 40 }])).res.status, 400);
  assert.equal((await get("/v1/holdings")).body.data.items.length, d.items.length, "nothing written on a refused edit");
});

test("company page: any NSE company, tracked or not; tabs answer from stored data", async () => {
  const held = (await get("/v1/companies/DIXON")).body.data as { header: { held: boolean; sparkline: number[]; state: string | null }; research: { status: string }; questions: unknown[] };
  assert.equal(held.header.held, true);
  assert.ok(held.header.sparkline.length > 30 && held.header.sparkline.length <= 60);
  assert.ok(held.header.state);
  const unseen = (await get("/v1/companies/CIPLA")).body.data as { header: { held: boolean; state: string | null }; governance: { checked: boolean } };
  assert.equal(unseen.header.held, false);
  assert.equal(unseen.header.state, null, "an untracked company is not called On track");
  assert.equal(unseen.governance.checked, false);

  const res = (await get("/v1/companies/DIXON/results?period=Q1FY27")).body.data as { period: string; periods: unknown[]; card: { rows: unknown[] } };
  assert.equal(res.period, "Q1FY27");
  assert.ok(res.periods.length > 1 && res.card.rows.length === 5);
  assert.equal((await get("/v1/companies/DIXON/results?period=Q9FY27")).res.status, 400);

  const fil = (await get("/v1/companies/DIXON/filings")).body.data as { events: unknown[]; pages: number };
  assert.ok(fil.events.length <= 8);
  const fin = (await get("/v1/companies/KPITTECH/financials")).body.data as { cash: { ratio: number | null }[]; trajectory: unknown[]; risks: unknown; risks_note: string | null };
  assert.ok(fin.cash.length > 0 && fin.trajectory.length > 0);
  assert.ok(fin.risks || fin.risks_note, "risks or a plain note, never an empty section");
  assert.equal((await get("/v1/companies/NOSUCHCO")).res.status, 404);
});

test("research: ready list and suggestions of companies not held; search finds the full NSE list", async () => {
  const r = (await get("/v1/research")).body.data as { ready: { symbol: string }[]; suggestions: { symbol: string }[] };
  const held = ((await get("/v1/holdings")).body.data as { items: { symbol: string }[] }).items.map((h) => h.symbol);
  assert.ok(r.suggestions.every((s) => !held.includes(s.symbol)));
  const s = (await get("/v1/search?q=cipla")).body.data as { items: { symbol: string }[] };
  assert.equal(s.items[0]?.symbol, "CIPLA");
  const status = (await get("/v1/companies/KPITTECH/research-status")).body.data as { status: string };
  assert.equal(status.status, "ready");
});
