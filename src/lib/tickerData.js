import { getDb } from './db';

export async function tickerDataExists(ticker) {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('ticker_fundamentals')
    .select('ticker')
    .eq('ticker', ticker.toUpperCase())
    .limit(1);

  if (error) return false;
  return data && data.length > 0;
}

export async function loadTickerFundamentals(ticker) {
  const supabase = await getDb();
  const upper = ticker.toUpperCase();

  const [{ data: fundamentals }, { data: prices }] = await Promise.all([
    supabase.from('ticker_fundamentals').select('data_type, data').eq('ticker', upper),
    supabase.from('ticker_prices').select('data_type, data').eq('ticker', upper),
  ]);

  const result = {
    revenue: [],
    eps: [],
    fcf: [],
    operating_margins: [],
    buybacks: [],
    daily_prices: [],
    market_data: [],
  };

  for (const row of (fundamentals || [])) {
    if (result.hasOwnProperty(row.data_type)) {
      result[row.data_type] = row.data;
    }
  }

  for (const row of (prices || [])) {
    if (result.hasOwnProperty(row.data_type)) {
      result[row.data_type] = row.data;
    }
  }

  return result;
}

export function getMarketDataPoint(marketData, metric) {
  const row = marketData.find(r => r.metric === metric);
  return row ? row.value : null;
}

export function computeValuationMetrics(data) {
  const { daily_prices, eps, fcf, revenue, market_data } = data;

  const currentPrice = getMarketDataPoint(market_data, 'current_price')
    || (daily_prices.length ? daily_prices[daily_prices.length - 1].close : null);

  const latestEps = eps.length ? eps[eps.length - 1].eps_diluted : null;
  const latestFcf = fcf.length ? fcf[fcf.length - 1].free_cash_flow : null;
  const latestRevenue = revenue.length ? revenue[revenue.length - 1].revenue : null;

  const buybacks = data.buybacks || [];
  const latestShares = buybacks.length ? buybacks[buybacks.length - 1].shares_outstanding : null;

  const peRatio = (currentPrice && latestEps && latestEps !== 0) ? currentPrice / latestEps : null;
  const marketCap = (currentPrice && latestShares) ? currentPrice * latestShares : null;
  const fcfYield = (latestFcf && marketCap && marketCap !== 0) ? (latestFcf / marketCap) * 100 : null;
  const priceToSales = (marketCap && latestRevenue && latestRevenue !== 0) ? marketCap / latestRevenue : null;

  const quarterEndDate = (row) => {
    const qNum = parseInt(row.quarter.replace('Q', ''));
    const month = String(qNum * 3).padStart(2, '0');
    const lastDay = [0, 31, 30, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][qNum * 3];
    return `${row.year}-${month}-${String(lastDay).padStart(2, '0')}`;
  };

  const epsLookup = eps
    .filter(e => e.eps_diluted && e.eps_diluted !== 0)
    .map(e => ({ date: quarterEndDate(e), value: e.eps_diluted }));
  const fcfLookup = fcf
    .map(f => ({ date: quarterEndDate(f), value: f.free_cash_flow }));
  const sharesLookup = (data.buybacks || [])
    .filter(b => b.shares_outstanding && b.shares_outstanding > 0)
    .map(b => ({ date: quarterEndDate(b), value: b.shares_outstanding }));

  const findLatest = (lookup, date) => {
    let result = null;
    for (const item of lookup) {
      if (item.date <= date) result = item.value;
      else break;
    }
    return result;
  };

  const peHistory = [];
  if (epsLookup.length && daily_prices.length) {
    for (let i = 0; i < daily_prices.length; i++) {
      const p = daily_prices[i];
      const epsVal = findLatest(epsLookup, p.date);
      if (epsVal && p.close) {
        peHistory.push({ date: p.date, pe_ratio: p.close / epsVal });
      }
    }
  }

  const fcfYieldHistory = [];
  if (fcfLookup.length && sharesLookup.length && daily_prices.length) {
    for (let i = 0; i < daily_prices.length; i++) {
      const p = daily_prices[i];
      const fcfVal = findLatest(fcfLookup, p.date);
      const sharesVal = findLatest(sharesLookup, p.date);
      if (fcfVal && sharesVal && p.close) {
        const mc = p.close * sharesVal;
        if (mc !== 0) {
          fcfYieldHistory.push({ date: p.date, fcf_yield: (fcfVal / mc) * 100 });
        }
      }
    }
  }

  return {
    currentPrice,
    peRatio,
    fcfYield,
    priceToSales,
    peHistory,
    fcfYieldHistory,
    high52w: getMarketDataPoint(market_data, '52_week_high'),
    low52w: getMarketDataPoint(market_data, '52_week_low'),
    pctFrom52wHigh: getMarketDataPoint(market_data, 'pct_from_52week_high'),
  };
}
