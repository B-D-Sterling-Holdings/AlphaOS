import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const TABLE = 'app_settings';
const BOARDS_KEY = 'task_boards';
const ACTIVE_KEY = 'activeTaskBoardId';

const DEFAULT_BOARDS = [{ id: 'default', name: 'Main Board' }];

async function getSetting(key) {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from(TABLE)
    .select('value')
    .eq('key', key)
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  try {
    return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  } catch {
    return data.value;
  }
}

async function setSetting(key, value) {
  const supabase = await getDb();
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await supabase
    .from(TABLE)
    .upsert({ key, value: serialized }, { onConflict: 'tenant_id,key' });
}

// GET — return { boards: [...], activeBoardId: '...' }
export async function GET() {
  try {
    const [boards, activeId] = await Promise.all([
      getSetting(BOARDS_KEY),
      getSetting(ACTIVE_KEY),
    ]);

    return NextResponse.json({
      boards: Array.isArray(boards) && boards.length > 0 ? boards : DEFAULT_BOARDS,
      activeBoardId: activeId || 'default',
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT — save boards list and/or active board
export async function PUT(req) {
  try {
    const { boards, activeBoardId } = await req.json();

    const promises = [];
    if (boards !== undefined) promises.push(setSetting(BOARDS_KEY, boards));
    if (activeBoardId !== undefined) promises.push(setSetting(ACTIVE_KEY, activeBoardId));
    await Promise.all(promises);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
