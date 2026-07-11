import { getDb } from '@/lib/db';
import { mutateSetting, readSetting } from '@/lib/appSettings';
import { apiJson, apiError, apiBadRequest, apiOk } from '@/lib/apiResponses';
import { normalizePlan, upsertPriority, removePriority } from '@/lib/horizons';

// Long-term planning suite ("Horizons" view of /tasks). One plan per tenant,
// stored as a single app_settings blob { vision, priorities: [...] }. No dedicated
// table — this rides on the tenant-scoped app_settings row like allocation
// schemes / task boards. Writes go through mutateSetting (server-side
// read-modify-write under the OCC version guard) so two editors don't clobber.
const KEY = 'horizon_plan';
const EMPTY = { vision: '', priorities: [] };

// GET — the whole plan.
export async function GET() {
  try {
    const supabase = await getDb();
    const raw = await readSetting(supabase, KEY, EMPTY);
    return apiJson(normalizePlan(raw));
  } catch (err) {
    return apiError(err);
  }
}

// POST — create or edit one priority. Body: { priority: { id, ...fields } }.
// Sends the full card, upserted by id (partial fields merge into the existing).
export async function POST(req) {
  try {
    const { priority } = await req.json();
    if (!priority || typeof priority !== 'object' || !priority.id) {
      return apiBadRequest('priority with an id is required');
    }
    const supabase = await getDb();
    await mutateSetting(supabase, KEY, (current) => {
      const plan = normalizePlan(current);
      return { ...plan, priorities: upsertPriority(plan.priorities, priority) };
    }, EMPTY);
    return apiJson({ priority });
  } catch (err) {
    return apiError(err);
  }
}

// DELETE — remove one priority. ?id=<priorityId>
export async function DELETE(req) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return apiBadRequest('id query param is required');
    const supabase = await getDb();
    await mutateSetting(supabase, KEY, (current) => {
      const plan = normalizePlan(current);
      return { ...plan, priorities: removePriority(plan.priorities, id) };
    }, EMPTY);
    return apiOk();
  } catch (err) {
    return apiError(err);
  }
}

// PATCH — update the top-level vision statement. Body: { vision }
export async function PATCH(req) {
  try {
    const body = await req.json();
    if (typeof body.vision !== 'string') {
      return apiBadRequest('vision (string) is required');
    }
    const supabase = await getDb();
    await mutateSetting(supabase, KEY, (current) => {
      const plan = normalizePlan(current);
      return { ...plan, vision: body.vision };
    }, EMPTY);
    return apiOk();
  } catch (err) {
    return apiError(err);
  }
}
