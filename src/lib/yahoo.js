import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

function safeFloat(val) {
  if (val == null) return null;
  const v = Number(val);
  return Number.isFinite(v) ? v : null;
}

function getEffectiveMarketPrice(quote) {
  const postMarketPrice = safeFloat(quote.postMarketPrice);
  if (postMarketPrice) return { price: postMarketPrice, session: 'post' };

  const preMarketPrice = safeFloat(quote.preMarketPrice);
  if (preMarketPrice) return { price: preMarketPrice, session: 'pre' };

  const regularMarketPrice = safeFloat(quote.regularMarketPrice);
  if (regularMarketPrice) return { price: regularMarketPrice, session: 'regular' };

  return { price: null, session: 'unknown' };
}

function buildQuote(quote, summary) {
  const fin = summary?.financialData || {};
  const stats = summary?.defaultKeyStatistics || {};
  const profile = summary?.assetProfile || {};

  const { price, session } = getEffectiveMarketPrice(quote);
  const regularMarketPrice = safeFloat(quote.regularMarketPrice);
  const postMarketPrice = safeFloat(quote.postMarketPrice);
  const preMarketPrice = safeFloat(quote.preMarketPrice);
  const prev = safeFloat(quote.regularMarketPreviousClose);
  const dayChange = (price && prev) ? price - prev : 0;
  const dayChangePct = prev ? (dayChange / prev) * 100 : 0;

  return {
    shortName: quote.shortName || quote.longName || '',
    exchange: quote.fullExchangeName || quote.exchange || '',
    price,
    regularMarketPrice,
    postMarketPrice,
    preMarketPrice,
    priceSession: session,
    previousClose: prev,
    dayChange: Math.round(dayChange * 10000) / 10000,
    dayChangePct: Math.round(dayChangePct * 10000) / 10000,
    marketCap: safeFloat(quote.marketCap),
    enterpriseValue: safeFloat(stats.enterpriseValue),
    evToEbitda: safeFloat(stats.enterpriseToEbitda),
    avgVolume: safeFloat(quote.averageDailyVolume3Month),
    dividendYield: safeFloat(quote.trailingAnnualDividendYield),
    trailingPE: safeFloat(quote.trailingPE),
    forwardPE: safeFloat(quote.forwardPE),
    revenueGrowth: safeFloat(fin.revenueGrowth),
    earningsGrowth: safeFloat(fin.earningsGrowth),
    roic: safeFloat(fin.returnOnEquity),
    fiftyTwoWeekHigh: safeFloat(quote.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: safeFloat(quote.fiftyTwoWeekLow),
    sector: profile.sector || '',
  };
}

// Yahoo answers a symbol it doesn't carry from quote() with an empty object
// rather than an error (only chart() throws "No data found"), so a bogus
// ticker sails through the watchlist and every quote fetch, and the first
// loud failure is Generate Data ~30s in. "Exists" therefore means a real
// symbol came back. On a miss, Yahoo search supplies the listings the user
// probably meant (e.g. UMG → UMGNF / UMG.AS); search results are taken
// unvalidated because yahoo-finance2's schema rejects some live payloads
// (typeDisp casing) that are perfectly usable here.
export async function validateTicker(ticker) {
  const upper = (ticker || '').trim().toUpperCase();
  if (!upper) return { valid: false, suggestions: [] };

  let quote = null;
  try {
    quote = await yahooFinance.quote(upper);
  } catch {}
  if (quote?.symbol) {
    return {
      valid: true,
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || '',
      exchange: quote.fullExchangeName || quote.exchange || '',
    };
  }

  let suggestions = [];
  try {
    const res = await yahooFinance.search(upper, {}, { validateResult: false });
    suggestions = (res.quotes || [])
      .filter(q => q.symbol && !['OPTION', 'FUTURE'].includes(q.quoteType))
      .slice(0, 4)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || '',
        exchange: q.exchDisp || q.exchange || '',
      }));
  } catch {}
  return { valid: false, suggestions };
}

