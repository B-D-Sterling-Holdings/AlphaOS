'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCache } from '@/lib/CacheContext';

/**
 * useTickerData — cache-first loader for a company's generated fundamentals
 * (/api/ticker/<ticker>), shared by every page that renders the company data
 * view (Research, Draft & Review).
 *
 * Uses the same `deep_research_tickerData_<ticker>` cache slots as the Research
 * page, so data loaded on one page is instantly there on the other, and the
 * generation job's cache invalidation (src/lib/generateTickerJob.js) refreshes
 * both. Stale-response guarding matches the Research page: only the latest
 * requested ticker may write state, so a slow fetch for a name the user has
 * navigated away from can't put its charts under the current selection.
 *
 * Returns { tickerData, tickerLoading, reload }. `tickerData` is null unless it
 * is tagged with the requested ticker; `reload` refetches after the cache slot
 * has been invalidated (e.g. when a generation run finishes).
 */
export function useTickerData(ticker) {
  const cache = useCache();
  const reqRef = useRef(null);
  const [loadedTickerData, setLoadedTickerData] = useState(() => (
    ticker ? (cache.get(`deep_research_tickerData_${ticker}`) || null) : null
  ));
  const [tickerLoading, setTickerLoading] = useState(false);

  const load = useCallback(async (t) => {
    if (!t) return;
    reqRef.current = t;
    const cached = cache.get(`deep_research_tickerData_${t}`);
    if (cached) {
      setLoadedTickerData(cached);
      // An older fetch's finally-block only clears the spinner when its ticker
      // is still the latest request — landing on a cache hit right after
      // switching names would otherwise leave the skeleton up forever.
      setTickerLoading(false);
      return;
    }
    // Clear stale data while loading so the prior name's charts don't linger.
    setLoadedTickerData(null);
    setTickerLoading(true);
    try {
      const res = await fetch(`/api/ticker/${t}`);
      const data = await res.json();
      cache.set(`deep_research_tickerData_${t}`, data);
      if (reqRef.current === t) setLoadedTickerData(data);
    } catch {
      // Leave tickerData null; callers render their no-data state.
    } finally {
      if (reqRef.current === t) setTickerLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    if (ticker) load(ticker);
    else { reqRef.current = null; setLoadedTickerData(null); setTickerLoading(false); }
  }, [ticker, load]);

  const reload = useCallback(() => load(ticker), [load, ticker]);

  // Only ever hand back fundamentals tagged with the currently requested name.
  const tickerData = loadedTickerData?.ticker === ticker ? loadedTickerData : null;

  return { tickerData, tickerLoading, reload };
}
