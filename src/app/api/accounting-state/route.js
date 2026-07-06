import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, apiOk, withApiError } from '@/lib/apiResponses';
import { readSettingWithVersion, writeSettingWithVersion } from '@/lib/appSettings';
import { VersionConflictError } from '@/lib/concurrency';

// Key/value row in app_settings (RLS-scoped to the caller's tenant via getDb).
// The column is JSONB, but the client contract here is string-based (it
// JSON.stringifies in and JSON.parses out), so we keep the wire value a string
// while storing native JSON underneath.
//
// This is a single big blob autosaved on every edit, so it's a prime spot for two
// admins to clobber each other. Writes are guarded by an optimistic-concurrency
// `version` (migration 030): the client echoes the version it loaded, and a stale
// save is rejected with 409 instead of silently overwriting the other admin.
const STORAGE_KEY = 'fund-accounting-state';

// GET -> { value: string | null, version }  (value is the JSON-stringified state)
export async function GET() {
  return withApiError(async () => {
    const supabase = await getDb();
    const { value: state, version } = await readSettingWithVersion(supabase, STORAGE_KEY, null);
    // Hand the client a string (its long-standing contract), whether the row is
    // native JSONB (object) or a legacy stringified value.
    const value = state == null ? null : typeof state === 'string' ? state : JSON.stringify(state);
    return apiJson({ value, version });
  });
}

// PUT { value: string, baseVersion? } -> guarded upsert (parsed to native JSONB).
// Returns { ok, version } on success, or 409 { conflict, current: { value }, version }.
export async function PUT(request) {
  return withApiError(async () => {
    const { value, baseVersion } = await request.json();
    if (typeof value !== 'string') {
      return apiBadRequest('value (string) is required');
    }

    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      return apiBadRequest('value must be a JSON string');
    }

    const supabase = await getDb();
    try {
      const { version } = await writeSettingWithVersion(supabase, STORAGE_KEY, parsed, baseVersion);
      return apiJson({ ok: true, version });
    } catch (e) {
      if (e instanceof VersionConflictError) {
        const current = e.current?.value;
        const currentStr = current == null ? null : typeof current === 'string' ? current : JSON.stringify(current);
        return apiJson(
          { conflict: true, current: { value: currentStr }, version: e.current?.version ?? 0 },
          { status: 409 }
        );
      }
      throw e;
    }
  });
}
