/*
  Role registry — the single source of truth for what each account role may do.

  Deliberately framework-neutral (no 'use client', no 'server-only', no
  node/edge-only imports) so the SAME definitions can be used by the edge
  middleware, server API routes and client components — mirroring
  src/lib/features.js.

  'admin' — global superadmin. Manages every workspace and every user; never
            feature-restricted. The bootstrap CIO login is an admin.
  'owner' — a workspace's main account. Full feature access to its own
            tenant's data; creates and manages the sub-users of that tenant
            and ONLY that tenant (enforced server-side in the users API).
  'user'  — a workspace member (sub-user), or a legacy standalone login.
            Sees only the features an admin/owner left enabled.
*/

export const ROLES = ['admin', 'owner', 'user'];

/** Collapse any stored/claimed role onto a known one (unknown → 'user'). */
export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'user';
}

/** Admins and workspace owners are never feature-restricted. */
export function isUnrestrictedRole(role) {
  return role === 'admin' || role === 'owner';
}

/**
 * May this role open /admin and call the user-management API at all?
 * Owners are additionally scoped to their own tenant server-side — this only
 * answers "is the door open", not "which users may they touch".
 */
export function canManageUsers(role) {
  return role === 'admin' || role === 'owner';
}
