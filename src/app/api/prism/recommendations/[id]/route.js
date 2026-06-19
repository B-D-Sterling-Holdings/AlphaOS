import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { normalizeSignal } from '@/lib/prismSignal';

// Top-level columns the UI is allowed to edit. These drive the Signal History
// timeline/table; the JSONB `recommendation` is kept in sync below so the detail
// panel matches.
const EDITABLE = ['signal', 'conviction', 'position_size_pct', 'price_target', 'expected_return_pct', 'analysis_date'];
const NUMERIC = new Set(['position_size_pct', 'price_target', 'expected_return_pct']);

// `id` is the row id, or a source_file name (ends in .json) as a fallback.
function keyAndColumn(id) {
  const key = decodeURIComponent(id);
  return { key, column: key.endsWith('.json') ? 'source_file' : 'id' };
}

// GET - one full recommendation (detail panel).
export async function GET(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const { key, column } = keyAndColumn(id);

    const { data, error } = await supabase
      .from('prism_recommendations')
      .select('*')
      .eq(column, key)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH - edit a recommendation. Body may contain any of EDITABLE plus `reasoning`.
// Updates the canonical columns and mirrors the change into the `recommendation`
// JSONB so the detail view stays consistent with the timeline.
export async function PATCH(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const { key, column } = keyAndColumn(id);
    const body = await request.json();

    const { data: current, error: fetchErr } = await supabase
      .from('prism_recommendations')
      .select('*')
      .eq(column, key)
      .single();
    if (fetchErr || !current) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }

    const update = {};
    for (const field of EDITABLE) {
      if (!(field in body)) continue;
      let value = body[field];
      if (NUMERIC.has(field)) value = value === '' || value == null ? null : Number(value);
      if (field === 'signal' && value) value = normalizeSignal(value);
      update[field] = value;
    }

    // Mirror edits into the JSONB recommendation (detail panel reads from here).
    const rec = { ...(current.recommendation || {}) };
    if ('signal' in update) rec.signal = update.signal;
    if ('conviction' in update) rec.conviction = update.conviction;
    if ('position_size_pct' in update) rec.position_size_pct = update.position_size_pct;
    if ('price_target' in update) rec.price_target_12mo = update.price_target;
    if ('expected_return_pct' in update) rec.expected_return_pct = update.expected_return_pct;
    if (typeof body.reasoning === 'string') rec.reasoning = body.reasoning;
    update.recommendation = rec;

    if (Object.keys(update).length === 1) {
      // Only the (unchanged) recommendation mirror — nothing to do.
      return NextResponse.json(current);
    }

    const { data, error } = await supabase
      .from('prism_recommendations')
      .update(update)
      .eq(column, key)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE - remove a recommendation from the signal history.
export async function DELETE(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const { key, column } = keyAndColumn(id);

    const { error } = await supabase
      .from('prism_recommendations')
      .delete()
      .eq(column, key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
