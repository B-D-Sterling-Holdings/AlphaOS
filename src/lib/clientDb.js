import { supabase } from './supabase';

/*
  Client-side counterpart to src/lib/db.js.

  A few client components (e.g. AccountingTool) talk to Supabase directly with the
  anon key, bypassing the server-side getDb() switch. To keep demo sessions isolated
  they must route to the same demo_* tables. Pass the accountType from useAuth():

      const db = clientDb(accountType);
      db.from('app_settings')...   // -> demo_app_settings for demo sessions

  Safe to call before auth resolves: AuthGate blocks rendering until the session
  (and accountType) is known, so consumers mount with the correct value.
*/

const DEMO_PREFIX = 'demo_';

export function clientDb(accountType) {
  const isDemo = accountType === 'demo';
  const resolve = (t) => (isDemo && !t.startsWith(DEMO_PREFIX) ? DEMO_PREFIX + t : t);
  return {
    isDemo,
    from(table) {
      return supabase.from(resolve(table));
    },
    get storage() {
      return supabase.storage;
    },
  };
}
