import { getDb } from '@/lib/db';
import { apiBadRequest, apiJson, apiOk, withApiError } from '@/lib/apiResponses';
import { versionedWrite } from '@/lib/concurrency';

export async function GET(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('archived') === '1';

    let query = supabase
      .from('ideas')
      .select('*')
      .order('pinned', { ascending: false })
      .order('position', { ascending: true })
      .order('updated_at', { ascending: false });

    if (!includeArchived) query = query.eq('archived', false);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return apiJson({ ideas: data || [] });
  });
}

export async function POST(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const body = await request.json();
    const row = {
      title: body.title || '',
      content: body.content || '',
      color: body.color || 'yellow',
      category: body.category || 'idea',
      tags: Array.isArray(body.tags) ? body.tags : [],
      pinned: !!body.pinned,
      archived: !!body.archived,
      position: Number.isFinite(body.position) ? body.position : 0,
    };

    const { data, error } = await supabase.from('ideas').insert(row).select().single();
    if (error) throw new Error(error.message);
    return apiJson({ idea: data });
  });
}

export async function PUT(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const body = await request.json();
    const { id, baseVersion, ...rest } = body;
    if (!id) return apiBadRequest('id is required');

    const updates = {};
    const allowed = ['title', 'content', 'color', 'category', 'tags', 'pinned', 'archived', 'position'];
    for (const k of allowed) {
      if (rest[k] !== undefined) updates[k] = rest[k];
    }
    updates.updated_at = new Date().toISOString();

    // Version-guarded update: a stale write throws VersionConflictError, which
    // withApiError turns into the canonical 409 (see src/lib/concurrency.js).
    const row = await versionedWrite(supabase, 'ideas', {
      match: { id }, values: updates, baseVersion, onConflict: 'id',
    });
    return apiJson({ idea: row });
  });
}

export async function DELETE(request) {
  const supabase = await getDb();
  return withApiError(async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return apiBadRequest('id is required');

    const { error } = await supabase.from('ideas').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return apiOk();
  });
}
