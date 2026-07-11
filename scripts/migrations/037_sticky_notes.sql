-- ============================================================
-- 037 — STICKY NOTES (global, floating, per-user workspace layer)
-- Run in the Supabase SQL Editor AFTER 005_multitenancy.sql and 031_occ_all_tables.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds the table behind the app-wide Sticky Notes feature — the little "NOTES"
-- tab pinned to every page (see src/components/StickyNotes.jsx). It is a
-- persistent, Windows-Sticky-Notes-style workspace layer: users jot free-form
-- notes, search them, and PIN any of them as a floating card that rides on top
-- of every page. Because a note's whole UI state lives here, a pinned note comes
-- back exactly where it was — same spot, size, colour, minimized/open state —
-- across navigation, refreshes and future sessions.
--
--   sticky_notes — one row per note. Carries the content (title, body, colour)
--            AND the floating card's UI state (pinned, minimized, position,
--            size, stacking order). `created_by` scopes notes to the person who
--            made them, so this reads as a personal layer rather than a shared
--            board (visibility scoping is done in the route; RLS below is the
--            hard tenant boundary, same as every other table).
--
-- Optimistic concurrency: a `version` column + the shared bump_version trigger
-- (see 030/031) make every edit a compare-and-swap, so two tabs (or two writers)
-- touching the same note never silently clobber each other — the loser gets a
-- 409 and reloads. Created AFTER 031, so the generic trigger-attach loop is
-- re-run here to pick this table up.
--
-- Tenant-scoped exactly like every other data table: tenant_id defaults to the
-- request's JWT claim, RLS isolates rows, the authenticated role gets the
-- standard grants. See 005_multitenancy.sql for the mechanism.

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sticky_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT public.app_current_tenant(),
  -- Owning app user id (session subject). Product-level scoping only — the hard
  -- isolation boundary is tenant_id via RLS below. '' for legacy/unknown.
  created_by  text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  -- optional ticker the note is about (uppercased, '' when none) — shown as a
  -- chip and included in the panel's search.
  ticker      text NOT NULL DEFAULT '',
  -- one of the named palette colours (see src/lib/stickyNotesApi.js), default yellow
  color       text NOT NULL DEFAULT 'yellow',
  -- floating-card UI state ---------------------------------------------------
  pinned      boolean NOT NULL DEFAULT false,   -- shown as a floating card?
  minimized   boolean NOT NULL DEFAULT false,   -- collapsed to its title bar?
  pos_x       numeric NOT NULL DEFAULT 80,       -- left, px from viewport edge
  pos_y       numeric NOT NULL DEFAULT 120,      -- top,  px from viewport edge
  width       numeric NOT NULL DEFAULT 280,
  height      numeric NOT NULL DEFAULT 260,
  z           numeric NOT NULL DEFAULT 0,        -- stacking order among cards
  -- --------------------------------------------------------------------------
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Defaults / columns (in case the table pre-existed)
-- ------------------------------------------------------------
ALTER TABLE public.sticky_notes
  ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant();
ALTER TABLE public.sticky_notes
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT '';
ALTER TABLE public.sticky_notes
  ADD COLUMN IF NOT EXISTS ticker text NOT NULL DEFAULT '';
ALTER TABLE public.sticky_notes
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Guard the colour column the same way 027 guards the other enum-likes.
ALTER TABLE public.sticky_notes DROP CONSTRAINT IF EXISTS sticky_notes_color_check;
ALTER TABLE public.sticky_notes ADD  CONSTRAINT sticky_notes_color_check
  CHECK (color IN ('yellow','green','blue','pink','purple','gray'));

CREATE INDEX IF NOT EXISTS idx_sticky_notes_tenant
  ON public.sticky_notes(tenant_id);
-- The panel loads one user's notes, most-recently-updated first.
CREATE INDEX IF NOT EXISTS idx_sticky_notes_tenant_owner
  ON public.sticky_notes(tenant_id, created_by, updated_at DESC);

-- ------------------------------------------------------------
-- 3. RLS + grants (mirror the tenant_isolation policy used everywhere)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sticky_notes'] LOOP
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
-- 4. Attach the shared bump_version trigger (same generic loop as 030/031/035).
--    sticky_notes was created after 031, so re-run the attach so its `version`
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
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'sticky_notes'; -- rowsecurity = true
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.sticky_notes'::regclass; -- bump_version_sticky_notes
--   INSERT INTO sticky_notes (title, body) VALUES ('hello', 'world');             -- tenant_id auto-set
-- ============================================================
