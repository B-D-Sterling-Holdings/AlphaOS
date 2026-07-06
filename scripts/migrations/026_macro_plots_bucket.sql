-- ============================================================
-- 026 — macro-plots storage bucket (move plot PNGs out of JSONB)
-- Run in the Supabase SQL Editor AFTER 025_tenant_composite_indexes.sql.
-- Idempotent: safe to run repeatedly; never touches stored objects.
-- ============================================================
--
-- WHY
-- ---
-- `macro_regime_results.plots` stored whole PNGs as base64 inside JSONB, so a
-- single results row was megabytes and a careless `SELECT *` pulled all of it.
-- Plots now live in a private storage bucket; the row keeps only
-- `{ filename: "<tenant_id>/<run_id>/<file>.png" }` path strings.
--
-- WHAT
-- ----
-- 1. Create the private `macro-plots` bucket (same model as documents /
--    research-images: private, no anon/authenticated policies — every
--    read/write goes through the service-role client behind src/lib/storage.js
--    and /api/macro-regime/plots, which sign short-lived URLs).
--
-- DEPLOY ORDER:
--   1. Run this migration (creates the bucket).
--   2. Deploy the app code (writer uploads to the bucket + stores paths; the
--      reader route already handles BOTH new paths and legacy base64, so a
--      pre-backfill row still renders).
--   3. Backfill existing rows out of base64 with:
--        node --env-file=.env.local scripts/migrate-macro-plots.mjs
--      (safe to run repeatedly; skips rows already migrated).
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('macro-plots', 'macro-plots', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- No policies: anon/authenticated get nothing; the service role bypasses
-- storage RLS. (Belt-and-suspenders drops in case a public policy was ever
-- hand-added in the dashboard.)
DROP POLICY IF EXISTS "Allow public read on macro-plots"   ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert on macro-plots" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on macro-plots" ON storage.objects;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT id, public FROM storage.buckets WHERE id = 'macro-plots';  -- public=false
-- ============================================================
