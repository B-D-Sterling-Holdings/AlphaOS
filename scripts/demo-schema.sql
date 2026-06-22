-- ============================================================
-- DEMO SCHEMA — isolated demo environment for AlphaOS
-- Run ONCE in the Supabase SQL Editor, AFTER scripts/supabase-schema.sql.
--
-- 100% ADDITIVE & NON-DESTRUCTIVE:
--   * Only CREATEs new `demo_*` tables — never ALTERs/DROPs/TRUNCATEs a prod table.
--   * Safe to re-run (everything is guarded / IF NOT EXISTS).
--
-- The demo account (login: demo / demo) is routed entirely to these tables by
-- src/lib/db.js (server). It can never name a production table, so it cannot read
-- or write real CIO Alpha data.
--
-- Note on RLS: the app uses its own JWT (not Supabase Auth), so auth.uid()-based
-- RLS cannot tell demo from prod. Isolation is enforced in the data-access layer.
-- RLS is ENABLED on all public tables (including these demo_* tables) with no
-- policies — the public anon key is locked out of the DB and all access runs
-- through the server's service-role client. Run scripts/migrations/001_enable_rls.sql AFTER this
-- file so the new demo_* tables are covered too.
-- ============================================================


-- ── 1. Clone the structure of every account/data table from its prod twin.
--      LIKE ... INCLUDING ALL copies columns, defaults, PKs, unique constraints,
--      indexes and checks. (Foreign keys are re-added in step 3.) app_settings is
--      handled explicitly in step 2 so it gets its own sequence.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'contacts','interactions','contact_files','tasks','research_links',
    'documents','theses','valuation_models','holdings','portfolio_cash',
    'watchlists','ticker_fundamentals','ticker_prices','allocation_config',
    'sector_config','factor_config','fund_nav_data','strategic_notes',
    'candidate_positions','ideas',
    'macro_regime_runs','macro_regime_results','macro_regime_config',
    'prism_recommendations','prism_ticker_data','prism_ticker_documents'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(t) IS NOT NULL AND to_regclass('demo_' || t) IS NULL THEN
      EXECUTE format('CREATE TABLE demo_%I (LIKE %I INCLUDING ALL)', t, t);
    END IF;
  END LOOP;
END $$;


-- ── 2. app_settings: explicit clone with its OWN sequence (so demo ids never
--      draw from the production app_settings sequence).
CREATE TABLE IF NOT EXISTS demo_app_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ── 3. Re-add the foreign keys LIKE does not copy (idempotent).
DO $$
BEGIN
  IF to_regclass('demo_interactions') IS NOT NULL
     AND to_regclass('demo_contacts') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demo_interactions_contact_fk') THEN
    ALTER TABLE demo_interactions
      ADD CONSTRAINT demo_interactions_contact_fk
      FOREIGN KEY (contact_id) REFERENCES demo_contacts(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('demo_contact_files') IS NOT NULL
     AND to_regclass('demo_contacts') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demo_contact_files_contact_fk') THEN
    ALTER TABLE demo_contact_files
      ADD CONSTRAINT demo_contact_files_contact_fk
      FOREIGN KEY (contact_id) REFERENCES demo_contacts(id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── 4. Ensure single-row config tables have their id=1 row to UPDATE.
INSERT INTO demo_portfolio_cash (id, cash) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO demo_allocation_config (id, config) VALUES (1, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO demo_sector_config (id, config) VALUES (1, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO demo_factor_config (id, factors, importance_weights, exposures)
  VALUES (1, '[]'::jsonb, '{"Volatility": 0.9}'::jsonb, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO demo_macro_regime_config (id, config) VALUES (1, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- STORAGE: demo reuses the existing `documents` / `research-images` buckets,
-- but demo uploads are written under a `demo/` path prefix (see the upload &
-- documents routes). No new buckets or policies are required.
-- ============================================================

-- Next: run scripts/demo-seed.sql to populate realistic demo data.
