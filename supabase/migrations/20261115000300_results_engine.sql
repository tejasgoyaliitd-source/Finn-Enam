-- Results engine: its runs are logged like every other source, so /v1/health shows them.
alter table public.ingest_runs drop constraint ingest_runs_source_check;
alter table public.ingest_runs add constraint ingest_runs_source_check
  check (source in ('nse', 'bse', 'yahoo', 'screener', 'documents', 'results', 'nse_equity_list'));

-- A results card is written only after the shared schema has validated it. These are the
-- database-side guarantees that don't depend on the application.
comment on column public.results.metrics is
  '{ current, prior_quarter, year_ago, growth, cash_conversion }; every amount in ₹ crore';
alter table public.results add constraint results_no_growth_when_not_comparable
  check (comparable or metrics -> 'growth' is null or metrics -> 'growth' = 'null'::jsonb);
alter table public.results add constraint results_bank_has_no_ebitda
  check (not is_bank or (metrics -> 'current' -> 'ebitda') is null or (metrics -> 'current' -> 'ebitda') = 'null'::jsonb);
