'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, memo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, Download, AlertTriangle, Save, Plus, Trash2, CheckCircle, FileDown, Check, X, Star, ChevronDown, ExternalLink, Link as LinkIcon, Send, MessageSquare, FileText, BookOpen, Mic, MoreHorizontal, Pencil, Search, ArrowLeft } from 'lucide-react';
import Card from '@/components/Card';
import StatCard from '@/components/StatCard';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import FundamentalChart from '@/components/charts/FundamentalChart';
import PriceChart from '@/components/charts/PriceChart';
import Toast from '@/components/Toast';
import { formatMoney, formatLargeNumber, formatShareCount, formatNumber } from '@/lib/formatters';
import { useCache } from '@/lib/CacheContext';
import ValuationModel from '@/components/ValuationModel';
import RichTextArea from '@/components/RichTextArea';
import { migrateNewsImages } from '@/lib/migrateNewsImages';
import { persistStageMove, writeWatchlistCache, persistHoldingsBackfill, STAGE_LABELS, routeForStage } from '@/lib/stageMove';
import { startGeneration, isGenerating, subscribeGeneration } from '@/lib/generateTickerJob';
import {
  fetchComputedValuationModel,
  fetchPortfolio,
  fetchQuote,
  fetchThesis,
  fetchTickerFundamentals,
  fetchWatchlist,
  saveThesisReconciled,
} from '@/lib/researchApi';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const EMPTY_FUNDAMENTALS = {};

const TickerPicker = memo(function TickerPicker({ holdings, selectedTicker, onSelect }) {
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

  const q = search.toUpperCase();
  const filtered = (holdings || []).filter(h => !q || h.ticker.toUpperCase().includes(q));

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
            const pick = filtered[0]?.ticker || (qq && (holdings || []).some(h => h.ticker.toUpperCase() === qq) ? qq : '');
            if (pick) { commit(pick); e.target.blur(); }
          } else if (e.key === 'Escape') {
            setOpen(false); e.target.blur();
          }
        }}
        placeholder="Search ticker..."
        className="w-56 bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm font-semibold text-gray-900 tracking-wide outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 hover:border-gray-300 transition-all duration-200 placeholder:text-gray-300 placeholder:font-normal placeholder:tracking-normal shadow-sm"
      />
      {open && (
        <div
          className="absolute left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-y-auto overflow-x-hidden py-1.5"
          style={{ zIndex: 100, maxHeight: '27rem' }}
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">No matches</div>
          ) : filtered.map(h => {
            const idx = q ? h.ticker.toUpperCase().indexOf(q) : -1;
            const isActive = h.ticker === selectedTicker;
            return (
              <button
                key={h.ticker}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => commit(h.ticker)}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm transition-colors ${isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <span className="font-semibold tracking-wide">
                  {idx >= 0 ? (
                    <>
                      {h.ticker.slice(0, idx)}
                      <span className="bg-emerald-100 text-emerald-700 rounded px-0.5">{h.ticker.slice(idx, idx + q.length)}</span>
                      {h.ticker.slice(idx + q.length)}
                    </>
                  ) : h.ticker}
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

const FUNDAMENTALS_BOXES = [
  { key: 'revenueGrowth', label: 'Revenue and Growth', bg: 'bg-blue-50/50', taBg: 'bg-blue-50/10', border: 'border-blue-200/60', ring: 'focus:ring-blue-200 focus:border-blue-300', labelColor: 'text-blue-600', placeholder: 'Revenue CAGR, segment growth, unit economics, pricing, and demand drivers...' },
  { key: 'profitability', label: 'Profitability', bg: 'bg-emerald-50/50', taBg: 'bg-emerald-50/10', border: 'border-emerald-200/60', ring: 'focus:ring-emerald-200 focus:border-emerald-300', labelColor: 'text-emerald-600', placeholder: 'Margins, operating leverage, FCF conversion, EPS quality, and ROIC...' },
  { key: 'capitalReturn', label: 'Capital Returned to Shareholders', bg: 'bg-violet-50/50', taBg: 'bg-violet-50/10', border: 'border-violet-200/60', ring: 'focus:ring-violet-200 focus:border-violet-300', labelColor: 'text-violet-600', placeholder: 'Buybacks, dividends, share count trends, and capital allocation discipline...' },
  { key: 'misc', label: 'Misc', bg: 'bg-gray-50', taBg: 'bg-white/70', border: 'border-gray-200', ring: 'focus:ring-gray-200 focus:border-gray-300', labelColor: 'text-gray-600', placeholder: 'Balance sheet context, cyclicality, one-time items, regulation, or anything else...' },
];

const FundamentalsNotesGrid = memo(function FundamentalsNotesGrid({ fundamentals, onChange }) {
  const refs = useRef({});

  const syncHeights = useCallback(() => {
    const rows = [
      ['revenueGrowth', 'profitability'],
      ['capitalReturn', 'misc'],
    ];
    rows.forEach(rowKeys => {
      const els = rowKeys.map(k => refs.current[k]).filter(Boolean);
      if (els.length === 0) return;
      els.forEach(el => { el.style.height = 'auto'; });
      const max = Math.max(...els.map(el => el.scrollHeight), 150);
      els.forEach(el => { el.style.height = max + 'px'; });
    });
  }, []);

  useLayoutEffect(() => {
    syncHeights();
  }, [syncHeights, fundamentals.revenueGrowth, fundamentals.profitability, fundamentals.capitalReturn, fundamentals.misc]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {FUNDAMENTALS_BOXES.map(({ key, label, bg, taBg, border, ring, labelColor, placeholder }) => (
        <div key={key} className={`${bg} border ${border} rounded-2xl p-4`}>
          <label className={`text-[11px] font-bold uppercase tracking-[0.18em] ${labelColor}`}>
            {label}
          </label>
          <textarea
            ref={el => { refs.current[key] = el; }}
            value={fundamentals[key] || ''}
            onChange={e => onChange(key, e.target.value)}
            onInput={syncHeights}
            placeholder={placeholder}
            rows={6}
            spellCheck={true}
            className={`mt-3 w-full ${taBg} border ${border} rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none ${ring} transition-all resize-none overflow-hidden`}
          />
        </div>
      ))}
    </div>
  );
});

function SortableTab({ tab, isActive, isConfirming, isEditing, editingTabTitle, setEditingTabTitle, canDelete, tabCount, onSelect, onStartEdit, onFinishEdit, onConfirmDelete, onCancelDelete, onDelete, setConfirmDeleteTabId }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
    transition: transition || 'transform 200ms ease',
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="flex items-center group/tab">
      {isConfirming ? (
        <div className="flex items-center gap-1 px-2 py-1 bg-white rounded-lg shadow-sm border border-red-200">
          <span className="text-[10px] text-red-600 font-medium whitespace-nowrap">Delete?</span>
          <button onClick={onDelete} className="text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded hover:bg-red-600 transition-colors">Yes</button>
          <button onClick={onCancelDelete} className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors">No</button>
        </div>
      ) : isEditing ? (
        <input
          autoFocus
          value={editingTabTitle}
          onChange={e => setEditingTabTitle(e.target.value)}
          onBlur={() => onFinishEdit(editingTabTitle || 'Untitled')}
          onKeyDown={e => { if (e.key === 'Enter') onFinishEdit(editingTabTitle || 'Untitled'); if (e.key === 'Escape') onFinishEdit(null); }}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          className="px-3 py-1.5 text-xs font-semibold bg-white rounded-lg outline-none ring-2 ring-emerald-500 min-w-[60px] max-w-[120px]"
        />
      ) : (
        <button
          onClick={onSelect}
          onDoubleClick={onStartEdit}
          className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
            isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          {tab.title}
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); if (tabCount > 1) setConfirmDeleteTabId(tab.id); }}
            className={`p-0.5 rounded transition-all ${
              tabCount > 1 ? 'hover:bg-red-100 hover:text-red-500 cursor-pointer' : 'cursor-default'
            } ${isActive ? 'text-gray-400' : 'text-gray-300'}`}
          >
            <X size={10} />
          </span>
        </button>
      )}
    </div>
  );
}

