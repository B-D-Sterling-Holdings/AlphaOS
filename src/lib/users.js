import 'server-only';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabaseAdmin';
import { sanitizeFeatureKeys } from './features';

/*
  User + tenant management. Runs through the service-role client (BYPASSRLS)
  because the identity tables (users, tenants) are deliberately invisible to the
  authenticated role. All callers must enforce their own authz (admin-only) —
  these helpers do not.
*/

export async function findUserByUsername(username) {
  if (!username) return null;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, username, password_hash, role, tenant_id, is_active, is_demo, disabled_features')
    .ilike('username', username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

/**
 * The set of feature keys an admin has switched OFF for a user, looked up fresh
 * (so changes apply without waiting for the user's session JWT to be reissued).
 * Admins are never restricted. Unknown ids / bootstrap logins return [].
 */
export async function getDisabledFeaturesForUser(id) {
  if (!id) return [];
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role, disabled_features')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.role === 'admin') return [];
  return sanitizeFeatureKeys(data.disabled_features);
}

/**
 * Live auth state for a users-table id: whether the account is still active,
 * plus its current role and disabled features. Returns null when the id has no
 * row (deleted user — or a bootstrap login, which callers must exclude by id
 * shape before treating null as "revoked").
 */
export async function getUserAuthState(id) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role, is_active, disabled_features')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    isActive: data.is_active !== false,
    role: data.role === 'admin' ? 'admin' : 'user',
    disabledFeatures: data.role === 'admin' ? [] : sanitizeFeatureKeys(data.disabled_features),
  };
}

export async function listUsers() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, username, role, tenant_id, is_active, disabled_features, created_at, tenants(name)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    tenantId: u.tenant_id,
    tenantName: u.tenants?.name ?? null,
    isActive: u.is_active,
    disabledFeatures: sanitizeFeatureKeys(u.disabled_features),
    createdAt: u.created_at,
  }));
}

/**
 * Provision a brand-new isolated workspace: one tenant + one user, plus the
 * singleton config rows that the app expects to already exist. The new tenant
 * starts with zero rows in every other table — no per-user tables, no scripts.
 */
export async function createUser({ username, password, role = 'user' }) {
  const uname = String(username || '').trim();
  if (!uname) throw new Error('username is required');
  if (!password || String(password).length < 6) {
    throw new Error('password must be at least 6 characters');
  }
  if (!['admin', 'user'].includes(role)) throw new Error('invalid role');

  if (await findUserByUsername(uname)) {
    throw new Error(`username "${uname}" is already taken`);
  }

  // 1. tenant (the data partition)
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants')
    .insert({ name: uname })
    .select('id')
    .single();
  if (tErr) throw new Error(tErr.message);

  // 2. user
  const password_hash = bcrypt.hashSync(String(password), 10);
  const { data: user, error: uErr } = await supabaseAdmin
    .from('users')
    .insert({ username: uname, password_hash, role, tenant_id: tenant.id })
    .select('id, username, role, tenant_id')
    .single();
  if (uErr) {
    // roll back the orphan tenant on failure
    await supabaseAdmin.from('tenants').delete().eq('id', tenant.id);
    throw new Error(uErr.message);
  }

  await seedTenantDefaults(tenant.id);

  return { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id };
}

export async function setUserActive(id, isActive) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ is_active: !!isActive, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Replace the set of features switched OFF for a user. Unknown keys are dropped
 * so a malformed payload can never persist garbage. Returns the stored list.
 */
export async function setUserFeatures(id, disabledFeatures) {
  if (!id) throw new Error('id is required');
  const clean = sanitizeFeatureKeys(disabledFeatures);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ disabled_features: clean, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return clean;
}

// Every tenant-scoped data table. These carry a `tenant_id` column but (unlike
// users.tenant_id) have NO foreign key to tenants, so deleting a tenant does not
// cascade to them — deleteUser purges them explicitly to avoid orphaned rows.
const TENANT_DATA_TABLES = [
  'contacts', 'interactions', 'contact_files', 'tasks', 'app_settings',
  'research_links', 'documents', 'theses', 'valuation_models', 'holdings',
  'portfolio_cash', 'watchlists', 'ticker_fundamentals', 'ticker_prices',
  'allocation_config', 'sector_config', 'factor_config', 'fund_nav_data',
  'strategic_notes', 'candidate_positions', 'ideas',
  'prism_recommendations', 'prism_ticker_data', 'prism_ticker_documents',
  'macro_regime_config', 'macro_regime_runs', 'macro_regime_results',
  'macro_regime_weights', 'lessons', 'lesson_patterns',
];

