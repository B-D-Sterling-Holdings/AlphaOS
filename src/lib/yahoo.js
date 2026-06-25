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

export async function fetchQuotes(tickers) {
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
  for (const t of tickers) {
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
          result[t] = { price: null, error: retryErr.message };
          continue;
        }
      }
    }

    const summary = await yahooFinance.quoteSummary(t, {
      modules: ['financialData', 'defaultKeyStatistics', 'assetProfile'],
    }).catch(() => null);

    result[t] = buildQuote(quote, summary);
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

  for (const t of tickers) {
    try {
      if (period === '1d') {
        const quote = await yahooFinance.quote(t);
        const price = safeFloat(quote.regularMarketPrice);
        const prev = safeFloat(quote.regularMarketPreviousClose);
        if (price && prev) {
          result[t] = Math.round(((price - prev) / prev) * 100 * 10000) / 10000;
        } else {
          result[t] = 0;
        }
      } else {
        const periodMap = { '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825 };
        const days = periodMap[period];
        if (!days) { result[t] = 0; continue; }

        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);

        const chartResult = await yahooFinance.chart(t, {
          period1: start.toISOString().split('T')[0],
          period2: end.toISOString().split('T')[0],
        });
        const hist = chartResult.quotes || [];

        if (!hist || hist.length < 2) {
          result[t] = 0;
          continue;
        }

        const startPrice = hist[0].close;
        const endPrice = hist[hist.length - 1].close;
        if (startPrice > 0) {
          result[t] = Math.round(((endPrice - startPrice) / startPrice) * 100 * 10000) / 10000;
        } else {
          result[t] = 0;
        }
      }
    } catch {
      result[t] = 0;
    }
  }

  return result;
}
