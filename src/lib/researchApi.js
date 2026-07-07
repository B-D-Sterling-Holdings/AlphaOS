import { computeValuationModel } from './valuationModel.js';
import { mergeThesis } from './thesisMerge.js';
import { saveWithOCC } from './occClient.js';

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

// One POST attempt. Pulls the optimistic-concurrency token (`version`) out of the
// thesis and sends it as `baseVersion`; classifies the response as a conflict
// (409) or a normal result.
async function postThesis(ticker, thesis) {
  const { version: baseVersion, ...payload } = stripTransientThesisFields(thesis) || {};
  const res = await fetch(`/api/thesis/${ticker}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ ...payload, baseVersion }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) {
    return { conflict: true, current: data.current || null, version: data.version };
  }
  return { conflict: false, ok: res.ok && data.success !== false, version: data.version, data };
}

/**
 * Save a thesis with optimistic-concurrency reconciliation. A thin adapter over the
 * shared saveWithOCC (src/lib/occClient.js): the only thesis-specific parts are the
 * payload shaping and the merge policy (mergeThesis unions Draft & Review threads so
 * concurrent comments are never lost). Returns:
 *   { ok: true,  thesis, reloaded }              — saved (reloaded=true if a merge happened)
 *   { ok: false, conflict: true, thesis }        — merged a teammate's changes but
 *                                                  couldn't win the race; caller shows
 *                                                  the merged state for a manual re-save
 *   { ok: false, error }                         — network/other failure
 *
 * `thesis` (when present) carries the up-to-date `version` for the next save.
 */
export async function saveThesisReconciled(ticker, localThesis, { retries = 1 } = {}) {
  const res = await saveWithOCC({
    url: `/api/thesis/${ticker}`,
    method: 'POST',
    local: localThesis,
    buildBody: (t) => {
      const { version, ...payload } = stripTransientThesisFields(t) || {};
      return { ...payload, baseVersion: version };
    },
    merge: (local, server) => mergeThesis(local, server),
    retries,
  });
  if (res.ok) {
    // Stamp the persisted version onto whatever we actually sent (merged or not).
    return { ok: true, thesis: { ...res.sent, version: res.data.version }, reloaded: res.reconciled };
  }
  if (res.conflict) {
    // Merged the teammate's state but couldn't land within the retry budget; hand
    // the merged doc back so the caller can show it for a manual re-save.
    return { ok: false, conflict: true, thesis: res.merged };
  }
  return { ok: false, error: res.error };
}

// Back-compat thin wrapper (kept for any caller that only needs a fire-and-forget
// save and inspects `.success`). Prefer saveThesisReconciled for interactive saves.
export async function saveThesis(ticker, thesis) {
  const res = await postThesis(ticker, thesis);
  if (res.conflict) return { success: false, conflict: true, current: res.current };
  return { success: res.ok, version: res.version, ...res.data };
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
