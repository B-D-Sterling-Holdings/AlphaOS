import { NextResponse } from 'next/server';
import { fetchQuotes } from '@/lib/yahoo';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tickers = searchParams.get('tickers');
    if (!tickers) {
      return NextResponse.json({ error: 'tickers param required' }, { status: 400 });
    }

    const tickerList = tickers.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    // `basic=1` skips the per-ticker fundamentals fetch for callers that only
    // render price/day-change (e.g. the dashboard holdings tiles) — much faster.
    const basic = searchParams.get('basic') === '1';
    const quotes = await fetchQuotes(tickerList, { basic });

    return NextResponse.json({ quotes });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
