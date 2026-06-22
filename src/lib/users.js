import 'server-only';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabaseAdmin';

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
    .select('id, username, password_hash, role, tenant_id, is_demo, is_active')
    .ilike('username', username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function listUsers() {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, username, role, tenant_id, is_demo, is_active, created_at, tenants(name)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    tenantId: u.tenant_id,
    tenantName: u.tenants?.name ?? null,
    isDemo: u.is_demo,
    isActive: u.is_active,
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

// Every tenant-scoped data table (mirrors the list in migration 005). The
// data tables carry a tenant_id but no FK cascade to `tenants`, so we purge
// them explicitly before removing the user + tenant. The `users` row itself
// cascades when its tenant is deleted (users.tenant_id ON DELETE CASCADE).
const TENANT_DATA_TABLES = [
  'contacts', 'interactions', 'contact_files', 'tasks', 'app_settings',
  'research_links', 'documents', 'theses', 'valuation_models', 'holdings',
  'portfolio_cash', 'watchlists', 'ticker_fundamentals', 'ticker_prices',
  'allocation_config', 'sector_config', 'factor_config', 'fund_nav_data',
  'strategic_notes', 'candidate_positions', 'ideas',
  'prism_recommendations', 'prism_ticker_data', 'prism_ticker_documents',
  'macro_regime_config', 'macro_regime_runs', 'macro_regime_results',
  'macro_regime_weights',
];

/**
 * Permanently delete a user and its entire isolated workspace: every
 * tenant-scoped data row, then the tenant (which cascade-deletes the user).
 * Built-in demo accounts cannot be deleted here.
 */
export async function deleteUser(id) {
  if (!id) throw new Error('id is required');

  const { data: user, error: fErr } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id, is_demo')
    .eq('id', id)
    .maybeSingle();
  if (fErr) throw new Error(fErr.message);
  if (!user) throw new Error('user not found');
  if (user.is_demo) throw new Error('the built-in demo account cannot be deleted');

  // Purge all tenant-scoped data first (no FK cascade on these tables).
  for (const table of TENANT_DATA_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq('tenant_id', user.tenant_id);
    // A table may not exist in every deployment — ignore "missing table" errors.
    if (error && error.code !== '42P01' && !/does not exist/i.test(error.message)) {
      throw new Error(`delete ${table}: ${error.message}`);
    }
  }

  // Removing the tenant cascades to the user row.
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
