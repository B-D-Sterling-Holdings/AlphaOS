-- ============================================================
-- 017 — ISSUE COMPLEXITY SCALE 1..5 (adds "Very hard")
-- Run in the Supabase SQL Editor AFTER 016_issue_complexity.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- 016 created issues.complexity with CHECK 1..4. The Dev tab's Complexity
-- pill now has five levels — 1 = trivial, 2 = easy, 3 = moderate, 4 = hard,
-- 5 = very hard (NULL = not sized yet) — so the constraint is widened to 1..5.
-- Existing values are untouched.

ALTER TABLE public.issues DROP CONSTRAINT IF EXISTS issues_complexity_check;
ALTER TABLE public.issues ADD CONSTRAINT issues_complexity_check
  CHECK (complexity IS NULL OR complexity BETWEEN 1 AND 5);

-- ============================================================
-- VERIFY
-- ============================================================
--   UPDATE issues SET complexity = 5 WHERE number = -1;  -- no-op, must not error
-- ============================================================
