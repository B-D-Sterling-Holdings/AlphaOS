import { calculateLiveAUM } from './accountingState.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchAccountingStateValue() {
  const res = await fetch('/api/accounting-state');
  const data = await res.json();
  return { ok: res.ok, value: data.value, version: data.version, error: data.error, status: res.status };
}

// Saves the accounting blob with an optimistic-concurrency guard. Pass the
// `baseVersion` the client last loaded; a stale save comes back as
// { conflict: true, current: { value }, version } (HTTP 409) instead of silently
// overwriting another admin's concurrent edit. On success returns { ok, version }.
export async function saveAccountingStateValue(value, baseVersion) {
  const res = await fetch('/api/accounting-state', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ value, baseVersion }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...data, status: res.status };
}

export async function saveAccountingState(state, baseVersion) {
  return saveAccountingStateValue(JSON.stringify(state), baseVersion);
}

async function fetchPortfolio() {
  const res = await fetch('/api/portfolio');
  return res.json();
}

async function fetchQuotes(tickers) {
  const res = await fetch(`/api/quotes?tickers=${tickers}`);
  return res.json();
}

export async function fetchLiveAUM() {
  const portfolio = await fetchPortfolio();
  const holdings = portfolio?.holdings || [];
  if (holdings.length === 0) return portfolio?.cash || 0;

  const tickers = holdings.map(holding => holding.ticker).join(',');
  const quotes = await fetchQuotes(tickers);
  return calculateLiveAUM(portfolio, quotes);
}
