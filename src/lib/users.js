import 'server-only';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabaseAdmin';
import { sanitizeFeatureKeys } from './features';
import { ROLES, normalizeRole, isUnrestrictedRole } from './roles';
import { CIO_TENANT_ID } from './auth';

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
  if (!data || isUnrestrictedRole(data.role)) return [];
  return sanitizeFeatureKeys(data.disabled_features);
}

/**
 * Revoke every session issued before now() for a subject (a users.id UUID or
 * the bootstrap 'cio-admin' string). Called by logout and by an admin's
 * "sign out everywhere" action. Best-effort: a failure here must not block
 * logout, so callers swallow errors.
 */
export async function revokeSessionsBefore(subject, at = new Date()) {
  if (!subject) return;
  const iso = at.toISOString();
  const { error } = await supabaseAdmin
    .from('auth_revocations')
    .upsert({ subject, not_before: iso, updated_at: iso }, { onConflict: 'subject' });
  if (error) throw new Error(error.message);
}

/**
 * The "not before" instant for a subject, or null if it has never been
 * revoked. A session JWT whose `iat` predates this is no longer valid.
 */
export async function getSessionNotBefore(subject) {
  if (!subject) return null;
  const { data, error } = await supabaseAdmin
    .from('auth_revocations')
    .select('not_before')
    .eq('subject', subject)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.not_before ? new Date(data.not_before) : null;
}

/** Minimal identity lookup for authz checks (tenant scoping, role guards). */
export async function getUserById(id) {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, username, role, tenant_id, is_active')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
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
    role: normalizeRole(data.role),
    disabledFeatures: isUnrestrictedRole(data.role) ? [] : sanitizeFeatureKeys(data.disabled_features),
  };
}

/**
 * The bootstrap CIO login as a virtual users-row shape, so the admin UI can
 * show it as the owner of the CIO Alpha workspace. It has no users row (it
 * lives in env vars), so `builtin: true` tells callers it can never be
 * edited, disabled, or deleted through the users API. Null when the env
 * login is not configured.
 */
export async function getBuiltinCioUser() {
  const username = process.env.AUTH_USERNAME;
  if (!username) return null;
  let tenantName = 'CIO Alpha';
  try {
    const { data } = await supabaseAdmin
      .from('tenants')
      .select('name')
      .eq('id', CIO_TENANT_ID)
      .maybeSingle();
    if (data?.name) tenantName = data.name;
  } catch {
    // tenants not migrated yet — the fallback name is fine for display
  }
  return {
    id: 'cio-admin',
    username,
    role: 'admin',
    builtin: true,
    tenantId: CIO_TENANT_ID,
    tenantName,
    isActive: true,
    disabledFeatures: [],
    createdAt: null,
  };
}

/**
 * List users, optionally scoped to one tenant. Owners MUST pass their own
 * tenantId — this helper does not know who is asking.
 */
