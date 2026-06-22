-- ============================================================
-- 005 — MULTITENANCY (row-level, RLS-enforced)
-- Run in the Supabase SQL Editor AFTER 001_enable_rls.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- The app no longer has a single CIO Alpha tenant + a parallel demo_* schema.
-- Instead, every data table gets a `tenant_id uuid` and is isolated by Postgres
-- Row Level Security. The app authenticates with its own JWT cookie, but the
-- server now talks to PostgREST as the `authenticated` role using a short-lived
-- Supabase-signed JWT whose `tenant_id` claim drives the policies below
-- (see src/lib/supabaseTenant.js). The service-role key still bypasses RLS and is
-- used only for auth/admin/user-management and the Python pipeline (which sets
-- tenant_id explicitly).
--
-- The result: a query that forgets to filter by tenant still cannot cross
-- tenants — the database refuses it. That is the whole point of Option B.
--
-- Two seed tenants get fixed UUIDs so the app's bootstrap logins map to them:
--   CIO Alpha : 11111111-1111-1111-1111-111111111111  (existing prod data)
--   Demo      : 22222222-2222-2222-2222-222222222222  (starts empty)
-- ============================================================

-- ------------------------------------------------------------
-- 0. Helper: the current request's tenant, read from the JWT claim.
--    Used by every policy and as the DEFAULT for every tenant_id column.
--    Returns NULL for the service role (no request JWT) — which is why
--    service-role inserts MUST set tenant_id explicitly.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json ->> 'tenant_id',
    ''
  )::uuid
$$;

-- ------------------------------------------------------------
-- 1. Identity tables (service-role only — NO authenticated access).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_demo       boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(lower(username));

-- Seed the two well-known tenants.
INSERT INTO tenants (id, name, is_demo) VALUES
  ('11111111-1111-1111-1111-111111111111', 'CIO Alpha', false),
  ('22222222-2222-2222-2222-222222222222', 'Demo',      true)
ON CONFLICT (id) DO NOTHING;

-- Lock identity tables down hard: RLS on, no policies => only the service role
-- (BYPASSRLS) can touch them. The browser/anon/authenticated roles get nothing.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;
ALTER TABLE users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE users   FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON tenants FROM anon, authenticated;
REVOKE ALL ON users   FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. macro_regime_weights — referenced by the app but missing from the base
--    schema. Create it (singleton-style) so the migration below can scope it.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS macro_regime_weights (
  id          integer DEFAULT 1,
  weights     jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 3. Add tenant_id to every tenant-scoped data table, backfill existing rows
--    to the CIO tenant, then make it NOT NULL with the claim-based default.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
  data_tables text[] := ARRAY[
    'contacts','interactions','contact_files','tasks','app_settings',
    'research_links','documents','theses','valuation_models','holdings',
    'portfolio_cash','watchlists','ticker_fundamentals','ticker_prices',
    'allocation_config','sector_config','factor_config','fund_nav_data',
    'strategic_notes','candidate_positions','ideas',
    'prism_recommendations','prism_ticker_data','prism_ticker_documents',
    'macro_regime_config','macro_regime_runs','macro_regime_results',
    'macro_regime_weights'
  ];
BEGIN
  FOREACH t IN ARRAY data_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE; -- table not present in this DB; skip
    END IF;

    -- add column (nullable first)
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid', t);
    -- backfill anything still null -> CIO tenant (existing production data)
    EXECUTE format(
      'UPDATE public.%I SET tenant_id = ''11111111-1111-1111-1111-111111111111'' WHERE tenant_id IS NULL',
      t
    );
    -- default future inserts to the request's tenant
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant()',
      t
    );
    -- now enforce presence
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);
    -- index for the policy filter
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_tenant ON public.%I(tenant_id)', t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. Singleton config tables: the old `id = 1` single-row pattern collides
--    across tenants. Make tenant_id the primary key (one row per tenant) while
--    keeping the `id` column (still defaults to 1) so existing `.eq('id', 1)`
--    reads keep working under RLS.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
  singletons text[] := ARRAY[
    'portfolio_cash','allocation_config','sector_config','factor_config',
    'macro_regime_config','macro_regime_weights'
  ];
