import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  const supabase = await getDb();
  try {
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
    return NextResponse.json({ ideas: data || [] });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const supabase = await getDb();
  try {
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
    return NextResponse.json({ idea: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const supabase = await getDb();
  try {
    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updates = {};
    const allowed = ['title', 'content', 'color', 'category', 'tags', 'pinned', 'archived', 'position'];
    for (const k of allowed) {
      if (rest[k] !== undefined) updates[k] = rest[k];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('ideas')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ idea: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { error } = await supabase.from('ideas').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
