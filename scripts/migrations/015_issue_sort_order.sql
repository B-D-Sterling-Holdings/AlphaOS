-- ============================================================
-- 015 — ISSUE MANUAL ORDER (Dev-tab reordering within a priority)
-- Run in the Supabase SQL Editor AFTER 014_issue_dev_triage.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Supports the up/down chevrons in the admin-only "Dev" tab of the Issues UI
-- (src/components/IssuesWidget.jsx) — the same reorder pattern as Strategic
-- Hub's Position Overview: rows sort by priority first, then by this manual
-- order within each priority band.
--
--   issues.sort_order — integer rank inside a priority band (lower = higher
--                       on the list; ties fall back to newest-first). Written
--                       by the API's admin-only "sort-order" action; stripped
--                       from GET responses for non-admin sessions along with
--                       the rest of the triage state.

ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT number, title, priority, sort_order FROM issues
--   ORDER BY priority NULLS LAST, sort_order, created_at DESC;
-- ============================================================
