import { getDb } from '@/lib/db';
import { apiBadRequest, apiCreated, apiError, apiJson, apiOk, conflictResponse } from '@/lib/apiResponses';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';

/*
  Per-company research to-do items behind the collapsible Research Task panel
  (see src/components/ResearchTaskPanel.jsx). One row per item, scoped to a
  ticker. Requires migration 035_research_tasks.sql.

  Deliberately separate from /api/tasks (the firm-wide kanban board): these items
  only make sense alongside a specific name's thesis, so they are keyed by ticker
  rather than board_id and carry a status/tags/assignee tailored to research work.

  Edits are version-guarded (OCC) exactly like /api/tasks — two analysts editing
  the same item get a canonical 409 instead of a silent last-write-wins.
*/

const TABLE = 'research_tasks';
const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITIES = ['high', 'medium', 'low'];

// Only these columns are writable from the client — never `version` (the trigger
// owns it), `tenant_id` (RLS/default owns it), or `id`.
function sanitizeUpdates(body) {
  const out = {};
  if (typeof body.title === 'string') out.title = body.title;
  if (typeof body.notes === 'string') out.notes = body.notes;
  if (typeof body.assignee === 'string') out.assignee = body.assignee;
  if (typeof body.status === 'string' && STATUSES.includes(body.status)) out.status = body.status;
  if (typeof body.priority === 'string' && PRIORITIES.includes(body.priority)) out.priority = body.priority;
  if (Array.isArray(body.tags)) {
    out.tags = body.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
  }
  if (body.position !== undefined && Number.isFinite(Number(body.position))) {
    out.position = Number(body.position);
  }
  return out;
}

// GET — list a ticker's tasks in display order.
export async function GET(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker')?.trim().toUpperCase();

  if (!ticker) return apiBadRequest('ticker is required');

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('ticker', ticker)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return apiError(error);
  return apiJson(data);
}

// POST — create a task for a ticker (appended to the end of its list).
export async function POST(req) {
  const supabase = await getDb();
  const body = await req.json();
  const ticker = body.ticker?.trim().toUpperCase();
  const title = body.title?.trim();

  if (!ticker) return apiBadRequest('ticker is required');
  if (!title) return apiBadRequest('title is required');

  // Next position within this ticker.
  const { data: existing } = await supabase
    .from(TABLE)
    .select('position')
    .eq('ticker', ticker)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = existing?.length ? (Number(existing[0].position) || 0) + 1 : 0;

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      ticker,
      title,
      status: STATUSES.includes(body.status) ? body.status : 'todo',
      priority: PRIORITIES.includes(body.priority) ? body.priority : 'medium',
      assignee: typeof body.assignee === 'string' ? body.assignee : '',
      tags: Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string' && t.trim()) : [],
      position: nextPos,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return apiError(error);
  return apiCreated(data);
}

// PUT — update a task (title, status, assignee, tags, notes, position).
export async function PUT(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { id, baseVersion } = body;

  if (!id) return apiBadRequest('id is required');

  const updates = sanitizeUpdates(body);
  if (Object.keys(updates).length === 0) return apiBadRequest('no valid fields to update');
  updates.updated_at = new Date().toISOString();

  try {
    const data = await versionedWrite(supabase, TABLE, {
      match: { id }, values: updates, baseVersion, onConflict: 'id',
    });
    return apiJson(data);
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return apiError(e);
  }
}

// DELETE — remove a task.
export async function DELETE(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return apiBadRequest('id is required');

  const { error } = await supabase.from(TABLE).delete().eq('id', id);

  if (error) return apiError(error);
  return apiOk();
}
