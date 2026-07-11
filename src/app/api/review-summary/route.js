import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * GET /api/review-summary?tickers=A,B,C
 *
 * Returns { summaries: { TICKER: openCommentCount }, authors: { TICKER: {name, email} } }
 * for the Watchlist cards — the badge count and the "who's the author" line. Comments
 * are one entity per ticker living on thesis.underwriting.draftReview (the same store
 * Draft & Review reads/writes), so this counts unresolved threads that hold at least
 * one posted message — empty stubs and un-posted composer drafts are deliberately
 * ignored so nothing "stale" shows a badge. RLS scopes the query to the caller's tenant.
 */
export async function GET(request) {
  try {
    const supabase = await getDb();
    const tickersParam = new URL(request.url).searchParams.get('tickers') || '';
    const tickers = [...new Set(
      tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
    )];

    const summaries = {};
    const authors = {};
    if (tickers.length === 0) return NextResponse.json({ summaries, authors });

    // Seed every requested ticker at 0 so a name whose comments were all resolved or
    // deleted correctly clears its badge (not just names that still have some).
    for (const t of tickers) summaries[t] = 0;

    const { data, error } = await supabase
      .from('theses')
      .select('ticker, underwriting')
      .in('ticker', tickers);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const row of data || []) {
      const dr = row.underwriting?.draftReview || {};
      const threads = dr.threads || [];
      summaries[row.ticker] = threads.filter(
        t => !t.resolved && (t.messages || []).length > 0
      ).length;
      // Only report an author when one is actually set, so the card can show the
      // "no author yet" nudge for names that have none.
      const a = dr.author || {};
      if (a.name || a.email) authors[row.ticker] = { name: a.name || '', email: a.email || '' };
    }

    return NextResponse.json({ summaries, authors });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
