'use client';

/*
  Module-scope owner of the long-running "Generate Data" call.

  Generation takes ~30 seconds (Alpha Vantage rate-limit pauses), long enough
  that the user navigates to another tab or company while it runs. When the
  call lived in component state, unmounting the page orphaned it: the spinner
  vanished, the stale "no data" cache entry was never refreshed for the
  remounted page, and a completion for a name the user had switched away from
  clobbered the currently selected company's charts.

  Instead the in-flight state lives here, outliving any page. Pages call
  `isGenerating(ticker)` on mount to restore their spinner and subscribe to
  completions to refresh whatever they have on screen. Cache invalidation for
  BOTH consumers of ticker data (Research: `deep_research_*`, Position Review:
  `research_*`) happens here on success, so fresh data appears even if neither
  page was mounted when the run finished.
*/

const inFlight = new Map(); // ticker -> Promise<{ ok, error? }>
const listeners = new Set();

export function isGenerating(ticker) {
  return inFlight.has((ticker || '').toUpperCase());
}

/** Subscribe to generation completions. Returns an unsubscribe function. */
export function subscribeGeneration(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Kick off (or join) data generation for a ticker. Deduped per ticker, so a
 * double click or a remounted page re-triggering can't start a second run.
 * `cache` is the CacheContext facade — it lives in the dashboard layout, which
 * stays mounted for the whole session, so holding it here is safe.
 */
export function startGeneration(ticker, cache) {
  const upper = (ticker || '').toUpperCase();
  if (!upper) return Promise.resolve({ ok: false, error: 'No ticker selected' });
  const existing = inFlight.get(upper);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch('/api/generate-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: upper }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        return { ok: false, error: data.error || `Generation failed (HTTP ${res.status})` };
      }
      // Invalidate every page family's per-ticker caches so the next look at
      // this name refetches, no matter which page the user is on by now.
      cache.set(`deep_research_tickerData_${upper}`, null);
      cache.set(`deep_research_quote_${upper}`, null);
      cache.set('deep_research_liveQuote', null);
      cache.set(`research_tickerData_${upper}`, null);
      cache.set(`research_quote_${upper}`, null);
      cache.set('research_liveQuote', null);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || 'Generation failed' };
    }
  })().then((result) => {
    // Leave the in-flight registry before notifying, so subscribers reading
    // `isGenerating` during the callback see the settled state.
    inFlight.delete(upper);
    for (const fn of listeners) {
      try { fn({ ticker: upper, ...result }); } catch {}
    }
    return result;
  });

  inFlight.set(upper, promise);
  return promise;
}