// `basic: true` returns only the batch-quote fields (price, day change, name,
// 52-week range, marketCap) and SKIPS the per-ticker quoteSummary round-trips.
// Callers that render just a price/mover — the dashboard's holdings pie and
// movers — don't touch the fundamentals, so paying for N quoteSummary calls
// there is pure latency (it was the dashboard's slowest hop). The watchlist,
// which shows PE/EV/growth, omits the flag and gets the full payload.
export async function fetchQuotes(tickers, { basic = false } = {}) {
  const result = {};
  if (!tickers?.length) return result;

  // 1. Fetch all prices in a SINGLE batched request. This is the data the UI
  //    treats as required, and one request is far less likely to be rate-limited
  //    by Yahoo than N parallel quote+quoteSummary pairs (which trips the limit
  //    in dev, where StrictMode/Fast Refresh can double the burst).
  const quoteMap = {};
  try {
    const quotes = await yahooFinance.quote(tickers);
    for (const q of (Array.isArray(quotes) ? quotes : [quotes])) {
      if (q?.symbol) quoteMap[q.symbol] = q;
    }
  } catch {
    // Batch failed entirely — the per-ticker fallback below will retry.
  }

  // 2. Layer in the richer quoteSummary fundamentals per ticker. These are
  //    best-effort: a failure here (e.g. rate limit) leaves the price intact
  //    rather than nulling it out and surfacing a "failed to load" error.
  //    Resolving one ticker must NEVER throw — a single bad symbol has to
  //    degrade to a no-data entry, not sink the whole response.
  async function resolveTicker(t) {
    let quote = quoteMap[t];
    if (!quote) {
      // Symbol missing from the batch — try once, then retry after a short delay.
      try {
        quote = await yahooFinance.quote(t);
      } catch {
        try {
          await new Promise(r => setTimeout(r, 500));
          quote = await yahooFinance.quote(t);
        } catch (retryErr) {
          return { price: null, error: retryErr.message };
        }
      }
    }

    // Yahoo RESOLVES an unknown/foreign symbol (e.g. bare "UMG", which only
    // lists as UMG.AS) to `undefined` instead of throwing, so the catch above
    // never fires. Guard here: without it buildQuote reads
    // `undefined.postMarketPrice`, throws, and 500s the entire /api/quotes
    // response — blanking out every other (valid) ticker on the watchlist.
    if (!quote?.symbol) return { price: null, error: 'no data' };

    // Basic mode: everything the caller needs is already in the batch quote —
    // don't pay for the fundamentals round-trip. buildQuote handles a null
    // summary (the fundamentals fields just come back null).
    if (basic) return buildQuote(quote, null);

    const summary = await yahooFinance.quoteSummary(t, {
      modules: ['financialData', 'defaultKeyStatistics', 'assetProfile'],
    }).catch(() => null);

    return buildQuote(quote, summary);
  }

  // The fundamentals calls are independent per ticker, so run them in small
  // concurrent windows rather than strictly one-at-a-time — for a full
  // watchlist that's the difference between ~N sequential round-trips and a
  // handful of batched ones. The window stays small on purpose: a flat parallel
  // burst of all N trips Yahoo's rate limit (worse under dev StrictMode's
  // double-fire), but a few at a time does not.
  const CONCURRENCY = 6;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const window = tickers.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(window.map(resolveTicker));
    window.forEach((t, j) => { result[t] = resolved[j]; });
  }

  return result;
}

