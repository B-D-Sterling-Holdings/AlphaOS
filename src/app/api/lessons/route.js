import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { conflictResponse } from '@/lib/apiResponses';

/*
  Supabase table required — created by scripts/migrations/007_lessons_learned.sql.
  (Reproduced here for reference; run the migration, don't hand-create.)

  CREATE TABLE lessons (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL DEFAULT public.app_current_tenant(),
    ticker        text DEFAULT '',
    company       text DEFAULT '',
    title         text NOT NULL,
    type          text DEFAULT 'post_mortem',
    outcome       text DEFAULT 'uncertain',
    category      text DEFAULT 'business',
    severity      text DEFAULT 'medium',
    repeat_risk   text DEFAULT 'medium',
    status        text DEFAULT 'not_reviewed',
    position_type text DEFAULT 'owned',
    date_opened   date,
    date_reviewed date,
    tags          jsonb DEFAULT '[]'::jsonb,   -- string[]
    pattern_ids   jsonb DEFAULT '[]'::jsonb,   -- uuid[] -> lesson_patterns.id
    detail        jsonb DEFAULT '{}'::jsonb,   -- long-form post-mortem section editors
    comments      jsonb DEFAULT '[]'::jsonb,   -- Draft & Review-style threads
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
  );
*/

const TABLE = 'lessons';

// Columns a client is allowed to write. Everything else (id, tenant_id,
// created_at) is server/DB controlled.
const WRITABLE = new Set([
  'ticker', 'company', 'title', 'type', 'outcome', 'category', 'severity',
  'repeat_risk', 'status', 'position_type', 'date_opened', 'date_reviewed',
  'tags', 'pattern_ids', 'detail', 'comments',
]);

function pickWritable(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (WRITABLE.has(k)) out[k] = v;
  }
  // Normalize empty date strings to null so Postgres `date` accepts them.
  if (out.date_opened === '') out.date_opened = null;
  if (out.date_reviewed === '') out.date_reviewed = null;
  return out;
}

// GET — all lessons for the tenant (newest first).
export async function GET() {
  try {
    const supabase = await getDb();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json(data || []);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — create a lesson.
export async function POST(req) {
  try {
    const supabase = await getDb();
    const body = await req.json();
    const insert = pickWritable(body);
    if (!insert.title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    insert.title = insert.title.trim();
    insert.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from(TABLE).insert(insert).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT — update a lesson.
export async function PUT(req) {
  try {
    const supabase = await getDb();
    const body = await req.json();
    const { id, baseVersion } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updates = pickWritable(body);
    updates.updated_at = new Date().toISOString();

    // Version-guarded so two people editing the same lesson (its comment threads or
    // section editors) can't clobber each other. A stale write → canonical 409.
    const data = await versionedWrite(supabase, TABLE, {
      match: { id }, values: updates, baseVersion, onConflict: 'id',
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE — remove a lesson by ?id=.
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
