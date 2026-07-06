import { calculateLiveAUM } from './accountingState.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchAccountingStateValue() {
  const res = await fetch('/api/accounting-state');
  const data = await res.json();
  return { ok: res.ok, value: data.value, error: data.error, status: res.status };
}

export async function saveAccountingStateValue(value) {
  const res = await fetch('/api/accounting-state', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ value }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...data, status: res.status };
}

export async function saveAccountingState(state) {
  return saveAccountingStateValue(JSON.stringify(state));
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
