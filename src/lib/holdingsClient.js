import { holdingsQuoteTickers, holdingsWithPrices } from './holdingsPortfolio.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchPortfolioData() {
  const res = await fetch('/api/portfolio');
  return res.json();
}

export async function fetchQuotesForHoldings(holdings) {
  const tickers = holdingsQuoteTickers(holdings);
  const res = await fetch(`/api/quotes?tickers=${tickers}`);
  return res.json();
}

export async function fetchQuotesForTickers(tickers) {
  const tickersParam = Array.isArray(tickers) ? tickers.join(',') : tickers;
  const res = await fetch(`/api/quotes?tickers=${tickersParam}`);
  return res.json();
}

export async function fetchRiskForHoldings(holdings, quotes) {
  const res = await fetch('/api/risk', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ holdings: holdingsWithPrices(holdings, quotes) }),
  });
  return res.json();
}

export async function fetchFundamentalsForHoldings(holdings) {
  const tickers = holdings.map(holding => holding.ticker).join(',');
  const res = await fetch(`/api/fundamentals?tickers=${tickers}`);
  return res.json();
}

export async function fetchSectorLabels() {
  const res = await fetch('/api/sector-labels');
  return res.json();
}

export async function saveSectorConfig(updates) {
  const res = await fetch('/api/sector-labels', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function fetchFactorConfig() {
  const res = await fetch('/api/factor-config');
  return res.json();
}

export async function saveFactorConfigData(updates) {
  const res = await fetch('/api/factor-config', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });
  return res.json();
}

export async function saveHolding({ ticker, shares, costBasis }) {
  const res = await fetch('/api/holdings', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ ticker, shares: Number(shares), cost_basis: Number(costBasis) }),
  });
  return res.json();
}

export async function deleteHolding(ticker) {
  const res = await fetch(`/api/holdings?ticker=${ticker}`, { method: 'DELETE' });
  return res.json();
}

export async function saveCashBalance(cash) {
  const res = await fetch('/api/cash', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ cash: Number(cash) }),
  });
  return res.json();
}

export async function validateTicker(ticker) {
  const res = await fetch(`/api/validate-ticker?ticker=${encodeURIComponent(ticker)}`);
  return res.json();
}
