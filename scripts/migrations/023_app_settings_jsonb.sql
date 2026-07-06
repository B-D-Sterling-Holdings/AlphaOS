-- ============================================================
-- 023 — app_settings.value : TEXT -> JSONB
-- Run in the Supabase SQL Editor AFTER 022_drop_legacy_prism_rag_demo.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHY
-- ---
-- `app_settings` is the per-tenant key/value store (task_boards, assignees,
-- saved_emails, activeWatchlistId, fund-accounting-state, …). `value` was TEXT
-- holding JSON that each route had to JSON.stringify in and JSON.parse out — the
-- one config store that wasn't native JSONB, so it couldn't be queried, indexed,
-- or partially updated, and the whole blob was rewritten on every change.
--
-- This converts `value` to JSONB. Most rows already hold valid JSON text (a
-- stringified object/array) and convert directly; a few hold a BARE string
-- (e.g. activeWatchlistId = 'default', which is NOT valid JSON on its own) and
-- are wrapped into a JSON string ("default"). The helper below handles both.
--
-- DEPLOY ORDER (low-risk either way — the app's readers already tolerate both a
-- JSON string and a parsed value): deploy the app code that stops stringifying,
-- then run this. Running it first is also safe — old code writing a stringified
-- value into JSONB just stores a JSON-string, which the readers still parse.
-- ------------------------------------------------------------

-- Convert TEXT -> JSONB, tolerating bare (non-JSON) strings.
-- t::jsonb parses valid JSON; anything that fails (a plain word like 'default')
-- falls back to to_jsonb(t), i.e. a JSON string.
CREATE OR REPLACE FUNCTION public._app_settings_text_to_jsonb(t text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF t IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN t::jsonb;
  EXCEPTION WHEN others THEN
    RETURN to_jsonb(t);
  END;
END;
$$;

-- Only convert if it's still TEXT (re-runs are a no-op once it's JSONB).
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_settings'
      AND column_name = 'value'
  ) = 'text' THEN
    EXECUTE $ddl$
      ALTER TABLE public.app_settings
        ALTER COLUMN value TYPE jsonb
        USING public._app_settings_text_to_jsonb(value)
    $ddl$;
    RAISE NOTICE 'app_settings.value converted TEXT -> JSONB';
  ELSE
    RAISE NOTICE 'app_settings.value already JSONB; nothing to do';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public._app_settings_text_to_jsonb(text);

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT data_type FROM information_schema.columns
--   WHERE table_name = 'app_settings' AND column_name = 'value';   -- expect: jsonb
--
--   -- values should be real JSON now (objects/arrays/strings), not text blobs:
--   SELECT key, jsonb_typeof(value) FROM app_settings ORDER BY key;
-- ============================================================
