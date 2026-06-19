import { NextResponse } from 'next/server';
import path from 'path';
import { getDb } from '@/lib/db';

// PATCH - rename a document and/or reassign it to another ticker.
// Body: { filename?, ticker? }. The (ticker, filename) pair is unique.
export async function PATCH(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const body = await request.json();

    const update = {};
    if (typeof body.filename === 'string' && body.filename.trim()) {
      update.filename = path.basename(body.filename.trim());
    }
    if (typeof body.ticker === 'string' && body.ticker.trim()) {
      update.ticker = body.ticker.trim().toUpperCase();
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('prism_ticker_documents')
      .update(update)
      .eq('id', id)
      .select('id, ticker, filename, updated_at')
      .single();
    if (error) {
      const conflict = error.code === '23505';
      return NextResponse.json(
        { error: conflict ? 'A document with that name already exists for this ticker.' : error.message },
        { status: conflict ? 409 : 500 },
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE - remove an uploaded document.
export async function DELETE(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const { error } = await supabase.from('prism_ticker_documents').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
