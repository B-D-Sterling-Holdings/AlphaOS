import { getDb } from '@/lib/db';
import { apiBadRequest, apiCreated, apiError, apiJson, apiOk } from '@/lib/apiResponses';

/*
  Supabase table required — run this SQL in the Supabase SQL Editor:

  CREATE TABLE tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'low',
    done BOOLEAN DEFAULT false,
    notes TEXT DEFAULT '',
    assignee TEXT DEFAULT '',
    subtasks JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT '',
    position INT DEFAULT 0,
    board_id TEXT DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_tasks_priority ON tasks(priority);
  CREATE INDEX idx_tasks_board_id ON tasks(board_id);

  -- If you already have the table, add missing columns:
  -- ALTER TABLE tasks ADD COLUMN board_id TEXT DEFAULT 'default';
  -- CREATE INDEX idx_tasks_board_id ON tasks(board_id);
  -- ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT '';
*/

const TABLE = 'tasks';

// GET — fetch tasks, optionally filtered by board_id
export async function GET(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const boardId = searchParams.get('board_id');

  let query = supabase
    .from(TABLE)
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (boardId) {
    // Include tasks with matching board_id OR tasks with no board_id (legacy) when requesting 'default'
    if (boardId === 'default') {
      query = query.or('board_id.eq.default,board_id.is.null');
    } else {
      query = query.eq('board_id', boardId);
    }
  }

  const { data, error } = await query;

  if (error) return apiError(error);
  return apiJson(data);
}

// POST — create a new task
export async function POST(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { title, priority = 'low', board_id = 'default' } = body;

  if (!title?.trim()) {
    return apiBadRequest('Title is required');
  }

  // Get next position for this priority within this board
  let query = supabase
    .from(TABLE)
    .select('position')
    .eq('priority', priority)
    .order('position', { ascending: false })
    .limit(1);

  if (board_id === 'default') {
    query = query.or('board_id.eq.default,board_id.is.null');
  } else {
    query = query.eq('board_id', board_id);
  }

  const { data: existing } = await query;
  const nextPos = existing?.length ? (existing[0].position || 0) + 1 : 0;

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ title: title.trim(), priority, position: nextPos, board_id, subtasks: [], updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error) return apiError(error);
  return apiCreated(data);
}

// PUT — update a task (toggle done, rename, subtasks, etc.)
export async function PUT(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return apiBadRequest('id is required');

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABLE)
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return apiError(error);
  return apiJson(data);
}

// DELETE — remove a task
export async function DELETE(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return apiBadRequest('id is required');

  const { error } = await supabase.from(TABLE).delete().eq('id', id);

  if (error) return apiError(error);
  return apiOk();
}
