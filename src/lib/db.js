import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabaseAdmin';
import { getTenantClient } from './supabaseTenant';
import { SESSION_COOKIE_NAME, verifySession } from './auth';

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

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session?.tenantId) return null;
  return {
    userId: session.userId,
    username: session.username,
    tenantId: session.tenantId,
    role: session.role === 'admin' ? 'admin' : 'user',
    isDemo: !!session.isDemo,
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

  const { tenantId, role, isDemo, username, userId } = session;
  const client = await getTenantClient(tenantId);

  return {
    tenantId,
    role,
    isDemo,
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
