import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { conflictResponse } from '@/lib/apiResponses';

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
  const { ticker, sentiment, conviction, action, action_reason, notes, alternatives, target_weight, priority, expected_return, sort_order, baseVersion } = body;

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const tw = target_weight === '' || target_weight == null ? null : Number(target_weight);
  const er = expected_return === '' || expected_return == null ? null : Number(expected_return);

  const values = {
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
  if (sort_order != null && !isNaN(Number(sort_order))) values.sort_order = Number(sort_order);

  // Version-guarded upsert-by-ticker: two people editing the same position's note
  // can't clobber each other → canonical 409 on a stale write.
  try {
    const data = await versionedWrite(supabase, 'strategic_notes', {
      match: { ticker: ticker.toUpperCase() }, values, baseVersion, onConflict: 'tenant_id,ticker',
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
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
