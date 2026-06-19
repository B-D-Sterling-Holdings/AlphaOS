import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Row count matches the seed convention (scripts/seed-prism-data.mjs): lines
// minus the header.
function countRows(csv) {
  const lines = String(csv || '').trim().split('\n');
  return Math.max(0, lines.length - 1);
}

// GET - one dataset including its csv_content (for the editor).
export async function GET(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const { data, error } = await supabase
      .from('prism_ticker_data')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH - edit a dataset's CSV content and/or category. `rows` is recomputed
// from the new CSV.
export async function PATCH(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const body = await request.json();

    const update = {};
    if (typeof body.csv_content === 'string') {
      update.csv_content = body.csv_content;
      update.rows = countRows(body.csv_content);
    }
    if (typeof body.category === 'string' && body.category.trim()) {
      update.category = body.category.trim();
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('prism_ticker_data')
      .update(update)
      .eq('id', id)
      .select('id, ticker, category, rows, updated_at')
      .single();
    if (error) {
      const conflict = error.code === '23505';
      return NextResponse.json(
        { error: conflict ? 'A dataset with that category already exists for this ticker.' : error.message },
        { status: conflict ? 409 : 500 },
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE - remove a generated dataset.
export async function DELETE(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const { error } = await supabase.from('prism_ticker_data').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