// Storage buckets whose objects are namespaced by a `<tenant_id>/` path prefix
// (see src/lib/db.js `storagePrefix`). Storage bypasses RLS, so isolation here is
// purely by path — which is exactly why the purge below is so tightly guarded.
const STORAGE_BUCKETS = ['research-images', 'documents'];

// A tenant id MUST be a canonical UUID before it is ever used as a delete prefix.
const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Recursively collect every object path under a storage folder. `.list()` is one
// level deep; entries with a null id are sub-"folders" (virtual prefixes) we
// recurse into. Returns full object paths (e.g. `<tenant>/<ticker>/<file>`).
async function listStorageFilesUnder(bucket, folder) {
  const out = [];
  const stack = [folder];
  while (stack.length) {
    const dir = stack.pop();
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .list(dir, { limit: 100, offset });
      if (error) throw new Error(`list ${bucket}/${dir}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const entry of data) {
        const full = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.id === null) stack.push(full); // sub-folder
        else out.push(full);                      // file
      }
      if (data.length < 100) break;
    }
  }
  return out;
}

/**
 * Delete every stored object belonging to one tenant — and ONLY that tenant.
 *
 * This is intentionally not exported: the only way to reach it is through
 * deleteUser(), so a prefix-wide storage wipe can never be triggered from
 * anywhere else. It also fails closed on anything that could widen the blast
 * radius: a non-UUID tenant id is rejected outright (an empty/garbage prefix
 * would otherwise match the whole bucket), and every path is re-checked to be
 * inside `<tenantId>/` before it is removed.
 */
async function purgeTenantStorage(tenantId) {
  if (typeof tenantId !== 'string' || !TENANT_UUID_RE.test(tenantId)) {
    throw new Error('refusing to purge storage: tenant id is not a valid UUID');
  }
  const prefix = `${tenantId}/`;

  for (const bucket of STORAGE_BUCKETS) {
    const paths = await listStorageFilesUnder(bucket, tenantId);
    // Belt-and-suspenders: never hand `remove()` anything outside this tenant.
    const stray = paths.find((p) => !p.startsWith(prefix));
    if (stray) {
      throw new Error(`refusing to purge storage: "${stray}" is outside tenant prefix`);
    }
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
      if (error) throw new Error(`purge ${bucket}: ${error.message}`);
    }
  }
}

/**
 * Permanently delete an admin-created user and its entire isolated workspace:
 * stored files, all tenant-scoped rows, and the tenant itself (which cascades
 * the user row). Callers must enforce admin authz and block self-deletion (see
 * the DELETE handler).
 */
export async function deleteUser(id) {
  if (!id) throw new Error('id is required');

  const { data: user, error: fErr } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id')
    .eq('id', id)
    .maybeSingle();
  if (fErr) throw new Error(fErr.message);
  if (!user) throw new Error('user not found');
  // Guard the destructive prefix before anything is touched: a user without a
  // proper tenant UUID must never reach the storage/data purge below.
  if (!TENANT_UUID_RE.test(user.tenant_id || '')) {
    throw new Error('refusing to delete: user has no valid tenant');
  }

  // 1. Stored objects first — if the prefix guard rejects, nothing else runs.
  await purgeTenantStorage(user.tenant_id);

  // 2. All tenant-scoped data (no FK cascade on these tables).
  for (const table of TENANT_DATA_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq('tenant_id', user.tenant_id);
    // A table may not exist in every deployment — ignore "missing table" errors.
    if (error && error.code !== '42P01' && !/does not exist/i.test(error.message)) {
      throw new Error(`delete ${table}: ${error.message}`);
    }
  }

  // 3. The tenant row — cascades to the user row.
  const { error: tErr } = await supabaseAdmin.from('tenants').delete().eq('id', user.tenant_id);
  if (tErr) throw new Error(tErr.message);
}

/** Insert the singleton config rows a fresh tenant needs (service role). */
export async function seedTenantDefaults(tenantId) {
  const singletons = [
    ['portfolio_cash', { tenant_id: tenantId, id: 1, cash: 0 }],
    ['allocation_config', { tenant_id: tenantId, id: 1, config: {} }],
    ['sector_config', { tenant_id: tenantId, id: 1, config: {} }],
    ['factor_config', { tenant_id: tenantId, id: 1, factors: [], importance_weights: { Volatility: 0.9 }, exposures: {} }],
    ['macro_regime_config', { tenant_id: tenantId, id: 1, config: {} }],
  ];
  for (const [table, row] of singletons) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(row, { onConflict: 'tenant_id', ignoreDuplicates: true });
    if (error) throw new Error(`seed ${table}: ${error.message}`);
  }
}
