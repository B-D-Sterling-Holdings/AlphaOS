-- ============================================================
-- 021 — PRIVATE STORAGE BUCKETS (close audit finding F3)
-- Run in the Supabase SQL Editor AFTER 020_session_revocation.sql.
-- Idempotent: safe to run repeatedly; never touches stored objects.
-- ============================================================
--
-- ⚠️ DEPLOY ORDER — this migration breaks every old public object URL, so:
--   1. Deploy the app code that serves /api/storage/object (signed-URL
--      redirect) and stores app-relative URLs (branch auth_design).
--   2. Run `node --env-file=.env.local scripts/migrate-storage-urls.mjs`
--      to rewrite public URLs already persisted in content rows.
--   3. THEN run this file. (Running it first leaves the still-deployed old
--      code rendering public URLs that now 400.)
--
-- WHY
-- ---
-- Table data is isolated by RLS, but the two storage buckets were PUBLIC-read
-- with only the unguessable `<tenant_id>/` path prefix as protection. Any
-- leaked full URL (browser history, logs, copied links, exports, referrers)
-- was readable by anyone, forever.
--
-- WHAT
-- ----
-- 1. Flip both buckets to private. Public object URLs stop resolving.
-- 2. Drop the public-read policies on storage.objects (public INSERT/DELETE
--    were already dropped by 004). With no policies, anon/authenticated get
--    nothing; the service role bypasses storage RLS.
--
-- Reads now flow exclusively through the app: content references the stable,
-- session-gated URL `/api/storage/object?bucket=…&path=…`, which validates
-- the session + tenant prefix (src/lib/storage.js) and 302-redirects to a
-- short-lived signed URL (5 min in-app, 7 days for URLs minted into reminder
-- emails at send time). Signed URLs are minted by the service-role client and
-- work regardless of bucket privacy, so the new code also runs fine BEFORE
-- this migration — that is what makes the staged cutover safe.
-- ------------------------------------------------------------

UPDATE storage.buckets
SET public = false
WHERE id IN ('documents', 'research-images');

DROP POLICY IF EXISTS "Allow public read on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read on research-images" ON storage.objects;

-- Belt-and-suspenders: make sure no stray write policies survived either
-- (004 dropped these; re-dropping is a no-op).
DROP POLICY IF EXISTS "Allow public insert on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert on research-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on research-images" ON storage.objects;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT id, public FROM storage.buckets
--   WHERE id IN ('documents','research-images');       -- expect public = false, false
--
--   SELECT policyname FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects'
--     AND policyname ILIKE '%documents%' OR policyname ILIKE '%research-images%';
--                                                      -- expect 0 rows
--
--   -- live proof: an old public URL must now be refused —
--   --   curl -i "$SUPABASE_URL/storage/v1/object/public/documents/<any-known-path>"
--   --   -> 400/404 (not 200)
--   -- while the app still serves it via /api/storage/object with a session.
-- ============================================================
