/*
  Provision the demo login (idempotent — safe to re-run any time).

    node --env-file=.env.local scripts/provision-demo.mjs
    node --env-file=.env.local --conditions=react-server scripts/provision-demo.mjs  # also seeds data now

  Creates the reserved Demo tenant (fixed UUID from migration 005) if missing
  and a `demo` / `demo` user bound to it, exactly like a user-management user:
  a users-table row that the normal login route authenticates. The row is
  flagged is_demo=true, which makes the login route wipe + re-seed the tenant
  on every successful demo login (src/lib/demoSeed.js).

  Seeding itself normally happens at first login. Run with
  `--conditions=react-server` to also seed immediately from this script
  (that flag lets Node import the app's server-only modules).
*/

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const DEMO_TENANT_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_USERNAME = 'demo';
const DEMO_PASSWORD = 'demo';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// 1. Reserved demo tenant (no-op if migration 005 already created it).
{
  const { error } = await supabase
    .from('tenants')
    .upsert({ id: DEMO_TENANT_ID, name: 'Demo', is_demo: true }, { onConflict: 'id' });
  if (error) throw new Error(`tenant upsert: ${error.message}`);
  console.log(`✓ demo tenant ${DEMO_TENANT_ID}`);
}

// 2. The demo user — same shape user management creates, pinned to the demo
//    tenant. Password intentionally short ("demo"): this is a showcase login.
{
  const password_hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const { data: existing, error: fErr } = await supabase
    .from('users')
    .select('id, tenant_id')
    .ilike('username', DEMO_USERNAME)
    .maybeSingle();
  if (fErr) throw new Error(`user lookup: ${fErr.message}`);

  if (existing) {
    const { error } = await supabase
      .from('users')
      .update({
        password_hash,
        role: 'user',
        tenant_id: DEMO_TENANT_ID,
        is_demo: true,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) throw new Error(`user update: ${error.message}`);
    console.log(`✓ demo user refreshed (id ${existing.id})`);
  } else {
    const { data, error } = await supabase
      .from('users')
      .insert({
        username: DEMO_USERNAME,
        password_hash,
        role: 'user',
        tenant_id: DEMO_TENANT_ID,
        is_demo: true,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`user insert: ${error.message}`);
    console.log(`✓ demo user created (id ${data.id})`);
  }
}

// 3. Optional immediate seed (works when run with --conditions=react-server).
try {
  const { resetDemoTenant } = await import('../src/lib/demoSeed.js');
  console.log('Seeding demo dataset…');
  await resetDemoTenant({ force: true });
  console.log('✓ demo tenant seeded');
} catch (err) {
  console.log(`Seed skipped (${err.message.split('\n')[0]})`);
  console.log('  → data will seed automatically on the first demo login, or re-run with --conditions=react-server');
}

console.log('\nDone. Log in with demo / demo — every login resets to the showcase dataset.');
