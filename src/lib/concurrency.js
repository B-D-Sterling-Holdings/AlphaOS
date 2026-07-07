/*
  NOTE: intentionally NOT marked `server-only`. This module holds no secrets and
  operates purely on a tenant-scoped client passed in by the caller, so it can be
  unit-tested with a fake client (tests/concurrency.test.mjs). The modules that do
  hold credentials (supabaseTenant/supabaseAdmin/db) keep their server-only guard.

  Optimistic concurrency control (OCC) for the document-shaped tables — theses,
  watchlists, valuation_models, and the single-blob app_settings rows. See
  migration 030 and docs/DATABASE_ARCHITECTURE.md §11.

  The problem it solves: those rows are read whole into the browser, edited, and
  written back whole. A blind upsert is last-write-wins, so two people (or one in
  two tabs) editing the same row silently overwrite each other.

  The mechanism: each such row carries a monotonic `version` (DB-maintained by the
  bump_version trigger). A save is a compare-and-swap:

      UPDATE ... WHERE <key> AND version = <baseVersion>

  Postgres row locking makes that atomic, so of two racing saves that both started
  from version N, exactly one lands (row → N+1) and the other matches zero rows.
  The loser gets a VersionConflictError carrying the current row; routes turn that
  into HTTP 409 so the client reloads + re-applies rather than clobbering.

  baseVersion contract (the client echoes it from the last GET / successful save):
    - number >= 1  → expect an existing row at exactly that version → guarded UPDATE
    - 0            → expect NO row yet → INSERT (a losing INSERT trips the unique
                     key and is reported as a conflict)
    - undefined    → pre-migration / legacy caller → fall back to the historical
                     unguarded upsert so the app keeps working before 030 is
                     applied (no hard cutover). Post-migration every client sends a
                     number, so this branch goes quiet on its own.

  `values` passed here must NOT include `version` — the trigger owns it. The
  returned row includes the persisted `version` so the caller can echo it back to
  the client for the next save.
*/

const PG_UNIQUE_VIOLATION = '23505';

export class VersionConflictError extends Error {
  constructor(current = null) {
    super('version conflict: the row was changed by another writer');
    this.name = 'VersionConflictError';
    this.current = current; // the fresh server row (or null if it vanished)
  }
}

async function fetchCurrent(client, table, match) {
  let q = client.from(table).select('*');
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

/**
 * Version-guarded write of a single row keyed by `match` (RLS supplies tenant_id).
 *
 * @param client            tenant-scoped client from getDb()
 * @param table             table name
 * @param opts.match        equality key identifying the row, e.g. { ticker }
 * @param opts.values       column values to write (must NOT include `version`)
 * @param opts.baseVersion  see the baseVersion contract above
 * @param opts.onConflict   onConflict target for the legacy upsert fallback
 * @returns the persisted row (including its new `version`)
 * @throws  VersionConflictError on a stale / racing write
 */
export async function versionedWrite(client, table, { match, values, baseVersion, onConflict }) {
  // Legacy / pre-migration: no base version → historical unguarded upsert.
  if (baseVersion === undefined || baseVersion === null) {
    const { data, error } = await client
      .from(table)
      .upsert({ ...values, ...match }, onConflict ? { onConflict } : undefined)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  // Expect no row yet → INSERT. A unique violation means someone else created it
  // first: report a conflict carrying their row rather than overwriting it.
  if (baseVersion === 0) {
    const { data, error } = await client
      .from(table)
      .insert({ ...values, ...match })
      .select('*')
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new VersionConflictError(await fetchCurrent(client, table, match));
      }
      throw new Error(error.message);
    }
    return data;
  }

  // Expect an existing row at baseVersion → compare-and-swap UPDATE.
  let upd = client.from(table).update(values);
  for (const [k, v] of Object.entries(match)) upd = upd.eq(k, v);
  const { data, error } = await upd.eq('version', baseVersion).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    // Zero rows matched: the row advanced past baseVersion (or was deleted).
    throw new VersionConflictError(await fetchCurrent(client, table, match));
  }
  return data;
}

/**
 * Server-side read-modify-write with a version-guarded retry loop. For appends and
 * other JSONB mutations the server performs itself (e.g. adding a comment to an
 * issue's `comments` array): read the row, compute the new values from it, and
 * commit under the version guard — retrying on a concurrent change so the mutation
 * is never lost (an append should ALWAYS land, never 409 the user).
 *
 * @param client   tenant-scoped client
 * @param table    table name
 * @param match    equality key identifying the row, e.g. { id }
 * @param mutate   (currentRow) => valuesToWrite | null  (null aborts, e.g. auth fail)
 * @param retries  max attempts (default 4)
 * @returns the persisted row, or null when `mutate` aborts or the row is missing.
 */
export async function versionedMutate(client, table, { match, mutate, retries = 4 }) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const current = await fetchCurrent(client, table, match);
    if (!current) return null;
    const values = mutate(current);
    if (values == null) return null;
    try {
      return await versionedWrite(client, table, {
        match,
        values,
        // Guard on the version we just read. undefined (pre-migration, no column)
        // falls back to an unguarded update — same as everywhere else.
        baseVersion: typeof current.version === 'number' ? current.version : undefined,
      });
    } catch (e) {
      if (e instanceof VersionConflictError) continue; // someone else wrote — re-read and retry
      throw e;
    }
  }
  // Exhausted retries under sustained contention: one last unguarded write so the
  // user's action still lands (worst case degrades to last-write-wins, never an error).
  const current = await fetchCurrent(client, table, match);
  if (!current) return null;
  const values = mutate(current);
  if (values == null) return null;
  return versionedWrite(client, table, { match, values, baseVersion: undefined });
}

/**
 * Normalize a value read from a `.select('*')` row into a base version the client
 * can echo back. Returns:
 *   - the numeric version when the column exists (post-migration),
 *   - 0 when there is no row yet (both eras — routes to INSERT),
 *   - undefined when the row exists but predates the column (pre-migration) so the
 *     client omits it and the server takes the legacy upsert path.
 */
export function versionOf(row) {
  if (!row) return 0;
  return typeof row.version === 'number' ? row.version : undefined;
}
