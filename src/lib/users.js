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
