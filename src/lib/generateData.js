import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });
import { getDb } from './db';

const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

function quarterLabel(date) {
  const month = date.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return `Q${quarter}`;
}

function quarterFrame(entries, valueName) {
  return entries.map(e => ({
    year: e.date.getFullYear(),
    quarter: quarterLabel(e.date),
    [valueName]: e.value,
  }));
}

function ttmSum(values) {
  const result = [];
  for (let i = 3; i < values.length; i++) {
    const sum = values[i].value + values[i - 1].value + values[i - 2].value + values[i - 3].value;
    result.push({ date: values[i].date, value: sum });
  }
  return result;
}

function ttmMean(values) {
  const result = [];
  for (let i = 3; i < values.length; i++) {
    const avg = (values[i].value + values[i - 1].value + values[i - 2].value + values[i - 3].value) / 4;
    result.push({ date: values[i].date, value: avg });
  }
  return result;
}

async function fetchAlphaVantage(func, symbol, apiKey) {
  const url = `${ALPHA_VANTAGE_BASE_URL}?function=${func}&symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const data = await res.json();

  if (data['Error Message']) throw new Error(`Alpha Vantage API error: ${data['Error Message']}`);
  if (data['Note']) throw new Error(`Alpha Vantage rate limit: ${data['Note']}`);
  if (data['Information']) throw new Error(`Alpha Vantage: ${data['Information']}`);
  return data;
}

function parseReports(data, key) {
  const reports = data[key] || [];
  return reports
    .filter(r => r.fiscalDateEnding)
    .map(r => {
      const parsed = { date: new Date(r.fiscalDateEnding) };
      for (const [k, v] of Object.entries(r)) {
        if (k === 'fiscalDateEnding' || k === 'reportedCurrency') continue;
        const num = parseFloat(v);
        parsed[k] = isNaN(num) ? null : num;
      }
      return parsed;
    })
    .sort((a, b) => a.date - b.date);
}

function pickSeries(reports, fieldNames) {
  for (const name of fieldNames) {
    const values = reports
      .filter(r => r[name] != null && !isNaN(r[name]))
      .map(r => ({ date: r.date, value: r[name] }));
    if (values.length > 0) return values;
  }
  return null;
}

function mergeQA(quarterly, annual) {
  if (!quarterly && !annual) return null;
  if (!quarterly) return annual;
  if (!annual) return quarterly;
  const earliestQ = quarterly[0].date;
  const before = annual.filter(a => a.date < earliestQ);
  return [...before, ...quarterly].sort((a, b) => a.date - b.date);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// A cross-tenant upsert conflict surfaces as an RLS violation: until
// scripts/migrations/009_finish_tenant_keys.sql runs, ticker data is keyed
// GLOBALLY on (ticker, data_type), so once any tenant holds a row for a name
// no other tenant can write theirs. Name the real fix instead of leaking the
// raw Postgres error to the toast.
function saveError(what, error) {
  if (/row-level security/i.test(error?.message || '')) {
    return new Error(
      `Failed to save ${what}: another workspace already holds ${what} for this ticker, and the database still uses global ticker keys. ` +
      `Run scripts/migrations/009_finish_tenant_keys.sql in the Supabase SQL editor, then retry.`
    );
  }
  return new Error(`Failed to save ${what}: ${error?.message || 'unknown error'}`);
}

export async function generateTickerData(ticker, apiKey) {
  const supabase = await getDb();
  const upper = ticker.toUpperCase();

  // Fetch prices from yahoo-finance2. A symbol Yahoo doesn't carry throws
  // "No data found, symbol may be delisted" here — usually not a delisting
  // but a listing mismatch (foreign names need an exchange suffix, e.g. UMG
  // trades as UMG.AS / UMGNF). Say that instead of parroting Yahoo.
  let chartResult;
  try {
    chartResult = await yahooFinance.chart(upper, { period1: '1990-01-01', period2: new Date().toISOString().split('T')[0] });
  } catch (e) {
    if (/no data found/i.test(e?.message || '')) {
      throw new Error(
        `Yahoo Finance has no data for "${upper}" — the symbol is likely wrong for its listing (foreign names need an exchange suffix, e.g. UMG.AS, or use the US OTC symbol). Re-add the ticker on the Watchlist page to get symbol suggestions.`
      );
    }
    throw e;
  }
  const hist = chartResult.quotes || [];
  if (!hist || hist.length === 0) throw new Error(`No price data for ${upper}`);

  const dailyPrices = hist
    .filter(h => h.close != null)
    .map(h => ({
      date: h.date instanceof Date
        ? h.date.toISOString().split('T')[0]
        : new Date(h.date).toISOString().split('T')[0],
      close: h.close,
    }));

  // Market data metrics
  const currentPrice = dailyPrices[dailyPrices.length - 1].close;
  const currentDate = dailyPrices[dailyPrices.length - 1].date;
  const last252 = dailyPrices.slice(-252);
  const week52High = Math.max(...last252.map(p => p.close));
  const week52Low = Math.min(...last252.map(p => p.close));
  const pctFromHigh = ((currentPrice - week52High) / week52High) * 100;

  const marketData = [
    { metric: 'current_price', value: currentPrice, date: currentDate },
    { metric: '52_week_high', value: week52High, date: currentDate },
    { metric: '52_week_low', value: week52Low, date: currentDate },
    { metric: 'pct_from_52week_high', value: Math.round(pctFromHigh * 100) / 100, date: currentDate },
  ];

  if (dailyPrices.length >= 252) {
    const price1yAgo = dailyPrices[dailyPrices.length - 252].close;
    const pct1y = ((currentPrice - price1yAgo) / price1yAgo) * 100;
    marketData.push({ metric: 'pct_change_1y', value: Math.round(pct1y * 100) / 100, date: currentDate });
  }

  // Save prices to Supabase. Failing here (not just logging) matters twice
  // over: silently dropping the price history left half-generated tickers, and
  // erroring before the Alpha Vantage calls below spares ~25s of rate-limit
  // sleeps plus three calls of daily API quota when the write can't land.
  const { error: priceError } = await supabase.from('ticker_prices').upsert([
    { ticker: upper, data_type: 'daily_prices', data: dailyPrices, updated_at: new Date().toISOString() },
    { ticker: upper, data_type: 'market_data', data: marketData, updated_at: new Date().toISOString() },
  ]);
  if (priceError) throw saveError('price history', priceError);

  // Fetch fundamentals from Alpha Vantage
  const incomeRaw = await fetchAlphaVantage('INCOME_STATEMENT', upper, apiKey);
  const incomeQ = parseReports(incomeRaw, 'quarterlyReports');
  const incomeA = parseReports(incomeRaw, 'annualReports');

  // Alpha Vantage answers symbols it doesn't cover (OTC pink sheets, many
  // foreign listings — e.g. CNSWF) with an empty body `{}` instead of an
  // error, so the run used to sail through, report success with zero
  // fundamentals rows, and the research page then said "no data" forever.
  // Fail on the first empty statement: it spares the two remaining calls
  // (+24s of rate-limit sleeps) and turns the silent nothing into an
  // actionable message.
  if (incomeQ.length === 0 && incomeA.length === 0) {
    throw new Error(
      `Alpha Vantage has no fundamentals for ${upper} — it generally doesn't cover OTC or foreign listings. Try the company's primary exchange symbol.`
    );
  }
  await sleep(12000);

  const balanceRaw = await fetchAlphaVantage('BALANCE_SHEET', upper, apiKey);
  const balanceQ = parseReports(balanceRaw, 'quarterlyReports');
  const balanceA = parseReports(balanceRaw, 'annualReports');
  await sleep(12000);

  const cashRaw = await fetchAlphaVantage('CASH_FLOW', upper, apiKey);
  const cashQ = parseReports(cashRaw, 'quarterlyReports');
  const cashA = parseReports(cashRaw, 'annualReports');

  // Extract series
  let revenueQ = pickSeries(incomeQ, ['totalRevenue']);
  const revenueA = pickSeries(incomeA, ['totalRevenue']);

  const operatingIncomeQ = pickSeries(incomeQ, ['operatingIncome']);

  let epsQ = pickSeries(incomeQ, ['dilutedEPS', 'reportedEPS']);
  if (!epsQ) {
    const netIncome = pickSeries(incomeQ, ['netIncome', 'netIncomeFromContinuingOperations']);
    const dilutedShares = pickSeries(incomeQ, ['dilutedAverageShares', 'dilutedAverageSharesOutstanding']);
    const sharesOutQ = pickSeries(balanceQ, ['commonStockSharesOutstanding', 'commonStock']);
    if (netIncome && (dilutedShares || sharesOutQ)) {
      const denom = dilutedShares || sharesOutQ;
      epsQ = netIncome.map(n => {
        const d = denom.find(s => s.date.getTime() === n.date.getTime());
        return d ? { date: n.date, value: n.value / d.value } : null;
      }).filter(Boolean);
    }
  }

  let fcfQ = pickSeries(cashQ, ['freeCashFlow']);
  if (!fcfQ) {
    const opCf = pickSeries(cashQ, ['operatingCashflow']);
    const capex = pickSeries(cashQ, ['capitalExpenditures']);
    if (opCf && capex) {
      fcfQ = opCf.map(o => {
        const c = capex.find(x => x.date.getTime() === o.date.getTime());
        return c ? { date: o.date, value: o.value - c.value } : null;
      }).filter(Boolean);
    }
  }

  const sharesOutQ = pickSeries(balanceQ, ['commonStockSharesOutstanding', 'commonStock']);

  const fundamentalUpserts = [];

  // Revenue
  const revenue = revenueQ;
  if (revenue && revenue.length >= 4) {
    const ttm = ttmSum(revenue);
    if (ttm.length > 0) {
      fundamentalUpserts.push({
        ticker: upper,
        data_type: 'revenue',
        data: quarterFrame(ttm, 'revenue'),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Operating margins
  if (operatingIncomeQ && revenue && revenue.length >= 4 && operatingIncomeQ.length >= 4) {
    const ttmOp = ttmSum(operatingIncomeQ);
    const ttmRev = ttmSum(revenue);
    const margins = [];
    for (let i = 0; i < ttmOp.length; i++) {
      const revEntry = ttmRev.find(r => r.date.getTime() === ttmOp[i].date.getTime());
      if (revEntry && revEntry.value !== 0) {
        margins.push({ date: ttmOp[i].date, value: ttmOp[i].value / revEntry.value });
      }
    }
    if (margins.length > 0) {
      fundamentalUpserts.push({
        ticker: upper,
        data_type: 'operating_margins',
        data: quarterFrame(margins, 'operating_margin'),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Shares outstanding (buybacks)
  if (sharesOutQ && sharesOutQ.length >= 4) {
    const ttm = ttmMean(sharesOutQ);
    if (ttm.length > 0) {
      fundamentalUpserts.push({
        ticker: upper,
        data_type: 'buybacks',
        data: quarterFrame(ttm, 'shares_outstanding'),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // EPS
  if (epsQ && epsQ.length >= 4) {
    const ttm = ttmSum(epsQ);
    if (ttm.length > 0) {
      fundamentalUpserts.push({
        ticker: upper,
        data_type: 'eps',
        data: quarterFrame(ttm, 'eps_diluted'),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // FCF
  if (fcfQ && fcfQ.length >= 4) {
    const ttm = ttmSum(fcfQ);
    if (ttm.length > 0) {
      fundamentalUpserts.push({
        ticker: upper,
        data_type: 'fcf',
        data: quarterFrame(ttm, 'free_cash_flow'),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Belt-and-braces for the partial-coverage case (statements exist but no
  // metric has the 4 quarters TTM math needs): the page treats a ticker with
  // no fundamentals rows as "no data", so returning success here would lie.
  if (fundamentalUpserts.length === 0) {
    throw new Error(
      `Alpha Vantage returned no usable fundamentals for ${upper} (fewer than 4 quarters of every metric), so the research charts would be empty.`
    );
  }
  const { error } = await supabase.from('ticker_fundamentals').upsert(fundamentalUpserts);
  if (error) throw saveError('fundamentals', error);

  return { ticker: upper, pricesDays: dailyPrices.length, fundamentalsTypes: fundamentalUpserts.length };
}
