import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const TABLE = 'allocation_config';

// GET - load saved allocation config
export async function GET() {
  const supabase = await getDb();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', 1)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row yet
      return NextResponse.json({ config: null });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data.config });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - save allocation config
export async function PUT(req) {
  const supabase = await getDb();
  try {
    const { config } = await req.json();

    if (!config) {
      return NextResponse.json({ error: 'config is required' }, { status: 400 });
    }

    const row = {
      id: 1,
      config,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ config: data.config });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
