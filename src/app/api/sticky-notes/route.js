import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, apiOk, withApiError } from '@/lib/apiResponses';
import { versionedWrite } from '@/lib/concurrency';

/*
  Sticky Notes — the app-wide, Windows-Sticky-Notes-style workspace layer
  (component src/components/StickyNotes.jsx). Requires migration 037_sticky_notes.

  One row per note. It stores BOTH the content (title, body, colour) and the
  floating card's UI state (pinned, minimized, position, size, stacking order),
  so a pinned note returns exactly where the user left it — same spot, size and
  state — across navigation, refreshes and future sessions.

  Scoping. RLS (migration 037) is the hard boundary: a row is only ever visible
  to its own tenant. On top of that, notes are scoped to the person who made
  them via `created_by` (the session subject) so this reads as a personal layer
  rather than a shared board. That created_by filter is product-level, not a
  security boundary — everyone in a tenant is the same small firm — but it means
  one teammate's notes never float on another's screen.

  Concurrency. Content and layout edits are version-guarded compare-and-swap
  (see src/lib/concurrency.js): a stale write throws VersionConflictError, which
  withApiError turns into the canonical 409 so the client reloads that one note
  instead of clobbering a concurrent writer (e.g. the same user in two tabs).
*/

const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'gray'];
const NUMERIC_FIELDS = ['pos_x', 'pos_y', 'width', 'height', 'z'];
const BOOL_FIELDS = ['pinned', 'minimized'];

// Only these columns are writable from the client — never `version` (the trigger
// owns it), `tenant_id`/`created_by` (set on insert, scoped by RLS + the route),
// or `id`.
function sanitizeUpdates(body) {
  const out = {};
  if (typeof body.title === 'string') out.title = body.title;
  if (typeof body.body === 'string') out.body = body.body;
  if (typeof body.ticker === 'string') out.ticker = body.ticker.trim().toUpperCase().slice(0, 12);
  if (typeof body.color === 'string' && COLORS.includes(body.color)) out.color = body.color;
  for (const k of BOOL_FIELDS) {
    if (typeof body[k] === 'boolean') out[k] = body[k];
  }
  for (const k of NUMERIC_FIELDS) {
    if (body[k] !== undefined && Number.isFinite(Number(body[k]))) out[k] = Number(body[k]);
  }
  return out;
}

// GET — this user's notes, most-recently-updated first.
export async function GET() {
  const supabase = await getDb();
  return withApiError(async () => {
    const { data, error } = await supabase
      .from('sticky_notes')
      .select('*')
      .eq('created_by', supabase.userId || '')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return apiJson({ notes: data || [] });
  });
}

// POST — create a note (owned by the caller). Returns the row incl. its version.
export async function POST(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const body = await request.json().catch(() => ({}));
    const updates = sanitizeUpdates(body);
    const row = {
      created_by: supabase.userId || '',
      title: updates.title ?? '',
      body: updates.body ?? '',
      ticker: updates.ticker ?? '',
      color: updates.color ?? 'yellow',
      pinned: updates.pinned ?? false,
      minimized: updates.minimized ?? false,
      // Position/size fall back to the table defaults when the client omits them.
      ...NUMERIC_FIELDS.reduce((acc, k) => {
        if (updates[k] !== undefined) acc[k] = updates[k];
        return acc;
      }, {}),
    };
    const { data, error } = await supabase.from('sticky_notes').insert(row).select().single();
    if (error) throw new Error(error.message);
    return apiJson({ note: data }, { status: 201 });
  });
}

// PUT — version-guarded update of one note's content and/or UI state.
export async function PUT(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const body = await request.json().catch(() => ({}));
    const { id, baseVersion } = body;
    if (!id) return apiBadRequest('id is required');

    const updates = sanitizeUpdates(body);
    if (Object.keys(updates).length === 0) return apiBadRequest('no valid fields to update');
    updates.updated_at = new Date().toISOString();

    // match on created_by too so a note can only be updated by its owner (RLS
    // already scopes to the tenant). A stale write throws VersionConflictError,
    // which withApiError turns into the canonical 409.
    const row = await versionedWrite(supabase, 'sticky_notes', {
      match: { id, created_by: supabase.userId || '' },
      values: updates,
      baseVersion,
    });
    return apiJson({ note: row });
  });
}

// DELETE — remove one of the caller's notes.
export async function DELETE(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return apiBadRequest('id is required');

    const { error } = await supabase
      .from('sticky_notes')
      .delete()
      .eq('id', id)
      .eq('created_by', supabase.userId || '');
    if (error) throw new Error(error.message);
    return apiOk();
  });
}
