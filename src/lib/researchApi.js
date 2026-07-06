import { computeValuationModel } from './valuationModel.js';
import { mergeThesis } from './thesisMerge.js';

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
 * Save a thesis with optimistic-concurrency reconciliation.
 *
 * On a version conflict (a teammate saved first) it merges the local edits on top
 * of the fresh server document (see mergeThesis) and retries, so concurrent Draft
 * & Review comments are never silently lost. Returns:
 *   { ok: true,  thesis, reloaded }              — saved (reloaded=true if a merge happened)
 *   { ok: false, conflict: true, thesis }        — merged a teammate's changes but
 *                                                  couldn't win the race; caller shows
 *                                                  the merged state for a manual re-save
 *   { ok: false, error }                         — network/other failure
 *
 * `thesis` (when present) carries the up-to-date `version` for the next save.
 */
export async function saveThesisReconciled(ticker, localThesis, { retries = 1 } = {}) {
  let attempt = localThesis;
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await postThesis(ticker, attempt);
    } catch (e) {
      return { ok: false, error: e?.message || 'network error', thesis: attempt };
    }
    if (!res.conflict) {
      if (!res.ok) return { ok: false, error: res.data?.error || 'save failed', thesis: attempt };
      // Stamp the new version so the next save compares against the right row.
      return { ok: true, thesis: { ...attempt, version: res.version }, reloaded: i > 0 };
    }
    // Conflict: fuse the teammate's server state under our in-flight edits.
    attempt = mergeThesis(attempt, res.current);
    if (i >= retries) {
      return { ok: false, conflict: true, thesis: attempt };
    }
  }
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
