import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Key/value row in app_settings (demo sessions transparently hit demo_app_settings).
const STORAGE_KEY = 'fund-accounting-state';

// GET -> { value: string | null }  (value is the JSON-stringified accounting state)
export async function GET() {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', STORAGE_KEY)
    .single();

  // PostgREST returns an error when .single() finds no row — treat that as empty.
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ value: data?.value ?? null });
}

// PUT { value: string } -> upsert
export async function PUT(request) {
  try {
    const { value } = await request.json();
    if (typeof value !== 'string') {
      return NextResponse.json({ error: 'value (string) is required' }, { status: 400 });
    }

    const supabase = await getDb();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: STORAGE_KEY, value });

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
