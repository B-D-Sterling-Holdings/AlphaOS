-- ============================================================
-- 035 — RESEARCH TASKS (per-company workflow to-do list)
-- Run in the Supabase SQL Editor AFTER 005_multitenancy.sql and 031_occ_all_tables.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds the table behind the shared Research Task panel — the collapsible left
-- rail that rides along on the Draft & Review, Research, and Position Review
-- pages. It is a structured to-do list scoped to ONE company: "build the model",
-- "analyze utilization rates", etc. It is deliberately separate from the
-- firm-wide `tasks` board (/tasks) — those are org-level kanban cards; these are
-- per-name research items that only make sense next to that company's thesis.
--
--   research_tasks — one row per to-do item for a ticker. Carries a status, an
--            optional assignee (the person responsible), free-form tags, and a
--            notes field. Ordered within a ticker by `position`.
--
-- Assignees are picked from the same saved-assignee roster the /tasks board uses
-- (app_settings key `assignees_research-tasks`, served by /api/assignees) — a
-- free-text name + colour, not an auth user account, matching the existing task
-- UI. So this migration adds no roster table.
--
-- Tenant-scoped exactly like every other data table: tenant_id defaults to the
-- request's JWT claim, RLS isolates rows, the authenticated role gets the
-- standard grants. See 005_multitenancy.sql for the mechanism.
--
-- Optimistic concurrency: a `version` column + the shared bump_version trigger
-- (see 030/031) make every edit a compare-and-swap, so two analysts editing the
-- same item don't clobber each other. This table is created AFTER 031, so the
-- generic trigger-attach loop is re-run here to pick it up.

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT public.app_current_tenant(),
  ticker      text NOT NULL,
  title       text NOT NULL DEFAULT '',
  notes       text DEFAULT '',
  -- todo | in_progress | blocked | done
  status      text NOT NULL DEFAULT 'todo',
  -- high | medium | low
  priority    text NOT NULL DEFAULT 'medium',
  -- saved-assignee roster NAME (see /api/assignees), '' when unassigned
  assignee    text DEFAULT '',
  -- free-form labels, e.g. ["model","valuation"]
  tags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- manual ordering within a ticker (fractional inserts allowed)
  position    numeric NOT NULL DEFAULT 0,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Defaults / constraints (in case the table pre-existed)
-- ------------------------------------------------------------
ALTER TABLE public.research_tasks
  ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant();
ALTER TABLE public.research_tasks
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.research_tasks
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

-- Guard the enum-like columns the same way 027 guards the others.
ALTER TABLE public.research_tasks DROP CONSTRAINT IF EXISTS research_tasks_status_check;
ALTER TABLE public.research_tasks ADD  CONSTRAINT research_tasks_status_check
  CHECK (status IN ('todo','in_progress','blocked','done'));
ALTER TABLE public.research_tasks DROP CONSTRAINT IF EXISTS research_tasks_priority_check;
ALTER TABLE public.research_tasks ADD  CONSTRAINT research_tasks_priority_check
  CHECK (priority IN ('high','medium','low'));

CREATE INDEX IF NOT EXISTS idx_research_tasks_tenant
  ON public.research_tasks(tenant_id);
-- The panel loads one ticker's list in display order.
CREATE INDEX IF NOT EXISTS idx_research_tasks_tenant_ticker
  ON public.research_tasks(tenant_id, ticker, position);

-- ------------------------------------------------------------
-- 3. RLS + grants (mirror the tenant_isolation policy used everywhere)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['research_tasks'] LOOP
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

-- ------------------------------------------------------------
-- 4. Attach the shared bump_version trigger (same generic loop as 030/031).
--    research_tasks was created after 031, so re-run the attach so its `version`
--    column is DB-maintained like every other OCC table.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'version'
      AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'bump_version_' || r.table_name
        AND tgrelid = format('public.%I', r.table_name)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.bump_version();',
        'bump_version_' || r.table_name, r.table_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'research_tasks';  -- rowsecurity = true
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.research_tasks'::regclass;  -- bump_version_research_tasks
--   INSERT INTO research_tasks (ticker, title) VALUES ('TEST', 'build the model');   -- tenant_id auto-set
-- ============================================================
