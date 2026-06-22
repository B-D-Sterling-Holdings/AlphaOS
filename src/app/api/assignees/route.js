import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const TABLE = 'app_settings';

function getKey(boardId) {
  return boardId && boardId !== 'default' ? `assignees_${boardId}` : 'assignees';
}

// GET - load saved assignees [{name, color}] for a board
export async function GET(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const boardId = searchParams.get('board_id') || 'default';
  const key = getKey(boardId);

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('key', key)
      .single();

    if (error && error.code === 'PGRST116') {
      return NextResponse.json({ assignees: [] });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let assignees = [];
    try {
      assignees = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch {
      assignees = [];
    }

    return NextResponse.json({ assignees: Array.isArray(assignees) ? assignees : [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - save assignees list for a board
export async function PUT(req) {
  const supabase = await getDb();
  try {
    const { assignees, board_id } = await req.json();
    const key = getKey(board_id || 'default');

    if (!Array.isArray(assignees)) {
      return NextResponse.json({ error: 'assignees must be an array' }, { status: 400 });
    }

    const row = {
      key,
      value: JSON.stringify(assignees),
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: 'tenant_id,key' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let saved = [];
    try {
      saved = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch {
      saved = assignees;
    }

    return NextResponse.json({ assignees: saved });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
