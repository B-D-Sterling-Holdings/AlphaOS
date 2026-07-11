import { getDb } from '@/lib/db';
import { apiBadRequest, apiError, apiOk } from '@/lib/apiResponses';

// PATCH — bulk-update the display order of a ticker's research tasks after a
// drag-and-drop reorder. Mirrors /api/tasks/reorder: a plain positional write
// (not version-guarded — reordering is a whole-list operation, not a
// field-level edit). RLS still scopes every row to the caller's tenant.
export async function PATCH(req) {
  const supabase = await getDb();
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return apiBadRequest('items array is required');
  }

  // items: [{ id, position }]
  const now = new Date().toISOString();
  const results = await Promise.all(
    items.map(({ id, position }) =>
      supabase.from('research_tasks').update({ position, updated_at: now }).eq('id', id)
    )
  );

  const failed = results.find(r => r.error)?.error;
  if (failed) return apiError(failed);
  return apiOk();
}
