import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import YahooFinance from 'yahoo-finance2';
import { computeFullTimeline } from '@/lib/accounting';
import { readSetting } from '@/lib/appSettings';

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// S&P 500 price at fund inception (2024-09-17) and inception NAV
const INCEPTION_SP = 5634.58;
const INCEPTION_NAV = 100;

export async function GET() {
  const supabase = await getDb();
  try {
    const { data, error } = await supabase
      .from('fund_nav_data')
      .select('date, fund_nav, sp500_nav')
      .order('date', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/fund-nav
 * Body: { entries: [{ date: "MM/DD/YYYY", aum: 46554.25 }, ...] }
 *
 * 1. Loads accounting state from Supabase to get share counts per period
 * 2. Computes NAV per share = AUM / outstanding shares for each date
 * 3. Fetches S&P 500 closing prices for those dates from Yahoo Finance
 * 4. Computes S&P NAV = (sp500_close / INCEPTION_SP) * INCEPTION_NAV
 * 5. Upserts rows into fund_nav_data
 */
export async function POST(request) {
  const supabase = await getDb();
  try {
    const { entries } = await request.json();
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries array is required' }, { status: 400 });
    }

    // 1. Load accounting state from app_settings (JSONB; the helper also
    //    tolerates a legacy stringified value).
    const accountingState = await readSetting(supabase, 'fund-accounting-state', null);
    if (!accountingState) {
      return NextResponse.json({ error: 'Could not load accounting state' }, { status: 500 });
    }

    const computedTimeline = computeFullTimeline(accountingState);

    // Build a "share ladder": outstanding shares effective from each period start.
    //
    // We DON'T match by [startDate, endDate] range because stale/open periods can
    // overlap newer ones (e.g. an un-closed current period whose endDate still
    // extends past a later contribution). Range-overlap matching then picks the
    // older period's pre-contribution share count and divides post-contribution
    // AUM by too few shares, making NAV skyrocket. Instead each entry uses the
    // share count from the latest period that started on or before its date.
    //
    // Keying off period starts (not contribution dates) matches the accounting
    // model: a contribution freezes at the prior period's END NAV and the issued
    // shares are recognized when the NEXT period begins the following day (see
    // closePeriod in lib/accounting.js). startTotalShares already reflects every
    // contribution up to that point.
    const ladder = [];
    for (let qi = 0; qi < computedTimeline.length; qi++) {
      for (const ev of computedTimeline[qi].computedEvents) {
        if (ev.type === 'period') {
          ladder.push({ date: ev.startDate, totalShares: ev.startTotalShares });
        }
      }
    }
    // Sort ascending by start date; later same-day starts win (larger count last).
    ladder.sort((a, b) =>
      a.date === b.date ? a.totalShares - b.totalShares : a.date < b.date ? -1 : 1
    );

    // 2. Parse entries and compute fund NAV per share
    const parsed = [];
    for (const entry of entries) {
      // Parse MM/DD/YYYY to YYYY-MM-DD
      const parts = entry.date.split('/');
      if (parts.length !== 3) {
        return NextResponse.json({ error: `Invalid date: ${entry.date}` }, { status: 400 });
      }
      const [mm, dd, yyyy] = parts;
      const isoDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

      // Shares outstanding as of this date = latest ladder step on or before it.
      let shares = null;
      for (const step of ladder) {
        if (step.date <= isoDate) shares = step.totalShares;
        else break;
      }

      if (shares == null || shares <= 0) {
        return NextResponse.json({
          error: `No share count available on or before date ${entry.date}`
        }, { status: 400 });
      }

      const fundNav = entry.aum / shares;
      parsed.push({ isoDate, fundNav, aum: entry.aum, shares });
    }

    // 3. Fetch S&P 500 historical prices for the date range
    const sortedDates = parsed.map(p => p.isoDate).sort();
    const startDate = new Date(sortedDates[0]);
    startDate.setDate(startDate.getDate() - 5); // buffer for weekends/holidays
    const endDate = new Date(sortedDates[sortedDates.length - 1]);
    endDate.setDate(endDate.getDate() + 2);

    let spPriceMap = {};
    try {
      const chartResult = await yahooFinance.chart('^GSPC', {
        period1: startDate.toISOString().split('T')[0],
        period2: endDate.toISOString().split('T')[0],
        interval: '1d',
      });
      const quotes = chartResult.quotes || [];
      for (const q of quotes) {
        if (q.date && q.close) {
          const d = new Date(q.date).toISOString().split('T')[0];
          spPriceMap[d] = q.close;
        }
      }
    } catch (err) {
      console.error('Failed to fetch S&P 500 data:', err);
      // Continue without S&P data — we'll use null
    }

    // Helper: find closest available S&P price on or before a given date
    function getSpPrice(isoDate) {
      if (spPriceMap[isoDate]) return spPriceMap[isoDate];
      // Look back up to 5 days for weekends/holidays
      const dt = new Date(isoDate + 'T00:00:00');
      for (let i = 1; i <= 5; i++) {
        const prev = new Date(dt);
        prev.setDate(prev.getDate() - i);
        const prevIso = prev.toISOString().split('T')[0];
        if (spPriceMap[prevIso]) return spPriceMap[prevIso];
      }
      return null;
    }

    // 4. Build upsert rows
    const rows = parsed.map(p => {
      const spClose = getSpPrice(p.isoDate);
      const sp500Nav = spClose != null ? (spClose / INCEPTION_SP) * INCEPTION_NAV : null;
      return {
        date: p.isoDate,
        fund_nav: Math.round(p.fundNav * 1000000) / 1000000,
        sp500_nav: sp500Nav != null ? Math.round(sp500Nav * 1000000) / 1000000 : null,
      };
    });

    // 5. Delete existing rows for these dates, then insert new ones
    const dates = rows.map(r => r.date);
    const { error: deleteErr } = await supabase
      .from('fund_nav_data')
      .delete()
      .in('date', dates);

    if (deleteErr) throw deleteErr;

    const { error: insertErr } = await supabase
      .from('fund_nav_data')
      .insert(rows);

    if (insertErr) throw insertErr;

    return NextResponse.json({
      success: true,
      inserted: rows.length,
      rows,
    });
  } catch (e) {
    console.error('POST /api/fund-nav error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
