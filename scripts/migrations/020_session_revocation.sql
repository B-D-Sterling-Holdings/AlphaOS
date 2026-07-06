-- ============================================================
-- 020 — SESSION REVOCATION FLOOR (logout + bootstrap admin)
-- Run in the Supabase SQL Editor AFTER 019_lock_views.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHY
-- ---
-- Sessions are stateless 7-day JWTs. Disabling a managed user already cuts
-- their data access within ~30 s (the is_active re-check in src/lib/db.js),
-- but two gaps remained (audit finding F6):
--   * "Log out" only cleared the cookie — a token already copied elsewhere
--     stayed valid until it expired.
--   * The bootstrap CIO admin has no `users` row, so nothing could revoke a
--     leaked bootstrap session short of rotating AUTH_JWT_SECRET (which logs
--     everyone out).
--
-- WHAT
-- ----
-- A tiny service-role-only table recording, per subject, a "not before"
-- instant. Any session JWT issued (iat) before that instant is rejected by
-- getSession()/`/api/auth/me`. Logout stamps now() for the caller's subject;
-- an admin action can stamp the bootstrap 'cio-admin' subject too. The check
-- reuses the existing 30 s revocation cache, so it adds no per-request DB hit.
--
-- `subject` is the session's userId: a users.id UUID for managed logins, or
-- the literal string 'cio-admin' for the bootstrap admin — hence text, and no
-- foreign key (the bootstrap subject has no users row).
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_revocations (
  subject     text PRIMARY KEY,
  not_before  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Service-role only: RLS on + forced, no policies, no anon/authenticated grant.
ALTER TABLE auth_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_revocations FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON auth_revocations FROM anon, authenticated;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT subject, not_before FROM auth_revocations;   -- (service role only)
--   -- anon/authenticated must be denied entirely:
--   --   curl "$SUPABASE_URL/rest/v1/auth_revocations?select=*" \
--   --     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"   -> 401/permission denied
-- ============================================================
