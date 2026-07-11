/*
  Role registry — the single source of truth for what each account role may do.

  Deliberately framework-neutral (no 'use client', no 'server-only', no
  node/edge-only imports) so the SAME definitions can be used by the edge
  middleware, server API routes and client components — mirroring
  src/lib/features.js.

  'admin' — global superadmin. Manages every workspace and every user; never
            feature-restricted. The bootstrap CIO login is an admin.
  'owner' — a workspace's main account. Feature-restricted by the admin like
            any other login; creates and manages the sub-users of its own
            tenant and ONLY that tenant (enforced server-side in the users
            API), and can only grant members features from its own enabled
            set.
  'user'  — a workspace member (sub-user), or a legacy standalone login.
            Sees only the features an admin/owner left enabled; manages
            nothing.

  The admin workspace (the CIO tenant) is a special case: EVERY member of it,
  whatever their stored role, is treated as an admin *within that workspace* —
  full feedback board, no feature restrictions, and user management. This is
  scoped to the CIO tenant only and never grants cross-tenant (global-admin)
  powers; callers pass `isAdminWorkspace` (tenantId === CIO_TENANT_ID) so these
  predicates can stay framework-neutral without importing the constant.
*/

export const ROLES = ['admin', 'owner', 'user'];

/** Collapse any stored/claimed role onto a known one (unknown → 'user'). */
export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'user';
}

/**
 * Never feature-restricted: global admins, and every member of the admin
 * workspace (the CIO tenant) — the internal team gets full access like the CIO.
 */
export function isUnrestrictedRole(role, isAdminWorkspace = false) {
  return role === 'admin' || isAdminWorkspace;
}

/**
 * May this role open /admin and call the user-management API at all?
 * Owners — and every member of the admin workspace — are additionally scoped to
 * their own tenant server-side; this only answers "is the door open", not
 * "which users may they touch". Cross-tenant management stays global-admin only.
 */
export function canManageUsers(role, isAdminWorkspace = false) {
  return role === 'admin' || role === 'owner' || isAdminWorkspace;
}
