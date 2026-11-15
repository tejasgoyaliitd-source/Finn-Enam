-- Triage pipeline: duplicate linking, new categories, classification fallback.

-- New categories: auditor_change, regulatory_order, disruption, routine.
alter domain public.filing_category drop constraint filing_category_check;
alter domain public.filing_category add constraint filing_category_check
  check (value in (
    'results', 'm_and_a', 'fund_raise', 'management_change', 'auditor_change', 'regulatory_order',
    'litigation', 'insider_trading', 'earnings_call', 'investor_meetings', 'credit_rating', 'dividend',
    'bonus_split', 'capex', 'press_release', 'postal_ballot', 'agm_egm', 'pledging', 'disruption', 'routine', 'unclassified'
  ));

-- dedupe_key now identifies one exchange record (re-polls are no-ops). Cross-exchange
-- duplicates are found with subject_hash inside a ±10 minute window and LINKED via
-- duplicate_of instead of being dropped.
comment on column public.filings.dedupe_key is
  'SHA-256 of exchange + symbol + canonical subject + filed_at: identity of one exchange record';
alter table public.filings
  add column subject_hash public.sha256_hex,
  add column duplicate_of bigint references public.filings (id);
comment on column public.filings.subject_hash is 'SHA-256 of symbol + canonical subject (boilerplate stripped)';
comment on column public.filings.duplicate_of is 'Set when this filing repeats one already stored (e.g. same disclosure on BSE minutes after NSE)';

alter table public.filings add constraint filings_not_self_duplicate check (duplicate_of is null or duplicate_of <> id);
create index filings_dedupe_window_idx on public.filings (symbol, subject_hash, filed_at);
create index filings_duplicate_of_idx on public.filings (duplicate_of) where duplicate_of is not null;

-- Duplicates point at an original, never at another duplicate.
create function public.check_duplicate_target() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.duplicate_of is not null and exists (
    select 1 from public.filings where id = new.duplicate_of and duplicate_of is not null
  ) then
    raise exception 'filing % would point at another duplicate (%)', new.dedupe_key, new.duplicate_of;
  end if;
  return new;
end $$;
create trigger filings_duplicate_target before insert on public.filings
  for each row execute function public.check_duplicate_target();

-- Duplicates are never analysed, scored or alerted on: only their original is.
create function public.reject_duplicate_analysis() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.filings where id = new.filing_id and duplicate_of is not null) then
    raise exception 'filing % is a duplicate; analyse its original instead', new.filing_id;
  end if;
  return new;
end $$;
create trigger filing_analysis_not_duplicate before insert or update on public.filing_analysis
  for each row execute function public.reject_duplicate_analysis();

-- 'fallback': no rule matched and the model was unavailable or failed.
alter table public.filing_analysis drop constraint filing_analysis_method_check;
alter table public.filing_analysis add constraint filing_analysis_method_check
  check (method in ('rule', 'model', 'fallback'));

-- Reasons are plain language for people, never score arithmetic like "+80".
alter table public.filing_analysis add constraint filing_analysis_reasons_plain
  check (cardinality(reasons) >= 1 and array_to_string(reasons, ' | ') !~ '(^|\s)[+-]\s?[0-9]+\M');

revoke all on function public.check_duplicate_target() from anon, authenticated, public;
revoke all on function public.reject_duplicate_analysis() from anon, authenticated, public;