BEGIN
  FOREACH t IN ARRAY singletons LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    -- drop whatever primary key exists, then key on tenant_id
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      t, t || '_pkey'
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ('public.' || t)::regclass AND contype = 'p'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (tenant_id)', t);
    END IF;
    -- keep id present + defaulted so {id:1} upserts and id=1 reads still resolve
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT 1', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. Business-unique constraints must become per-tenant. Drop the global
--    single-column uniques and re-add them scoped by tenant_id, so two tenants
--    can both hold e.g. AAPL. Upsert call sites are updated to match
--    (see the route changes that ship with this migration).
-- ------------------------------------------------------------
DO $$
BEGIN
  -- ticker-keyed tables
  ALTER TABLE theses            DROP CONSTRAINT IF EXISTS theses_ticker_key;
  ALTER TABLE valuation_models  DROP CONSTRAINT IF EXISTS valuation_models_ticker_key;
  ALTER TABLE holdings          DROP CONSTRAINT IF EXISTS holdings_ticker_key;
  ALTER TABLE strategic_notes   DROP CONSTRAINT IF EXISTS strategic_notes_ticker_key;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'theses_tenant_ticker_key') THEN
    ALTER TABLE theses ADD CONSTRAINT theses_tenant_ticker_key UNIQUE (tenant_id, ticker);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valuation_models_tenant_ticker_key') THEN
    ALTER TABLE valuation_models ADD CONSTRAINT valuation_models_tenant_ticker_key UNIQUE (tenant_id, ticker);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holdings_tenant_ticker_key') THEN
    ALTER TABLE holdings ADD CONSTRAINT holdings_tenant_ticker_key UNIQUE (tenant_id, ticker);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'strategic_notes_tenant_ticker_key') THEN
    ALTER TABLE strategic_notes ADD CONSTRAINT strategic_notes_tenant_ticker_key UNIQUE (tenant_id, ticker);
  END IF;

  -- app_settings: key unique -> (tenant_id, key)
  ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_key_key;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_tenant_key_key') THEN
    ALTER TABLE app_settings ADD CONSTRAINT app_settings_tenant_key_key UNIQUE (tenant_id, key);
  END IF;

  -- prism pipeline tables
  ALTER TABLE prism_recommendations  DROP CONSTRAINT IF EXISTS prism_recommendations_source_file_key;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prism_recommendations_tenant_source_file_key') THEN
    ALTER TABLE prism_recommendations ADD CONSTRAINT prism_recommendations_tenant_source_file_key UNIQUE (tenant_id, source_file);
  END IF;

  ALTER TABLE prism_ticker_data DROP CONSTRAINT IF EXISTS prism_ticker_data_ticker_category_key;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prism_ticker_data_tenant_ticker_category_key') THEN
    ALTER TABLE prism_ticker_data ADD CONSTRAINT prism_ticker_data_tenant_ticker_category_key UNIQUE (tenant_id, ticker, category);
  END IF;

  ALTER TABLE prism_ticker_documents DROP CONSTRAINT IF EXISTS prism_ticker_documents_ticker_filename_key;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prism_ticker_documents_tenant_ticker_filename_key') THEN
    ALTER TABLE prism_ticker_documents ADD CONSTRAINT prism_ticker_documents_tenant_ticker_filename_key UNIQUE (tenant_id, ticker, filename);
  END IF;
END $$;

-- watchlists: text PK `id` collides across tenants (everyone has 'default').
-- Re-key on (tenant_id, id).
DO $$
BEGIN
  ALTER TABLE watchlists DROP CONSTRAINT IF EXISTS watchlists_pkey;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.watchlists'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE watchlists ADD PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. RLS policies + grants for the `authenticated` role, on every table that
--    has a tenant_id (excludes identity tables, which stay service-role only).
--    Re-enables RLS/FORCE too, so tables created after 001 are covered.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND tb.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('users','tenants')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);

    -- one all-verbs policy: you can only see/modify rows in your own tenant,
    -- and you can only write rows stamped with your own tenant.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.app_current_tenant())
        WITH CHECK (tenant_id = public.app_current_tenant())
    $f$, t);

    -- the authenticated role needs base privileges; RLS then narrows the rows.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- serial/identity columns (e.g. app_settings.id) need sequence usage for inserts.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- the tenant resolver is called inside policies; make sure it's callable.
GRANT EXECUTE ON FUNCTION public.app_current_tenant() TO authenticated, anon;

-- ------------------------------------------------------------
-- 7. Seed the Demo tenant's singleton config rows so the demo login isn't
--    missing the single-row config tables. (CIO already has them from backfill.)
--    New tenants created via the admin UI are seeded by the app at creation.
-- ------------------------------------------------------------
INSERT INTO portfolio_cash    (tenant_id, id, cash)   VALUES ('22222222-2222-2222-2222-222222222222', 1, 0)            ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO allocation_config (tenant_id, id, config) VALUES ('22222222-2222-2222-2222-222222222222', 1, '{}'::jsonb) ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO sector_config     (tenant_id, id, config) VALUES ('22222222-2222-2222-2222-222222222222', 1, '{}'::jsonb) ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO factor_config     (tenant_id, id, factors, importance_weights, exposures)
  VALUES ('22222222-2222-2222-2222-222222222222', 1, '[]'::jsonb, '{"Volatility": 0.9}'::jsonb, '{}'::jsonb)          ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO macro_regime_config (tenant_id, id, config) VALUES ('22222222-2222-2222-2222-222222222222', 1, '{}'::jsonb) ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================================
-- VERIFY
-- ============================================================
--   -- every data table should report rowsecurity = true and have a policy:
--   SELECT tablename FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity;     -- expect 0
--   SELECT tablename FROM pg_tables t WHERE schemaname='public'
--     AND EXISTS (SELECT 1 FROM information_schema.columns c
--                 WHERE c.table_name=t.tablename AND c.column_name='tenant_id')
--     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename=t.tablename); -- expect 0
--
-- NOTE: the old demo_* tables are now superseded by the demo tenant and are no
-- longer read by the app. They are left in place (RLS-locked, no policy) so no
-- data is lost; drop them manually once you're satisfied the cutover is clean.
-- ============================================================
