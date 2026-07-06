import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, apiOk, withApiError } from '@/lib/apiResponses';
import { readSetting, writeSetting } from '@/lib/appSettings';

// Key/value row in app_settings (RLS-scoped to the caller's tenant via getDb).
// The column is JSONB, but the client contract here is string-based (it
// JSON.stringifies in and JSON.parses out), so we keep the wire value a string
// while storing native JSON underneath.
const STORAGE_KEY = 'fund-accounting-state';

// GET -> { value: string | null }  (value is the JSON-stringified accounting state)
export async function GET() {
  return withApiError(async () => {
    const supabase = await getDb();
    const state = await readSetting(supabase, STORAGE_KEY, null);
    // Hand the client a string (its long-standing contract), whether the row is
    // native JSONB (object) or a legacy stringified value.
    const value = state == null ? null : typeof state === 'string' ? state : JSON.stringify(state);
    return apiJson({ value });
  });
}

// PUT { value: string } -> upsert (parsed to native JSONB before storing)
export async function PUT(request) {
  return withApiError(async () => {
    const { value } = await request.json();
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
    await writeSetting(supabase, STORAGE_KEY, parsed);
    return apiOk();
  });
}