export async function listUsers({ tenantId } = {}) {
  let query = supabaseAdmin
    .from('users')
    .select('id, username, role, tenant_id, is_active, disabled_features, created_at, tenants(name)')
    .order('created_at', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
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

// created_by must reference a real users row; bootstrap ids ('cio-admin') are
// silently dropped so an FK failure can never block account creation.
const USER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a login.
 *
 * Without `tenantId`: provision a brand-new isolated workspace — one tenant +
 * one user, plus the singleton config rows the app expects to already exist.
 * The new tenant starts with zero rows in every other table.
 *
 * With `tenantId`: add a SUB-USER to that existing workspace. No new tenant,
 * no seeding — the account shares the workspace's data (scoped by RLS) and
 * sees only the features left enabled for it. Callers must have already
 * verified the caller is allowed to add users to that tenant.
 *
 * `disabledFeatures` seeds the new login's feature restrictions — used so a
 * restricted owner's new members start with (at most) the owner's own access.
 */
export async function createUser({ username, password, role = 'user', tenantId = null, createdBy = null, disabledFeatures = [] }) {
  const uname = String(username || '').trim();
  if (!uname) throw new Error('username is required');
  if (!password || String(password).length < 6) {
    throw new Error('password must be at least 6 characters');
  }
  if (!ROLES.includes(role)) throw new Error('invalid role');

  if (await findUserByUsername(uname)) {
    throw new Error(`username "${uname}" is already taken`);
  }

  const created_by = USER_UUID_RE.test(createdBy || '') ? createdBy : null;
  const password_hash = bcrypt.hashSync(String(password), 10);
  const disabled_features = sanitizeFeatureKeys(disabledFeatures);

  // ── Sub-user: join an existing workspace ────────────────────────────────
  if (tenantId) {
    // Admins are global — parking one inside a shared workspace would give
    // that workspace's members a confusing "local superadmin". Refuse.
    if (role === 'admin') throw new Error('admins cannot be added to an existing workspace');

    const { data: tenant, error: tErr } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!tenant) throw new Error('workspace not found');

    const { data: user, error: uErr } = await supabaseAdmin
      .from('users')
      .insert({ username: uname, password_hash, role, tenant_id: tenantId, created_by, disabled_features })
      .select('id, username, role, tenant_id')
      .single();
    if (uErr) throw new Error(uErr.message);
    return { id: user.id, username: user.username, role: user.role, tenantId: user.tenant_id };
  }

  // ── New isolated workspace ──────────────────────────────────────────────
  // 1. tenant (the data partition)
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants')
    .insert({ name: uname })
    .select('id')
    .single();
  if (tErr) throw new Error(tErr.message);

  // 2. user
  const { data: user, error: uErr } = await supabaseAdmin
    .from('users')
    .insert({ username: uname, password_hash, role, tenant_id: tenant.id, created_by, disabled_features })
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

/**
 * Rename a login. Admin-only (callers enforce). The old name stays in any
 * live session JWT until the user's next login/refresh — display only.
 */
export async function setUsername(id, username) {
  if (!id) throw new Error('id is required');
  const uname = String(username || '').trim();
  if (!uname) throw new Error('username is required');
  const existing = await findUserByUsername(uname);
  if (existing && existing.id !== id) {
    throw new Error(`username "${uname}" is already taken`);
  }
  const { error } = await supabaseAdmin
    .from('users')
    .update({ username: uname, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return uname;
}

/** Rename a workspace — its display name only. Admin-only (callers enforce). */
export async function renameWorkspace(tenantId, name) {
  if (!TENANT_UUID_RE.test(tenantId || '')) {
    throw new Error('not a valid tenant id');
  }
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name is required');
  const { error } = await supabaseAdmin.from('tenants').update({ name: clean }).eq('id', tenantId);
  if (error) throw new Error(error.message);
  return clean;
}

/** Reset a user's password. Callers must enforce authz (admin/owner-scoped). */
export async function setUserPassword(id, password) {
  if (!id) throw new Error('id is required');
  if (!password || String(password).length < 6) {
    throw new Error('password must be at least 6 characters');
  }
  const password_hash = bcrypt.hashSync(String(password), 10);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ password_hash, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Switch a login between workspace 'owner' and regular 'user' (member).
 * Admin-only (callers enforce). Never touches 'admin' rows or the builtin
 * CIO login (which has no users row anyway) — the global tier is not
 * reachable from here.
 */
export async function setUserRole(id, role) {
  if (!id) throw new Error('id is required');
  if (!['owner', 'user'].includes(role)) throw new Error('invalid role');
  const target = await getUserById(id);
  if (!target) throw new Error('user not found');
  if (target.role === 'admin') throw new Error('admin logins cannot be changed here');
  const { error } = await supabaseAdmin
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
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
// Deletion runs IN THIS ORDER: FK children must precede their parents
// (interactions/contact_files -> contacts; macro_regime_results.run_id ->
// macro_regime_runs), or the purge aborts on an FK violation.
// Per-tenant config (allocation/sector/factor/macro configs, macro weights,
// portfolio cash) lives in app_settings now — deleting app_settings rows below
// covers it (migration 024 dropped the standalone config tables).
const TENANT_DATA_TABLES = [
  'interactions', 'contact_files', 'contacts', 'tasks', 'app_settings',
  'research_links', 'documents', 'theses', 'valuation_models', 'holdings',
  'watchlists', 'ticker_fundamentals', 'ticker_prices', 'fund_nav_data',
  'strategic_notes', 'candidate_positions', 'ideas',
  'macro_regime_results', 'macro_regime_runs',
  'lessons', 'lesson_patterns', 'issues',
];

// Storage buckets whose objects are namespaced by a `<tenant_id>/` path prefix
// (see src/lib/db.js `storagePrefix`). Storage bypasses RLS, so isolation here is
// purely by path — which is exactly why the purge below is so tightly guarded.
const STORAGE_BUCKETS = ['research-images', 'documents', 'macro-plots'];

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
 * This is intentionally not exported: the only ways to reach it are
 * deleteUser() and deleteWorkspace(), so a prefix-wide storage wipe can never
 * be triggered from anywhere else. It also fails closed on anything that could widen the blast
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
 * Permanently delete a user.
 *
 * A sub-user (role 'user' sharing a tenant with other logins) loses only its
 * login row — the workspace's data belongs to the workspace and is kept.
 *
 * A workspace owner, an admin, or the last login of a tenant takes the whole
 * workspace with it: stored files, all tenant-scoped rows, and the tenant
 * itself (which cascades every remaining users row, including sub-users).
 *
 * Callers must enforce authz and block self-deletion (see the DELETE handler).
 * Returns { workspaceDeleted } so callers can phrase the outcome honestly.
 */
export async function deleteUser(id) {
  if (!id) throw new Error('id is required');

  const { data: user, error: fErr } = await supabaseAdmin
    .from('users')
    .select('id, role, tenant_id')
    .eq('id', id)
    .maybeSingle();
  if (fErr) throw new Error(fErr.message);
  if (!user) throw new Error('user not found');

  // Sub-user in a shared workspace: remove only the login. The tenant (and its
  // data, owned by the remaining logins) must survive.
  if (user.role === 'user') {
    // The CIO workspace's owner is the built-in env login, which has no users
    // row — a member there is never "the last login", so the sibling check
    // would wrongly see an empty workspace and wipe the CIO's data.
    let shared = user.tenant_id === CIO_TENANT_ID;
    if (!shared) {
      const { data: sibling, error: sErr } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('tenant_id', user.tenant_id)
        .neq('id', user.id)
        .limit(1);
      if (sErr) throw new Error(sErr.message);
      shared = !!(sibling && sibling.length > 0);
    }
    if (shared) {
      const { error: dErr } = await supabaseAdmin.from('users').delete().eq('id', user.id);
      if (dErr) throw new Error(dErr.message);
      return { workspaceDeleted: false };
    }
  }
  // Guard the destructive prefix before anything is touched: a user without a
  // proper tenant UUID must never reach the storage/data purge below.
  if (!TENANT_UUID_RE.test(user.tenant_id || '')) {
    throw new Error('refusing to delete: user has no valid tenant');
  }

  await deleteWorkspace(user.tenant_id);
  return { workspaceDeleted: true };
}

/**
 * Permanently delete an entire workspace: stored files, every tenant-scoped
 * row, and the tenant itself (which cascades all of its users rows — owner,
 * members, everyone). Nothing is kept.
 *
 * This is the cleanse behind the owner/solo path of deleteUser() and the
 * admin's explicit "Delete workspace" action. Callers must enforce authz
 * (global admin only) and never pass the caller's own tenant.
 */
export async function deleteWorkspace(tenantId) {
  if (!TENANT_UUID_RE.test(tenantId || '')) {
    throw new Error('refusing to delete: not a valid tenant id');
  }
  // The CIO tenant holds the original production data and its owner is the
  // built-in env login — it must never be wiped through this path.
  if (tenantId === CIO_TENANT_ID) {
    throw new Error('the built-in CIO workspace cannot be deleted');
  }
  const { data: tenant, error: tfErr } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tfErr) throw new Error(tfErr.message);
  if (!tenant) throw new Error('workspace not found');

  // 1. Stored objects first — if the prefix guard rejects, nothing else runs.
  await purgeTenantStorage(tenantId);

  // 2. All tenant-scoped data (no FK cascade on these tables).
  for (const table of TENANT_DATA_TABLES) {
    const { error } = await supabaseAdmin.from(table).delete().eq('tenant_id', tenantId);
    // A table may not exist in every deployment — ignore "missing table" errors.
    if (error && error.code !== '42P01' && !/does not exist/i.test(error.message)) {
      throw new Error(`delete ${table}: ${error.message}`);
    }
  }

  // 3. The tenant row — cascades to every users row in the workspace.
  const { error: tErr } = await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
  if (tErr) throw new Error(tErr.message);
}

/**
 * Seed the defaults a fresh tenant needs (service role).
 *
 * As of migration 024, per-tenant config (allocation/sector/factor/macro
 * configs, macro weights, portfolio cash) lives in app_settings, and every
 * reader has a built-in default with the first save creating the row (see
 * src/lib/appSettings.js). So a new tenant needs nothing seeded — this is a
 * no-op kept as the hook for any future per-tenant defaults.
 */
export async function seedTenantDefaults(_tenantId) {
  // intentionally empty — config defaults are resolved at read time.
}