export async function fetchFundamentals(tickers) {
  const results = await Promise.allSettled(
    tickers.map(async (t) => {
      // Try quoteSummary first for full data
      let summary = null;
      try {
        summary = await yahooFinance.quoteSummary(t, {
          modules: ['summaryDetail', 'assetProfile', 'defaultKeyStatistics', 'financialData'],
        });
      } catch {
        // quoteSummary can fail for ETFs/funds — fall back to basic quote
      }

      // If quoteSummary failed or returned no profile, try basic quote for sector/type info
      let quoteData = null;
      if (!summary?.assetProfile?.sector) {
        try {
          quoteData = await yahooFinance.quote(t);
        } catch {}
      }

      const profile = summary?.assetProfile || {};
      const detail = summary?.summaryDetail || {};
      const stats = summary?.defaultKeyStatistics || {};

      // Determine sector: prefer assetProfile, fall back to quoteType category
      let sector = profile.sector || null;
      if (!sector && quoteData) {
        // Map ETF/fund quoteTypes to meaningful categories
        const qt = quoteData.quoteType;
        if (qt === 'ETF' || qt === 'MUTUALFUND') {
          // Use the fund's display name to infer a rough sector
          const name = (quoteData.shortName || quoteData.longName || '').toLowerCase();
          if (name.includes('tech') || name.includes('semiconductor') || name.includes('software')) sector = 'Technology';
          else if (name.includes('health') || name.includes('biotech') || name.includes('pharma')) sector = 'Healthcare';
          else if (name.includes('financ') || name.includes('bank')) sector = 'Financial Services';
          else if (name.includes('energy') || name.includes('oil') || name.includes('gas')) sector = 'Energy';
          else if (name.includes('real estate') || name.includes('reit')) sector = 'Real Estate';
          else if (name.includes('utilit')) sector = 'Utilities';
          else if (name.includes('industrial')) sector = 'Industrials';
          else if (name.includes('consumer') && name.includes('stapl')) sector = 'Consumer Defensive';
          else if (name.includes('consumer') || name.includes('retail')) sector = 'Consumer Cyclical';
          else if (name.includes('communicat') || name.includes('media')) sector = 'Communication Services';
          else if (name.includes('material') || name.includes('mining') || name.includes('metal')) sector = 'Basic Materials';
          else if (name.includes('gold') || name.includes('silver') || name.includes('commodit')) sector = 'Commodities';
          else if (name.includes('bond') || name.includes('treasury') || name.includes('fixed income')) sector = 'Fixed Income';
          else if (name.includes('s&p') || name.includes('total market') || name.includes('index')) sector = 'Broad Market';
          else sector = qt === 'ETF' ? 'ETF' : 'Fund';
        }
      }

      return {
        ticker: t,
        data: {
          sector: sector || 'Unknown',
          industry: profile.industry || (quoteData?.shortName || 'Unknown'),
          marketCap: safeFloat(detail.marketCap) || safeFloat(quoteData?.marketCap),
          pe: safeFloat(detail.trailingPE) || safeFloat(quoteData?.trailingPE),
          forwardPe: safeFloat(detail.forwardPE) || safeFloat(quoteData?.forwardPE),
          peg: safeFloat(stats.pegRatio),
          pb: safeFloat(stats.priceToBook) || safeFloat(quoteData?.priceToBook),
          ps: safeFloat(detail.priceToSalesTrailing12Months),
          evEbitda: safeFloat(stats.enterpriseToEbitda),
          evRevenue: safeFloat(stats.enterpriseToRevenue),
          beta: safeFloat(stats.beta),
        },
      };
    })
  );

  const result = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      result[r.value.ticker] = r.value.data;
    } else {
      // Extract ticker from the error if possible — fallback
    }
  }

  // Fill in any missing tickers
  for (const t of tickers) {
    if (!result[t]) result[t] = { sector: 'Unknown', industry: 'Unknown' };
  }

  return result;
}

export async function fetchPeriodChanges(tickers, period) {
  const result = {};
  const periodMap = { '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825 };

  // Per-ticker change (a delisted/foreign symbol quietly falls back to 0 rather
  // than sinking the response — same contract as before).
  async function changeFor(t) {
    try {
      if (period === '1d') {
        const quote = await yahooFinance.quote(t);
        const price = safeFloat(quote?.regularMarketPrice);
        const prev = safeFloat(quote?.regularMarketPreviousClose);
        if (price && prev) return Math.round(((price - prev) / prev) * 100 * 10000) / 10000;
        return 0;
      }

      const days = periodMap[period];
      if (!days) return 0;

      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);

      const chartResult = await yahooFinance.chart(t, {
        period1: start.toISOString().split('T')[0],
        period2: end.toISOString().split('T')[0],
      });
      const hist = chartResult?.quotes || [];
      if (hist.length < 2) return 0;

      const startPrice = hist[0].close;
      const endPrice = hist[hist.length - 1].close;
      if (startPrice > 0) return Math.round(((endPrice - startPrice) / startPrice) * 100 * 10000) / 10000;
      return 0;
    } catch {
      return 0;
    }
  }

  // Bounded concurrency (see fetchQuotes): the Dip Finder asks for every
  // watchlist name at once, so a strictly sequential chart() loop is the slow
  // path the user feels when switching periods. A small window parallelizes it
  // without bursting past Yahoo's rate limit.
  const CONCURRENCY = 6;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const window = tickers.slice(i, i + CONCURRENCY);
    const changes = await Promise.all(window.map(changeFor));
    window.forEach((t, j) => { result[t] = changes[j]; });
  }

  return result;
}
