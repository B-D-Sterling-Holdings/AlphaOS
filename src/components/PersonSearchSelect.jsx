'use client';

import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Search, Check, AlertTriangle } from 'lucide-react';

// A compact search-to-select picker for the workspace's users, used to choose the
// Author / Reviewer on a review. Type to filter by name or email; Enter picks the
// top hit, Escape/blur closes. `people` is the workspace roster
// [{ id, name, email, hasEmail }] (from /api/workspace-users); `value` is the
// selected user's id; `onSelect` is called with the chosen user object.
//
// A user with no email set is still selectable (you can assign them), but is shown
// with a warning — notifying them reports "email is not set up" until an admin
// adds one.
const PersonSearchSelect = memo(function PersonSearchSelect({ people, value, onSelect, placeholder = 'Choose a person…' }) {
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
    return (people || []).filter(p => {
      const key = String(p?.id || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [people]);

  const selected = options.find(p => p.id === value);
  const selectedLabel = selected
    ? (selected.email ? `${selected.name} — ${selected.email}` : selected.name)
    : '';

  const q = search.trim().toLowerCase();
  const filtered = options.filter(p =>
    !q || (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q)
  );

  const commit = (person) => {
    setOpen(false);
    setSearch('');
    if (person) onSelect?.(person);
  };

  // Highlight the matched run inside `text` for the current query.
  const highlight = (text) => {
    if (!q) return text;
    const idx = (text || '').toLowerCase().indexOf(q);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-emerald-100 text-emerald-700 rounded px-0.5">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div className="relative sm:w-56 shrink-0" ref={wrapRef} style={{ zIndex: open ? 100 : 'auto' }}>
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={open ? search : selectedLabel}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={e => { setSearch(''); setOpen(true); e.target.select(); }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            if (filtered[0]) { commit(filtered[0]); e.target.blur(); }
          } else if (e.key === 'Escape') {
            setOpen(false); e.target.blur();
          }
        }}
        placeholder={placeholder}
        className="w-full bg-white border border-gray-200 rounded-lg pl-7 pr-2.5 py-1.5 text-[12px] text-gray-700 outline-none focus:ring-1 focus:ring-emerald-300 focus:border-transparent hover:border-gray-300 transition-colors placeholder:text-gray-400 truncate"
      />
      {open && (
        <div
          className="absolute left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-lg shadow-xl overflow-y-auto overflow-x-hidden py-1"
          style={{ zIndex: 100, maxHeight: '16rem' }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-gray-400 text-center">
              {options.length === 0 ? 'No people in this workspace' : 'No matches'}
            </div>
          ) : filtered.map(p => {
            const isActive = p.id === value;
            return (
              <button
                key={p.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => commit(p)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${isActive ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
              >
                <span className="min-w-0">
                  <span className={`block text-[12px] font-semibold truncate ${isActive ? 'text-emerald-700' : 'text-gray-700'}`}>
                    {highlight(p.name)}
                  </span>
                  {p.hasEmail ? (
                    <span className={`block text-[11px] truncate ${isActive ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {highlight(p.email)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500 truncate">
                      <AlertTriangle size={10} className="shrink-0" /> email not set up
                    </span>
                  )}
                </span>
                {isActive && <Check size={13} className="text-emerald-500 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default PersonSearchSelect;
