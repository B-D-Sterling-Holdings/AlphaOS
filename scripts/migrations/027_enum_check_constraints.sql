-- ============================================================
-- 027 — CHECK constraints on enum-like columns
-- Run in the Supabase SQL Editor AFTER 026_macro_plots_bucket.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHY
-- ---
-- Several columns hold a small closed set of string values (a de-facto enum)
-- but were plain TEXT with only an app-side default — nothing at the DB level
-- stopped a bad value. This adds CHECK constraints for the columns whose
-- complete vocabulary is well-defined in the app (verified against live data
-- 2026-07-06: every existing row already conforms).
--
-- SCOPE / non-goals: contacts.*, interactions.type, lessons.*, ideas.* are
-- deliberately left unconstrained — their vocabularies are larger/less settled
-- (and some hold legacy empty strings), so a too-tight CHECK would risk
-- breaking valid writes. Enum sets below are supersets of what the current UI
-- writes (e.g. action keeps the retired 'watch'; sentiment stays on the live
-- uneasy/neutral/feeling_good vocabulary — the old bullish/bearish wording is
-- dead in code) so nothing legitimate is ever rejected.
--
-- Each column is nullable-tolerant (`col IS NULL OR …`) so a NULL never trips
-- the constraint. All are added VALIDATED (existing data was checked first).
-- ------------------------------------------------------------

DO $$
BEGIN
  -- strategic_notes --------------------------------------------------------
  ALTER TABLE public.strategic_notes DROP CONSTRAINT IF EXISTS strategic_notes_sentiment_check;
  ALTER TABLE public.strategic_notes ADD  CONSTRAINT strategic_notes_sentiment_check
    CHECK (sentiment IS NULL OR sentiment IN ('uneasy','neutral','feeling_good'));

  ALTER TABLE public.strategic_notes DROP CONSTRAINT IF EXISTS strategic_notes_action_check;
  ALTER TABLE public.strategic_notes ADD  CONSTRAINT strategic_notes_action_check
    CHECK (action IS NULL OR action IN ('exit','trim','hold','add','watch'));

  ALTER TABLE public.strategic_notes DROP CONSTRAINT IF EXISTS strategic_notes_priority_check;
  ALTER TABLE public.strategic_notes ADD  CONSTRAINT strategic_notes_priority_check
    CHECK (priority IS NULL OR priority IN ('low','normal','high','urgent'));

  ALTER TABLE public.strategic_notes DROP CONSTRAINT IF EXISTS strategic_notes_conviction_check;
  ALTER TABLE public.strategic_notes ADD  CONSTRAINT strategic_notes_conviction_check
    CHECK (conviction IS NULL OR conviction BETWEEN 1 AND 5);

  -- candidate_positions ----------------------------------------------------
  ALTER TABLE public.candidate_positions DROP CONSTRAINT IF EXISTS candidate_positions_status_check;
  ALTER TABLE public.candidate_positions ADD  CONSTRAINT candidate_positions_status_check
    CHECK (status IS NULL OR status IN ('researching','watching','ready','passed'));

  ALTER TABLE public.candidate_positions DROP CONSTRAINT IF EXISTS candidate_positions_sentiment_check;
  ALTER TABLE public.candidate_positions ADD  CONSTRAINT candidate_positions_sentiment_check
    CHECK (sentiment IS NULL OR sentiment IN ('uneasy','neutral','feeling_good'));

  ALTER TABLE public.candidate_positions DROP CONSTRAINT IF EXISTS candidate_positions_priority_check;
  ALTER TABLE public.candidate_positions ADD  CONSTRAINT candidate_positions_priority_check
    CHECK (priority IS NULL OR priority IN ('low','normal','high','urgent'));

  ALTER TABLE public.candidate_positions DROP CONSTRAINT IF EXISTS candidate_positions_conviction_check;
  ALTER TABLE public.candidate_positions ADD  CONSTRAINT candidate_positions_conviction_check
    CHECK (conviction IS NULL OR conviction BETWEEN 1 AND 5);

  -- tasks ------------------------------------------------------------------
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
  ALTER TABLE public.tasks ADD  CONSTRAINT tasks_priority_check
    CHECK (priority IS NULL OR priority IN ('highest','medium','low'));
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname LIKE '%_check'
--     AND conrelid IN ('strategic_notes'::regclass,'candidate_positions'::regclass,'tasks'::regclass)
--   ORDER BY tbl, conname;
-- ============================================================
