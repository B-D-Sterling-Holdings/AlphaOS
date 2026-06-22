-- ============================================================
-- 004 — Tighten storage bucket policies
-- ============================================================
-- The 'documents' and 'research-images' buckets had public INSERT and DELETE
-- policies, meaning anyone could upload or delete objects directly via the
-- storage API. Uploads and deletes now go through the server's service-role
-- client (src/lib/db.js getDb().storage), which bypasses storage RLS — so the
-- public write policies are unnecessary attack surface.
--
-- This keeps public READ (so getPublicUrl() links still resolve) and removes
-- public INSERT/DELETE. Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS "Allow public insert on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on documents" ON storage.objects;

DROP POLICY IF EXISTS "Allow public insert on research-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on research-images" ON storage.objects;

-- ---------- Verify ----------
--   SELECT policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--   ORDER BY policyname;
-- Expect only the two "Allow public read ..." (SELECT) policies to remain.
