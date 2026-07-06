import { cookies } from 'next/headers';
import { getTenantClient } from './supabaseTenant';
import { SESSION_COOKIE_NAME, verifySession } from './auth';
import { getUserAuthState, getSessionNotBefore } from './users';
import { normalizeRole } from './roles';

/*
  Request-scoped, tenant-aware data access.

  Every session belongs to exactly one tenant (see src/lib/auth.js). `getDb()`
  resolves that tenant from the verified session cookie and returns a facade whose
  `.from()` / `.rpc()` go through an RLS-scoped Supabase client
  (src/lib/supabaseTenant.js). The database — not this code — enforces that a
  session can only touch its own tenant's rows, so a forgotten filter cannot leak.

  Usage is unchanged from before:

      import { getDb } from '@/lib/db';
      const supabase = await getDb();
      await supabase.from('tasks').select('*');   // RLS-scoped to this tenant

  Storage is deliberately NOT exposed here: buckets are private and every
  upload/read/delete goes through the narrow, session-validating helpers in
  src/lib/storage.js (uploadTenantImage/Document, getTenantSignedUrl,
  deleteTenantImage/Document), so no route can hand-build or manipulate
  arbitrary object paths.

  Fail-closed: a request without a valid session has no tenant and gets no data
  access (throws), rather than silently falling back to a default tenant.
*/

// Session JWTs live for 7 days, so "disable user" / "delete user" must be
// enforced here too, not only at login — otherwise a revoked account keeps its
// data access until the token expires. Cached briefly so this doesn't add a DB
// round-trip to every request.
const USERS_TABLE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const activeCache = new Map(); // userId -> { active, at }
const ACTIVE_CACHE_TTL_MS = 30_000;

// Logout / "sign out everywhere" revoke sessions by stamping a not-before
// instant (migration 020). Unlike the is_active check, this also covers the
// bootstrap 'cio-admin' subject (which has no users row). Cached the same way
// so it adds no per-request round-trip.
const nbfCache = new Map(); // subject -> { notBefore: number|null, at }

async function isSessionRevoked(userId, iatSeconds) {
  if (!userId || typeof iatSeconds !== 'number') return false;
  let entry = nbfCache.get(userId);
  if (!entry || Date.now() - entry.at >= ACTIVE_CACHE_TTL_MS) {
    try {
      const nb = await getSessionNotBefore(userId);
      // Store the floor as whole seconds to match the token's `iat` precision.
      entry = { notBeforeSec: nb ? Math.floor(nb.getTime() / 1000) : null, at: Date.now() };
      nbfCache.set(userId, entry);
    } catch {
      // Transient lookup failure: don't lock everyone out — the signed JWT is
      // still required; revocation just isn't re-checked this request.
      return false;
    }
  }
  if (entry.notBeforeSec == null) return false;
  // Revoke tokens issued strictly BEFORE the revocation second. A token issued
  // in the same second as (or after) the logout survives — so a re-login right
  // after logging out is never mistaken for the revoked session.
  return iatSeconds < entry.notBeforeSec;
}

async function isUserStillActive(userId) {
  // Bootstrap env logins (e.g. 'cio-admin') have no users row to revoke.
  if (!USERS_TABLE_ID_RE.test(userId || '')) return true;
  const hit = activeCache.get(userId);
  if (hit && Date.now() - hit.at < ACTIVE_CACHE_TTL_MS) return hit.active;
  let active;
  try {
    const state = await getUserAuthState(userId);
    active = !!state?.isActive; // no row (deleted) or is_active=false ⇒ revoked
  } catch {
    // Transient lookup failure: don't take the whole app down — the signed JWT
    // is still required, revocation just isn't re-checked this request.
    return true;
  }
  activeCache.set(userId, { active, at: Date.now() });
  return active;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session?.tenantId) return null;
  if (!(await isUserStillActive(session.userId))) return null;
  // Reject tokens issued before the subject's revocation floor (logout /
  // sign-out-everywhere). Covers the bootstrap admin, which is_active can't.
  if (await isSessionRevoked(session.userId, session.iat)) return null;
  return {
    userId: session.userId,
    username: session.username,
    tenantId: session.tenantId,
    role: normalizeRole(session.role),
  };
}

// Returns a tenant-scoped facade over Supabase. `.from()`/`.rpc()` are RLS-scoped
// to the caller's tenant. For files, use src/lib/storage.js — storage access is
// intentionally absent from this facade.
export async function getDb() {
  const session = await getSession();
  if (!session) {
    throw new Error('Not authenticated: no tenant for this request.');
  }

  const { tenantId, role, username, userId } = session;
  const client = await getTenantClient(tenantId);

  return {
    tenantId,
    role,
    username,
    userId,
    isAdmin: role === 'admin',
    from(table) {
      return client.from(table);
    },
    rpc(...args) {
      return client.rpc(...args);
    },
  };
}
