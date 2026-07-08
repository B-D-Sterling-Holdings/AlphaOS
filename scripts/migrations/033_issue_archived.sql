-- ============================================================
-- 033 — Issue archiving (the "Archived" tab in the Issues widget)
-- Run in the Supabase SQL Editor AFTER 010_issues.sql (any time after).
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds `archived_at` to `issues` so an admin can archive an issue — tucking it
-- out of the Open / Closed / Dev tabs into a dedicated "Archived" tab
-- (UI in src/components/IssuesWidget.jsx, actions in src/app/api/issues/route.js).
--
-- Archiving is ORTHOGONAL to status: an open OR a resolved issue can be
-- archived. `archived_at IS NULL` means "not archived"; a timestamp records
-- when it was archived (shown as "archived N ago"). Unarchiving sets it back
-- to NULL. The archive/unarchive actions are admin-only, enforced in the API
-- from the verified session (RLS handles tenant isolation, not authorization).
--
-- DEPLOY ORDER: the app degrades gracefully before this runs — GET selects all
-- columns, so a missing `archived_at` simply reads as "not archived" everywhere
-- and the widget works exactly as before. The Archive button only starts
-- succeeding once this column exists. Safe to run anytime.
-- ------------------------------------------------------------

ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Partial index: the Archived tab reads only the (usually small) set of
-- archived rows, and every other tab filters them out.
CREATE INDEX IF NOT EXISTS idx_issues_tenant_archived
  ON public.issues(tenant_id, archived_at)
  WHERE archived_at IS NOT NULL;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'issues' AND column_name = 'archived_at';  -- one row
-- ============================================================
