import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabaseAdmin';
import { getTenantClient } from './supabaseTenant';
import { SESSION_COOKIE_NAME, verifySession } from './auth';
import { getUserAuthState } from './users';

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

  Storage still runs through the service-role client (it has its own RLS), with
  object paths prefixed by `storagePrefix` (`<tenant_id>/...`) for isolation.

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
  return {
    userId: session.userId,
    username: session.username,
    tenantId: session.tenantId,
    role: session.role === 'admin' ? 'admin' : 'user',
  };
}

// Returns a tenant-scoped facade over Supabase. `.from()`/`.rpc()` are RLS-scoped
// to the caller's tenant; `.storage` is the service-role client (prefix paths
// with `storagePrefix`).
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
    storagePrefix: `${tenantId}/`,
    from(table) {
      return client.from(table);
    },
    get storage() {
      // Storage bypasses table RLS; isolation is by `storagePrefix` path.
      return supabaseAdmin.storage;
    },
    rpc(...args) {
      return client.rpc(...args);
    },
  };
}
