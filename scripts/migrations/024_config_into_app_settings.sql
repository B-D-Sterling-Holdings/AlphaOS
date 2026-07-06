-- ============================================================
-- 024 — Collapse the single-row config tables into app_settings
-- Run in the Supabase SQL Editor AFTER 023_app_settings_jsonb.sql.
-- Idempotent: safe to run repeatedly; copies data before dropping.
-- ============================================================
--
-- WHY
-- ---
-- Six tables were each "one row per tenant" config singletons:
--
--   allocation_config     (id, config jsonb)
--   sector_config         (id, config jsonb)
--   factor_config         (id, factors, importance_weights, exposures)
--   macro_regime_config   (id, config jsonb)
--   macro_regime_weights  (id, weights jsonb)
--   portfolio_cash        (id, cash numeric)
--
-- Each cost a table, an RLS policy, a seed row, and a line in the workspace-purge
-- and demo-reset lists — and relied on the vestigial `id = 1` / PRIMARY KEY
-- (tenant_id) singleton hack. They're all just per-tenant config, so they move
-- into the existing `app_settings` (tenant_id, key, value JSONB) store as one row
-- each, keyed by the old table name. app_settings already holds the biggest
-- per-tenant config (fund-accounting-state), so this unifies the pattern.
--
-- Shapes in app_settings.value (JSONB):
--   'allocation_config'    -> the old `config` object
--   'sector_config'        -> the old `config` object  ({ sector: {label,color} })
--   'factor_config'        -> { factors, importance_weights, exposures }
--   'macro_regime_config'  -> the old `config` object
--   'macro_regime_weights' -> the old `weights` object
--   'portfolio_cash'       -> { cash: <number> }
--
-- New tenants no longer seed these — every reader has a built-in default and the
-- first save creates the row (see src/lib/appSettings.js + seedTenantDefaults).
--
-- DEPLOY ORDER: deploy the app code that reads app_settings for config, THEN run
-- this. (Between deploy and this migration a config reader just returns its
-- built-in default until the row is copied in — no errors.)
-- ------------------------------------------------------------

DO $$
BEGIN
  -- allocation_config -> key 'allocation_config'
  IF to_regclass('public.allocation_config') IS NOT NULL THEN
    INSERT INTO public.app_settings (tenant_id, key, value)
      SELECT tenant_id, 'allocation_config', COALESCE(config, '{}'::jsonb)
      FROM public.allocation_config
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DROP TABLE public.allocation_config;
  END IF;

  -- sector_config -> key 'sector_config'
  IF to_regclass('public.sector_config') IS NOT NULL THEN
    INSERT INTO public.app_settings (tenant_id, key, value)
      SELECT tenant_id, 'sector_config', COALESCE(config, '{}'::jsonb)
      FROM public.sector_config
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DROP TABLE public.sector_config;
  END IF;

  -- macro_regime_config -> key 'macro_regime_config'
  IF to_regclass('public.macro_regime_config') IS NOT NULL THEN
    INSERT INTO public.app_settings (tenant_id, key, value)
      SELECT tenant_id, 'macro_regime_config', COALESCE(config, '{}'::jsonb)
      FROM public.macro_regime_config
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DROP TABLE public.macro_regime_config;
  END IF;

  -- macro_regime_weights -> key 'macro_regime_weights'  (column is `weights`)
  IF to_regclass('public.macro_regime_weights') IS NOT NULL THEN
    INSERT INTO public.app_settings (tenant_id, key, value)
      SELECT tenant_id, 'macro_regime_weights', COALESCE(weights, '{}'::jsonb)
      FROM public.macro_regime_weights
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DROP TABLE public.macro_regime_weights;
  END IF;

  -- factor_config -> key 'factor_config'  (three columns -> one object)
  IF to_regclass('public.factor_config') IS NOT NULL THEN
    INSERT INTO public.app_settings (tenant_id, key, value)
      SELECT tenant_id, 'factor_config', jsonb_build_object(
               'factors',            COALESCE(factors, '[]'::jsonb),
               'importance_weights', COALESCE(importance_weights, '{}'::jsonb),
               'exposures',          COALESCE(exposures, '{}'::jsonb))
      FROM public.factor_config
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DROP TABLE public.factor_config;
  END IF;

  -- portfolio_cash -> key 'portfolio_cash'  (numeric -> { cash })
  IF to_regclass('public.portfolio_cash') IS NOT NULL THEN
    INSERT INTO public.app_settings (tenant_id, key, value)
      SELECT tenant_id, 'portfolio_cash', jsonb_build_object('cash', COALESCE(cash, 0))
      FROM public.portfolio_cash
      ON CONFLICT (tenant_id, key) DO NOTHING;
    DROP TABLE public.portfolio_cash;
  END IF;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   -- the six tables are gone (expect 0 rows):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN
--     ('allocation_config','sector_config','factor_config',
--      'macro_regime_config','macro_regime_weights','portfolio_cash');
--
--   -- the config now lives in app_settings, one row per tenant per key:
--   SELECT tenant_id, key, jsonb_typeof(value)
--   FROM app_settings
--   WHERE key IN ('allocation_config','sector_config','factor_config',
--                 'macro_regime_config','macro_regime_weights','portfolio_cash')
--   ORDER BY tenant_id, key;
-- ============================================================
