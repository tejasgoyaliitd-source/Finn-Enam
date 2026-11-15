-- FINN initial schema.
--
-- Rules this file enforces:
--   1. Postgres holds structured rows only. Raw document text and large model outputs live in
--      Supabase Storage (see the next migration); every jsonb column has a size cap so nothing
--      large slips in by accident. Free tier is 500 MB.
--   2. RLS is enabled on every table with NO policies. Only finn-api (service role, which
--      bypasses RLS) reads or writes. anon/authenticated get nothing. A guard at the end of this
--      file fails the migration if any public table is missing RLS or has a policy.
--   3. Timestamps are timestamptz (absolute instants). The API formats them to IST (+05:30).
--   4. Money is ₹ crore. Enumerations are CHECK constraints mirroring packages/shared.

-- ─────────────────────────────────────────────────────────────────────────────
-- Domains (shared formats, mirror packages/shared/src/primitives.ts)
-- ─────────────────────────────────────────────────────────────────────────────

create domain public.nse_symbol as text
  check (value ~ '^[A-Z0-9&-]{1,20}$');

create domain public.sha256_hex as text
  check (value ~ '^[a-f0-9]{64}$');

create domain public.quarter_period as text
  check (value ~ '^Q[1-4]FY[0-9]{2}$');            -- Q2FY27

create domain public.fiscal_period as text
  check (value ~ '^(Q[1-4]|H[12]|9M)?FY[0-9]{2}$'); -- FY27, H1FY27, 9MFY27, Q3FY27

create domain public.reporting_basis as text
  check (value in ('consolidated', 'standalone'));

