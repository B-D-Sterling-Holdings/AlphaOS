-- ============================================================
-- 018 — RE-LOCK RLS + DROP STRAY POLICIES
-- Run in the Supabase SQL Editor AFTER 017_issue_complexity_scale.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- A 2026-07-05 live-DB probe found three tables readable with the PUBLIC anon
-- key (which ships to every browser) and across tenants:
--
--   macro_regime_config — every tenant's config JSONB
--   macro_regime_runs   — every tenant's pipeline runs incl. log_output
--   rag_coverage        — global RAG ingest stats (no tenant_id)
--
-- No SQL in this repo creates policies that would allow that, so the cause is
-- one (or both) of:
--   a) permissive policies added outside the repo (e.g. the Supabase
--      dashboard's "Enable read access for all users" quick-add), which OR
--      together with tenant_isolation and widen it;
--   b) tables dropped/recreated after 001/005 ran (the macro pipeline), which
--      silently loses ENABLE/FORCE RLS and the tenant_isolation policy.
--
-- This migration makes the intended end-state true again REGARDLESS of cause,
-- and re-running it after any future drift is always safe:
--
--   1. ENABLE + FORCE RLS on every table in public (re-run of 001's loop).
--   2. DROP every public-schema policy that is not `tenant_isolation`.
--      The repo's only public-schema policies ARE the tenant_isolation ones
--      from 005 — anything else on a public table is drift by definition.
--      (Storage policies live in the `storage` schema and are untouched.)
--   3. Recreate `tenant_isolation` + grants on every table that has a
--      tenant_id (re-run of 005 §6) — so a table that lost its policy in a
--      drop/recreate goes back to per-tenant access instead of going dark
--      for the app when step 1 turns RLS back on.
--
-- Tables WITHOUT a tenant_id (rag_*, scraped_content, content_chunks,
-- chat_*, macro_regime_signal, task_comments, the legacy demo_* clones)
-- intentionally end up RLS-on with NO policies: service-role only. That is
-- how the app reads them today (Python pipeline / server routes).
-- ------------------------------------------------------------

-- 1. RLS on + forced, everywhere in public (bypassed only by the service role).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- 2. Drop every stray (non-tenant_isolation) policy on public tables.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname <> 'tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'dropped stray policy % on public.%', p.policyname, p.tablename;
  END LOOP;
END $$;

-- 3. Recreate tenant_isolation + grants on every tenant-scoped table
--    (identical to 005 §6, so recreated tables regain their policy).
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
      AND c.table_name NOT IN ('users', 'tenants')
  LOOP
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

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================================
-- VERIFY
-- ============================================================
--   -- every public table locked (expect 0 rows):
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND NOT rowsecurity;
--
--   -- only tenant_isolation policies remain (expect 0 rows):
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND policyname <> 'tenant_isolation';
--
--   -- every tenant-scoped table has its policy back (expect 0 rows):
--   SELECT c.table_name
--   FROM information_schema.columns c
--   WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
--     AND c.table_name NOT IN ('users','tenants')
--     AND NOT EXISTS (SELECT 1 FROM pg_policies p
--                     WHERE p.schemaname = 'public'
--                       AND p.tablename = c.table_name
--                       AND p.policyname = 'tenant_isolation');
--
--   -- and the live proof: an anon request must now return zero rows —
--   --   curl "$SUPABASE_URL/rest/v1/macro_regime_runs?select=id&limit=1" \
--   --     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
-- ============================================================
