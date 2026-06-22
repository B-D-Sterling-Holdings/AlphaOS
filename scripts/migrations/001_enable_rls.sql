-- ============================================================
-- ENABLE RLS LOCKDOWN — run in the Supabase SQL Editor
-- Project: Research Management System (dnlimnnejpinedtucpgp)
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql
-- ============================================================
--
-- Context
-- -------
-- This app does NOT use Supabase Auth. It authenticates with its own JWT cookie
-- (see src/lib/auth.js), so there is no auth.uid() for RLS policies to key off.
--
-- The fix is therefore NOT "add per-user policies" — it is "lock the public anon
-- key out of the database entirely". The anon key ships to the browser
-- (NEXT_PUBLIC_SUPABASE_ANON_KEY), so with RLS off, anyone could read/write every
-- table via PostgREST. That is exactly the "rls_disabled_in_public" finding.
--
-- After this migration:
--   * RLS is ENABLED on every table in the public schema, with NO policies.
--     -> the anon (and authenticated) roles get zero rows and all writes denied.
--   * All server access runs through the SERVICE-ROLE key (src/lib/supabaseAdmin.js),
--     which BYPASSES RLS. Every API route keeps working byte-identically.
--   * The browser no longer talks to Supabase directly (AccountingTool now goes
--     through /api/accounting-state).
--
-- This is safe to run repeatedly (idempotent) and does not drop any data.
-- ============================================================

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    -- Enable RLS. With no policies present, this denies anon/authenticated and
    -- is bypassed by the service role.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t.tablename);
    -- FORCE also subjects the *table owner* to RLS, closing one more bypass path.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t.tablename);
  END LOOP;
END $$;

-- ---------- Verify ----------
-- Every row should show rowsecurity = true. Run this after the block above:
--
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
--
-- And confirm there are no lingering permissive policies you didn't intend:
--
--   SELECT schemaname, tablename, policyname
--   FROM pg_policies
--   WHERE schemaname = 'public';
--
-- (Expect zero rows — we intentionally grant the anon role no access.)

-- ============================================================
-- NOTE on Storage (separate from the table finding above)
-- ============================================================
-- scripts/supabase-schema.sql defines PUBLIC policies on storage.objects for the
-- 'documents' bucket (public read/insert/delete). Uploads now go through the
-- server (service role), so the public INSERT/DELETE policies are no longer
-- needed and should be dropped. Public READ is only required if you rely on
-- getPublicUrl() to display files; otherwise switch to createSignedUrl() and
-- drop the public read policy too. Left unchanged here because the Supabase
-- email was specifically about table RLS — handle storage as a follow-up.
