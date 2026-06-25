'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Search, Check } from 'lucide-react';

// Search-to-select company picker shared across the deep-dive pages
// (Position Review, Draft & Review, Research). Type to filter by ticker; the match
// is highlighted, Enter picks the top hit, Escape/blur closes. `items` is any list
// of objects with a `.ticker`; duplicates (same ticker across watchlists) collapse
// to one row, since selection is keyed purely on ticker.
const TickerSearchSelect = memo(function TickerSearchSelect({ items, selectedTicker, onSelect, placeholder = 'Search ticker...' }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const options = useMemo(() => {
    const seen = new Set();
    return (items || []).filter(it => it?.ticker && !seen.has(it.ticker) && seen.add(it.ticker));
  }, [items]);

  const q = search.toUpperCase();
  const filtered = options.filter(it => !q || it.ticker.toUpperCase().includes(q));

  const commit = (ticker) => {
    setOpen(false);
    setSearch('');
    if (ticker && ticker !== selectedTicker) onSelect(ticker);
  };

  return (
    <div className="relative" ref={wrapRef} style={{ zIndex: 100 }}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={open ? search : (selectedTicker || '')}
        onChange={e => { setSearch(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={e => { setSearch(''); setOpen(true); e.target.select(); }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const qq = search.trim().toUpperCase();
            const pick = filtered[0]?.ticker || (qq && options.some(it => it.ticker.toUpperCase() === qq) ? qq : '');
            if (pick) { commit(pick); e.target.blur(); }
          } else if (e.key === 'Escape') {
            setOpen(false); e.target.blur();
          }
        }}
        placeholder={placeholder}
        className="w-56 bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm font-semibold text-gray-900 tracking-wide outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 hover:border-gray-300 transition-all duration-200 placeholder:text-gray-300 placeholder:font-normal placeholder:tracking-normal shadow-sm"
      />
      {open && (
        <div
          className="absolute left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-y-auto overflow-x-hidden py-1.5"
          style={{ zIndex: 100, maxHeight: '27rem' }}
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">No matches</div>
          ) : filtered.map(it => {
            const idx = q ? it.ticker.toUpperCase().indexOf(q) : -1;
            const isActive = it.ticker === selectedTicker;
            return (
              <button
                key={it.ticker}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => commit(it.ticker)}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <span className="font-semibold tracking-wide">
                  {idx >= 0 ? (
                    <>
                      {it.ticker.slice(0, idx)}
                      <span className="bg-emerald-100 text-emerald-700 rounded px-0.5">{it.ticker.slice(idx, idx + q.length)}</span>
                      {it.ticker.slice(idx + q.length)}
                    </>
                  ) : it.ticker}
                </span>
                {isActive && <Check size={14} className="text-emerald-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default TickerSearchSelect;
