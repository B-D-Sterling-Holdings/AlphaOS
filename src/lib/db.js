import { cookies } from 'next/headers';
import { supabaseAdmin as supabase } from './supabaseAdmin';
import { SESSION_COOKIE_NAME, verifySession } from './auth';

/*
  Request-scoped, account-aware data access.

  The app is single-tenant for production (CIO Alpha). A separate "demo" account
  must never read or write production data, so every demo query is transparently
  routed to a parallel set of `demo_*` tables (see scripts/demo-schema.sql).

  Usage in a route handler or server-side lib function:

      import { getDb } from '@/lib/db';
      const supabase = await getDb();        // keep the name `supabase`
      await supabase.from('tasks').select('*');   // -> demo_tasks for demo sessions

  Production resolves to an empty prefix, so its queries are byte-identical to
  before. A demo session can never *name* a production table, which makes
  cross-contamination structurally impossible.

  Note on RLS: RLS is enabled on all public tables with no anon policies, so the
  public anon key (shipped to the browser) cannot touch the DB directly. Server
  access runs through the service-role client (supabaseAdmin), which bypasses RLS.
  The app authenticates with its own JWT (not a Supabase Auth session), so there
  is no auth.uid() for RLS to key off — demo/prod isolation is enforced here, at
  the data-access layer, via the demo_ table prefix. See scripts/migrations/001_enable_rls.sql.
*/

const DEMO_PREFIX = 'demo_';
const DEMO_STORAGE_PREFIX = 'demo/';

// Resolve the account type from the verified session cookie. Defaults to 'prod'
// (also covers older tokens issued before the accountType claim existed).
export async function getAccountType() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return 'prod';
    const session = await verifySession(token);
    return session?.accountType === 'demo' ? 'demo' : 'prod';
  } catch {
    return 'prod';
  }
}

function resolveTable(table, isDemo) {
  if (!isDemo) return table;
  // Guard against accidental double-prefixing.
  return table.startsWith(DEMO_PREFIX) ? table : DEMO_PREFIX + table;
}

// Returns an account-aware facade over the shared Supabase client. `.from()` is
// table-prefixed for demo sessions; `.storage` is passed through (callers prefix
// object paths with `storagePrefix`).
export async function getDb() {
  const accountType = await getAccountType();
  const isDemo = accountType === 'demo';

  return {
    accountType,
    isDemo,
    storagePrefix: isDemo ? DEMO_STORAGE_PREFIX : '',
    from(table) {
      return supabase.from(resolveTable(table, isDemo));
    },
    get storage() {
      return supabase.storage;
    },
    rpc(...args) {
      return supabase.rpc(...args);
    },
  };
}
