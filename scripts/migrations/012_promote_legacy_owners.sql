-- ============================================================
-- 012 — PROMOTE LEGACY SOLO LOGINS TO WORKSPACE OWNERS
-- Run in the Supabase SQL Editor any time after 011_sub_users.sql.
-- Idempotent: safe to run repeatedly; never touches data rows.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Before 011 every login was role 'user' owning its own tenant, so those
-- legacy workspaces have no 'owner' login and cannot manage a team. This
-- promotes every such login — the ONLY login of its tenant — to 'owner',
-- giving existing workspaces the same abilities as newly created ones:
-- the login gets the User Management (shield) button and can add and
-- manage members of its own workspace.
--
-- Left untouched:
--   * demo logins (is_demo) — the demo stays a locked showcase account;
--   * members of already-shared workspaces — their owner is whoever the
--     admin created as such;
--   * the CIO Alpha tenant — its owner is the built-in env login, which
--     has no users row (any member added there must stay a member).
--
-- Note: owners stay feature-restricted — any disabled_features on a
-- promoted login keep applying exactly as before. The promotion only adds
-- team management, and an owner can only grant members features from its
-- own enabled set (enforced in the users API).

UPDATE users u
SET role = 'owner', updated_at = now()
WHERE u.role = 'user'
  AND COALESCE(u.is_demo, false) = false
  AND u.tenant_id <> '11111111-1111-1111-1111-111111111111'
  AND NOT EXISTS (
    SELECT 1 FROM users o
    WHERE o.tenant_id = u.tenant_id AND o.id <> u.id
  );