export default function ResearchPage() {
  const cache = useCache();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTicker = searchParams.get('ticker');
  // The ticker this page was opened on via ?ticker= (carried along by a stage move).
  // Captured on mount and honored stubbornly: the "keep a valid name" fallback below
  // won't run until this name is selected or proven absent after a real fetch — so a
  // momentarily-stale watchlist load can't bounce the selection to the first name.
  const requestedTickerRef = useRef(urlTicker?.toUpperCase() || null);
  const [fetchedOnce, setFetchedOnce] = useState(false);
  const [portfolio, setPortfolio] = useState(() => cache.get('research_portfolio') || null);
  const [selectedTicker, setSelectedTicker] = useState(() => urlTicker || cache.get('research_selectedTicker') || '');
  // Fundamentals are cached per ticker. Seed from the initially-selected name's own
  // cache entry — never a generic shared slot, which is how one company's charts used
  // to bleed onto another's page.
  const tickerDataReqRef = useRef(null);
  const [loadedTickerData, setLoadedTickerData] = useState(() => {
    const t = urlTicker || cache.get('research_selectedTicker');
    return t ? (cache.get(`research_tickerData_${t}`) || null) : null;
  });
  const [watchlistData, setWatchlistData] = useState(() => cache.get('watchlist_data') || null);

  // Position Review membership: every `stage === 'position'` watchlist stock, tagged
  // with its watchlist so it can be demoted back to Research. This is the SOLE source
  // of what's in Position Review — the portfolio holdings book is not consulted (it was
  // backfilled into `position` stocks once, on load).
  const positionStocks = useMemo(() => (
    (watchlistData?.watchlists || []).flatMap(w =>
      (w.stocks || [])
        .filter(s => s.stage === 'position')
        .map(s => ({ ...s, watchlistId: w.id, watchlistName: w.name }))
    )
  ), [watchlistData]);

  const selectedPositionStock = useMemo(
    () => positionStocks.find(s => s.ticker === selectedTicker) || null,
    [positionStocks, selectedTicker]
  );

  // Only ever render fundamentals tagged with the currently selected name. A stale
  // in-flight fetch or a leftover cache payload could otherwise briefly surface one
  // company's charts under another company's header.
  const tickerData = loadedTickerData?.ticker === selectedTicker ? loadedTickerData : null;

  // Which stage a demote is currently persisting to (null = idle). Drives the button
  // spinner so the click has immediate feedback while the move resolves.
  const [movingTo, setMovingTo] = useState(null);

  // Demote the selected name out of Position Review. Every name here is a real
  // `position`-stage watchlist stock, so this just flips `stock.stage` back to
  // `research` — the name then leaves Position Review entirely (no holdings union to
  // keep it pinned here). Data-safe: only the stage flips; the thesis
  // (researchWorkspace/draftReview/valuation) and the portfolio book are untouched.
  const moveStage = useCallback(async (newStage) => {
    if (!selectedPositionStock || !watchlistData || movingTo) return;
    const ticker = selectedPositionStock.ticker;
    setMovingTo(newStage);
    try {
      const { next } = await persistStageMove({
        watchlistData,
        watchlistId: selectedPositionStock.watchlistId,
        ticker,
        newStage,
      });
      setWatchlistData(next);
      writeWatchlistCache(cache, next);
      setToast({ message: `${ticker} moved to ${STAGE_LABELS[newStage]}`, type: 'success' });
      // Follow the name to its new stage's tab so the pipeline reads as one flow.
      router.push(routeForStage(newStage, ticker));
    } catch {
      setToast({ message: `Failed to move ${ticker}`, type: 'error' });
      setMovingTo(null);
    }
  }, [selectedPositionStock, watchlistData, cache, router, movingTo]);
  const [loading, setLoading] = useState(() => !cache.get('research_portfolio'));
  const [tickerLoading, setTickerLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [liveQuote, setLiveQuote] = useState(() => cache.get('research_liveQuote') || null);
  const [quoteLoading, setQuoteLoading] = useState(() => !cache.get('research_liveQuote') && !!cache.get('research_selectedTicker'));
  const [activeResearchTab, setActiveResearchTab] = useState(() => cache.get('research_activeTab') || 'fundamentals');
  const [thesis, setThesis] = useState(null);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisDirty, setThesisDirty] = useState(false);
  const saveTimeoutRef = useRef(null);
  const modelRef = useRef(null);
  const [exporting, setExporting] = useState(false);

  // Position Review membership is driven PURELY by the `position` pipeline stage —
  // there is no link to the portfolio holdings book. The portfolio is still loaded for
  // the position-snapshot stats and for the one-time backfill that turns any
  // pre-existing holding into a `position` stock, so nothing vanishes when that link
  // is cut. The backfill only ADDS missing names and never touches the holdings table.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchPortfolio().catch(() => null),
      fetchWatchlist().catch(() => null),
    ]).then(async ([pf, wl]) => {
      if (!alive) return;
      if (pf) { setPortfolio(pf); cache.set('research_portfolio', pf); }
      let nextWl = wl;
      if (wl) {
        try {
          const migrated = await persistHoldingsBackfill({ watchlistData: wl, holdings: pf?.holdings });
          if (migrated) nextWl = migrated;
        } catch {}
        if (!alive) return;
        setWatchlistData(nextWl);
        writeWatchlistCache(cache, nextWl);
      }
      setLoading(false);
      setFetchedOnce(true);
    });
    return () => { alive = false; };
  }, [cache]);

  // Keep a valid Position Review name selected. When the current pick leaves the stage
  // (e.g. just demoted) fall back to the first remaining position; when the stage is
  // empty, clear the selection so the empty state shows instead of a stale ticker.
  // Skipped while a deep-link target is still pending so it can't override the moved
  // name with the first in the list.
  useEffect(() => {
    if (requestedTickerRef.current) return;
    if (!positionStocks.length) {
      if (selectedTicker) { setSelectedTicker(''); cache.set('research_selectedTicker', ''); }
      return;
    }
    if (!selectedTicker || !positionStocks.some(s => s.ticker === selectedTicker)) {
      const first = positionStocks[0].ticker;
      setSelectedTicker(first);
      cache.set('research_selectedTicker', first);
    }
  }, [positionStocks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Honor /position-review?ticker=XYZ (from a stage move, the command palette or the
  // Workflow Position card). Select it as soon as the name appears in the Position
  // Review stage; give up only once a real fetch has confirmed it isn't here.
  useEffect(() => {
    const requested = requestedTickerRef.current;
    if (!requested) return;
    if (positionStocks.some(s => s.ticker === requested)) {
      requestedTickerRef.current = null;
      setSelectedTicker(requested);
      cache.set('research_selectedTicker', requested);
    } else if (fetchedOnce && positionStocks.length) {
      requestedTickerRef.current = null;
    }
  }, [positionStocks, fetchedOnce]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTickerData = useCallback(async (ticker) => {
    if (!ticker) return;
    // Track the latest requested ticker so a slow fetch for a name we've navigated
    // away from can't overwrite the current selection's data.
    tickerDataReqRef.current = ticker;
    const cached = cache.get(`research_tickerData_${ticker}`);
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
      const data = await fetchTickerFundamentals(ticker);
      cache.set(`research_tickerData_${ticker}`, data);
      if (tickerDataReqRef.current === ticker) setLoadedTickerData(data);
    } catch (e) {
      setToast({ message: `Failed to load data for ${ticker}`, type: 'error' });
    } finally {
      if (tickerDataReqRef.current === ticker) setTickerLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    if (selectedTicker) {
      cache.set('research_selectedTicker', selectedTicker);
      loadTickerData(selectedTicker);
      // Only fetch quote if not cached for this ticker
      const cachedQuote = cache.get(`research_quote_${selectedTicker}`);
      if (cachedQuote) {
        setLiveQuote(cachedQuote);
        setQuoteLoading(false);
      } else {
        setLiveQuote(null);
        setQuoteLoading(true);
        fetchQuote(selectedTicker)
          .then(quote => {
            if (quote) {
              setLiveQuote(quote);
              cache.set('research_liveQuote', quote);
              cache.set(`research_quote_${selectedTicker}`, quote);
            }
          })
          .catch(() => {})
          .finally(() => setQuoteLoading(false));
      }
    }
  }, [selectedTicker, loadTickerData, cache]);

  // Load thesis data when ticker changes
  useEffect(() => {
    if (!selectedTicker) return;
    setThesisLoading(true);
    setThesisDirty(false);
    fetchThesis(selectedTicker)
      .then(data => setThesis(migrateNewsImages(data)))
      .catch(() => {})
      .finally(() => setThesisLoading(false));
  }, [selectedTicker]);

  // Cache active tab
  useEffect(() => {
    cache.set('research_activeTab', activeResearchTab);
  }, [activeResearchTab, cache]);

  // "Generate Data" runs in a module-scope job (src/lib/generateTickerJob) so
  // navigating to another tab, page, or company doesn't orphan it. On mount /
  // company change, restore the spinner if that name is still generating; on
  // completion, reload only if the finished name is the one on screen — the old
  // in-component reload used to blank whichever company the user had switched to.
  useEffect(() => {
    setGenerating(isGenerating(selectedTicker));
    return subscribeGeneration(({ ticker, ok, error }) => {
      if (ticker === selectedTicker) {
        setGenerating(false);
        if (ok) {
          setToast({ message: `Data generated for ${ticker}`, type: 'success' });
          loadTickerData(ticker);
        } else {
          setToast({ message: `Error: ${error}`, type: 'error' });
        }
      } else {
        // A run started on another name finished in the background; its caches
        // are already invalidated by the job, so just surface the outcome.
        setToast(ok
          ? { message: `Data generated for ${ticker}`, type: 'success' }
          : { message: `${ticker}: ${error}`, type: 'error' });
      }
    });
  }, [selectedTicker, loadTickerData]);

  // Save with optimistic-concurrency reconciliation so a concurrent edit to the
  // same thesis (another tab/analyst) is merged and retried, never silently
  // overwritten. See saveThesisReconciled / mergeThesis.
  const saveThesis = useCallback(async (data) => {
    if (!selectedTicker || (!thesisDirty && !data)) return;
    setThesisSaving(true);
    try {
      const result = await saveThesisReconciled(selectedTicker, data || thesis);
      if (result.ok) {
        setThesisDirty(false);
        if (result.reloaded) setThesis(result.thesis);
        else setThesis(prev => (prev ? { ...prev, version: result.thesis.version } : prev));
        setToast({ message: result.reloaded ? 'Merged newer changes and saved' : 'Thesis saved', type: 'success' });
      } else if (result.conflict) {
        setThesis(result.thesis);
        setThesisDirty(true);
        setToast({ message: 'Loaded newer changes — review and save again', type: 'info' });
      } else {
        setToast({ message: 'Failed to save thesis', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to save thesis', type: 'error' });
    } finally {
      setThesisSaving(false);
    }
  }, [selectedTicker, thesis, thesisDirty]);

  const updateThesisField = (field, value) => {
    setThesis(prev => ({ ...prev, [field]: value }));
    setThesisDirty(true);
  };

  const updateUnderwriting = (field, value) => {
    setThesis(prev => ({
      ...prev,
      underwriting: { ...prev.underwriting, [field]: value },
    }));
    setThesisDirty(true);
  };

  const updateFundamental = useCallback((field, value) => {
    setThesisDirty(true);
    setThesis(prev => {
      const underwriting = prev.underwriting || {};
      const researchWorkspace = underwriting.researchWorkspace || {};
      const fundamentals = researchWorkspace.fundamentals || {};
      return {
        ...prev,
        underwriting: {
          ...underwriting,
          researchWorkspace: {
            ...researchWorkspace,
            fundamentals: { ...fundamentals, [field]: value },
          },
        },
      };
    });
  }, []);

  const addCoreReason = () => {
    setThesis(prev => ({ ...prev, coreReasons: [...(prev.coreReasons || []), { title: '', description: '' }] }));
    setThesisDirty(true);
  };

  const removeCoreReason = (idx) => {
    const updated = {
      ...thesis,
      coreReasons: (thesis.coreReasons || []).filter((_, i) => i !== idx),
    };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  };

  const addNewsUpdate = () => {
    setThesis(prev => ({
      ...prev,
      newsUpdates: [...(prev.newsUpdates || []), { title: '', date: new Date().toISOString().slice(0, 10), body: '', impactOnAssumptions: '' }],
    }));
    setThesisDirty(true);
  };

  const removeNewsUpdate = (idx) => {
    const updated = {
      ...thesis,
      newsUpdates: (thesis.newsUpdates || []).filter((_, i) => i !== idx),
      _activeNewsIdx: undefined,
    };
    setThesis(updated);
    setThesisDirty(true);
    const { _activeNewsIdx, ...toSave } = updated;
    saveThesis(toSave);
  };

  const updateNewsUpdate = (idx, field, value) => {
    setThesis(prev => ({
      ...prev,
      newsUpdates: (prev.newsUpdates || []).map((entry, i) => i === idx ? { ...entry, [field]: value } : entry),
    }));
    setThesisDirty(true);
  };

  // Persisting commit for the News "What Happened" body (a RichTextArea, so images
  // live inline in the body itself — no separate gallery).
  const commitNewsUpdate = (idx, field, value) => {
    const updated = {
      ...thesis,
      newsUpdates: (thesis.newsUpdates || []).map((entry, i) => i === idx ? { ...entry, [field]: value } : entry),
    };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  };

  const updateCoreReason = (idx, field, value) => {
    setThesis(prev => ({
      ...prev,
      coreReasons: prev.coreReasons.map((r, i) => {
        if (i !== idx) return r;
        // Backward compat: if old format was a string, convert to object
        const obj = typeof r === 'string' ? { title: r, description: '' } : r;
        return { ...obj, [field]: value };
      }),
    }));
    setThesisDirty(true);
  };

  const DEFAULT_NOTES = { links: [], tabs: [{ id: '1', title: 'General', content: [] }] };
  const getNotes = (t) => {
    const raw = t?.notes || {};
    const base = { ...DEFAULT_NOTES, ...raw };
    // Migrate old content-array format to tabs
    if (raw.content && Array.isArray(raw.content) && !raw.tabs) {
      base.tabs = [{ id: '1', title: 'General', content: raw.content }];
      delete base.content;
    }
    if (!base.tabs || base.tabs.length === 0) base.tabs = [{ id: '1', title: 'General', content: [] }];
    return base;
  };

  // -- Note links --
  const [noteLinkUrl, setNoteLinkUrl] = useState('');
  const [noteLinkType, setNoteLinkType] = useState('web_article');
  const [noteLinkJustSaved, setNoteLinkJustSaved] = useState(false);
  const [editingLinkIdx, setEditingLinkIdx] = useState(null);

  const addNoteLink = () => {
    if (!noteLinkUrl.trim()) return;
    setThesis(prev => {
      const notes = getNotes(prev);
      return {
        ...prev,
        notes: { ...notes, links: [...notes.links, { url: noteLinkUrl.trim(), title: '', type: noteLinkType, addedAt: new Date().toISOString().slice(0, 10) }] },
      };
    });
    setThesisDirty(true);
    setNoteLinkUrl('');
    setNoteLinkJustSaved(true);
    setTimeout(() => setNoteLinkJustSaved(false), 1200);
  };

  const updateNoteLink = (idx, field, value) => {
    setThesis(prev => {
      const notes = getNotes(prev);
      return {
        ...prev,
        notes: { ...notes, links: notes.links.map((l, i) => i === idx ? { ...l, [field]: value } : l) },
      };
    });
    setThesisDirty(true);
  };

  const removeNoteLink = (idx) => {
    setThesis(prev => {
      const notes = getNotes(prev);
      return {
        ...prev,
        notes: { ...notes, links: notes.links.filter((_, i) => i !== idx) },
      };
    });
    setThesisDirty(true);
  };

  // -- Scratchpad tabs --
  const [activeNoteTab, setActiveNoteTab] = useState('1');
  const [editingTabId, setEditingTabId] = useState(null);
  const [editingTabTitle, setEditingTabTitle] = useState('');
  const [confirmDeleteTabId, setConfirmDeleteTabId] = useState(null);
  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const addNoteTab = () => {
    const id = Date.now().toString();
    setThesis(prev => {
      const notes = getNotes(prev);
      return {
        ...prev,
        notes: { ...notes, tabs: [...notes.tabs, { id, title: 'New Tab', content: [] }] },
      };
    });
    setActiveNoteTab(id);
    setThesisDirty(true);
  };

  const removeNoteTab = (id) => {
    let nextTabId = null;
    setThesis(prev => {
      const notes = getNotes(prev);
      const filtered = notes.tabs.filter(t => t.id !== id);
      if (filtered.length === 0) filtered.push({ id: '1', title: 'General', content: [] });
      nextTabId = filtered[0].id;
      return { ...prev, notes: { ...notes, tabs: filtered } };
    });
    setActiveNoteTab(prev => prev === id ? (nextTabId || '1') : prev);
    setThesisDirty(true);
  };

  const renameNoteTab = (id, title) => {
    setThesis(prev => {
      const notes = getNotes(prev);
      return {
        ...prev,
        notes: { ...notes, tabs: notes.tabs.map(t => t.id === id ? { ...t, title } : t) },
      };
    });
    setThesisDirty(true);
  };

  const updateNoteTabContent = (id, content) => {
    setThesis(prev => {
      const notes = getNotes(prev);
      return {
        ...prev,
        notes: { ...notes, tabs: notes.tabs.map(t => t.id === id ? { ...t, content } : t) },
      };
    });
    setThesisDirty(true);
  };

  const handleTabDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setThesis(prev => {
      const notes = getNotes(prev);
      const oldIdx = notes.tabs.findIndex(t => t.id === active.id);
      const newIdx = notes.tabs.findIndex(t => t.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      return { ...prev, notes: { ...notes, tabs: arrayMove(notes.tabs, oldIdx, newIdx) } };
    });
    setThesisDirty(true);
  };

  const generateData = () => {
    setShowGenerateModal(false);
    setShowUpdateModal(false);
    if (!selectedTicker || isGenerating(selectedTicker)) return;
    setGenerating(true);
    setToast({ message: `Generating data for ${selectedTicker}... This may take ~30 seconds.`, type: 'info' });
    // Cache invalidation and completion handling live in the job / the
    // subscription above, so they run even if this page has unmounted.
    startGeneration(selectedTicker, cache);
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="skeleton h-14 w-72 rounded-2xl mb-8" />
        <div className="skeleton h-96 rounded-3xl" />
      </div>
    );
  }

  const holdings = portfolio?.holdings || [];
  const cashVal = portfolio?.cash || 0;
  // The picker is driven PURELY by the `position` pipeline stage — no holdings link.
  // (Pre-existing holdings were backfilled into `position` stocks on load.)
  const pickerItems = [...new Map(positionStocks.map(s => [s.ticker, { ticker: s.ticker }])).values()];
  // Every name shown here is a real position-stage stock, so every name is demotable.
  const holding = holdings.find(h => h.ticker === selectedTicker);
  const selectedLivePrice = liveQuote?.price || null;
  const holdingPrice = (h) => (h.ticker === selectedTicker && selectedLivePrice) ? selectedLivePrice : h.cost_basis;
  const totalAum = holdings.reduce((s, h) => s + h.shares * holdingPrice(h), 0) + cashVal;
  const holdingValue = holding ? holding.shares * holdingPrice(holding) : 0;
  const pctAum = totalAum > 0 ? ((holdingValue / totalAum) * 100).toFixed(1) : '0.0';

  const dataExists = tickerData?.dataExists;

  const makeQuarterLabel = (row) => `${row.quarter}'${String(row.year).slice(-2)}`;

  const revenueLabels = tickerData?.revenue?.map(makeQuarterLabel) || [];
  const revenueData = tickerData?.revenue?.map(r => r.revenue) || [];
  const epsLabels = tickerData?.eps?.map(makeQuarterLabel) || [];
  const epsData = tickerData?.eps?.map(e => e.eps_diluted) || [];
  const fcfLabels = tickerData?.fcf?.map(makeQuarterLabel) || [];
  const fcfData = tickerData?.fcf?.map(f => f.free_cash_flow) || [];
  const marginLabels = tickerData?.operating_margins?.map(makeQuarterLabel) || [];
  const marginData = tickerData?.operating_margins?.map(m => m.operating_margin * 100) || [];
  const sharesLabels = tickerData?.buybacks?.map(makeQuarterLabel) || [];
  const sharesData = tickerData?.buybacks?.map(b => b.shares_outstanding) || [];
  const priceLabels = tickerData?.daily_prices?.map(p => p.date) || [];
  const priceData = tickerData?.daily_prices?.map(p => p.close) || [];
  const peLabels = tickerData?.valuation?.peHistory?.map(p => p.date) || [];
  const peData = tickerData?.valuation?.peHistory?.map(p => p.pe_ratio) || [];
  const fcfYieldLabels = tickerData?.valuation?.fcfYieldHistory?.map(f => f.date) || [];
  const fcfYieldData = tickerData?.valuation?.fcfYieldHistory?.map(f => f.fcf_yield) || [];
  const valuation = tickerData?.valuation || {};

  // Use live price for data points, recompute ratios
  const livePrice = liveQuote?.price || null;
  const csvPrice = valuation.currentPrice ? Number(valuation.currentPrice) : null;
  const displayPrice = livePrice || csvPrice;

  // Recompute PE, FCF yield, P/S using live price if available
  const csvEps = epsData.length > 0 ? epsData[epsData.length - 1] : null;
  const csvFcf = fcfData.length > 0 ? fcfData[fcfData.length - 1] : null;
  const csvRevenue = revenueData.length > 0 ? revenueData[revenueData.length - 1] : null;
  const csvShares = sharesData.length > 0 ? sharesData[sharesData.length - 1] : null;

  const livePe = (displayPrice && csvEps && csvEps > 0) ? displayPrice / csvEps : (valuation.peRatio ? Number(valuation.peRatio) : null);
  const liveFcfYield = (displayPrice && csvFcf && csvShares && csvShares > 0) ? (csvFcf / (displayPrice * csvShares)) * 100 : (valuation.fcfYield ? Number(valuation.fcfYield) : null);
  const livePs = (displayPrice && csvRevenue && csvShares && csvShares > 0) ? (displayPrice * csvShares) / csvRevenue : (valuation.priceToSales ? Number(valuation.priceToSales) : null);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Capture model data BEFORE switching tabs (switching unmounts ValuationModel)
      let modelData = modelRef.current?.getModelData?.() || null;

      // Fallback: if ref wasn't available (e.g. on fundamentals tab), load from API
      if (!modelData) {
        try {
          modelData = await fetchComputedValuationModel(selectedTicker, livePrice);
        } catch {}
      }

      // Fetch a fresh quote with all extended fields for the export
      let freshQuote = liveQuote;
      try {
        freshQuote = await fetchQuote(selectedTicker) || freshQuote;
      } catch {}

      const prevTab = activeResearchTab;
      if (prevTab !== 'fundamentals') {
        setActiveResearchTab('fundamentals');
        await new Promise(r => setTimeout(r, 800));
      }

      const { exportReport } = await import('@/lib/exportReport');

      await exportReport({
        ticker: selectedTicker,
        thesis,
        model: modelData,
        tickerData,
        liveQuote: freshQuote,
        displayPrice: freshQuote?.price || displayPrice,
        equityRating: thesis?.underwriting?.equityRating || 0,
      });

      if (prevTab !== 'fundamentals') {
        setActiveResearchTab(prevTab);
      }
      setToast({ message: 'Report exported!', type: 'success' });
    } catch (e) {
      console.error(e);
      setToast({ message: `Export failed: ${e.message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Position Review</h1>
        </div>
        {dataExists && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => setShowUpdateModal(true)}
              disabled={generating}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-white border border-gray-200 rounded-2xl text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 hover:shadow-md transition-all duration-200 disabled:opacity-40"
            >
              <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
              Update Data
            </button>
            {priceLabels.length > 0 && (
              <span className="text-[10px] text-gray-400">Last updated {priceLabels[priceLabels.length - 1]}</span>
            )}
          </div>
        )}
      </div>

      {/* Ticker Selector */}
      <div className="relative" style={{ zIndex: 50 }}>
      <Card className="mb-8 animate-fade-in-up stagger-2">
        <div className="flex items-center gap-4">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-bold">Select Company</label>
          <TickerPicker holdings={pickerItems} selectedTicker={selectedTicker} onSelect={setSelectedTicker} />

          {selectedPositionStock && (
            <button
              onClick={() => moveStage('research')}
              disabled={!!movingTo}
              title="Demote back to Research — it leaves Position Review; nothing is deleted, the thesis is kept"
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {movingTo === 'research' ? <RefreshCw size={13} className="animate-spin" /> : <ArrowLeft size={13} />}
              {movingTo === 'research' ? 'Moving…' : 'Back to Research'}
            </button>
          )}
        </div>
      </Card>
      </div>

      {!selectedTicker ? (
        <div className="text-center py-20">
          <p className="text-lg text-gray-400 mb-2">No names in Position Review</p>
          <p className="text-sm text-gray-300">Promote a researched name into Position to review it here</p>
        </div>
      ) : tickerLoading ? (
        <div className="space-y-6">
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-72 rounded-3xl" />
        </div>
      ) : !dataExists ? (
        <Card className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
            <AlertTriangle size={28} className="text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            No data generated for {selectedTicker}
          </h2>
          <p className="text-sm text-gray-500 mb-8 max-w-md mx-auto leading-relaxed">
            Data for this ticker has not been generated yet. Fetch fundamentals from Alpha Vantage and price data from Yahoo Finance.
          </p>
          <button
            onClick={() => setShowGenerateModal(true)}
            disabled={generating}
            className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold rounded-2xl hover:from-emerald-700 hover:to-emerald-600 shadow-lg shadow-emerald-200/50 hover:shadow-xl transition-all duration-200 disabled:opacity-40"
          >
            {generating ? 'Generating...' : 'Generate Data'}
          </button>
        </Card>
      ) : (
        <>
          {/* Tab Switcher + Save */}
          <div className="flex items-center justify-between mb-8 animate-fade-in-up stagger-3">
            <div className="flex gap-1 bg-gray-100/80 rounded-2xl p-1 w-fit">
              {[
                { key: 'fundamentals', label: 'Fundamentals' },
                { key: 'thesis', label: 'Thesis & Underwriting' },
                { key: 'notes', label: 'Notes' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveResearchTab(tab.key)}
                  className={`px-6 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    activeResearchTab === tab.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {(activeResearchTab === 'thesis' || activeResearchTab === 'notes') && thesis && (
              <button
                onClick={() => saveThesis()}
                disabled={thesisSaving || !thesisDirty}
                className={`flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-2xl shadow-md transition-all duration-200 ${
                  thesisDirty
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 hover:shadow-lg hover:shadow-emerald-200/50'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {thesisSaving ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : thesisDirty ? (
                  <Save size={14} />
                ) : (
                  <CheckCircle size={14} />
                )}
                {thesisSaving ? 'Saving...' : thesisDirty ? 'Save' : 'Saved'}
              </button>
            )}
          </div>

          {/* Position Snapshot */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            <StatCard label="Ticker" value={selectedTicker} />
            <StatCard label="% of AUM" value={quoteLoading ? null : `${pctAum}%`} />
            <StatCard
              label="Unrealized Gain/Loss"
              variant={
                quoteLoading || !holding || !livePrice ? 'default' :
                ((livePrice - holding.cost_basis) / holding.cost_basis >= 0 ? 'positive' : 'negative')
              }
              value={
                quoteLoading ? null :
                (holding && livePrice)
                  ? `${((livePrice - holding.cost_basis) / holding.cost_basis * 100) >= 0 ? '+' : ''}${((livePrice - holding.cost_basis) / holding.cost_basis * 100).toFixed(2)}%`
                  : '—'
              }
            />
          </div>

          {activeResearchTab === 'fundamentals' ? (
            <>
              {/* Price Chart */}
              <PriceChart labels={priceLabels} data={priceData} color="#10b981" />

              {/* Data Points */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Price', value: displayPrice ? `$${displayPrice.toFixed(2)}` : '—' },
                  { label: 'PE Ratio', value: livePe ? formatNumber(livePe, 1) : '—' },
                  { label: 'FCF Yield', value: liveFcfYield ? `${liveFcfYield.toFixed(1)}%` : '—' },
                  { label: 'Price / Sales', value: livePs ? formatNumber(livePs, 1) : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">{label}</p>
                    {quoteLoading ? (
                      <div className="h-7 w-20 rounded-lg skeleton" />
                    ) : (
                      <p className="text-xl font-extrabold gradient-text">{value}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <FundamentalChart title="Revenue" labels={revenueLabels} data={revenueData} label="Revenue" formatY={(v) => formatLargeNumber(v)} />
                <FundamentalChart title="EPS (Diluted)" labels={epsLabels} data={epsData} label="EPS" formatY={(v) => `$${v.toFixed(2)}`} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <FundamentalChart title="Free Cash Flow" labels={fcfLabels} data={fcfData} label="FCF" formatY={(v) => formatLargeNumber(v)} />
                <FundamentalChart title="Operating Margins" labels={marginLabels} data={marginData} chartType="line" label="Op Margin" color="#f59e0b" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <FundamentalChart title="Outstanding Shares" labels={sharesLabels} data={sharesData} label="Shares" formatY={(v) => formatShareCount(v)} colorPositive="#06b6d4" colorNegative="#06b6d4" />
                <PriceChart title="PE Ratio" labels={peLabels} data={peData} label="PE Ratio" color="#8b5cf6" formatY={(v) => v.toFixed(1)} showCagr={false} className="" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <PriceChart title="FCF Yield" labels={fcfYieldLabels} data={fcfYieldData} label="FCF Yield" color="#10b981" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} className="" />
              </div>
            </>
          ) : activeResearchTab === 'thesis' ? (
            /* ── Thesis & Underwriting Tab ── */
            thesisLoading ? (
              <div className="space-y-6">
                <div className="skeleton h-48 rounded-2xl" />
                <div className="skeleton h-64 rounded-2xl" />
              </div>
            ) : thesis ? (
              <div className="space-y-8" onBlur={() => saveThesis()}>
                {/* ── Preexisting Thesis ── */}
                <Card>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">Preexisting Thesis</h2>
                  <p className="text-xs text-gray-400 mb-6">Document your investment thesis, core reasoning, and valuation framework</p>

                  {/* Core Reasons */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-bold">Core Reasons We Own This</label>
                      <button
                        onClick={addCoreReason}
                        className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                      >
                        <Plus size={13} />
                        Add Reason
                      </button>
                    </div>
                    <div className="space-y-4">
                      {(thesis.coreReasons || []).map((reason, idx) => {
                        const r = typeof reason === 'string' ? { title: reason, description: '' } : reason;
                        return (
                          <div key={idx} className="group border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-all duration-200">
                            <div className="flex gap-3 items-start">
                              <span className="flex-shrink-0 w-7 h-10 flex items-center justify-center text-xs font-bold text-gray-300 mt-px">{idx + 1}.</span>
                              <div className="flex-1 space-y-2">
                                <input
                                  type="text" spellCheck={true}
                                  value={r.title}
                                  onChange={e => updateCoreReason(idx, 'title', e.target.value)}
                                  placeholder={`Core reason #${idx + 1}...`}
                                  className="w-full bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200 placeholder:text-gray-300 placeholder:font-normal"
                                />
                                <textarea
                                  value={r.description}
                                  onChange={e => updateCoreReason(idx, 'description', e.target.value)}
                                  onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; e.target.dataset.sizedFor = e.target.value; }}
                                  ref={el => { if (el && el.dataset.sizedFor !== el.value) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.dataset.sizedFor = el.value; } }}
                                  placeholder="Elaborate on this reason..."
                                  rows={2}
                                  spellCheck={true}
                                  className="w-full bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200 placeholder:text-gray-300 resize-none overflow-hidden"
                                />
                              </div>
                              {(thesis.coreReasons || []).length > 1 && (
                                <button
                                  onClick={() => removeCoreReason(idx)}
                                  className="flex-shrink-0 p-2.5 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all duration-200"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* The Story — rich text with inline images */}
                  <div className="mb-6">
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-1">The Story</label>
                    <p className="text-[10px] text-gray-400 mb-3">Paste images with Ctrl+V or hover to add via the image icon</p>
                    <RichTextArea
                      value={thesis.assumptions || ''}
                      onChange={val => updateThesisField('assumptions', val)}
                      ticker={selectedTicker}
                      placeholder="What assumptions underpin your thesis? E.g., continued market share gains, margin expansion from scale, durable competitive moat..."
                      rows={4}
                    />
                  </div>

                </Card>

                {/* ── Company Overview ── */}
                <Card>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">Company Overview</h2>
                  <p className="text-xs text-gray-400 mb-6">Summarize what the company does, how it makes money, and what matters most about the business</p>

                  <RichTextArea
                    value={thesis?.underwriting?.companyOverview || ''}
                    onChange={val => updateUnderwriting('companyOverview', val)}
                    ticker={selectedTicker}
                    placeholder="What does this company do? Cover the business model, key segments, customers, competitive position, and the main drivers investors should understand..."
                    rows={4}
                  />
                </Card>

                {/* ── Fundamentals Notes ── */}
                <Card>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">Fundamentals Notes</h2>
                  <p className="text-xs text-gray-400 mb-6">Quick blurbs on key fundamentals. These export below each respective section in the report</p>

                  <FundamentalsNotesGrid
                    fundamentals={thesis?.underwriting?.researchWorkspace?.fundamentals || EMPTY_FUNDAMENTALS}
                    onChange={updateFundamental}
                  />
                </Card>

                {/* ── News & Updates ── */}
                <Card>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-lg font-bold text-gray-900">News & Updates</h2>
                    <button
                      onClick={addNewsUpdate}
                      className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      <Plus size={13} />
                      Add Update
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mb-6">Log major developments, earnings, or news and how they affect your thesis</p>

                  {(!thesis.newsUpdates || thesis.newsUpdates.length === 0) ? (
                    <div className="text-center py-8 border border-dashed border-gray-200 rounded-xl">
                      <p className="text-sm text-gray-400 mb-1">No updates yet</p>
                      <p className="text-xs text-gray-300">Add an entry when earnings drop or a big event happens</p>
                    </div>
                  ) : (() => {
                    const updates = thesis.newsUpdates || [];
                    const latestIdx = updates.length - 1;
                    const activeIdx = thesis._activeNewsIdx !== undefined && thesis._activeNewsIdx < updates.length ? thesis._activeNewsIdx : latestIdx;
                    const entry = updates[activeIdx];

                    return (
                      <div>
                        {/* Selector for previous updates */}
                        {updates.length > 1 && (
                          <div className="flex items-center gap-3 mb-4">
                            <select
                              value={activeIdx}
                              onChange={e => setThesis(prev => ({ ...prev, _activeNewsIdx: Number(e.target.value) }))}
                              className="flex-1 bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                            >
                              {updates.map((u, i) => (
                                <option key={i} value={i}>
                                  {i === latestIdx ? '(Latest) ' : ''}{u.title || 'Untitled'}{u.date ? ` — ${u.date}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Active entry */}
                        <div className="border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-all duration-200 group">
                          <div className="flex items-start gap-4 mb-4">
                            <div className="flex-1">
                              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Title</label>
                              <input
                                type="text" spellCheck={true}
                                value={entry.title || ''}
                                onChange={e => updateNewsUpdate(activeIdx, 'title', e.target.value)}
                                placeholder="e.g., Q3 2025 Earnings, Major Acquisition, Guidance Revision..."
                                className="w-full bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200 placeholder:text-gray-300 placeholder:font-normal"
                              />
                            </div>
                            <div className="w-36 flex-shrink-0">
                              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Date</label>
                              <input
                                type="date"
                                value={entry.date || ''}
                                onChange={e => updateNewsUpdate(activeIdx, 'date', e.target.value)}
                                className="w-full bg-gray-50/50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                              />
                            </div>
                            <button
                              onClick={() => removeNewsUpdate(activeIdx)}
                              className="flex-shrink-0 p-2 mt-5 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all duration-200"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <div className="mb-4">
                            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">What Happened</label>
                            <RichTextArea
                              value={entry.body || ''}
                              onChange={value => updateNewsUpdate(activeIdx, 'body', value)}
                              onBlur={value => commitNewsUpdate(activeIdx, 'body', value)}
                              onCommit={value => commitNewsUpdate(activeIdx, 'body', value)}
                              ticker={selectedTicker}
                              placeholder="Summarize the key takeaways — paste charts or screenshots inline..."
                              rows={3}
                            />
                          </div>

                          <div>
                            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Impact on Assumptions</label>
                            <textarea
                              value={entry.impactOnAssumptions || ''}
                              onChange={e => updateNewsUpdate(activeIdx, 'impactOnAssumptions', e.target.value)}
                              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; e.target.dataset.sizedFor = e.target.value; }}
                              ref={el => { if (el && el.dataset.sizedFor !== el.value) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.dataset.sizedFor = el.value; } }}
                              placeholder="Does this change your revenue growth, margin, or valuation assumptions? If so, how?"
                              rows={2}
                              spellCheck={true}
                              className="w-full bg-amber-50/50 border border-amber-200/60 rounded-xl px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all duration-200 placeholder:text-amber-300 resize-none overflow-hidden"
                            />
                          </div>

                        </div>
                      </div>
                    );
                  })()}
                </Card>

                {/* ── Valuation Model ── */}
                <ValuationModel ref={modelRef} ticker={selectedTicker} livePrice={livePrice} />

                {/* ── Equity Rating & Export ── */}
                <Card>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Equity Rating</label>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map(star => (
                          <button
                            key={star}
                            onClick={() => {
                              const newRating = star === (thesis?.underwriting?.equityRating || 0) ? 0 : star;
                              const updated = {
                                ...(thesis || {}),
                                underwriting: { ...((thesis || {}).underwriting || {}), equityRating: newRating },
                              };
                              setThesis(updated);
                              setThesisDirty(true);
                              saveThesis(updated);
                            }}
                            className="transition-colors"
                          >
                            <Star
                              size={24}
                              className={star <= (thesis?.underwriting?.equityRating || 0)
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-gray-300 hover:text-amber-300'
                              }
                            />
                          </button>
                        ))}
                        {(thesis?.underwriting?.equityRating || 0) > 0 && (
                          <span className="ml-2 text-sm font-semibold text-gray-500">{thesis.underwriting.equityRating}/5</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleExport}
                      disabled={exporting}
                      className="flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-gray-900 to-gray-800 text-white font-semibold rounded-2xl hover:from-gray-800 hover:to-gray-700 shadow-lg shadow-gray-300/40 hover:shadow-xl transition-all duration-200 disabled:opacity-50"
                    >
                      {exporting ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <FileDown size={16} />
                      )}
                      {exporting ? 'Generating Report...' : 'Export Position Review'}
                    </button>
                  </div>
                </Card>
              </div>
            ) : null
          ) : activeResearchTab === 'notes' ? (
            /* ── Notes Tab ── */
            thesisLoading ? (
              <div className="space-y-6">
                <div className="skeleton h-48 rounded-2xl" />
              </div>
            ) : thesis ? (
              (() => {
                const notes = getNotes(thesis);
                const NOTE_TYPES = [
                  { value: 'tweet', label: 'Tweet', icon: MessageSquare, color: 'blue' },
                  { value: 'web_article', label: 'Article', icon: FileText, color: 'emerald' },
                  { value: 'white_paper', label: 'White Paper', icon: BookOpen, color: 'indigo' },
                  { value: 'transcript', label: 'Transcript', icon: Mic, color: 'teal' },
                  { value: 'other', label: 'Other', icon: MoreHorizontal, color: 'gray' },
                ];
                const NOTE_TYPE_MAP = Object.fromEntries(NOTE_TYPES.map(c => [c.value, c]));
                const NOTE_TYPE_COLORS = {
                  blue: 'bg-blue-50 text-blue-700 border-blue-200',
                  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                  teal: 'bg-teal-50 text-teal-700 border-teal-200',
                  gray: 'bg-gray-100 text-gray-600 border-gray-200',
                };
                const NOTE_TYPE_SELECTED = {
                  blue: 'bg-blue-600 text-white border-blue-600',
                  emerald: 'bg-emerald-600 text-white border-emerald-600',
                  indigo: 'bg-indigo-600 text-white border-indigo-600',
                  teal: 'bg-teal-600 text-white border-teal-600',
                  gray: 'bg-gray-600 text-white border-gray-600',
                };
                const currentTab = notes.tabs.find(t => t.id === activeNoteTab) || notes.tabs[0];

                return (
                  <div className="space-y-8" onBlur={() => saveThesis()}>
                    {/* ── Scratchpad with tabs ── */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-gray-900">Scratchpad</h2>
                      </div>

                      {/* Tab bar */}
                      <div className="flex items-center gap-0.5 bg-gray-100/80 rounded-t-2xl p-1 overflow-x-auto">
                        <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
                          <SortableContext items={notes.tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
                            {notes.tabs.map(tab => (
                              <SortableTab
                                key={tab.id}
                                tab={tab}
                                isActive={currentTab?.id === tab.id}
                                isConfirming={confirmDeleteTabId === tab.id}
                                isEditing={editingTabId === tab.id}
                                editingTabTitle={editingTabTitle}
                                setEditingTabTitle={setEditingTabTitle}
                                canDelete={notes.tabs.length > 1}
                                tabCount={notes.tabs.length}
                                onSelect={() => setActiveNoteTab(tab.id)}
                                onStartEdit={() => { setEditingTabId(tab.id); setEditingTabTitle(tab.title); }}
                                onFinishEdit={(title) => { if (title) renameNoteTab(tab.id, title); setEditingTabId(null); }}
                                onConfirmDelete={() => setConfirmDeleteTabId(tab.id)}
                                onCancelDelete={() => setConfirmDeleteTabId(null)}
                                onDelete={() => { removeNoteTab(tab.id); setConfirmDeleteTabId(null); }}
                                setConfirmDeleteTabId={setConfirmDeleteTabId}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                        <button
                          onClick={addNoteTab}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-gray-50 rounded-lg transition-colors flex-shrink-0"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      {/* Tab content */}
                      <Card className="rounded-t-none border-t-0">
                        {currentTab && (
                          <RichTextArea
                            value={currentTab.content || []}
                            onChange={(blocks) => updateNoteTabContent(currentTab.id, blocks)}
                            ticker={selectedTicker}
                            placeholder="Paste anything here — text, images, screenshots, notes..."
                            rows={8}
                          />
                        )}
                      </Card>
                    </div>

                    {/* ── Links ── */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <h2 className="text-lg font-bold text-gray-900">Links</h2>
                      </div>

                      {/* Add bar */}
                      <div className={`rounded-2xl border mb-4 transition-all ${
                        noteLinkJustSaved ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200 bg-white'
                      }`}>
                        <div className="flex items-center gap-2 px-4 py-3">
                          <Plus size={16} className={`flex-shrink-0 transition-colors ${noteLinkJustSaved ? 'text-emerald-500' : 'text-gray-300'}`} />
                          <input
                            type="url"
                            value={noteLinkUrl}
                            onChange={e => setNoteLinkUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addNoteLink(); }}
                            placeholder="Paste a link..."
                            className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-300"
                          />
                          <button
                            onClick={addNoteLink}
                            disabled={!noteLinkUrl.trim()}
                            className={`p-1.5 rounded-lg transition-all ${
                              noteLinkJustSaved ? 'text-emerald-500'
                                : noteLinkUrl.trim() ? 'text-gray-900 hover:bg-gray-100'
                                : 'text-gray-200 cursor-not-allowed'
                            }`}
                          >
                            {noteLinkJustSaved ? <Check size={16} /> : <Send size={15} />}
                          </button>
                        </div>
                        <div className="flex items-center gap-1 px-4 pb-3 pt-0">
                          {NOTE_TYPES.map(ct => {
                            const Icon = ct.icon;
                            const selected = noteLinkType === ct.value;
                            return (
                              <button key={ct.value} onClick={() => setNoteLinkType(ct.value)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-all ${
                                  selected ? NOTE_TYPE_SELECTED[ct.color] : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                                }`}>
                                <Icon size={10} />
                                {ct.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Link cards */}
                      {notes.links.length === 0 ? (
                        <p className="text-sm text-gray-300 italic px-1">No links saved yet</p>
                      ) : (
                        <div className="space-y-2">
                          {notes.links.map((link, idx) => {
                            const ct = NOTE_TYPE_MAP[link.type] || NOTE_TYPE_MAP.other;
                            const TypeIcon = ct.icon;
                            const isEditing = editingLinkIdx === idx;
                            return (
                              <div key={idx} className={`group bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all ${isEditing ? 'border-emerald-200' : 'border-gray-100 hover:border-gray-200'}`}>
                                <div className="px-5 py-3.5">
                                  {isEditing ? (
                                    <div className="space-y-2">
                                      <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 uppercase tracking-wide font-medium pointer-events-none">Title</span>
                                        <input
                                          autoFocus
                                          type="text" spellCheck={true}
                                          value={link.title || ''}
                                          onChange={e => updateNoteLink(idx, 'title', e.target.value)}
                                          placeholder="Add a title..."
                                          className="w-full bg-gray-50/50 border border-gray-200 rounded-lg pl-12 pr-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all placeholder:text-gray-300"
                                        />
                                      </div>
                                      <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 uppercase tracking-wide font-medium pointer-events-none">Link</span>
                                        <input
                                          type="text" spellCheck={true}
                                          value={link.url || ''}
                                          onChange={e => updateNoteLink(idx, 'url', e.target.value)}
                                          placeholder="https://..."
                                          className="w-full bg-gray-50/50 border border-gray-200 rounded-lg pl-12 pr-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all placeholder:text-gray-300 font-mono text-xs"
                                        />
                                      </div>
                                      <div className="flex justify-end">
                                        <button
                                          onClick={() => setEditingLinkIdx(null)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                                        >
                                          <Check size={12} /> Done
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <a href={link.url.startsWith('http') ? link.url : `https://${link.url}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-sm font-semibold text-gray-900 hover:text-emerald-600 truncate max-w-md transition-colors">
                                            {link.title || link.url}
                                          </a>
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${NOTE_TYPE_COLORS[ct.color]}`}>
                                            <TypeIcon size={10} />
                                            {ct.label}
                                          </span>
                                          {link.addedAt && <span className="text-[10px] text-gray-400">{link.addedAt}</span>}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-0.5 flex-shrink-0">
                                        <button
                                          onClick={() => setEditingLinkIdx(idx)}
                                          className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                                          <Pencil size={14} />
                                        </button>
                                        <button
                                          onClick={() => removeNoteLink(idx)}
                                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                  </div>
                );
              })()
            ) : null
          ) : null}
        </>
      )}

      {/* Generate Data Modal */}
      {showGenerateModal && (
        <div className="modal-overlay" onClick={() => setShowGenerateModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-3">Generate Data for {selectedTicker}</h3>
            <p className="text-sm text-gray-500 mb-4 leading-relaxed">
              This will fetch fundamental data from Alpha Vantage and price data from Yahoo Finance.
              The data will be saved locally so you only need to do this once.
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 mb-5">
              Note: Alpha Vantage free tier allows 5 API calls/minute. Generation takes ~30 seconds.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowGenerateModal(false)} className="px-5 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-all duration-200">
                Cancel
              </button>
              <button onClick={generateData} className="px-5 py-2.5 text-sm bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold rounded-xl hover:from-emerald-700 hover:to-emerald-600 shadow-md hover:shadow-lg hover:shadow-emerald-200/50 transition-all duration-200">
                Generate Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update Data Modal */}
      {showUpdateModal && (
        <div className="modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-3">Update Data for {selectedTicker}</h3>
            <p className="text-sm text-gray-500 mb-4 leading-relaxed">
              This will re-fetch the latest fundamental and price data, overwriting the existing data.
              Use this after an earnings release or if the data is stale.
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 mb-5">
              This will use your Alpha Vantage API quota. Are you sure?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowUpdateModal(false)} className="px-5 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-all duration-200">
                Cancel
              </button>
              <button onClick={generateData} className="px-5 py-2.5 text-sm bg-gradient-to-r from-amber-500 to-amber-400 text-white font-semibold rounded-xl hover:from-amber-600 hover:to-amber-500 shadow-md hover:shadow-lg transition-all duration-200">
                Update Data
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

    </div>
  );
}
