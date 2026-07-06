-- ============================================================
-- 028 — Reconcile macro_regime_results.run_id -> runs FK (ON DELETE SET NULL)
-- Run in the Supabase SQL Editor AFTER 027_enum_check_constraints.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHY
-- ---
-- The live DB has a HARD foreign key macro_regime_results.run_id ->
-- macro_regime_runs(id) with NO action, while the schema comment historically
-- called it a "soft reference". That mismatch is what forced the brittle
-- "always delete results before runs" ordering (demo wipe, workspace purge,
-- retention pruning) — deleting a run first aborts on an FK violation.
--
-- WHAT
-- ----
-- Keep the FK (it's a real relationship worth enforcing) but make it
-- ON DELETE SET NULL: deleting a run simply nulls the reference on any result
-- that still points at it, instead of erroring. Retention still keeps more runs
-- (5) than results (3), so in normal operation a run outlives its result and
-- this never fires — it's the safety net that removes the ordering fragility.
--
-- Results still carry their own backtest/metrics/plots, so a null run_id loses
-- nothing the app renders (the results route never joins back to runs).
-- ------------------------------------------------------------

DO $$
DECLARE
  fk_name text;
BEGIN
  IF to_regclass('public.macro_regime_results') IS NULL THEN RETURN; END IF;

  -- Find the existing FK on run_id (name may vary by how it was created).
  SELECT c.conname INTO fk_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.macro_regime_results'::regclass
    AND c.contype = 'f'
    AND a.attname = 'run_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.macro_regime_results DROP CONSTRAINT %I', fk_name);
  END IF;

  -- Re-add with ON DELETE SET NULL under a stable name.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.macro_regime_results'::regclass
      AND conname = 'macro_regime_results_run_id_fkey'
  ) THEN
    ALTER TABLE public.macro_regime_results
      ADD CONSTRAINT macro_regime_results_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES public.macro_regime_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'macro_regime_results'::regclass AND contype = 'f';
--   -- expect: FOREIGN KEY (run_id) REFERENCES macro_regime_runs(id) ON DELETE SET NULL
-- ============================================================
