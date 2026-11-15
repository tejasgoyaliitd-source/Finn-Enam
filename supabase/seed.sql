-- FINN demo seed: one mandate-clean, 18-stock portfolio.
--
-- Mandate: no alcohol, tobacco, gambling or real-money gaming, or businesses involving animal
-- harm. Excluded names are listed in the house view and checked by the guard at the bottom,
-- which fails the seed if any of them is held.
--
-- Test coverage this portfolio gives the results/people logic:
--   * Bank card (no EBITDA): HDFCBANK (bank) and BAJFINANCE (NBFC). Both is_bank = true.
--   * Q2 FY27 reporters: SEBI LODR Reg. 33 requires quarterly results within 45 days, so all
--     18 must have filed Q2 FY27 (quarter ended 30 Sep 2026) by 14 Nov 2026.
--   * Management change: POLYCAB. CFO Gandharv Tongia resigned in Oct 2025; Niyant Maru was
--     appointed CFO for a fixed term ending 16 Jul 2026, so a further CFO change in 2026 is
--     expected. Ingestion pulls the actual filings; nothing here is invented.
--
-- Reference data (ISIN, BSE code) is a starting point. The weekly NSE equity-list load
-- upserts companies and overwrites these if anything has changed (e.g. a split changes ISIN).
--
-- Idempotent: safe to run repeatedly.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Companies
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.companies (symbol, name, isin, bse_code, sector, is_bank) values
  ('HDFCBANK',   'HDFC Bank Ltd',                          'INE040A01034', '500180', 'Private sector bank',                true),
  ('BAJFINANCE', 'Bajaj Finance Ltd',                      'INE296A01032', '500034', 'NBFC: consumer and SME lending',     true),
  ('TITAN',      'Titan Company Ltd',                      'INE280A01028', '500114', 'Jewellery, watches and eyewear',     false),
  ('DIXON',      'Dixon Technologies (India) Ltd',         'INE935N01020', '540699', 'Electronics manufacturing services', false),
  ('POLYCAB',    'Polycab India Ltd',                      'INE455K01017', '542652', 'Wires and cables',                   false),
  ('PERSISTENT', 'Persistent Systems Ltd',                 'INE262H01021', '533179', 'IT services',                        false),
  ('KPITTECH',   'KPIT Technologies Ltd',                  'INE04I401011', '542651', 'Automotive software',                false),
  ('ASTRAL',     'Astral Ltd',                             'INE006I01046', '532830', 'Pipes and adhesives',                false),
  ('PIDILITIND', 'Pidilite Industries Ltd',                'INE318A01026', '500331', 'Adhesives and construction chemicals', false),
  ('HAVELLS',    'Havells India Ltd',                      'INE176B01034', '517354', 'Electricals and consumer durables',  false),
  ('KAYNES',     'Kaynes Technology India Ltd',            'INE918Z01012', '543664', 'Electronics manufacturing services', false),
  ('CGPOWER',    'CG Power and Industrial Solutions Ltd',  'INE067A01029', '500093', 'Electrical equipment',               false),
  ('APLAPOLLO',  'APL Apollo Tubes Ltd',                   'INE702C01027', '533758', 'Structural steel tubes',             false),
  ('ASIANPAINT', 'Asian Paints Ltd',                       'INE021A01026', '500820', 'Paints',                             false),
  ('MARICO',     'Marico Ltd',                             'INE196A01026', '531642', 'FMCG: hair care and edible oils',    false),
  ('SUPREMEIND', 'The Supreme Industries Ltd',             'INE195A01028', '509930', 'Plastic products',                   false),
  ('SONACOMS',   'Sona BLW Precision Forgings Ltd',        'INE073K01018', '543300', 'Auto components (EV drivetrains)',   false),
  ('PAGEIND',    'Page Industries Ltd',                    'INE761H01022', '532827', 'Innerwear and apparel',              false)
on conflict (symbol) do update set
  name = excluded.name, isin = excluded.isin, bse_code = excluded.bse_code,
  sector = excluded.sector, is_bank = excluded.is_bank;

