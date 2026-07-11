-- ============================================================
-- 038 — Drop the `ideas` table (Workspace feature removed)
-- ============================================================
-- The Workspace section (the /workspace "Ideas" board and its /api/ideas route)
-- was removed on 2026-07-11 — its sticky-note-style jotting is superseded by the
-- app-wide Sticky Notes layer (src/components/StickyNotes.jsx, `sticky_notes`
-- table, migration 037). With the page, API route, feature gate, nav item and
-- demo seed all gone, nothing in `src/` reads or writes `ideas` anymore, so its
-- rows are dead data.
--
-- `ideas` was a per-tenant table (title/content/color/category/tags/pinned/
-- archived/position) carrying the OCC `version` column + `bump_version` trigger
-- from migration 031. CASCADE drops the tenant_isolation policy, the grants, and
-- the bump_version_ideas trigger along with it.
--
-- No app dependency and no deploy-order note: the code that referenced the table
-- is already gone, so this is safe to run anytime. Idempotent — safe to re-run.
-- This DOES delete data (every tenant's Workspace notes); that is the intent.
-- ============================================================

DROP TABLE IF EXISTS public.ideas CASCADE;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT to_regclass('public.ideas');  -- NULL once dropped
-- ============================================================
