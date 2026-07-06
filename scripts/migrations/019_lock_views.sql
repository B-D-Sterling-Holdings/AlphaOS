-- ============================================================
-- 019 — LOCK VIEWS OUT OF THE ANON/AUTHENTICATED ROLES
-- Run in the Supabase SQL Editor AFTER 018_drop_stray_policies.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- The 2026-07-06 re-audit (after 018) found ONE remaining anon-readable
-- relation: rag_coverage. 018 re-locked every TABLE (pg_tables loop) and
-- dropped every stray POLICY — so the survivor has to be a VIEW: views are
-- not subject to RLS themselves, weren't touched by either loop, and
-- PostgREST exposes them exactly like tables. By default a view also runs
-- with its OWNER's privileges, so it can read straight through the RLS of
-- the tables underneath it.
--
-- The app never reads views through the anon/authenticated roles (rag_* is
-- Python-pipeline / service-role territory), so the fix is general, not
-- rag_coverage-specific — for EVERY view in public:
--
--   1. REVOKE all anon/authenticated access (closes today's leak, and any
--      view added later by the pipeline gets caught on the next re-run).
--   2. SET (security_invoker = true): the view now runs with the CALLER's
--      privileges, so even if someone re-grants access in the dashboard
--      later, a caller only sees what the underlying tables' RLS allows —
--      instead of the owner's RLS-bypassing read.
--
-- The service role is unaffected: it bypasses RLS and holds its own grants.
-- ------------------------------------------------------------

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v.table_name);
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.table_name);
    RAISE NOTICE 'locked view public.%', v.table_name;
  END LOOP;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   -- every public view should now be invoker-security and ungranted:
--   SELECT c.relname,
--          c.reloptions,
--          has_table_privilege('anon', c.oid, 'SELECT')          AS anon_select,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'v';
--   -- expect: reloptions contains security_invoker=true, both booleans false.
--
--   -- and the live proof (expect zero rows / permission denied):
--   --   curl "$SUPABASE_URL/rest/v1/rag_coverage?select=*&limit=1" \
--   --     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
-- ============================================================
