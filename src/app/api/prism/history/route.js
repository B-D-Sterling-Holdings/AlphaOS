import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { summarizeHistories } from '@/lib/prismSignal';

// GET - per-ticker recommendation-history summaries (Signal History landing).
export async function GET() {
  const supabase = await getDb();
  try {
    const { data, error } = await supabase
      .from('prism_recommendations')
      .select('ticker, analysis_date, signal, conviction')
      .order('analysis_date', { ascending: true });

    if (error) return NextResponse.json({ histories: [], error: error.message }, { status: 500 });
    return NextResponse.json({ histories: summarizeHistories(data || []) });
  } catch (err) {
    return NextResponse.json({ histories: [], error: err.message }, { status: 500 });
  }
}
