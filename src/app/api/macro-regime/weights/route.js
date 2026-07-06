import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, writeSetting } from '@/lib/appSettings';

const KEY = 'macro_regime_weights';

// GET - load saved macro-regime portfolio weights
export async function GET() {
  try {
    const supabase = await getDb();
    const weights = await readSetting(supabase, KEY, null);
    return NextResponse.json({ weights });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - save macro-regime portfolio weights
export async function PUT(req) {
  try {
    const { weights } = await req.json();
    if (!weights || typeof weights !== 'object') {
      return NextResponse.json({ error: 'weights object is required' }, { status: 400 });
    }

    const supabase = await getDb();
    await writeSetting(supabase, KEY, weights);
    return NextResponse.json({ weights });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
