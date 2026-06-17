import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// PATCH — bulk-update positions for tasks within a priority section
export async function PATCH(req) {
  const supabase = await getDb();
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array is required' }, { status: 400 });
  }

  // items: [{ id, position, priority? }]
  const now = new Date().toISOString();
  const results = await Promise.all(
    items.map(({ id, position, priority }) => {
      const row = { position, updated_at: now };
      if (priority) row.priority = priority;
      return supabase.from('tasks').update(row).eq('id', id);
    })
  );

  const error = results.find(r => r.error)?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
