import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { GuidanceStatement, Verdict } from "@finn/shared";
import { fromGuidanceRow, guidanceRow } from "../src/index";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

async function createDatabase() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(
    "CREATE SCHEMA IF NOT EXISTS storage; CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);"
  );

  const migrations = [
    "supabase/migrations/20261115000000_init_schema.sql",
    "supabase/migrations/20261115000100_storage_buckets.sql",
    "supabase/migrations/20261115000200_triage_pipeline.sql",
    "supabase/migrations/20261115000300_results_engine.sql",
    "supabase/migrations/20261115000400_management_record.sql",
  ];

  for (const m of migrations) {
    const sql = readFileSync(resolve(REPO_ROOT, m), "utf8");
    await db.exec(sql);
  }

  const seed = readFileSync(resolve(REPO_ROOT, "supabase/seed.sql"), "utf8");
  await db.exec(seed);

  return db;
}

test("Postgres: migrations 1–5 and seed apply cleanly, and guidance_statements + verdicts tables enforce integrity", async () => {
  const db = await createDatabase();

  // Create a document row for DIXON transcript
  const docId = "00000000-0000-4000-8000-0000000000aa";
  const sha = "a".repeat(64);
  await db.query(
    `insert into public.documents (id, symbol, type, period, url, sha256, storage_path, pages, readable)
     values ($1, 'DIXON', 'transcript', 'Q4FY26', 'https://example.com/dixon.pdf', $2, 'a.json.gz', 20, true)`,
    [docId, sha]
  );

  // 1. Guidance statement with point target & roundtrip check
  const stmt1: GuidanceStatement = {
    id: "00000000-0000-4000-8000-000000000001",
    symbol: "DIXON",
    doc_id: docId,
    call_period: "Q4FY26",
    metric: "revenue",
    metric_label: "revenue",
    metric_kind: "absolute",
    scope: "company",
    segment: null,
    target: { kind: "point", value: 56000 },
    unit: "inr_cr",
    period_target: "FY27",
    hedges: ["aspire to"],
    quote: "We aspire to achieve revenue of about 56000 crores in FY27",
    page: 12,
    quote_match: 0.95,
  };

  const row1 = guidanceRow(stmt1);
  await db.query(
    `insert into public.guidance_statements (
      id, symbol, doc_id, call_period, metric, metric_label, metric_kind, scope, segment,
      target_kind, target_low, target_high, direction, unit, period_target, hedges, quote, page, quote_match
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      row1.id, row1.symbol, row1.doc_id, row1.call_period, row1.metric, row1.metric_label, row1.metric_kind,
      row1.scope, row1.segment, row1.target_kind, row1.target_low, row1.target_high, row1.direction,
      row1.unit, row1.period_target, row1.hedges, row1.quote, row1.page, row1.quote_match,
    ]
  );

  const res1 = await db.query<any>("select * from public.guidance_statements where id = $1", [stmt1.id]);
  assert.equal(res1.rows.length, 1);
  assert.deepEqual(fromGuidanceRow(res1.rows[0]), stmt1);

  // 2. Guidance statement with range target & null period_target (medium term)
  const stmt2: GuidanceStatement = {
    id: "00000000-0000-4000-8000-000000000002",
    symbol: "KPITTECH",
    doc_id: docId,
    call_period: "Q2FY26",
    metric: "ebitda_margin",
    metric_label: "EBITDA margin",
    metric_kind: "margin",
    scope: "company",
    segment: null,
    target: { kind: "range", low: 22, high: 24 },
    unit: "pct",
    period_target: null,
    hedges: [],
    quote: "We are aiming for an EBITDA margin range of 22 to 24 percent in the medium term",
    page: 5,
    quote_match: 0.98,
  };

  const row2 = guidanceRow(stmt2);
  await db.query(
    `insert into public.guidance_statements (
      id, symbol, doc_id, call_period, metric, metric_label, metric_kind, scope, segment,
      target_kind, target_low, target_high, direction, unit, period_target, hedges, quote, page, quote_match
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      row2.id, row2.symbol, row2.doc_id, row2.call_period, row2.metric, row2.metric_label, row2.metric_kind,
      row2.scope, row2.segment, row2.target_kind, row2.target_low, row2.target_high, row2.direction,
      row2.unit, row2.period_target, row2.hedges, row2.quote, row2.page, row2.quote_match,
    ]
  );

  const res2 = await db.query<any>("select * from public.guidance_statements where id = $1", [stmt2.id]);
  assert.equal(res2.rows.length, 1);
  assert.deepEqual(fromGuidanceRow(res2.rows[0]), stmt2);

  // 3. Insert verdicts for both statements
  const v1: Verdict = {
    statement_id: stmt1.id,
    verdict: "not_mentioned_since",
    reason: "Not mentioned since the Q4 FY26 call (2 calls since)",
    pace_note: null,
    last_mentioned_in: "Q4FY26",
    superseded_by_statement_id: null,
    as_of: "2026-11-15T12:00:00+05:30",
    rule_version: "verdict-v1",
  };

  const v2: Verdict = {
    statement_id: stmt2.id,
    verdict: "not_measurable",
    reason: "Not a measurable target: no period given",
    pace_note: null,
    last_mentioned_in: null,
    superseded_by_statement_id: null,
    as_of: "2026-11-15T12:00:00+05:30",
    rule_version: "verdict-v1",
  };

  for (const v of [v1, v2]) {
    await db.query(
      `insert into public.verdicts (
        statement_id, verdict, reason, pace_note, last_mentioned_in, superseded_by_statement_id, as_of, rule_version
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [v.statement_id, v.verdict, v.reason, v.pace_note, v.last_mentioned_in, v.superseded_by_statement_id, v.as_of, v.rule_version]
    );
  }

  // 4. Constraint check: quote_match < 0.85 must fail
  await assert.rejects(
    async () => {
      await db.query(
        `insert into public.guidance_statements (
          id, symbol, doc_id, call_period, metric, metric_label, metric_kind, scope, segment,
          target_kind, target_low, target_high, direction, unit, period_target, hedges, quote, page, quote_match
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 0.84)`,
        [
          "00000000-0000-4000-8000-0000000000ff", "DIXON", docId, "Q4FY26", "revenue", "revenue", "absolute",
          "company", null, "point", 56000, 56000, null, "inr_cr", "FY27", [], "Unverified quote", 12,
        ]
      );
    },
    /guidance_quote_verified/
  );

  // 5. Constraint check: revised requires superseded_by_statement_id
  const stmt3: GuidanceStatement = {
    ...stmt1,
    id: "00000000-0000-4000-8000-000000000003",
    target: { kind: "point", value: 60000 },
  };
  const row3 = guidanceRow(stmt3);
  await db.query(
    `insert into public.guidance_statements (
      id, symbol, doc_id, call_period, metric, metric_label, metric_kind, scope, segment,
      target_kind, target_low, target_high, direction, unit, period_target, hedges, quote, page, quote_match
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      row3.id, row3.symbol, row3.doc_id, row3.call_period, row3.metric, row3.metric_label, row3.metric_kind,
      row3.scope, row3.segment, row3.target_kind, row3.target_low, row3.target_high, row3.direction,
      row3.unit, row3.period_target, row3.hedges, row3.quote, row3.page, row3.quote_match,
    ]
  );

  await assert.rejects(async () => {
    await db.query(
      `insert into public.verdicts (
        statement_id, verdict, reason, pace_note, last_mentioned_in, superseded_by_statement_id, as_of, rule_version
      ) values ($1, 'revised', 'Target revised', null, null, null, now(), 'verdict-v1')`,
      [stmt3.id]
    );
  });

  // Valid revised linking to stmt3
  await db.query(
    `update public.verdicts set verdict = 'revised', reason = 'Target revised', superseded_by_statement_id = $1, last_mentioned_in = null
     where statement_id = $2`,
    [stmt3.id, stmt1.id]
  );

  // 6. Constraint check: pace_note on Met/Missed must fail
  await assert.rejects(async () => {
    await db.query(
      `insert into public.verdicts (
        statement_id, verdict, reason, pace_note, last_mentioned_in, superseded_by_statement_id, as_of, rule_version
      ) values ($1, 'met', 'Guided 21%, delivered 21%', 'Illegal pace note', null, null, now(), 'verdict-v1')`,
      [stmt3.id]
    );
  });

  // 7. Cascade delete: deleting guidance_statement deletes verdict
  await db.query("delete from public.guidance_statements where id = $1", [stmt1.id]);
  const checkCascade = await db.query("select * from public.verdicts where statement_id = $1", [stmt1.id]);
  assert.equal(checkCascade.rows.length, 0);
});

test("Postgres: actuals upsert deduplication prevents ON CONFLICT DO UPDATE batch collision", async () => {
  const db = await createDatabase();

  const duplicateBatch = [
    { symbol: "DIXON", period: "Q2FY27", metric: "revenue", basis: "consolidated", value: 250000, unit: "inr_cr", source: "transcript" },
    { symbol: "DIXON", period: "Q2FY27", metric: "revenue", basis: "consolidated", value: 250100, unit: "inr_cr", source: "transcript" },
  ];

  // Raw Postgres fails with 21000 without deduplication
  await assert.rejects(
    async () => {
      await db.query(`
        insert into public.actuals (symbol, period, metric, basis, value, unit, source, updated_at)
        values
          ('DIXON', 'Q2FY27', 'revenue', 'consolidated', 250000, 'inr_cr', 'transcript', now()),
          ('DIXON', 'Q2FY27', 'revenue', 'consolidated', 250100, 'inr_cr', 'transcript', now())
        on conflict (symbol, period, metric, basis) do update set
          value = excluded.value,
          updated_at = excluded.updated_at
      `);
    },
    (err: Error) => err.message.includes("ON CONFLICT DO UPDATE command cannot affect row a second time")
  );

  // Deduplicating by conflict key resolves cleanly
  const map = new Map<string, (typeof duplicateBatch)[number]>();
  for (const r of duplicateBatch) {
    map.set(`${r.symbol}|${r.period}|${r.metric}|${r.basis}`, r);
  }
  const deduped = Array.from(map.values());
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]!.value, 250100);

  await db.query(
    `insert into public.actuals (symbol, period, metric, basis, value, unit, source, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (symbol, period, metric, basis) do update set
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [deduped[0]!.symbol, deduped[0]!.period, deduped[0]!.metric, deduped[0]!.basis, deduped[0]!.value, deduped[0]!.unit, deduped[0]!.source]
  );

  const res = await db.query("select * from public.actuals where symbol = 'DIXON' and metric = 'revenue'");
  assert.equal(res.rows.length, 1);
  assert.equal(Number((res.rows[0] as any).value), 250100);
});
