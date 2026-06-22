import 'server-only';
import { createClient } from '@supabase/supabase-js';

/*
  Server-only Supabase client using the service-role key.

  This key BYPASSES Row Level Security, so it must never reach the browser. The
  `server-only` import above makes the build fail if any client component pulls
  this module into its bundle.

  Why this exists: the app authenticates with its own JWT cookie (see lib/auth.js),
  not Supabase Auth, so there is no auth.uid() for RLS to key off. We therefore
  enable RLS with no anon policies (locking the public anon key out of the DB) and
  let all *server* access run through this trusted client instead. The browser can
  no longer read/write tables directly; everything goes through API routes.

  See scripts/migrations/001_enable_rls.sql for the matching lockdown migration.
*/

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder';

if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL)
) {
  // Fail loud rather than silently falling back to a placeholder in prod.
  throw new Error(
    'supabaseAdmin: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
