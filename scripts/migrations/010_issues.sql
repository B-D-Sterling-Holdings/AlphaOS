-- ============================================================
-- 010 — ISSUES (in-app issue tracker / bug board)
-- Run in the Supabase SQL Editor AFTER 005_multitenancy.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds the table behind the Issues widget (the "New issue" button in the top-right
-- of the navbar; UI in src/components/IssuesWidget.jsx, API in
-- src/app/api/issues/route.js).
--
--   issues — one row per issue/bug report. Every user in a tenant can open an
--            issue and comment on one; only an admin (the CIO login) can resolve,
--            reopen, or delete. Resolved issues move to the "Archived" tab.
--
-- Body and comments are stored as JSONB in the RichTextArea block format
-- ([{ type:'text', value:'<html>' }, ...]) so screenshots and formatting are
-- preserved, mirroring `lessons.comments`.
--
-- Tenant-scoped exactly like every other data table: tenant_id defaults to the
-- request's JWT claim, RLS isolates rows, and the authenticated role gets the
-- standard grants. Admin-only actions (resolve/reopen/delete) are enforced in the
-- API route from the verified session — RLS handles isolation, not authorization.
-- See 005_multitenancy.sql for the mechanism.

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT public.app_current_tenant(),
  title        text NOT NULL,
  -- RichTextArea blocks: [{ type:'text', value:'<html>' }, ...]
  body         jsonb DEFAULT '[]'::jsonb,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  author       text DEFAULT '',            -- username who opened it (server-set)
  -- [{ id, author, body, createdAt }] — body is RichTextArea blocks
  comments     jsonb DEFAULT '[]'::jsonb,
  resolved_at  timestamptz,
  resolved_by  text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Defaults / backfill (in case the table pre-existed without the tenant default)
-- ------------------------------------------------------------
ALTER TABLE public.issues ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant();

CREATE INDEX IF NOT EXISTS idx_issues_tenant        ON public.issues(tenant_id);
CREATE INDEX IF NOT EXISTS idx_issues_tenant_status ON public.issues(tenant_id, status);

-- ------------------------------------------------------------
-- 3. RLS + grants (mirror the tenant_isolation policy used everywhere)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['issues'] LOOP
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
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'issues';  -- rowsecurity = true
--   INSERT INTO issues (title) VALUES ('smoke test');  -- as a tenant session, should set tenant_id automatically
-- ============================================================
