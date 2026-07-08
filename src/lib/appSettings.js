import 'server-only';
import { versionedWrite, versionedMutate, versionOf } from './concurrency';

/*
  Per-tenant key/value config: the `app_settings` table, one row per
  (tenant_id, key) with a JSONB `value`.

  This is the single home for per-tenant configuration. As of migration 024 it
  also holds what used to be the standalone single-row config tables
  (allocation_config, sector_config, factor_config, macro_regime_config,
  portfolio_cash) — each is now one keyed row here.

  RLS scopes every read/write to the caller's tenant, so callers never pass
  tenant_id. `value` is JSONB (migration 023): PostgREST returns it already
  parsed. `coerce()` also tolerates a legacy TEXT/stringified value so a row
  written by older code mid-deploy can't break a read.

  Usage (pass the tenant-scoped client from getDb()):

      const supabase = await getDb();
      const cfg = await readSetting(supabase, 'allocation_config', {});
      await writeSetting(supabase, 'allocation_config', cfg);
*/

function coerce(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    // Legacy TEXT row (or a JSON-string value): parse if possible.
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Read one app_settings value for the current tenant.
 * @param supabase tenant-scoped client from getDb()
 * @param key      settings key
 * @param fallback returned when the row is absent (default null)
 */
export async function readSetting(supabase, key, fallback = null) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return fallback; // no row yet
    throw new Error(error.message);
  }
  return coerce(data?.value, fallback);
}

/**
 * Upsert one app_settings value for the current tenant. `value` is stored as
 * native JSONB — do NOT JSON.stringify it.
 */
export async function writeSetting(supabase, key, value) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'tenant_id,key' });
  if (error) throw new Error(error.message);
  return value;
}

/**
 * Read a value together with its optimistic-concurrency version (see migration
 * 030 / src/lib/concurrency.js). Use this for the big single-blob settings rows
 * (e.g. fund-accounting-state) so the client can save with a version guard.
 * Returns { value, version } — version is a number (post-migration), 0 when the
 * row is absent, or undefined for a pre-migration row.
 */
export async function readSettingWithVersion(supabase, key, fallback = null) {
  // select('*') (not 'value, version') so this tolerates the pre-migration schema
  // where the `version` column doesn't exist yet — versionOf() then returns
  // undefined and the client falls back to legacy unguarded saves.
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('key', key)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return { value: fallback, version: 0 }; // no row yet
    throw new Error(error.message);
  }
  return { value: coerce(data?.value, fallback), version: versionOf(data) };
}

/**
 * Version-guarded upsert of one app_settings value. Throws VersionConflictError
 * when `baseVersion` is stale (a concurrent writer moved the row on). Returns
 * { value, version }.
 */
export async function writeSettingWithVersion(supabase, key, value, baseVersion) {
  const row = await versionedWrite(supabase, 'app_settings', {
    match: { key },
    values: { value },
    baseVersion,
    onConflict: 'tenant_id,key',
  });
  return { value, version: versionOf(row) };
}

/**
 * Server-side read-modify-write of one app_settings value under the version guard,
 * with automatic retry on a concurrent change. Use this for the config blobs the
 * SERVER patches in place (read the whole object, change one field, write it back)
 * — factor exposures, sector labels — so two people patching different fields at
 * once don't lose each other's change. `mutate(currentValue) => nextValue`.
 */
export async function mutateSetting(supabase, key, mutate, fallback = null) {
  const row = await versionedMutate(supabase, 'app_settings', {
    match: { key },
    // versionedMutate hands us the raw row; coerce the JSONB value, apply the
    // caller's patch, and hand back the column update. A missing row starts from
    // `fallback` (versionedMutate only calls us when a row exists, so seed via an
    // initial write below when absent).
    mutate: (current) => ({ value: mutate(coerce(current.value, fallback)) }),
  });
  if (row) return coerce(row.value, fallback);
  // No row yet → create it from the fallback-seeded patch (first write, no contention).
  const seeded = mutate(fallback);
  await writeSetting(supabase, key, seeded);
  return seeded;
}
