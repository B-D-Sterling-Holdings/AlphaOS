'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, TrendingUp } from 'lucide-react';
import { ALL_PAGES } from '@/lib/navigation';

// How each ticker context maps to a destination. Ordered by deep-link quality:
// research and holdings can open a specific ticker; the others land on the page.
const CONTEXT_META = {
  research:  { label: 'Research',     page: 'Research',        href: t => `/research?ticker=${encodeURIComponent(t)}` },
  holding:   { label: 'Holding',      page: 'Position Review', href: t => `/position-review?ticker=${encodeURIComponent(t)}` },
  watchlist: { label: 'Watchlist',    page: 'Watchlist',       href: () => '/watchlist' },
  candidate: { label: 'Candidate',    page: 'Strategic Hub',   href: () => '/strategic-hub' },
};
const CONTEXT_PRIORITY = ['research', 'holding', 'watchlist', 'candidate'];

function tickerDestination(contexts) {
  const primary = CONTEXT_PRIORITY.find(c => contexts.includes(c)) || 'watchlist';
  return CONTEXT_META[primary];
}

// Lightweight subsequence fuzzy match: every char of `query` must appear in
// `text` in order. Returns a score (lower = better) or -1 for no match.
function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Reward consecutive matches and earlier positions.
      score += (lastIdx === -1 ? ti : (ti - lastIdx - 1)) + ti * 0.01;
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [tickers, setTickers] = useState([]);
  const [tickersLoaded, setTickersLoaded] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Lazy-load tickers from across the app the first time the palette opens:
  // holdings, every watchlist stock, and strategic candidates. A ticker can
  // live in several places, so we collect all of its contexts and a name.
  const loadTickers = useCallback(async () => {
    if (tickersLoaded) return;
    setTickersLoaded(true);
    try {
      const [portfolioRes, watchlistRes, candidatesRes] = await Promise.all([
        fetch('/api/portfolio').then(r => r.json()).catch(() => null),
        fetch('/api/watchlist').then(r => r.json()).catch(() => null),
        fetch('/api/strategic-candidates').then(r => r.json()).catch(() => null),
      ]);

      const map = new Map(); // ticker -> { contexts:Set, name }
      const add = (rawTicker, context, name) => {
        const t = rawTicker?.toUpperCase?.().trim();
        if (!t) return;
        const entry = map.get(t) || { contexts: new Set(), name: '' };
        entry.contexts.add(context);
        if (name && !entry.name) entry.name = name;
        map.set(t, entry);
      };

      for (const h of portfolioRes?.holdings || []) {
        add(h.ticker, 'holding', h.name || h.company);
      }
      for (const wl of watchlistRes?.watchlists || []) {
        for (const s of wl.stocks || []) {
          add(s.ticker, s.stage === 'research' ? 'research' : 'watchlist', s.name || s.company || s.companyName);
        }
      }
      for (const c of (Array.isArray(candidatesRes) ? candidatesRes : [])) {
        add(c.ticker, 'candidate', c.name || c.company);
      }

      setTickers(
        [...map.entries()].map(([ticker, v]) => ({
          ticker,
          name: v.name || '',
          contexts: [...v.contexts],
        }))
      );
    } catch {
      // Pages-only search still works if ticker fetch fails.
    }
  }, [tickersLoaded]);

  // Mirror `open` into a ref so the keydown handler can read it without
  // re-subscribing the listener on every toggle.
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  const openPalette = useCallback(() => {
    setQuery('');
    setActiveIdx(0);
    loadTickers();
    setOpen(true);
  }, [loadTickers]);

  // Global open/close: Ctrl+S / ⌘S, plus the custom event the navbar dispatches.
  // We intercept the browser's "save page" default in favor of the palette.
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else openPalette();
      }
    };
    const onOpenEvent = () => openPalette();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-command-palette', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-command-palette', onOpenEvent);
    };
  }, [openPalette]);

  // Focus the input when the palette opens (DOM side-effect only).
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Build the ranked result list from pages + tickers.
  const results = useMemo(() => {
    const pageItems = ALL_PAGES.map(p => ({
      type: 'page',
      key: `page:${p.href}`,
      title: p.label,
      subtitle: p.group,
      icon: p.icon,
      href: p.href,
      haystack: `${p.label} ${p.group} ${p.desc || ''}`,
    }));

    const trimmed = query.trim();

    // Tickers are only included once the user actually searches — they'd bury
    // the page list otherwise. When shown, each routes to where it's viewable.
    if (!trimmed) {
      return pageItems.slice(0, 50);
    }

    const tickerItems = tickers.map(t => {
      const dest = tickerDestination(t.contexts);
      const contextLabels = t.contexts.map(c => CONTEXT_META[c].label).join(' · ');
      return {
        type: 'ticker',
        key: `ticker:${t.ticker}`,
        title: t.ticker,
        subtitle: `${contextLabels} · open in ${dest.page}`,
        icon: TrendingUp,
        href: dest.href(t.ticker),
        haystack: `${t.ticker} ${t.name}`,
      };
    });

    return [...pageItems, ...tickerItems]
      .map(item => ({ item, score: fuzzyScore(trimmed, item.haystack) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
      .map(({ item }) => item);
  }, [query, tickers]);

  const go = useCallback((item) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }, [router]);

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Scroll the active row into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10001] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />

      <div
        className="relative w-full max-w-xl rounded-2xl overflow-hidden border border-gray-200/80 shadow-2xl shadow-gray-900/20 animate-scale-in"
        style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,1) 100%)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-gray-100">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to a page or ticker…"
            className="flex-1 bg-transparent outline-none text-[15px] text-gray-800 placeholder:text-gray-400"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-[10px] font-semibold text-gray-400">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-gray-400">
              No matches for “{query}”
            </div>
          ) : (
            results.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === activeIdx;
              return (
                <button
                  key={item.key}
                  data-idx={idx}
                  onClick={() => go(item)}
                  onMouseMove={() => setActiveIdx(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${active ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                >
                  <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${active ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                    <Icon size={16} />
                  </span>
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className={`text-[14px] font-semibold leading-tight ${active ? 'text-emerald-700' : 'text-gray-800'}`}>{item.title}</span>
                    <span className="text-[11.5px] leading-tight text-gray-400">
                      {item.subtitle}
                    </span>
                  </span>
                  {active && <CornerDownLeft size={14} className="text-emerald-500 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 h-10 border-t border-gray-100 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><kbd className="px-1 rounded bg-gray-100 border border-gray-200">↑</kbd><kbd className="px-1 rounded bg-gray-100 border border-gray-200">↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 rounded bg-gray-100 border border-gray-200">↵</kbd> open</span>
        </div>
      </div>
    </div>
  );
}
