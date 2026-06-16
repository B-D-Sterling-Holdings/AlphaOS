import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET — load all strategic notes
export async function GET() {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('strategic_notes')
    .select('*')
    .order('ticker');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST — upsert a strategic note for a ticker
export async function POST(request) {
  const supabase = await getDb();
  const body = await request.json();
  const { ticker, sentiment, conviction, action, action_reason, notes, alternatives, target_weight, priority, expected_return, sort_order } = body;

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const tw = target_weight === '' || target_weight == null ? null : Number(target_weight);
  const er = expected_return === '' || expected_return == null ? null : Number(expected_return);

  const row = {
    ticker: ticker.toUpperCase(),
    sentiment: sentiment || 'neutral',
    conviction: conviction ?? 3,
    action: action || 'hold',
    action_reason: action_reason || '',
    notes: notes || '',
    alternatives: alternatives || '',
    expected_return: isNaN(er) ? null : er,
    target_weight: isNaN(tw) ? null : tw,
    priority: priority || 'normal',
    updated_at: new Date().toISOString(),
  };
  if (sort_order != null && !isNaN(Number(sort_order))) row.sort_order = Number(sort_order);

  const { data, error } = await supabase
    .from('strategic_notes')
    .upsert(row, { onConflict: 'ticker' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — remove a strategic note
export async function DELETE(request) {
  const supabase = await getDb();
  const { ticker } = await request.json();
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const { error } = await supabase
    .from('strategic_notes')
    .delete()
    .eq('ticker', ticker.toUpperCase());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
