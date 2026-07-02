-- ============================================================
-- 009 — FINISH PER-TENANT KEYS (ticker data, theses, NAV, settings)
-- Run in the Supabase SQL Editor any time after 005_multitenancy.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Migration 005 re-scoped most business uniques per tenant but several
-- deployed tables kept GLOBAL keys, so once any tenant holds a row, no
-- other tenant can hold the equivalent row:
--
--   ticker_prices / ticker_fundamentals  PK (ticker, data_type)
--   theses / valuation_models            PK (ticker)
--   fund_nav_data                        UNIQUE (date)
--   app_settings                         PK (key)
--
-- This bites every non-CIO tenant ("Generate Data", saving a thesis, NAV
-- import, task boards…) and is why the demo dataset (src/lib/demoData.js)
-- uses a non-overlapping ticker cast and why src/lib/demoSeed.js tolerates
-- collisions. After this migration both restrictions are unnecessary.
--
-- Fix: re-key on tenant-scoped keys, mirroring what 005 did elsewhere.
--
-- fund_nav_data has the same disease in another shape: a global UNIQUE(date)
-- (fund_nav_data_date_key), so only one tenant can hold a NAV point for any
-- calendar day. Re-scoped to UNIQUE(tenant_id, date) below. The fund-nav API
-- (delete-then-insert, RLS-scoped) needs no change.
-- ------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ticker_prices', 'ticker_fundamentals'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    -- Drop the legacy global key (whichever form it exists in).
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_pkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_ticker_data_type_key');

    -- Re-key per tenant.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (tenant_id, ticker, data_type)', t);
    END IF;
  END LOOP;
END $$;

-- theses / valuation_models: the deployed tables are primary-keyed on
-- (ticker) alone — 005 added the per-tenant UNIQUE(tenant_id, ticker) but
-- left the global PK, so two tenants still can't both hold e.g. an MSFT
-- thesis. Re-key the PK to (tenant_id, ticker); the app's upserts already
-- target onConflict 'tenant_id,ticker'.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['theses', 'valuation_models'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    -- only touch it when the current PK does NOT include tenant_id
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = ('public.' || t)::regclass AND c.contype = 'p'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(c.conkey) k
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
          WHERE a.attname = 'tenant_id'
        )
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, t || '_pkey');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (tenant_id, ticker)', t);
    END IF;
  END LOOP;
END $$;

-- fund_nav_data: global UNIQUE(date) -> per-tenant UNIQUE(tenant_id, date).
DO $$
BEGIN
  IF to_regclass('public.fund_nav_data') IS NOT NULL THEN
    ALTER TABLE public.fund_nav_data DROP CONSTRAINT IF EXISTS fund_nav_data_date_key;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fund_nav_data_tenant_date_key'
    ) THEN
      ALTER TABLE public.fund_nav_data
        ADD CONSTRAINT fund_nav_data_tenant_date_key UNIQUE (tenant_id, date);
    END IF;
  END IF;
END $$;

-- app_settings: deployed PK is (key) — global across tenants. Re-key on the
-- serial id (the per-tenant UNIQUE(tenant_id, key) from 005 already guards
-- business uniqueness; all reads/upserts go through it), and realign the id
-- sequence so future inserts can't collide with existing rows.
DO $$
DECLARE
  pk_cols text;
BEGIN
  IF to_regclass('public.app_settings') IS NULL THEN RETURN; END IF;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO pk_cols
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'public.app_settings'::regclass AND c.contype = 'p';

  IF pk_cols IS DISTINCT FROM 'id' THEN
    ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
    ALTER TABLE public.app_settings ADD PRIMARY KEY (id);
  END IF;

  PERFORM setval(
    pg_get_serial_sequence('public.app_settings', 'id'),
    COALESCE((SELECT MAX(id) FROM public.app_settings), 0) + 1,
    false
  );
END $$;

-- VERIFY:
--   SELECT c.conrelid::regclass AS tbl, conname, pg_get_constraintdef(c.oid)
--   FROM pg_constraint c
--   WHERE c.conrelid IN ('ticker_prices'::regclass, 'ticker_fundamentals'::regclass,
--                        'theses'::regclass, 'valuation_models'::regclass,
--                        'fund_nav_data'::regclass, 'app_settings'::regclass)
--     AND c.contype IN ('p', 'u');
-- Expect: PK (tenant_id, ticker, data_type) on the ticker tables,
--         PK (tenant_id, ticker) on theses / valuation_models,
--         UNIQUE (tenant_id, date) on fund_nav_data,
--         PK (id) + UNIQUE (tenant_id, key) on app_settings.
--
-- NOTE: src/lib/generateData.js upserts rely on the PK as the conflict
-- target, so they pick the per-tenant key up automatically.
