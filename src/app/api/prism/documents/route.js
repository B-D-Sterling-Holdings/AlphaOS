import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// GET - list uploaded research documents (prism_ticker_documents). Optional
// ?ticker= filter. Excludes content_base64 to keep the payload light.
export async function GET(request) {
  const supabase = await getDb();
  try {
    const ticker = request.nextUrl.searchParams.get('ticker');
    let query = supabase
      .from('prism_ticker_documents')
      .select('id, ticker, filename, updated_at')
      .order('ticker', { ascending: true })
      .order('filename', { ascending: true });
    if (ticker) query = query.eq('ticker', String(ticker).toUpperCase());

    const { data, error } = await query;
    if (error) return NextResponse.json({ documents: [], error: error.message }, { status: 500 });
    return NextResponse.json({ documents: data || [] });
  } catch (err) {
    return NextResponse.json({ documents: [], error: err.message }, { status: 500 });
  }
}
