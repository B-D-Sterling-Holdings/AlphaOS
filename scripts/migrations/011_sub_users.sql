-- ============================================================
-- 011 — SUB-USERS (workspace owners + team members)
-- Run in the Supabase SQL Editor any time after 008_feature_access.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Until now every users row owned its own tenant (one login = one isolated
-- workspace). This migration lets several logins share ONE tenant:
--
--   * a new role 'owner' — a workspace's main account. Owners have full
--     feature access inside their own tenant and may create/manage sub-users
--     (role 'user') in that tenant — and ONLY that tenant.
--   * `created_by` — audit column recording which login created this user
--     (NULL for pre-existing rows and rows created by the bootstrap CIO
--     login, which has no users-table row).
--
-- Data isolation is untouched: a sub-user carries the tenant_id of its
-- workspace, so the RLS policies from 005_multitenancy.sql already scope it
-- to exactly that workspace's rows. Cross-workspace visibility remains
-- impossible at the database level.
--
-- 'admin' keeps its existing meaning: GLOBAL superadmin (manages every
-- workspace and user). Existing 'user'/'admin' rows behave exactly as before.
-- ------------------------------------------------------------

-- Widen the role check to allow 'owner'. The constraint was created inline in
-- 005, so it carries the default name users_role_check.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','owner','user'));

-- Who created this login. ON DELETE SET NULL: deleting a manager must never
-- block or cascade to the accounts they created.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
