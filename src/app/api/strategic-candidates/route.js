import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Research pipeline — names being researched or with potential to enter the
// portfolio (not yet held). Drives the "Research Pipeline" section of the
// Strategic Hub.

// GET — load all candidate positions
export async function GET() {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('candidate_positions')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST — create a new candidate (no id) or update an existing one (with id)
export async function POST(request) {
  const supabase = await getDb();
  const body = await request.json();
  const { id, ticker, status, sentiment, conviction, priority, target_weight, notes, sort_order } = body;

  if (!ticker || !ticker.trim()) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }

  const tw = target_weight === '' || target_weight == null ? null : Number(target_weight);

  const row = {
    ticker: ticker.trim().toUpperCase(),
    status: status || 'researching',
    sentiment: sentiment || 'neutral',
    conviction: conviction ?? 3,
    priority: priority || 'normal',
    target_weight: isNaN(tw) ? null : tw,
    notes: notes || '',
    updated_at: new Date().toISOString(),
  };
  if (sort_order != null && !isNaN(Number(sort_order))) row.sort_order = Number(sort_order);

  let query;
  if (id) {
    query = supabase.from('candidate_positions').update(row).eq('id', id).select().single();
  } else {
    query = supabase.from('candidate_positions').insert(row).select().single();
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — remove a candidate by id
export async function DELETE(request) {
  const supabase = await getDb();
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase
    .from('candidate_positions')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
