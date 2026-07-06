import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, writeSetting } from '@/lib/appSettings';

const KEY = 'allocation_config';

// GET - load saved allocation config
export async function GET() {
  try {
    const supabase = await getDb();
    const config = await readSetting(supabase, KEY, null);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - save allocation config
export async function PUT(req) {
  try {
    const { config } = await req.json();
    if (!config) {
      return NextResponse.json({ error: 'config is required' }, { status: 400 });
    }

    const supabase = await getDb();
    await writeSetting(supabase, KEY, config);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
