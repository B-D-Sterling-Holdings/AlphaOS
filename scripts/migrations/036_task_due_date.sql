-- ============================================================
-- 036 — TASK DUE DATE (weekly planner)
-- Run in the Supabase SQL Editor AFTER 000_initial_schema.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds a single optional `due_date` to the firm-wide `tasks` board so a task can
-- be scheduled onto a specific day. This backs the new "Week" view on /tasks —
-- a Mon–Sun calendar grid where each task lands in the column for its due_date.
-- Tasks with no due_date stay in the "Backlog" rail; setting/clearing the date
-- (by dragging a card between days, or into the backlog) is a normal task edit.
--
-- The column is intentionally a DATE, not a timestamp: the planner is day-grained
-- ("what am I doing Tuesday"), so there is no time-of-day component to store.
--
-- Nothing else about the tasks board changes — priority, board_id, subtasks,
-- assignees, and the optimistic-concurrency `version` column are all untouched.
-- Existing rows get NULL (i.e. undated → Backlog), which is the correct default.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS due_date date;

-- The Week view loads one board's dated tasks and buckets them by day.
CREATE INDEX IF NOT EXISTS idx_tasks_board_due
  ON public.tasks(board_id, due_date);

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'tasks' AND column_name = 'due_date';   -- data_type = date
--   UPDATE tasks SET due_date = current_date WHERE FALSE;         -- column accepts a date
-- ============================================================
