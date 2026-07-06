-- ============================================================
-- 030 — Optimistic concurrency (version guard on document rows)
-- ============================================================
-- The "document-shaped" tables are read whole into the browser, edited, and
-- written back whole (theses, watchlists, valuation_models, and the
-- single-blob app_settings rows like fund-accounting-state). Two people — or one
-- person in two tabs — editing the same row would otherwise SILENTLY overwrite
-- each other: last write wins, the other's work is gone.
--
-- This adds a monotonic `version` counter to each such table plus a BEFORE UPDATE
-- trigger that increments it on every update. The app then saves with a
-- compare-and-swap:  UPDATE ... WHERE version = <base>.  A writer whose base is
-- stale matches ZERO rows and is told to reload + re-apply (HTTP 409) instead of
-- clobbering the concurrent writer. See src/lib/concurrency.js and
-- docs/DATABASE_ARCHITECTURE.md §11.
--
-- Row versioning starts at 1 (existing rows are backfilled to 1 by the DEFAULT).
-- The app represents "no row yet" as base 0, which routes to an INSERT (a losing
-- INSERT trips the per-tenant unique key and is reported as a conflict).
--
-- Deploy order: SHIP THE APP CODE FIRST. Until this migration runs, GET
-- responses omit `version`, clients send no base version, and the server falls
-- back to the historical unguarded upsert — behaviour identical to today. Once
-- applied, every document GET returns a version and every save is guarded. There
-- is no hard cutover and no data backfill beyond the column default.
--
-- Idempotent: column adds are IF NOT EXISTS; the trigger DO-loop attaches to any
-- public BASE TABLE that has a `version` column and lacks the trigger, so it also
-- auto-covers any future table given a `version` column (mirrors migration 003).
-- ============================================================

ALTER TABLE public.theses           ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.watchlists       ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.valuation_models ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.app_settings     ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Shared trigger function: advance version on every UPDATE. Guarded so an
-- explicit app-supplied version (which the app never sends today) is not double
-- bumped; in practice the app omits `version` from update payloads and this
-- always runs.
CREATE OR REPLACE FUNCTION public.bump_version()
RETURNS trigger AS $$
BEGIN
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to every public table that has a `version` column and lacks the trigger.
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
      AND c.column_name = 'version'
      AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'bump_version_' || r.table_name
        AND tgrelid = format('public.%I', r.table_name)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.bump_version();',
        'bump_version_' || r.table_name, r.table_name
      );
    END IF;
  END LOOP;
END $$;

-- ---------- Verify ----------
--   SELECT event_object_table, trigger_name
--   FROM information_schema.triggers
--   WHERE trigger_name LIKE 'bump_version_%'
--   ORDER BY event_object_table;
--
--   -- version advances on update, holds on insert:
--   -- SELECT version FROM theses WHERE ticker = 'AAPL';   -- e.g. 1
--   -- UPDATE theses SET valuation = valuation WHERE ticker = 'AAPL';
--   -- SELECT version FROM theses WHERE ticker = 'AAPL';   -- now 2