-- ─────────────────────────────────────────────────────────────────────────────
-- Demo portfolio and house view
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.portfolios (id, name, settings) values (
  '00000000-0000-4000-8000-000000000001',
  'FINN demo portfolio',
  '{
    "mandate": {
      "excluded_activities": ["alcohol", "tobacco", "gambling", "real_money_gaming", "animal_harm"],
      "excluded_symbols": [
        "ITC", "ITCHOTELS", "GODFRYPHLP", "VSTIND", "NTCIND",
        "UNITDSPR", "MCDOWELL-N", "RADICO", "UBL", "TI", "GLOBUSSPR", "SULA", "SOMDISTILL", "ABDL",
        "DELTACORP", "NAZARA", "ONMOBILE",
        "VENKEYS", "AVANTIFEED", "WATERBASE"
      ]
    },
    "push": { "channel": "telegram", "max_per_day": 3, "digest_time_ist": "08:00" },
    "muted_sub_kinds": ["newspaper_ad"]
  }'::jsonb
)
on conflict (id) do update set name = excluded.name, settings = excluded.settings;

-- Replace holdings wholesale so re-running the seed never leaves stale rows.
delete from public.holdings where portfolio_id = '00000000-0000-4000-8000-000000000001';

insert into public.holdings (portfolio_id, symbol, weight_pct, added_at)
select '00000000-0000-4000-8000-000000000001', symbol, weight_pct, '2026-04-01 09:15:00+05:30'
from (values
  ('HDFCBANK',   9.00),
  ('TITAN',      7.50),
  ('BAJFINANCE', 7.00),
  ('DIXON',      6.50),
  ('POLYCAB',    6.50),
  ('PERSISTENT', 6.00),
  ('KPITTECH',   5.50),
  ('ASTRAL',     5.50),
  ('PIDILITIND', 5.50),
  ('HAVELLS',    5.00),
  ('KAYNES',     5.00),
  ('CGPOWER',    5.00),
  ('APLAPOLLO',  4.50),
  ('ASIANPAINT', 4.50),
  ('MARICO',     4.50),
  ('PAGEIND',    4.50),
  ('SUPREMEIND', 4.00),
  ('SONACOMS',   4.00)
) as h (symbol, weight_pct);

-- ─────────────────────────────────────────────────────────────────────────────
-- Default alert rules
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.alert_rules (portfolio_id, kind, params) values
  ('00000000-0000-4000-8000-000000000001', 'move_sigma',    '{"sigma": 2.5, "lookback_sessions": 60}'),
  ('00000000-0000-4000-8000-000000000001', 'volume_x',      '{"multiple": 3, "lookback_sessions": 20}'),
  ('00000000-0000-4000-8000-000000000001', 'concentration', '{"max_weight_pct": 10}')
on conflict (portfolio_id, kind) do update set params = excluded.params, enabled = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard: the demo must be mandate-clean and tie up, or the seed fails
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  pid        constant uuid := '00000000-0000-4000-8000-000000000001';
  n          integer;
  total      numeric;
  banks      integer;
  violators  text;
  max_w      numeric;
begin
  select count(*), sum(weight_pct), max(weight_pct) into n, total, max_w
  from public.holdings where portfolio_id = pid;
  if n <> 18 then raise exception 'Demo portfolio should hold 18 stocks, holds %', n; end if;
  if total <> 100 then raise exception 'Demo weights sum to %, expected exactly 100', total; end if;
  if max_w > 10 then raise exception 'Demo breaks its own 10%% concentration rule (max %)', max_w; end if;

  select string_agg(h.symbol, ', ') into violators
  from public.holdings h
  join public.portfolios p on p.id = h.portfolio_id
  where h.portfolio_id = pid
    and p.settings -> 'mandate' -> 'excluded_symbols' ? h.symbol;
  if violators is not null then
    raise exception 'Mandate breach: demo portfolio holds excluded names: %', violators;
  end if;

  select count(*) into banks
  from public.holdings h join public.companies c using (symbol)
  where h.portfolio_id = pid and c.is_bank;
  if banks < 1 then raise exception 'Demo needs at least one bank to exercise the bank results card'; end if;
end $$;

commit;
