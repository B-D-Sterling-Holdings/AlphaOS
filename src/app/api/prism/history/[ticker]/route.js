import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildTickerHistory } from '@/lib/prismSignal';

const COLUMNS =
  'id, source_file, ticker, analysis_date, signal, conviction, position_size_pct, price_target, expected_return_pct, model, analysis_mode';

// GET - full ordered history (entries + summary) for one ticker.
export async function GET(request, { params }) {
  const supabase = await getDb();
  try {
    const { ticker } = await params;
    const upper = String(ticker).toUpperCase();
    const { data, error } = await supabase
      .from('prism_recommendations')
      .select(COLUMNS)
      .eq('ticker', upper);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(buildTickerHistory(upper, data || []));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
