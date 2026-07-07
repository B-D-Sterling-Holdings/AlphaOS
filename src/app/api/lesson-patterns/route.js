import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { conflictResponse } from '@/lib/apiResponses';

/*
  Supabase table required — created by scripts/migrations/007_lessons_learned.sql.

  CREATE TABLE lesson_patterns (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL DEFAULT public.app_current_tenant(),
    name                text NOT NULL,
    description         text DEFAULT '',
    why_it_matters      text DEFAULT '',
    checklist_questions jsonb DEFAULT '[]'::jsonb,  -- string[]
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
  );

  Patterns are linked to lessons via lessons.pattern_ids (array of pattern ids);
  "related stocks" for a pattern are derived client-side from that link.
*/

const TABLE = 'lesson_patterns';

const WRITABLE = new Set(['name', 'description', 'why_it_matters', 'checklist_questions']);

function pickWritable(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (WRITABLE.has(k)) out[k] = v;
  }
  return out;
}

export async function GET() {
  try {
    const supabase = await getDb();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json(data || []);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const supabase = await getDb();
    const body = await req.json();
    const insert = pickWritable(body);
    if (!insert.name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    insert.name = insert.name.trim();
    insert.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from(TABLE).insert(insert).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const supabase = await getDb();
    const body = await req.json();
    const { id, baseVersion } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const updates = pickWritable(body);
    updates.updated_at = new Date().toISOString();
    const data = await versionedWrite(supabase, TABLE, {
      match: { id }, values: updates, baseVersion, onConflict: 'id',
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const supabase = await getDb();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