create domain public.filing_category as text
  check (value in (
    'results', 'm_and_a', 'fund_raise', 'management_change', 'litigation', 'insider_trading',
    'earnings_call', 'investor_meetings', 'credit_rating', 'dividend', 'bonus_split', 'capex',
    'press_release', 'postal_ballot', 'agm_egm', 'pledging', 'unclassified'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function public.reject_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Companies, portfolios, holdings
-- ─────────────────────────────────────────────────────────────────────────────

create table public.companies (
  symbol      public.nse_symbol primary key,
  name        text not null check (length(name) between 1 and 200),
  isin        text not null unique check (isin ~ '^IN[A-Z0-9]{9}[0-9]$'),
  bse_code    text unique check (bse_code ~ '^[0-9]{6}$'),
  sector      text,
  -- Banks and NBFCs get the bank results card (no EBITDA).
  is_bank     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

create table public.portfolios (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 100),
  -- House view: mandate exclusions, alert thresholds, muted kinds, push budget.
  -- Shape is validated by HouseView in packages/shared.
  settings    jsonb not null default '{}'::jsonb
              check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger portfolios_updated_at before update on public.portfolios
  for each row execute function public.set_updated_at();

create table public.holdings (
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  symbol       public.nse_symbol not null references public.companies (symbol),
  weight_pct   numeric(5, 2) not null check (weight_pct > 0 and weight_pct <= 100),
  added_at     timestamptz not null default now(),
  primary key (portfolio_id, symbol)
);
create index holdings_symbol_idx on public.holdings (symbol);

-- Weights may leave room for cash but can never exceed 100% in total. Deferred, so a
-- rebalance inside one transaction can pass through an intermediate state.
create function public.enforce_portfolio_weight_sum() returns trigger
language plpgsql set search_path = '' as $$
declare
  pid   uuid := coalesce(new.portfolio_id, old.portfolio_id);
  total numeric;
begin
  select coalesce(sum(weight_pct), 0) into total from public.holdings where portfolio_id = pid;
  if total > 100 then
    raise exception 'Holdings in portfolio % have weights summing to %, above 100', pid, total;
  end if;
  return null;
end $$;
create constraint trigger holdings_weight_sum
  after insert or update on public.holdings
  deferrable initially deferred
  for each row execute function public.enforce_portfolio_weight_sum();

-- ─────────────────────────────────────────────────────────────────────────────
-- Market data
-- ─────────────────────────────────────────────────────────────────────────────

-- ~120 sessions per holding. The PK index (symbol, date) serves "last 60 sessions" for
-- volatility and "last 20 sessions" for average volume via a backward index scan.
create table public.prices_daily (
  symbol  public.nse_symbol not null references public.companies (symbol),
  date    date not null,
  close   numeric(14, 4) not null check (close > 0),
  volume  bigint not null check (volume >= 0),
  primary key (symbol, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ingestion runs (drives /v1/health)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.ingest_runs (
  id           bigint generated always as identity primary key,
  source       text not null check (source in ('nse', 'bse', 'yahoo', 'screener', 'documents', 'nse_equity_list')),
  -- Where it ran from: lets /health say "last refreshed from the laptop at 21:40".
  runner       text not null check (runner in ('cron', 'pinger', 'refresher', 'manual')),
  status       text not null check (status in ('running', 'ok', 'partial', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  rows_ingested integer not null default 0 check (rows_ingested >= 0),
  -- Opaque resume point, e.g. the last filed_at seen.
  cursor       text,
  error        text check (length(error) <= 4000),
  check ((status = 'running') = (finished_at is null)),
  check (finished_at is null or finished_at >= started_at),
  check (status <> 'failed' or error is not null)
);
create index ingest_runs_source_started_idx on public.ingest_runs (source, started_at desc);
create index ingest_runs_last_ok_idx on public.ingest_runs (source, finished_at desc) where status = 'ok';

-- ─────────────────────────────────────────────────────────────────────────────
-- Filings and the push pipeline
-- ─────────────────────────────────────────────────────────────────────────────

create table public.filings (
  id              bigint generated always as identity primary key,
  symbol          public.nse_symbol not null references public.companies (symbol),
  exchange        text not null check (exchange in ('NSE', 'BSE')),
  exch_category   text not null,
  subject         text not null check (length(subject) between 1 and 2000),
  attachment_url  text check (attachment_url ~ '^https?://'),
  filed_at        timestamptz not null,
  -- The exchange's original record, for re-normalising. Small by nature; capped anyway.
  raw             jsonb not null check (pg_column_size(raw) <= 16384),
  -- SHA-256 of symbol + normalised subject + 10-minute bucket; collapses NSE/BSE duplicates.
  dedupe_key      public.sha256_hex not null unique,
  ingested_at     timestamptz not null default now()
);
create index filings_filed_at_idx on public.filings (filed_at desc);
create index filings_symbol_filed_at_idx on public.filings (symbol, filed_at desc);
-- Filings never change once filed.
create trigger filings_immutable before update on public.filings
  for each row execute function public.reject_update();

-- Same company, same corporate action (results PDF + press release + newspaper ad + deck).
create table public.events (
  id                 bigint generated always as identity primary key,
  symbol             public.nse_symbol not null references public.companies (symbol),
  kind               public.filing_category not null,
  primary_filing_id  bigint not null unique references public.filings (id),
  filed_at           timestamptz not null,
  created_at         timestamptz not null default now()
);
create index events_symbol_filed_at_idx on public.events (symbol, filed_at desc);

-- Recomputable: re-running the classifier overwrites this row.
create table public.filing_analysis (
  filing_id    bigint primary key references public.filings (id) on delete cascade,
  category     public.filing_category not null,
  sub_kind     text,
  tier         text not null check (tier in ('act', 'read', 'routine')),
  score        integer not null,
  -- Plain-language reasons ("Promoter sold 2.1% of the company"), never "+80".
  reasons      text[] not null default '{}',
  headline     text check (length(headline) <= 300),
  method       text not null check (method in ('rule', 'model')),
  model        text,
  event_id     bigint references public.events (id) on delete set null,
  analysed_at  timestamptz not null default now(),
  check ((method = 'model') = (model is not null))
);
create index filing_analysis_event_idx on public.filing_analysis (event_id);
create index filing_analysis_tier_idx on public.filing_analysis (tier);

-- ─────────────────────────────────────────────────────────────────────────────
-- Results cards
-- ─────────────────────────────────────────────────────────────────────────────

create table public.results (
  id              bigint generated always as identity primary key,
  symbol          public.nse_symbol not null references public.companies (symbol),
  period          public.quarter_period not null,
  -- One basis per card: current, prior-quarter and year-ago figures all share it.
  basis           public.reporting_basis not null,
  unit            text not null default 'INR_CR' check (unit = 'INR_CR'),
  is_bank         boolean not null,
  -- { current, prior_quarter, year_ago } each a ResultsMetrics; validated by zod on write.
  metrics         jsonb not null
                  check (jsonb_typeof(metrics) = 'object' and metrics ? 'current'
                         and pg_column_size(metrics) <= 16384),
  -- Array of ResultsCheck; a pat_tie check is mandatory.
  checks          jsonb not null
                  check (jsonb_typeof(checks) = 'array' and checks @> '[{"id": "pat_tie"}]'
                         and pg_column_size(checks) <= 16384),
  comparable          boolean not null default true,
  comparability_note  text,
  source          text not null check (source in ('xbrl', 'pdf', 'screener')),
  source_url      text check (source_url ~ '^https?://'),
  page            integer check (page > 0),
  -- Exact formula string used, stored with the card. Null for banks and NBFCs.
  ebitda_formula  text,
  filing_id       bigint references public.filings (id),
  filed_at        timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (symbol, period, basis),
  check (is_bank = (ebitda_formula is null)),
  check (comparable = (comparability_note is null))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- People moves
-- ─────────────────────────────────────────────────────────────────────────────

create table public.people_events (
  id              bigint generated always as identity primary key,
  filing_id       bigint not null references public.filings (id),
  symbol          public.nse_symbol not null references public.companies (symbol),
  name            text not null,
  role            text not null,
  action          text not null check (action in ('appointed', 'resigned', 'retired', 'removed', 'redesignated', 'ceased')),
  effective_date  date,
  prior_roles     jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(prior_roles) = 'array' and pg_column_size(prior_roles) <= 8192),
  tenure_months   integer check (tenure_months >= 0),
  stated_reason   text check (length(stated_reason) <= 2000),
  source_page     integer check (source_page > 0),
  created_at      timestamptz not null default now(),
  unique (filing_id, name, action)
);
create index people_events_symbol_idx on public.people_events (symbol, effective_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Research: documents, guidance, actuals, verdicts
-- ─────────────────────────────────────────────────────────────────────────────

-- Metadata only. Extracted page text is gzip JSON in the 'documents' bucket at storage_path.
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  symbol        public.nse_symbol not null references public.companies (symbol),
  type          text not null check (type in ('annual_report', 'transcript', 'results', 'filing', 'presentation')),
  period        public.fiscal_period,
  url           text not null check (url ~ '^https?://'),
  sha256        public.sha256_hex not null unique,
  pages         integer check (pages > 0),
  storage_path  text,
  -- False for scanned PDFs we could not extract text from. Never OCR'd on the request path.
  readable      boolean not null,
  fetched_at    timestamptz not null default now(),
  check (not readable or (storage_path is not null and pages is not null))
);
create index documents_symbol_type_idx on public.documents (symbol, type, period);

create table public.guidance_statements (
  id             uuid primary key default gen_random_uuid(),
  symbol         public.nse_symbol not null references public.companies (symbol),
  doc_id         uuid not null references public.documents (id),
  call_period    public.quarter_period not null,
  metric         text not null,
  metric_kind    text not null check (metric_kind in ('margin', 'growth', 'absolute', 'ratio', 'other')),
  scope          text not null check (scope in ('company', 'segment')),
  segment        text,
  -- Flattened GuidanceTarget union: range | point (low = high) | direction | none.
  target_kind    text not null check (target_kind in ('range', 'point', 'direction', 'none')),
  target_low     numeric,
  target_high    numeric,
  direction      text check (direction in ('up', 'down', 'flat')),
  unit           text check (unit in ('pct', 'inr_cr', 'x', 'count', 'days', 'other')),
  period_target  public.fiscal_period not null,
  -- Hedge words verbatim ("aspire", "subject to"); every one must appear in the quote.
  hedges         text[] not null default '{}',
  quote          text not null check (length(quote) between 1 and 2000),
  page           integer not null check (page > 0),
  quote_match    numeric(4, 3) not null check (quote_match between 0 and 1),
  created_at     timestamptz not null default now(),
  check ((scope = 'segment') = (segment is not null)),
  check (case target_kind
    when 'range'     then target_low is not null and target_high is not null and target_low < target_high and direction is null
    when 'point'     then target_low is not null and target_high = target_low and direction is null
    when 'direction' then direction is not null and target_low is null and target_high is null
    when 'none'      then direction is null and target_low is null and target_high is null
  end),
  check (target_kind not in ('range', 'point') or unit is not null),
  check (metric_kind <> 'margin' or target_kind not in ('range', 'point') or unit = 'pct')
);
create index guidance_statements_symbol_idx on public.guidance_statements (symbol, metric, period_target);
create index guidance_statements_doc_idx on public.guidance_statements (doc_id);

create table public.actuals (
  symbol      public.nse_symbol not null references public.companies (symbol),
  period      public.fiscal_period not null,
  metric      text not null,
  -- Consolidated and standalone actuals are separate rows and never compared to each other.
  basis       public.reporting_basis not null,
  value       numeric not null,
  unit        text not null check (unit in ('pct', 'inr_cr', 'x', 'count', 'days', 'other')),
  source      text not null check (source in ('results', 'screener', 'xbrl')),
  updated_at  timestamptz not null default now(),
  primary key (symbol, period, metric, basis)
);

-- Deterministic output of the verdict engine; one current verdict per statement.
create table public.verdicts (
  statement_id               uuid primary key references public.guidance_statements (id) on delete cascade,
  verdict                    text not null check (verdict in (
                               'met', 'missed', 'behind', 'revised', 'too_early', 'not_measurable', 'not_mentioned_since')),
  reason                     text not null check (length(reason) between 1 and 500),
  pace_note                  text,
  last_mentioned_in          public.quarter_period,
  revised_from_statement_id  uuid references public.guidance_statements (id),
  as_of                      timestamptz not null,
  rule_version               text not null,
  check (pace_note is null or verdict in ('too_early', 'behind')),
  check ((verdict = 'not_mentioned_since') = (last_mentioned_in is not null)),
  check ((verdict = 'revised') = (revised_from_statement_id is not null))
);

create table public.governance_flags (
  id         bigint generated always as identity primary key,
  symbol     public.nse_symbol not null references public.companies (symbol),
  filing_id  bigint references public.filings (id),
  kind       text not null check (kind in (
               'auditor_change', 'auditor_resignation', 'auditor_qualification',
               'pledge_created', 'pledge_increased', 'pledge_released',
               'promoter_buy', 'promoter_sell', 'senior_exit',
               'regulatory_order', 'related_party')),
  detail     text not null check (length(detail) <= 1000),
  filed_at   timestamptz not null,
  unique (filing_id, kind)
);
create index governance_flags_symbol_idx on public.governance_flags (symbol, filed_at desc);

-- What the company page reads. Rebuilt only when inputs_hash changes.
create table public.research_snapshots (
  symbol       public.nse_symbol primary key references public.companies (symbol),
  built_at     timestamptz not null default now(),
  sections     jsonb not null
               check (jsonb_typeof(sections) = 'object' and pg_column_size(sections) <= 131072),
  inputs_hash  public.sha256_hex not null
);

create table public.research_jobs (
  id          uuid primary key default gen_random_uuid(),
  symbol      public.nse_symbol not null references public.companies (symbol),
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- [{ name, state, started_at, finished_at, note }]
  steps       jsonb not null default '[]'::jsonb
              check (jsonb_typeof(steps) = 'array' and pg_column_size(steps) <= 32768),
  error       text check (length(error) <= 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (status <> 'failed' or error is not null)
);
-- POST /v1/research/:symbol is idempotent: at most one active job per symbol.
create unique index research_jobs_one_active_idx on public.research_jobs (symbol)
  where status in ('queued', 'running');
create trigger research_jobs_updated_at before update on public.research_jobs
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Alerts, feedback, push
-- ─────────────────────────────────────────────────────────────────────────────

create table public.alert_rules (
  id            bigint generated always as identity primary key,
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  kind          text not null check (kind in ('move_sigma', 'volume_x', 'category', 'concentration')),
  params        jsonb not null default '{}'::jsonb
                check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 4096),
  enabled       boolean not null default true,
  unique (portfolio_id, kind)
);

create table public.alerts (
  id            bigint generated always as identity primary key,
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  symbol        public.nse_symbol not null references public.companies (symbol),
  kind          text not null check (kind in ('move_sigma', 'volume_x', 'category', 'concentration')),
  payload       jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  -- The filing that explains the move, if any ("no filing explains this" when null).
  filing_id     bigint references public.filings (id),
  -- IST trading date; one alert per symbol, kind and day.
  alert_date    date not null,
  triggered_at  timestamptz not null default now(),
  sent_at       timestamptz,
  unique (portfolio_id, symbol, kind, alert_date),
  check (sent_at is null or sent_at >= triggered_at)
);
create index alerts_portfolio_triggered_idx on public.alerts (portfolio_id, triggered_at desc);

create table public.feedback (
  id            bigint generated always as identity primary key,
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  filing_id     bigint references public.filings (id),
  action        text not null check (action in ('seen', 'mute_kind', 'unmute_kind')),
  sub_kind      text,
  created_at    timestamptz not null default now(),
  check (action <> 'seen' or filing_id is not null),
  check (action = 'seen' or sub_kind is not null)
);
create index feedback_portfolio_idx on public.feedback (portfolio_id, created_at desc);

create table public.push_targets (
  id            bigint generated always as identity primary key,
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  channel       text not null default 'telegram' check (channel in ('telegram')),
  chat_id       text not null,
  created_at    timestamptz not null default now(),
  unique (portfolio_id, channel)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- LLM cache and cost log
-- ─────────────────────────────────────────────────────────────────────────────

-- key = SHA-256(task + prompt version + model + normalised input).
-- Small outputs inline (≤ 8 KB); anything larger goes to the 'llm-outputs' bucket.
create table public.llm_cache (
  key             public.sha256_hex primary key,
  task            text not null,
  model           text not null,
  prompt_version  text not null,
  output          jsonb check (pg_column_size(output) <= 8192),
  storage_path    text,
  created_at      timestamptz not null default now(),
  check ((output is null) <> (storage_path is null))
);

create table public.llm_calls (
  id           bigint generated always as identity primary key,
  task         text not null,
  provider     text not null check (provider in ('gemini', 'groq', 'anthropic')),
  model        text not null,
  tokens_in    integer not null default 0 check (tokens_in >= 0),
  tokens_out   integer not null default 0 check (tokens_out >= 0),
  cached       boolean not null default false,
  latency_ms   integer not null check (latency_ms >= 0),
  -- List price in ₹ at call time. Cache hits cost nothing.
  cost_inr     numeric(12, 4) not null default 0 check (cost_inr >= 0),
  ok           boolean not null,
  error        text check (length(error) <= 2000),
  created_at   timestamptz not null default now(),
  check (not cached or cost_inr = 0),
  check (ok or error is not null)
);
create index llm_calls_created_idx on public.llm_calls (created_at desc);
create index llm_calls_task_idx on public.llm_calls (task, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Lock down: RLS on everything, no policies, no grants to client roles
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.companies            enable row level security;
alter table public.portfolios           enable row level security;
alter table public.holdings             enable row level security;
alter table public.prices_daily         enable row level security;
alter table public.ingest_runs          enable row level security;
alter table public.filings              enable row level security;
alter table public.events               enable row level security;
alter table public.filing_analysis      enable row level security;
alter table public.results              enable row level security;
alter table public.people_events        enable row level security;
alter table public.documents            enable row level security;
alter table public.guidance_statements  enable row level security;
alter table public.actuals              enable row level security;
alter table public.verdicts             enable row level security;
alter table public.governance_flags     enable row level security;
alter table public.research_snapshots   enable row level security;
alter table public.research_jobs        enable row level security;
alter table public.alert_rules          enable row level security;
alter table public.alerts               enable row level security;
alter table public.feedback             enable row level security;
alter table public.push_targets         enable row level security;
alter table public.llm_cache            enable row level security;
alter table public.llm_calls            enable row level security;

-- Belt and braces: even if someone adds a policy later, client roles hold no privileges.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- Guard: fail the migration if any public table lacks RLS or carries a policy.
do $$
declare
  missing text;
  with_policy text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if missing is not null then
    raise exception 'RLS not enabled on: %', missing;
  end if;

  select string_agg(distinct tablename, ', ') into with_policy
  from pg_policies where schemaname = 'public';
  if with_policy is not null then
    raise exception 'Public tables must have no RLS policies; found policies on: %', with_policy;
  end if;
end $$;
