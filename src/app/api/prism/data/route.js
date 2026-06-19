import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET - list generated ticker datasets (prism_ticker_data). Optional ?ticker=
// filter. Excludes csv_content to keep the payload light.
export async function GET(request) {
  const supabase = await getDb();
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    let query = supabase
      .from('prism_ticker_data')
      .select('id, ticker, category, rows, updated_at')
      .order('ticker', { ascending: true })
      .order('category', { ascending: true });
    if (ticker) query = query.eq('ticker', String(ticker).toUpperCase());

    const { data, error } = await query;
    if (error) return NextResponse.json({ datasets: [], error: error.message }, { status: 500 });
    return NextResponse.json({ datasets: data || [] });
  } catch (err) {
    return NextResponse.json({ datasets: [], error: err.message }, { status: 500 });
  }
}
