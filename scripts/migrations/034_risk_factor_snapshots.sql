-- ============================================================
-- 034 — RISK FACTOR SNAPSHOTS (per-stock risk input revision history)
-- Run in the Supabase SQL Editor AFTER 005_multitenancy.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds the table behind the new Allocation → Inputs tab. The five risk factor
-- SCORES per stock (Volatility, Regulatory, Disruption, Valuation, Earnings
-- Quality) still live as the working values inside the `allocation_config`
-- app_settings blob (row.factorExposures / row.factorReasons) — that is what the
-- Optimizer reads. This table is the *audit log*: each time an analyst commits a
-- revision for a ticker, one row is appended capturing the exact scores, the
-- per-factor reasoning, the factor weights in force, and an optional note, so we
-- can look back and see what we were thinking at that time.
--
--   risk_factor_snapshots — one row per committed revision of a ticker's risk
--            inputs. Append-only in normal use; the newest row per ticker is the
--            "current saved" baseline the Inputs tab diffs against.
--
-- Self-describing payload: `factors` records the factor NAMES at snapshot time and
-- `scores` / `reasons` / `factor_weights` are arrays aligned to it, so a later
-- change to the factor list never silently re-labels old history.
--
-- Tenant-scoped exactly like every other data table: tenant_id defaults to the
-- request's JWT claim, RLS isolates rows, and the authenticated role gets the
-- standard grants. See 005_multitenancy.sql for the mechanism.

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_factor_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT public.app_current_tenant(),
  ticker         text NOT NULL,
  -- Factor names at snapshot time, e.g. ["Volatility","Regulatory",...]
  factors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Scores aligned to `factors`, e.g. [0.4, 0.2, 0.55, 0.3, 0.25]
  scores         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Per-factor reasoning aligned to `factors` (why this number for this stock)
  reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Global risk factor weights in force at snapshot time, aligned to `factors`
  factor_weights jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Optional overall note for the revision
  note           text DEFAULT '',
  author         text DEFAULT '',              -- username who committed it (server-set)
  created_at     timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Defaults / backfill (in case the table pre-existed without the tenant default)
-- ------------------------------------------------------------
ALTER TABLE public.risk_factor_snapshots
  ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant();

CREATE INDEX IF NOT EXISTS idx_risk_snapshots_tenant
  ON public.risk_factor_snapshots(tenant_id);
-- History view is "newest revisions of a ticker first".
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_tenant_ticker
  ON public.risk_factor_snapshots(tenant_id, ticker, created_at DESC);

-- ------------------------------------------------------------
-- 3. RLS + grants (mirror the tenant_isolation policy used everywhere)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['risk_factor_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.app_current_tenant())
        WITH CHECK (tenant_id = public.app_current_tenant())
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'risk_factor_snapshots';  -- rowsecurity = true
--   INSERT INTO risk_factor_snapshots (ticker, factors, scores)
--     VALUES ('TEST', '["Volatility"]'::jsonb, '[0.5]'::jsonb);  -- as a tenant session, tenant_id auto-set
-- ============================================================
