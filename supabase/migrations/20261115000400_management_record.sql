-- Management record: guidance extraction, quote verification, deterministic verdicts.

-- Canonical metric key in `metric`; management's own wording in `metric_label`.
alter table public.guidance_statements add column metric_label text;
update public.guidance_statements set metric_label = metric where metric_label is null;
alter table public.guidance_statements alter column metric_label set not null;
comment on column public.guidance_statements.metric is
  'Canonical key (revenue, revenue_growth, ebitda_margin, ... or other:<slug>) used to match calls and actuals';

-- A statement may give no period ("in the medium term"); the verdict engine then says Not measurable.
alter table public.guidance_statements alter column period_target drop not null;

-- No quote below the 0.85 fuzzy-match threshold against its cited page is ever stored.
alter table public.guidance_statements add constraint guidance_quote_verified check (quote_match >= 0.85);

-- For a "revised" verdict the link points FORWARD, to the statement that replaced this one.
alter table public.verdicts rename column revised_from_statement_id to superseded_by_statement_id;

-- Figures management reports on calls ("EBITDA margin for the year was 20.8%") are actuals too.
alter table public.actuals drop constraint actuals_source_check;
alter table public.actuals add constraint actuals_source_check check (source in ('results', 'screener', 'xbrl', 'transcript'));

alter table public.ingest_runs drop constraint ingest_runs_source_check;
alter table public.ingest_runs add constraint ingest_runs_source_check
  check (source in ('nse', 'bse', 'yahoo', 'screener', 'documents', 'results', 'guidance', 'nse_equity_list'));

create index verdicts_verdict_idx on public.verdicts (verdict);
