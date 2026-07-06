export const BENCHMARK_TICKER = 'SPY';

export function holdingsQuoteTickers(holdings = [], benchmarkTicker = BENCHMARK_TICKER) {
  return Array.from(new Set([...holdings.map(holding => holding.ticker), benchmarkTicker]))
    .filter(Boolean)
    .join(',');
}

export function quoteErrorMessage(holdings = [], quotesPayload = {}) {
  const failedTickers = holdings
    .map(holding => holding.ticker)
    .filter(ticker => !quotesPayload[ticker]?.price);

  if (failedTickers.length === 0) return null;

  const providerThrottled =
    failedTickers.length === holdings.length ||
    failedTickers.some(ticker => /fetch failed|too many requests|429|rate.?limit|timed? ?out/i.test(quotesPayload[ticker]?.error || ''));

  if (providerThrottled) {
    return 'Live prices are temporarily rate-limited by the market-data provider (Yahoo Finance). Wait a minute, then hit Reload — refreshing immediately will stay throttled.';
  }
  return `Failed to load live prices for: ${failedTickers.join(', ')}. Try Reload.`;
}

export function holdingsWithPrices(holdings = [], quotes = {}) {
  return holdings.map(holding => ({
    ticker: holding.ticker,
    shares: holding.shares,
    cost_basis: holding.cost_basis,
    price: quotes[holding.ticker]?.price || holding.cost_basis,
  }));
}

export function buildPositions(holdings = [], quotes = {}) {
  return holdings.map(holding => {
    const quote = quotes[holding.ticker];
    const price = quote?.price || holding.cost_basis;
    const dayChange = quote?.dayChange || 0;
    const value = holding.shares * price;
    const cost = holding.shares * holding.cost_basis;
    const unrealizedPnl = value - cost;
    const unrealizedPnlPct = cost > 0 ? (unrealizedPnl / cost) * 100 : 0;
    const dayChangePct = quote?.dayChangePct || 0;
    const dailyPnl = holding.shares * dayChange;
    return {
      ticker: holding.ticker,
      shares: holding.shares,
      costBasis: holding.cost_basis,
      price,
      value,
      cost,
      unrealizedPnl,
      unrealizedPnlPct,
      dayChange,
      dayChangePct,
      dailyPnl,
    };
  });
}

export function portfolioTotals({ portfolio, quotes = {}, quotesLoading = false, benchmarkTicker = BENCHMARK_TICKER }) {
  const holdings = portfolio?.holdings || [];
  const cashVal = portfolio?.cash || 0;
  const positions = buildPositions(holdings, quotes);
  const quotesLoaded = !quotesLoading && (holdings.length === 0 || Object.keys(quotes).length > 0);
  const nav = positions.reduce((sum, position) => sum + position.value, 0);
  const totalAum = nav + cashVal;
  const totalCost = positions.reduce((sum, position) => sum + position.cost, 0);
  const totalUnrealizedPnl = nav - totalCost;
  const totalDailyChange = positions.reduce((sum, position) => sum + position.dailyPnl, 0);
  const previousTotalAum = totalAum - totalDailyChange;
  const totalDailyChangePct = previousTotalAum > 0 ? (totalDailyChange / previousTotalAum) * 100 : 0;

  return {
    holdings,
    cashVal,
    positions,
    quotesLoaded,
    nav,
    totalAum,
    totalCost,
    totalUnrealizedPnl,
    totalDailyChange,
    totalDailyChangePct,
    benchmarkDayChangePct: quotes[benchmarkTicker]?.dayChangePct,
  };
}

export function treemapPositions(positions = []) {
  return positions.map(position => ({
    ticker: position.ticker,
    value: position.value,
    pnlPct: position.unrealizedPnlPct,
    dayChangePct: position.dayChangePct,
  }));
}

export function filterPositions(positions = [], search = '') {
  const q = search.toLowerCase();
  return positions
    .filter(position => !q || position.ticker.toLowerCase().includes(q))
    .sort((a, b) => b.value - a.value);
}

export function clampExposure(value) {
  return Math.max(0, Math.min(1, parseFloat(value) || 0));
}

export function withFactorExposure(factorConfig, ticker, factor, value) {
  const current = factorConfig?.exposures || {};
  const tickerExposures = { ...(current[ticker] || {}), [factor]: clampExposure(value) };
  return { exposures: { [ticker]: tickerExposures } };
}

export function withAddedFactor(factorConfig, name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return {
    factors: [...(factorConfig?.factors || []), trimmed],
    importanceWeights: { ...(factorConfig?.importanceWeights || {}), [trimmed]: 0.5 },
  };
}

export function withoutFactor(factorConfig, name) {
  const factors = (factorConfig?.factors || []).filter(factor => factor !== name);
  const importanceWeights = { ...(factorConfig?.importanceWeights || {}) };
  delete importanceWeights[name];
  const exposures = { ...(factorConfig?.exposures || {}) };
  for (const ticker of Object.keys(exposures)) {
    if (exposures[ticker][name] !== undefined) {
      exposures[ticker] = { ...exposures[ticker] };
      delete exposures[ticker][name];
    }
  }
  return { factors, importanceWeights, exposures };
}

export function withImportanceWeight(factorConfig, factor, value) {
  return {
    importanceWeights: {
      ...(factorConfig?.importanceWeights || {}),
      [factor]: clampExposure(value),
    },
  };
}
