import { computeValuationModel } from './valuationModel.js';

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchWatchlist() {
  const res = await fetch('/api/watchlist');
  return res.json();
}

export async function fetchPortfolio() {
  const res = await fetch('/api/portfolio');
  return res.json();
}

export async function fetchTickerFundamentals(ticker) {
  const res = await fetch(`/api/ticker/${ticker}`);
  return res.json();
}

export async function fetchThesis(ticker) {
  const res = await fetch(`/api/thesis/${ticker}`);
  return res.json();
}

export function stripTransientThesisFields(thesis) {
  const { _activeNewsIdx, ...rest } = thesis || {};
  return rest;
}

export async function saveThesis(ticker, thesis) {
  const res = await fetch(`/api/thesis/${ticker}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(stripTransientThesisFields(thesis)),
  });
  return res.json();
}

export async function fetchQuotes(tickers) {
  const tickersParam = Array.isArray(tickers) ? tickers.join(',') : tickers;
  const res = await fetch(`/api/quotes?tickers=${encodeURIComponent(tickersParam || '')}`);
  return res.json();
}

export async function fetchQuote(ticker) {
  const data = await fetchQuotes(ticker);
  return data.quotes?.[ticker] || null;
}

export async function fetchSavedValuationModel(ticker) {
  const res = await fetch(`/api/model/${ticker}`);
  return res.json();
}

const parseModelNumber = (value) => (
  value === '' || value === undefined || value === null || isNaN(Number(value))
    ? 0
    : Number(value)
);

export function buildComputedValuationModel(modelJson, livePrice = 0) {
  if (!modelJson?.exists || !modelJson.inputs) return null;
  const sharePrice = parseModelNumber(modelJson.inputs.sharePrice) || (livePrice || 0);
  const inputs = { ...modelJson.inputs, sharePrice };
  return { inputs, computed: computeValuationModel(inputs) };
}

export async function fetchComputedValuationModel(ticker, livePrice = 0) {
  const modelJson = await fetchSavedValuationModel(ticker);
  return buildComputedValuationModel(modelJson, livePrice);
}
