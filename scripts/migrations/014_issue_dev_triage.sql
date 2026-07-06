-- ============================================================
-- 014 — ISSUE DEV TRIAGE (admin priority + notes)
-- Run in the Supabase SQL Editor AFTER 013_issue_numbers_labels.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Supports the admin-only "Dev" tab in the Issues UI
-- (src/components/IssuesWidget.jsx): every issue ranked by priority with a
-- quick-glance triage note.
--
--   issues.priority  — smallint 1..4 (1 = urgent, 2 = high, 3 = medium,
--                      4 = low); NULL = not prioritized yet. Set by admins
--                      only (enforced in the API route, like resolve/reopen).
--
--   issues.dev_notes — free-text triage note ("what I think of it at a
--                      glance"). Admin-only: the API strips both fields from
--                      GET responses for non-admin sessions.

ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS priority smallint
  CHECK (priority IS NULL OR priority BETWEEN 1 AND 4);
ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS dev_notes text;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT number, title, priority, dev_notes FROM issues ORDER BY priority NULLS LAST;
-- ============================================================
