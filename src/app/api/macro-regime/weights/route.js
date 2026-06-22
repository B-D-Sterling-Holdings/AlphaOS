import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const TABLE = 'macro_regime_weights';

// GET - load saved macro-regime portfolio weights
export async function GET() {
  const supabase = await getDb();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', 1)
      .single();

    if (error && error.code === 'PGRST116') {
      return NextResponse.json({ weights: null });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ weights: data.weights });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - save macro-regime portfolio weights
export async function PUT(req) {
  const supabase = await getDb();
  try {
    const { weights } = await req.json();

    if (!weights || typeof weights !== 'object') {
      return NextResponse.json({ error: 'weights object is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        { id: 1, weights, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id' }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ weights: data.weights });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
