-- ============================================================
-- 003 — Auto-maintain updated_at
-- ============================================================
-- Until now, updated_at only got its DEFAULT now() at INSERT and was set by hand
-- in some write paths but not others, so it was stale on many rows. This adds a
-- BEFORE UPDATE trigger to every public table that has an updated_at column
-- (prod AND demo_*), so the DB maintains it consistently. The app no longer needs
-- to set updated_at manually (harmless if it still does).
--
-- Idempotent: re-running replaces the function and re-creates triggers only where
-- missing. Also auto-covers any future table with an updated_at column.
-- ============================================================

-- Shared trigger function.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to every public table that has an updated_at column and doesn't yet
-- have the trigger.
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
      AND c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'set_updated_at_' || r.table_name
        AND tgrelid = format('public.%I', r.table_name)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
        'set_updated_at_' || r.table_name, r.table_name
      );
    END IF;
  END LOOP;
END $$;

-- ---------- Verify ----------
--   SELECT event_object_table, trigger_name
--   FROM information_schema.triggers
--   WHERE trigger_name LIKE 'set_updated_at_%'
--   ORDER BY event_object_table;
