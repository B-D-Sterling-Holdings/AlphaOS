-- ============================================================
-- 016 — ISSUE COMPLEXITY (admin triage: how hard is the fix)
-- Run in the Supabase SQL Editor AFTER 015_issue_sort_order.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds the "Complexity" pill next to Priority in the admin-only "Dev" tab of
-- the Issues UI (src/components/IssuesWidget.jsx).
--
--   issues.complexity — smallint 1..4 (1 = trivial, 2 = easy, 3 = moderate,
--                       4 = hard); NULL = not sized yet. Written by the API's
--                       admin-only "complexity" action; stripped from GET
--                       responses for non-admin sessions along with the rest
--                       of the triage state.

ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS complexity smallint
  CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 4);

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT number, title, priority, complexity FROM issues
--   ORDER BY priority NULLS LAST, sort_order, created_at DESC;
-- ============================================================
