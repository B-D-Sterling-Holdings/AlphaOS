-- ============================================================
-- 029 — theses.assumptions : TEXT -> JSONB
-- Run in the Supabase SQL Editor AFTER 028_results_run_fk.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHY
-- ---
-- `theses.assumptions` was TEXT holding EITHER a plain string (legacy) OR a
-- JSON-stringified rich-text block array (`[{type,value}, …]`). The thesis route
-- carried serialize/deserialize helpers to paper over the two shapes, and
-- readers that hit the column directly (e.g. the Strategic Hub) got raw JSON
-- text. Converting to JSONB lets the block array live natively; the route then
-- reads/writes it directly and `richHasContent` sees a real array.
--
-- (Only `assumptions` is converted. `valuation` is a plain string in the app —
-- verified empty in every live row — and stays TEXT.)
--
-- Existing values (verified live 2026-07-06: 7 json-array, 1 plain-string,
-- 9 empty) convert with the same tolerant rule as migration 023: text that
-- parses as JSON becomes that JSON (the '[...]' arrays); anything else becomes a
-- JSON string (the plain-string / '' rows).
--
-- DEPLOY ORDER: deploy the app code (route reads/writes assumptions natively and
-- still tolerates a string), then run this. Running it first is also safe.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._theses_assumptions_to_jsonb(t text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  BEGIN
    RETURN t::jsonb;
  EXCEPTION WHEN others THEN
    RETURN to_jsonb(t);
  END;
END;
$$;

DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'theses' AND column_name = 'assumptions'
  ) = 'text' THEN
    -- A TEXT default (e.g. '') can't auto-cast to jsonb and blocks the TYPE
    -- change, so drop it first. The app always supplies a value (the thesis
    -- route defaults to ''), so no DB-level default is needed afterward.
    ALTER TABLE public.theses ALTER COLUMN assumptions DROP DEFAULT;
    EXECUTE $ddl$
      ALTER TABLE public.theses
        ALTER COLUMN assumptions TYPE jsonb
        USING public._theses_assumptions_to_jsonb(assumptions)
    $ddl$;
    RAISE NOTICE 'theses.assumptions converted TEXT -> JSONB';
  ELSE
    RAISE NOTICE 'theses.assumptions already JSONB; nothing to do';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public._theses_assumptions_to_jsonb(text);

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT data_type FROM information_schema.columns
--   WHERE table_name='theses' AND column_name='assumptions';        -- expect: jsonb
--   SELECT ticker, jsonb_typeof(assumptions) FROM theses ORDER BY ticker;
--   -- expect a mix of 'array' (rich text) and 'string' (legacy/empty)
-- ============================================================
