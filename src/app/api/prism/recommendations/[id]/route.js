import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET - one full recommendation (detail panel). `id` is the row id, or a
// source_file name as a fallback.
export async function GET(request, { params }) {
  const supabase = await getDb();
  try {
    const { id } = await params;
    const key = decodeURIComponent(id);
    const column = key.endsWith('.json') ? 'source_file' : 'id';

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
