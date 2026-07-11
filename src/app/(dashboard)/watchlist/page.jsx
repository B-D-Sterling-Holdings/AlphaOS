'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCache } from '@/lib/CacheContext';
import { writeWatchlistCache, routeForStage, postWatchlist } from '@/lib/stageMove';
import { fetchThesis, saveThesisReconciled } from '@/lib/researchApi';
import Toast from '@/components/Toast';
import { formatMoneyPrecise, formatPct, formatLargeNumber } from '@/lib/formatters';
import { Plus, X, ArrowRight, Eye, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Pencil, Trash2, Check, List, ChevronRight, ChevronLeft, RefreshCw, Star, ArrowUpNarrowWide, MessageCircle } from 'lucide-react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import WatchlistComments from '@/components/WatchlistComments';
import { normalizeAutoNotify } from '@/lib/autoNotify';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// Escape a plain-text watchlist note so it renders literally inside the rich-text
// (contentEditable HTML) Investment Overview box, keeping line breaks.
function noteToPaperHtml(note) {
  const escaped = note
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\r?\n/g, '<br>');
}

// True if the Draft & Review "Investment Overview" (thesis.underwriting.draftReview.paper)
// already has visible content — so we never clobber an existing write-up.
function hasInvestmentOverview(thesis) {
  const paper = thesis?.underwriting?.draftReview?.paper;
  const visible = (html) => !!(html && html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
  if (Array.isArray(paper)) {
    return paper.some(block => block?.type === 'image' || visible(block?.value));
  }
  return typeof paper === 'string' && visible(paper);
}

// Carry the watchlist "Why I'm interested" note into the Draft & Review Investment
// Overview the first time a name is promoted (issue #76). One-time and best-effort:
// only seeds when the box is still empty, so the author can freely edit or clear it
// afterward without it coming back.
async function seedInvestmentOverviewFromNote(ticker, note) {
  const thesis = await fetchThesis(ticker);
  if (hasInvestmentOverview(thesis)) return;
  const updated = {
    ...(thesis || {}),
    underwriting: {
      ...((thesis || {}).underwriting || {}),
      draftReview: {
        ...((thesis || {}).underwriting?.draftReview || {}),
        paper: [{ type: 'text', value: noteToPaperHtml(note) }],
      },
    },
  };
  await saveThesisReconciled(ticker, updated);
}

function autoExpand(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Compact height (≈2 lines) for a collapsed "Why I'm interested" note. Notes default
// to this; the per-card expand toggle grows a note — and every card sharing its visual
// row — to fit the tallest content so the row stays aligned.
const COLLAPSED_NOTE_HEIGHT = 68;

function orderStocks(stocks = []) {
  return stocks
    .map((stock, index) => ({ stock, index }))
    .sort((a, b) => {
      const aPos = Number.isFinite(a.stock?.position) ? a.stock.position : a.index;
      const bPos = Number.isFinite(b.stock?.position) ? b.stock.position : b.index;
      return aPos - bPos || a.index - b.index;
    })
    .map(({ stock }, position) => ({ ...stock, position }));
}

// Content signature of a watchlist payload with version tokens stripped, so two
// payloads compare equal iff their meaningful data (list names + stocks) matches —
// regardless of what `version` each carries. This is what lets a save tell a genuine
// concurrent edit (content actually diverged) apart from a merely stale version token
// (only the number moved, e.g. after navigating in from another page or tab).
function watchlistContentSig(data) {
  return JSON.stringify(
    (data?.watchlists || [])
      .map(w => ({ id: w.id, name: w.name || '', stocks: orderStocks(w.stocks || []) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  );
}

const isWatching = (s) => s.stage === 'watching' || s.stage === 'researching';

// Coerce a stock's (possibly absent) comment review into the full shape the
// Draft & Review comment components expect: threads + author/reviewer people +
// a normalized auto-notify config.
function normalizeReview(review) {
  const r = review || {};
  return {
    threads: Array.isArray(r.threads) ? r.threads : [],
    author: { name: r.author?.name || '', email: r.author?.email || '' },
    reviewer: { name: r.reviewer?.name || '', email: r.reviewer?.email || '' },
    autoNotify: normalizeAutoNotify(r.autoNotify),
  };
}

// Card badge count: unresolved threads that actually hold a posted comment. This
// deliberately ignores empty stubs and un-posted composer drafts, so a half-started
// or abandoned point never shows up as a "stale" comment.
function openCommentCount(threads) {
  return (threads || []).filter(t => !t.resolved && (t.messages || []).length > 0).length;
}

// Fold an edited author into the ticker→author map the cards read: set it when a
// name/email exists, drop the key when it's been cleared — so the card flips back to
// the "no author set" nudge (matching /api/review-summary, which omits empty authors).
function setCardAuthor(map, ticker, author) {
  const name = author?.name?.trim() || '';
  const email = author?.email?.trim() || '';
  if (!name && !email) {
    if (!(ticker in map)) return map;
    const next = { ...map };
    delete next[ticker];
    return next;
  }
  return { ...map, [ticker]: { name, email } };
}

// Stable-partition a list so pinned (starred) names float ahead of the rest while
// each group keeps its incoming relative order. This is the single rule behind
// "float to top": we apply it after every star toggle and every reorder so a dragged
// card that crosses the pin boundary simply snaps to it rather than breaking the
// invariant that all pinned names sit above all un-pinned ones.
function starredFirst(list) {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (Number(!!b.s.starred) - Number(!!a.s.starred)) || (a.i - b.i))
    .map(({ s }) => s);
}

// Splice a new ordering of the watching names back into the full stock array,
// leaving names in other pipeline stages exactly where they were, then renumber
// every card by its final index so the new order persists (orderStocks sorts by
// `position`, so the numbers — not the array order — are what stick).
function applyWatchingOrder(allStocks, orderedWatching) {
  const queue = [...orderedWatching];
  return allStocks
    .map((s) => (isWatching(s) ? queue.shift() : s))
    .map((s, position) => ({ ...s, position }));
}

const DIP_PERIODS = [
  { key: '52w', label: '% from 52W High' },
  { key: '1d', label: '1D' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
];

const PERIOD_SUBTITLES = {
  '52w': '% off 52-week high',
  '1d': 'Price change for current trading day',
  '1mo': 'Price change over the last month',
  '3mo': 'Price change over the last 3 months',
  '6mo': 'Price change over the last 6 months',
  '1y': 'Price change over the last year',
  '2y': 'Price change over the last 2 years',
  '5y': 'Price change over the last 5 years',
};

/* ── Shared % change source ───────────────────────────────────────
   One function computes a name's % change for the selected period so the Dip
   Finder graph and the "sort by % change" card order read from the SAME number
   (that's what "line them up" means). Returns null when the datum isn't loaded. */
function computePct(ticker, quote, period, periodData) {
  if (period === '52w') {
    if (!quote?.price || !quote?.fiftyTwoWeekHigh) return null;
    return ((quote.price - quote.fiftyTwoWeekHigh) / quote.fiftyTwoWeekHigh) * 100;
  }
  if (period === '1d') {
    return quote?.dayChangePct == null ? null : quote.dayChangePct;
  }
  const pct = (periodData[period] || {})[ticker];
  return pct == null ? null : pct;
}

// Owns the period selector + on-demand fetch of non-quote periods (1M…5Y). Lifted
// out of DipFinder so the page can share the exact same period + data with the card
// sort. 52W/1D come straight from the live quotes and need no fetch.
function usePeriodChanges(tickers) {
  const [period, setPeriod] = useState('52w');
  const [periodData, setPeriodData] = useState({});
  const [loading, setLoading] = useState(false);
  const fetchedPeriods = useRef({});

  useEffect(() => {
    if (period === '52w' || period === '1d' || tickers.length === 0) return;
    if (fetchedPeriods.current[period]) {
      setPeriodData(prev => ({ ...prev, [period]: fetchedPeriods.current[period] }));
      return;
    }
    setLoading(true);
    fetch(`/api/period-changes?tickers=${tickers.join(',')}&period=${period}`)
      .then(r => r.json())
      .then(data => {
        fetchedPeriods.current[period] = data.changes || {};
        setPeriodData(prev => ({ ...prev, [period]: data.changes || {} }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, tickers]);

  return { period, setPeriod, periodData, loading };
}

/* ── Dip Finder Bar Chart (Chart.js) ──────────────────────────── */
function DipFinder({ stocks, quotes, period, setPeriod, periodData, periodLoading }) {
  const items = useMemo(() => {
    return stocks
      .map(s => {
        const pct = computePct(s.ticker, quotes[s.ticker], period, periodData);
        return pct == null ? null : { ticker: s.ticker, pct };
      })
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct);
  }, [stocks, quotes, period, periodData]);

  const data = {
    labels: items.map(i => i.ticker),
    datasets: [
      {
        data: items.map(i => i.pct),
        backgroundColor: items.map(i =>
          i.pct >= 0 ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.90)'
        ),
        hoverBackgroundColor: items.map(i =>
          i.pct >= 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)'
        ),
        borderRadius: 4,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}%`,
        },
        backgroundColor: '#1f2937',
        titleFont: { size: 12, weight: 'bold' },
        bodyFont: { size: 12 },
        padding: 8,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { size: 11, weight: '600' },
          color: '#6b7280',
        },
        border: { display: false },
      },
      y: {
        grid: {
          color: 'rgba(0,0,0,0.05)',
          drawTicks: false,
        },
        ticks: {
          font: { size: 11 },
          color: '#9ca3af',
          callback: (v) => `${v}%`,
          padding: 8,
        },
        border: { display: false },
      },
    },
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Dip Finder</h2>
          <p className="text-xs text-gray-400">{PERIOD_SUBTITLES[period]}</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {DIP_PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                period === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {periodLoading ? (
        <div className="flex items-center justify-center" style={{ height: 260 }}>
          <div className="text-sm text-gray-400 animate-pulse">Loading data...</div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center" style={{ height: 260 }}>
          <div className="text-sm text-gray-400">No data available</div>
        </div>
      ) : (
        <div style={{ height: Math.max(260, items.length * 12 + 120) }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}

/* ── 52-Week Range Bar with Red→Green Gradient ────────────────── */
function RangeBar({ low, high, current }) {
  if (!low || !high || !current) return null;
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div className="mt-1">
      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
        <span>{formatMoneyPrecise(low)}</span>
        <span className="text-gray-500 font-medium text-[10px]">52W</span>
        <span>{formatMoneyPrecise(high)}</span>
      </div>
      <div
        className="relative h-1.5 rounded-full"
        style={{
          background: 'linear-gradient(90deg, #ef4444, #f59e0b, #22c55e)',
        }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-md"
          style={{
            left: `calc(${pct}% - 5px)`,
            backgroundColor: pct > 66 ? '#22c55e' : pct > 33 ? '#f59e0b' : '#ef4444',
          }}
        />
      </div>
    </div>
  );
}

/* ── Stock Card ───────────────────────────────────────────────── */
function StockCard({
  stock,
  quote,
  onRemove,
  onMove,
  onMoveOrder,
  onToggleStar,
  onUpdateNote,
  onSyncNoteRows,
  noteExpanded = false,
  onToggleNoteExpand = () => {},
  canMoveLeft = false,
  canMoveRight = false,
  moving = false,
  starred = false,
  openCommentCount = 0,
  author = null,
  commentsOpen = false,
  onToggleComments = () => {},
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openThreadCount = openCommentCount;

  return (
    <div
      data-stock-ticker={stock.ticker}
      className={`relative h-full flex flex-col bg-white rounded-2xl border shadow-sm hover:shadow-md transition-shadow p-5 pb-3 ${
        starred ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-200'
      }`}
    >
      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm font-semibold text-gray-800">
            Remove <span className="text-red-500">{stock.ticker}</span> from watchlist?
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-1.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onRemove(stock.ticker)}
              className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-1.5 rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-gray-900">{stock.ticker}</span>
            {quote?.shortName && (
              <span className="text-sm text-gray-400 font-medium truncate">({quote.shortName})</span>
            )}
          </div>
          {quote?.price && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xl font-semibold text-gray-800">
                {formatMoneyPrecise(quote.price)}
              </span>
              {quote.dayChange != null && (
                <span className={`flex items-center gap-0.5 text-sm font-medium ${
                  quote.dayChange >= 0 ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {quote.dayChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {formatPct(quote.dayChangePct)}
                </span>
              )}
            </div>
          )}
          {!quote?.price && (
            <div className="h-7 w-24 bg-gray-100 rounded animate-pulse mt-1" />
          )}
          {/* Author — who owns the write-up for this name, or a quiet nudge to set
              one. Comes from the thesis (same store as Draft & Review). */}
          <div className="mt-1 flex items-center gap-1 text-[11px] min-w-0">
            {author?.name || author?.email ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-gray-400 shrink-0">Author</span>
                <span className="text-gray-600 font-medium truncate">{author.name || author.email}</span>
              </>
            ) : (
              <span className="text-gray-300 italic">No author set yet</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onToggleStar(stock.ticker)}
            className={`transition-colors p-1 ${
              starred ? 'text-amber-400 hover:text-amber-500' : 'text-gray-300 hover:text-amber-400'
            }`}
            title={starred ? 'Unpin from top' : 'Pin to top'}
          >
            <Star size={16} fill={starred ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => onToggleComments(stock.ticker)}
            className={`relative transition-colors p-1 ${
              commentsOpen ? 'text-emerald-600' : openThreadCount > 0 ? 'text-emerald-500 hover:text-emerald-600' : 'text-gray-300 hover:text-gray-500'
            }`}
            title="Comments"
          >
            <MessageCircle size={16} />
            {openThreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                {openThreadCount}
              </span>
            )}
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onMoveOrder(stock.ticker, 'left')}
            disabled={!canMoveLeft}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-25 disabled:hover:text-gray-300 transition-colors p-1"
            title="Move up"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onMoveOrder(stock.ticker, 'right')}
            disabled={!canMoveRight}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-25 disabled:hover:text-gray-300 transition-colors p-1"
            title="Move down"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-red-400 hover:text-red-600 transition-colors p-1"
            title="Remove"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 52-week range */}
      {quote && (
        <RangeBar low={quote.fiftyTwoWeekLow} high={quote.fiftyTwoWeekHigh} current={quote.price} />
      )}

      {/* Key metrics row */}
      {quote?.price && (
        <div className="flex gap-3 mt-2 text-[11px] text-gray-500">
          {quote.marketCap && <span>MCap {formatLargeNumber(quote.marketCap)}</span>}
          {quote.trailingPE && <span>PE {quote.trailingPE.toFixed(1)}</span>}
          {quote.forwardPE && <span>Fwd PE {quote.forwardPE.toFixed(1)}</span>}
        </div>
      )}

      {/* Why I'm interested */}
      <div className="mt-2.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Why I&apos;m Interested
        </label>
        <div className="relative mt-1">
          <textarea spellCheck={true}
            data-watchlist-note
            defaultValue={stock.note || ''}
            placeholder="Quick note on why this stock is interesting..."
            className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
            rows={2}
            ref={(el) => {
              if (!el) return;
              if (noteExpanded) autoExpand(el);
              else el.style.height = `${COLLAPSED_NOTE_HEIGHT}px`;
              onSyncNoteRows();
            }}
            onInput={(e) => {
              if (noteExpanded) autoExpand(e.target);
              else e.target.style.height = `${COLLAPSED_NOTE_HEIGHT}px`;
              onSyncNoteRows();
            }}
            onBlur={(e) => onUpdateNote(stock.ticker, e.target.value)}
          />
          {/* Anchored to the bottom-right corner of the note box; a matching
              background keeps it legible over any text it overlaps. */}
          <button
            type="button"
            onClick={() => onToggleNoteExpand(stock.ticker)}
            className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300 hover:text-emerald-600 bg-gray-50 rounded pl-1.5 py-0.5 transition-colors"
            title={noteExpanded ? 'Collapse notes in this row' : 'Expand notes in this row'}
          >
            {noteExpanded ? 'Collapse' : 'Expand'}
            {noteExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onMove(stock.ticker, 'draft')}
          disabled={moving}
          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {moving ? 'Moving…' : 'Move to Draft & Review'}
          {moving ? <RefreshCw size={13} className="animate-spin" /> : <ArrowRight size={13} />}
        </button>
      </div>
    </div>
  );
}

/* ── Watchlist Selector Dropdown ──────────────────────────────── */
function WatchlistSelector({ watchlists, activeId, onSwitch, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const dropdownRef = useRef(null);

  const activeList = watchlists.find(w => w.id === activeId);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
        setCreatingNew(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setCreatingNew(false);
  };

  const handleRename = (id) => {
    const name = renameValue.trim();
    if (!name) return;
    onRename(id, name);
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="relative z-50" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-2 transition-colors shadow-sm"
      >
        <List size={15} className="text-gray-400" />
        <span className="max-w-[200px] truncate">{activeList?.name || 'Watchlist'}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {watchlists.map(wl => (
              <div
                key={wl.id}
                role="button"
                onClick={() => {
                  if (renamingId === wl.id || confirmDeleteId === wl.id) return;
                  onSwitch(wl.id);
                  setOpen(false);
                }}
                className={`flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer ${
                  wl.id === activeId ? 'bg-emerald-50/60' : ''
                }`}
              >
                {renamingId === wl.id ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleRename(wl.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 flex items-center gap-1.5"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-300"
                      onKeyDown={(e) => { if (e.key === 'Escape') { setRenamingId(null); } }}
                    />
                    <button type="submit" className="text-emerald-600 hover:text-emerald-700 p-0.5">
                      <Check size={14} />
                    </button>
                  </form>
                ) : confirmDeleteId === wl.id ? (
                  <div className="flex-1 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-red-600 font-medium">Delete &ldquo;{wl.name}&rdquo;?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 px-2 py-0.5 rounded"
                      >
                        No
                      </button>
                      <button
                        onClick={() => { onDelete(wl.id); setConfirmDeleteId(null); }}
                        className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded"
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-left text-sm text-gray-800 font-medium truncate">
                      {wl.name}
                      {(() => {
                        // Count only names still in the watching stage — names promoted to
                        // Draft & Review / Research / Position live on their own tabs and must
                        // not inflate the Watchlist count (this matches the on-page tally).
                        const count = wl.stocks.filter(s => s.stage === 'watching' || s.stage === 'researching').length;
                        return (
                          <span className="text-xs text-gray-400 ml-2">
                            {count} stock{count !== 1 ? 's' : ''}
                          </span>
                        );
                      })()}
                    </span>
                    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setRenamingId(wl.id); setRenameValue(wl.name); }}
                        className="text-gray-300 hover:text-gray-500 p-1 rounded transition-colors"
                        title="Rename"
                      >
                        <Pencil size={13} />
                      </button>
                      {watchlists.length > 1 && (
                        <button
                          onClick={() => setConfirmDeleteId(wl.id)}
                          className="text-gray-300 hover:text-red-400 p-1 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Create new watchlist */}
          <div className="border-t border-gray-100 px-3 py-2.5">
            {creatingNew ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
                className="flex items-center gap-1.5"
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Watchlist name..."
                  className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-300"
                  onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingNew(false); setNewName(''); } }}
                />
                <button type="submit" className="text-emerald-600 hover:text-emerald-700 p-0.5">
                  <Check size={14} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreatingNew(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors w-full"
              >
                <Plus size={14} />
                New Watchlist
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function WatchlistPage() {
  const cache = useCache();
  const router = useRouter();
  const [allData, setAllData] = useState(null); // { watchlists: [...], activeWatchlistId }
  // Ticker currently being promoted (null = idle). Drives that card's button spinner
  // so the click has immediate feedback while the move + navigation resolve.
  const [movingTicker, setMovingTicker] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [tickerInput, setTickerInput] = useState('');
  // Symbol validation for the add form: true while the existence check is in
  // flight, and { ticker, suggestions } after a miss so the user can pick the
  // listing they meant (e.g. UMG → UMGNF / UMG.AS).
  const [addChecking, setAddChecking] = useState(false);
  const [addError, setAddError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  // Grid ordering: 'manual' = drag/arrow order (pinned float to top); 'change' =
  // sorted to mirror the Dip Finder graph's biggest-% -change-first ordering.
  const [sortMode, setSortMode] = useState('manual');
  // Ticker whose comments popover is open (null = none). Only one at a time.
  const [openCommentsTicker, setOpenCommentsTicker] = useState(null);
  const [loadedReview, setLoadedReview] = useState(null); // { ticker, thesis } backing the open popover
  const [reviewSummary, setReviewSummary] = useState({}); // ticker -> open comment count (card badges)
  const [reviewAuthors, setReviewAuthors] = useState({}); // ticker -> { name, email } (card author line)
  // Tickers whose note is expanded to full height (default: compact). Toggling one
  // card flips every card sharing its visual row so the row stays aligned.
  const [expandedNotes, setExpandedNotes] = useState(() => new Set());
  const stockAreaRef = useRef(null);
  const prevPositionsRef = useRef(new Map());
  const movedTickersRef = useRef(new Set());
  const noteRowsFrameRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const shouldAnimateRef = useRef(false);
  // Freshest optimistic-concurrency version per watchlist id, and a promise chain that
  // serializes writes. Together these stop a name's own back-to-back edits (rapid
  // reorder clicks, a drag right after a star) from false-conflicting: saves run one
  // at a time and each payload is re-stamped with the latest version just before send.
  const latestVersionsRef = useRef({});
  const saveChainRef = useRef(Promise.resolve());
  // The last server-confirmed watchlist CONTENT (versions ignored). A 409 is only a
  // *real* conflict when the server's content has diverged from this base; when only
  // the version tokens advanced (stale bookkeeping — the common case after moving a
  // name to another stage/page bumps the row), the save is safe to retry silently
  // instead of nagging the user to redo a change nothing actually clobbered.
  const serverTruthRef = useRef(null);

  const watchlists = (allData?.watchlists || []).toSorted((a, b) => {
    const aMain = a.name?.toLowerCase().includes('b.d. sterling') || a.name?.toLowerCase().includes('bd sterling') ? 0 : 1;
    const bMain = b.name?.toLowerCase().includes('b.d. sterling') || b.name?.toLowerCase().includes('bd sterling') ? 0 : 1;
    return aMain - bMain;
  });
  const activeId = allData?.activeWatchlistId || 'default';
  const activeWatchlist = watchlists.find(w => w.id === activeId);
  const stocks = useMemo(() => orderStocks(activeWatchlist?.stocks || []), [activeWatchlist]);

  // The Watchlist tab only shows names still in the watching stage (promoted names
  // live on their own tabs; their `stage` flips but no data is lost). 'researching'
  // (the retired On Queue stage) folds back into Watching so nothing is stranded.
  const watching = useMemo(() => stocks.filter(isWatching), [stocks]);
  const watchingTickers = useMemo(() => watching.map(s => s.ticker).filter(Boolean), [watching]);

  // Period selector + data shared with the Dip Finder graph so "sort by % change"
  // reads the exact numbers the graph draws.
  const { period, setPeriod, periodData, loading: periodLoading } = usePeriodChanges(watchingTickers);

  const pctByTicker = useMemo(() => {
    const map = {};
    for (const s of watching) {
      const pct = computePct(s.ticker, quotes[s.ticker], period, periodData);
      if (pct != null) map[s.ticker] = pct;
    }
    return map;
  }, [watching, quotes, period, periodData]);

  // What the grid actually renders. Pinned names always float to the top; within
  // each tier the order is the manual (drag/arrow) order, or — in "% change" mode —
  // sorted to mirror the Dip Finder (biggest change first). Names still missing a
  // datum sort last so the grid doesn't reshuffle while a period is loading.
  const displayWatching = useMemo(() => {
    if (sortMode !== 'change') return starredFirst(watching);
    return watching
      .map((s, i) => ({ s, i, pct: pctByTicker[s.ticker] }))
      .sort((a, b) => {
        const star = Number(!!b.s.starred) - Number(!!a.s.starred);
        if (star) return star;
        const aHas = a.pct != null, bHas = b.pct != null;
        if (aHas && bHas) return b.pct - a.pct;
        if (aHas !== bHas) return aHas ? -1 : 1;
        return a.i - b.i;
      })
      .map(x => x.s);
  }, [watching, sortMode, pctByTicker]);

  // Card comment badges: counts live on the theses, not the watchlist payload, so
  // fetch a batch summary of open comment counts for the visible names.
  const watchingKey = watchingTickers.join(',');
  useEffect(() => {
    if (!watchingKey) return;
    let cancelled = false;
    fetch(`/api/review-summary?tickers=${encodeURIComponent(watchingKey)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.summaries) setReviewSummary(prev => ({ ...prev, ...d.summaries }));
        if (d.authors) setReviewAuthors(prev => ({ ...prev, ...d.authors }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [watchingKey]);

  // Record the authoritative version of each watchlist so the next save sends a
  // current token rather than the one first loaded.
  const rememberVersions = useCallback((data) => {
    for (const w of data?.watchlists || []) {
      if (w?.version != null) latestVersionsRef.current[w.id] = w.version;
    }
  }, []);

  // Load watchlist
  const loadData = useCallback(async () => {
    try {
      const cached = cache.get('watchlist_data');
      if (cached?.watchlists) {
        setAllData(cached);
        rememberVersions(cached);
        serverTruthRef.current = cached;
        setLoading(false);
        return cached;
      }
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      setAllData(data);
      rememberVersions(data);
      serverTruthRef.current = data;
      writeWatchlistCache(cache, data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
      return null;
    }
  }, [cache, rememberVersions]);

  // Save all data. Guarded by optimistic concurrency: if someone else changed the
  // watchlist first, the server returns the fresh state and we reload it — so their
  // edit is never silently lost. The local change is reverted (visibly, with a
  // notice) and can be redone against the up-to-date list.
  const saveData = useCallback((updatedData) => {
    // Optimistic UI right away so the grid feels instant…
    setAllData(updatedData);
    writeWatchlistCache(cache, updatedData);

    // …but serialize the network writes on a single chain. Each save waits for the
    // previous to finish (which refreshes latestVersionsRef), then re-stamps the
    // payload with the freshest version per list just before sending — so two of the
    // user's own edits in quick succession can never collide on a stale token.
    const task = saveChainRef.current.then(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const stamped = {
          ...updatedData,
          watchlists: (updatedData.watchlists || []).map(w => {
            const v = latestVersionsRef.current[w.id];
            return v != null ? { ...w, version: v } : w;
          }),
        };
        const res = await postWatchlist(stamped);

        if (!res.conflict) {
          // Success. Adopt the freshly-bumped tokens, and record our payload as the
          // new server truth (content-wise it now equals what the server stored).
          if (res.versions?.length) {
            for (const v of res.versions) {
              if (v?.version != null) latestVersionsRef.current[v.id] = v.version;
            }
            // Fold the new tokens into state/cache too, so a later save built from a
            // fresh render (not through the ref) still carries a current version.
            setAllData(prev => {
              if (!prev) return prev;
              const merged = {
                ...prev,
                watchlists: prev.watchlists.map(w => {
                  const nv = latestVersionsRef.current[w.id];
                  return nv != null ? { ...w, version: nv } : w;
                }),
              };
              writeWatchlistCache(cache, merged);
              return merged;
            });
          }
          serverTruthRef.current = updatedData;
          return;
        }

        // A 409 came back. Refresh tokens from the server's truth either way, then
        // decide whether this is a REAL conflict or just a stale version token.
        const server = res.current;
        if (server) rememberVersions(server);
        const base = serverTruthRef.current;
        const diverged =
          !server || !base ||
          watchlistContentSig(server) !== watchlistContentSig(base);

        if (!diverged) {
          // No one actually changed the data — our version token was merely stale
          // (e.g. a stage move on another page bumped the row). Re-stamp with the
          // fresh tokens and retry silently; the user's change still lands, no nag.
          serverTruthRef.current = server;
          continue;
        }

        // Genuinely concurrent edit by someone else: adopt their state and let the
        // user redo, so their change is never silently overwritten.
        setAllData(server);
        writeWatchlistCache(cache, server);
        serverTruthRef.current = server;
        setToast({ message: 'The watchlist was updated in another session — reloaded the latest. Please redo your change.', type: 'info' });
        return;
      }
      // Still colliding after several silent retries (sustained contention) — surface
      // it rather than spin forever.
      setToast({ message: 'The watchlist was updated in another session — reloaded the latest. Please redo your change.', type: 'info' });
    });
    // Keep the chain alive even if one save throws.
    saveChainRef.current = task.catch(() => {});
    return task;
  }, [cache, rememberVersions]);

  // Helper: update active watchlist's stocks and save
  const saveStocks = useCallback(async (updatedStocks) => {
    const orderedStocks = orderStocks(updatedStocks);
    const updatedData = {
      ...allData,
      watchlists: allData.watchlists.map(wl =>
        wl.id === activeId ? { ...wl, stocks: orderedStocks } : wl
      ),
    };
    await saveData(updatedData);
  }, [allData, activeId, saveData]);

  // Fetch quotes
  const fetchQuotes = useCallback(async (stockList) => {
    const tickers = stockList.map(s => s.ticker).filter(Boolean);
    if (tickers.length === 0) return;
    try {
      const cachedQuotes = cache.get('watchlist_quotes');
      if (cachedQuotes) {
        setQuotes(cachedQuotes);
        return;
      }
      const res = await fetch(`/api/quotes?tickers=${tickers.join(',')}`);
      const data = await res.json();
      setQuotes(data.quotes || {});
      cache.set('watchlist_quotes', data.quotes || {});
    } catch {
      // silent
    }
  }, [cache]);

  useEffect(() => {
    let cancelled = false;

    async function syncWatchlist() {
      const data = await loadData();
      if (!data || cancelled) return;

      const allStocks = (data.watchlists || []).flatMap(wl => wl.stocks || []);
      if (allStocks.length > 0) fetchQuotes(allStocks);
    }

    syncWatchlist();

    return () => {
      cancelled = true;
    };
  }, [loadData, fetchQuotes]);

  // ── Watchlist management ──

  const switchWatchlist = async (id) => {
    const updatedData = { ...allData, activeWatchlistId: id };
    await saveData(updatedData);
    // Fetch quotes for any new tickers
    const wl = updatedData.watchlists.find(w => w.id === id);
    if (wl) {
      const newTickers = wl.stocks.filter(s => !quotes[s.ticker]);
      if (newTickers.length > 0) {
        try {
          const res = await fetch(`/api/quotes?tickers=${newTickers.map(s => s.ticker).join(',')}`);
          const data = await res.json();
          if (data.quotes) {
            setQuotes(prev => {
              const merged = { ...prev, ...data.quotes };
              cache.set('watchlist_quotes', merged);
              return merged;
            });
          }
        } catch {}
      }
    }
  };

  const createWatchlist = async (name) => {
    const id = `wl_${Date.now()}`;
    const newWl = { id, name, stocks: [] };
    const updatedData = {
      ...allData,
      watchlists: [...allData.watchlists, newWl],
      activeWatchlistId: id,
    };
    await saveData(updatedData);
  };

  const renameWatchlist = async (id, name) => {
    const updatedData = {
      ...allData,
      watchlists: allData.watchlists.map(wl =>
        wl.id === id ? { ...wl, name } : wl
      ),
    };
    await saveData(updatedData);
  };

  const deleteWatchlist = async (id) => {
    const remaining = allData.watchlists.filter(wl => wl.id !== id);
    if (remaining.length === 0) return;
    const updatedData = {
      ...allData,
      watchlists: remaining,
      activeWatchlistId: allData.activeWatchlistId === id ? remaining[0].id : allData.activeWatchlistId,
    };
    await saveData(updatedData);
  };

  // ── Stock operations (scoped to active watchlist) ──

  const addStock = async (symbolOverride) => {
    const ticker = (symbolOverride || tickerInput).trim().toUpperCase();
    setAddError(null);
    if (!ticker || stocks.some(s => s.ticker === ticker)) {
      setTickerInput('');
      return;
    }

    // Failsafe: Yahoo returns an empty quote (not an error) for symbols it
    // doesn't carry, so without this gate a dead ticker joins the list and
    // only fails ~30s into Generate Data. Suggestion clicks skip the check —
    // the suggestion came from Yahoo, so it's known-good.
    if (!symbolOverride) {
      setAddChecking(true);
      let check = null;
      try {
        const res = await fetch(`/api/validate-ticker?ticker=${encodeURIComponent(ticker)}`);
        if (res.ok) check = await res.json();
      } catch {}
      setAddChecking(false);
      if (check?.valid === false) {
        setAddError({ ticker, suggestions: check.suggestions || [] });
        return;
      }
      // Validator unreachable (network/Yahoo hiccup): add unchecked rather
      // than block the workflow on it.
    }

    const newStock = {
      ticker,
      stage: 'watching',
      note: '',
      fundamentals: { revenueGrowth: '', profitability: '', capitalReturn: '', misc: '' },
      dislocationItems: [],
      addedAt: new Date().toISOString(),
    };
    const updated = [...stocks, newStock];
    setTickerInput('');
    await saveStocks(updated);
    // Fetch quote for new ticker
    try {
      const res = await fetch(`/api/quotes?tickers=${ticker}`);
      const data = await res.json();
      if (data.quotes) {
        setQuotes(prev => {
          const merged = { ...prev, ...data.quotes };
          cache.set('watchlist_quotes', merged);
          return merged;
        });
      }
    } catch {}
  };

  const removeStock = async (ticker) => {
    await saveStocks(stocks.filter(s => s.ticker !== ticker));
  };

  // Move a name into the Draft & Review stage. This only flips `stage`; every other
  // field on the stock and its thesis is left untouched, so a name can round-trip
  // between the Watchlist and Draft & Review tabs without losing any data.
  const moveStock = async (ticker, newStage) => {
    if (movingTicker) return;
    setMovingTicker(ticker);
    try {
      // Promoting into Draft & Review seeds the Investment Overview from the "Why
      // I'm interested" note so those initial thoughts aren't retyped (issue #76).
      // Best-effort: a failure here must never block the stage move.
      if (newStage === 'draft') {
        const note = (stocks.find(s => s.ticker === ticker)?.note || '').trim();
        if (note) {
          try { await seedInvestmentOverviewFromNote(ticker, note); } catch {}
        }
      }
      await saveStocks(stocks.map(s =>
        s.ticker === ticker ? { ...s, stage: newStage } : s
      ));
      // Follow the name to its new stage's tab so the pipeline reads as one flow.
      router.push(routeForStage(newStage, ticker));
    } catch {
      setMovingTicker(null);
    }
  };

  // Persist a new order of the watching names: splice it back into the full stock
  // list (leaving other-stage names untouched) and save. Shared by drag, the arrows,
  // and the star toggle. Always re-float pinned names first so the invariant holds.
  const persistWatchingOrder = async (orderedWatching) => {
    await saveStocks(applyWatchingOrder(stocks, starredFirst(orderedWatching)));
  };

  const moveStockOrder = async (ticker, direction) => {
    if (sortMode !== 'manual') return; // order is derived in "% change" mode
    const list = displayWatching;
    const idx = list.findIndex(s => s.ticker === ticker);
    if (idx < 0) return;

    const neighborIdx = direction === 'left' ? idx - 1 : idx + 1;
    const neighbor = list[neighborIdx];
    // Don't let an arrow hop the pin boundary — pinned names stay above un-pinned.
    if (!neighbor || !!neighbor.starred !== !!list[idx].starred) return;

    // FLIP: snapshot current positions so the swap animates smoothly.
    const area = stockAreaRef.current;
    if (area) {
      const currentPositions = new Map();
      area.querySelectorAll('[data-stock-ticker]').forEach(el => {
        const rect = el.getBoundingClientRect();
        currentPositions.set(el.getAttribute('data-stock-ticker'), { x: rect.left, y: rect.top });
      });
      prevPositionsRef.current = currentPositions;
    }

    const moved = [...list];
    [moved[idx], moved[neighborIdx]] = [moved[neighborIdx], moved[idx]];

    movedTickersRef.current = new Set([ticker, neighbor.ticker]);
    pendingScrollRef.current = { x: window.scrollX, y: window.scrollY };
    shouldAnimateRef.current = true;
    await persistWatchingOrder(moved);
  };

  const toggleStar = async (ticker) => {
    // Flip the pin, then re-float. Base this on the MANUAL order (not the current
    // view) so pinning while sorted by "% change" never overwrites the saved manual
    // ordering — it only moves the toggled name to the boundary of its new tier.
    const flipped = starredFirst(watching).map(s =>
      s.ticker === ticker ? { ...s, starred: !s.starred } : s
    );
    await persistWatchingOrder(flipped);
  };

  const updateNote = async (ticker, note) => {
    await saveStocks(stocks.map(s =>
      s.ticker === ticker ? { ...s, note } : s
    ));
  };

  // Comments are ONE entity per ticker that follows it across every pipeline stage:
  // they live on the thesis (thesis.underwriting.draftReview), the exact same store
  // Draft & Review reads/writes. So a comment added on the Watchlist is the same
  // comment in Draft & Review after promotion, a Draft & Review comment (open OR
  // resolved) shows here after a demote, and saveThesisReconciled unions threads by
  // id so nothing is lost. `openReviewThesis` holds the full thesis for the open
  // popover (kept in a ref too so edits build on the freshest copy).
  const loadedReviewRef = useRef(null);

  // Load the thesis backing the open popover. Only sets state inside the async
  // callback (no synchronous reset) — loading is derived by comparing tickers.
  useEffect(() => {
    if (!openCommentsTicker) return;
    let cancelled = false;
    fetchThesis(openCommentsTicker)
      .then(t => { if (!cancelled) { const v = { ticker: openCommentsTicker, thesis: t || {} }; loadedReviewRef.current = v; setLoadedReview(v); } })
      .catch(() => { if (!cancelled) { const v = { ticker: openCommentsTicker, thesis: {} }; loadedReviewRef.current = v; setLoadedReview(v); } });
    return () => { cancelled = true; };
  }, [openCommentsTicker]);

  const reviewReady = !!openCommentsTicker && loadedReview?.ticker === openCommentsTicker;
  const reviewLoading = !!openCommentsTicker && !reviewReady;
  const openReview = reviewReady ? normalizeReview(loadedReview.thesis.underwriting?.draftReview) : null;

  // Fold the popover's edits back into the thesis' draftReview (leaving `paper` and
  // everything else untouched). persist=false = keystroke (local only); persist=true
  // saves through the OCC-reconciled thesis save.
  const updateReview = useCallback(async (ticker, nextReview, persist) => {
    const cur = loadedReviewRef.current;
    const base = (cur?.ticker === ticker ? cur.thesis : null) || {};
    const dr = base.underwriting?.draftReview || {};
    const nextThesis = {
      ...base,
      underwriting: {
        ...(base.underwriting || {}),
        draftReview: {
          ...dr,
          threads: nextReview.threads,
          author: nextReview.author,
          reviewer: nextReview.reviewer,
          autoNotify: nextReview.autoNotify,
        },
      },
    };
    loadedReviewRef.current = { ticker, thesis: nextThesis };
    setLoadedReview({ ticker, thesis: nextThesis });
    setReviewSummary(s => ({ ...s, [ticker]: openCommentCount(nextReview.threads) }));
    setReviewAuthors(a => setCardAuthor(a, ticker, nextReview.author));
    if (persist) {
      const res = await saveThesisReconciled(ticker, nextThesis);
      const merged = res?.thesis;
      if (merged) {
        // Adopt the persisted/merged thesis (fresh version + any teammate threads
        // unioned in) — only if the popover is still on the same ticker.
        if (loadedReviewRef.current?.ticker === ticker) {
          loadedReviewRef.current = { ticker, thesis: merged };
          setLoadedReview({ ticker, thesis: merged });
        }
        setReviewSummary(s => ({ ...s, [ticker]: openCommentCount(merged.underwriting?.draftReview?.threads) }));
        setReviewAuthors(a => setCardAuthor(a, ticker, merged.underwriting?.draftReview?.author));
      }
    }
  }, []);

  // Email the "who's up next" recipients for a stock's pending comments, reusing the
  // same endpoint Draft & Review uses (it's ticker-generic).
  const notifyStockComments = useCallback(async (ticker, threadIds) => {
    const r = normalizeReview(loadedReviewRef.current?.thesis?.underwriting?.draftReview);
    try {
      const res = await fetch('/api/notify-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, author: r.author, reviewer: r.reviewer, threads: r.threads, threadIds, stage: 'watching' }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.sent?.length) {
        setToast({ message: `Emailed ${data.sent.map(s => s.role).join(' & ')} for ${ticker}`, type: 'success' });
      } else if (data.skipped?.length) {
        setToast({ message: `Couldn't send for ${ticker}: ${data.skipped[0].reason}`, type: 'error' });
      }
      return data;
    } catch {
      setToast({ message: `Failed to send notification for ${ticker}`, type: 'error' });
      return { sent: [], skipped: [] };
    }
  }, []);

  const syncNoteRows = useCallback(() => {
    if (noteRowsFrameRef.current) return;
    noteRowsFrameRef.current = requestAnimationFrame(() => {
      noteRowsFrameRef.current = null;
      const area = stockAreaRef.current;
      if (!area) return;
      const expanded = expandedNotes;

      const grids = [...area.querySelectorAll('[data-stock-grid]')];
      grids.forEach(grid => {
        const cards = [...grid.querySelectorAll('[data-stock-ticker]')];
        const rowGroups = [];

        // Let every note shrink to its natural content height so we can measure it.
        cards.forEach(card => {
          const note = card.querySelector('[data-watchlist-note]');
          if (note) note.style.height = 'auto';
        });

        // Group notes by the visual row their card sits in, flagging a row as expanded
        // if any card in it is expanded (an expanded card grows its whole row).
        cards.forEach(card => {
          const note = card.querySelector('[data-watchlist-note]');
          if (!note) return;

          const top = card.getBoundingClientRect().top;
          let row = rowGroups.find(group => Math.abs(group.top - top) < 2);
          if (!row) {
            row = { top, notes: [], expanded: false };
            rowGroups.push(row);
          }
          row.notes.push(note);
          if (expanded.has(card.getAttribute('data-stock-ticker'))) row.expanded = true;
        });

        rowGroups.forEach(row => {
          // Expanded rows grow every note to the tallest content so they line up;
          // collapsed rows sit at the compact height with the overflow clipped.
          const height = row.expanded
            ? Math.max(COLLAPSED_NOTE_HEIGHT, ...row.notes.map(note => note.scrollHeight))
            : COLLAPSED_NOTE_HEIGHT;
          row.notes.forEach(note => { note.style.height = `${height}px`; });
        });
      });
    });
  }, [expandedNotes]);

  // Expand or collapse a note and — so the grid stays tidy — every other card sharing
  // its visual row. Row membership is read from the DOM (cards at the same vertical
  // offset), then those tickers flip together.
  const toggleNoteExpand = useCallback((ticker) => {
    const area = stockAreaRef.current;
    let rowTickers = [ticker];
    if (area) {
      const cards = [...area.querySelectorAll('[data-stock-ticker]')];
      const self = cards.find(c => c.getAttribute('data-stock-ticker') === ticker);
      if (self) {
        const top = self.getBoundingClientRect().top;
        rowTickers = cards
          .filter(c => Math.abs(c.getBoundingClientRect().top - top) < 2)
          .map(c => c.getAttribute('data-stock-ticker'));
      }
    }
    setExpandedNotes(prev => {
      const willExpand = !prev.has(ticker);
      const next = new Set(prev);
      for (const t of rowTickers) {
        if (willExpand) next.add(t); else next.delete(t);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    syncNoteRows();
    window.addEventListener('resize', syncNoteRows);
    return () => {
      window.removeEventListener('resize', syncNoteRows);
      if (noteRowsFrameRef.current) {
        cancelAnimationFrame(noteRowsFrameRef.current);
        noteRowsFrameRef.current = null;
      }
    };
  }, [syncNoteRows, stocks.length, activeId]);

  useLayoutEffect(() => {
    syncNoteRows();

    const area = stockAreaRef.current;
    if (!area) return;
    const pendingScroll = pendingScrollRef.current;
    if (shouldAnimateRef.current && pendingScroll) {
      window.scrollTo(pendingScroll.x, pendingScroll.y);
    }
    const cards = area.querySelectorAll('[data-stock-ticker]');
    const newPositions = new Map();
    cards.forEach(el => {
      const ticker = el.getAttribute('data-stock-ticker');
      const rect = el.getBoundingClientRect();
      newPositions.set(ticker, { x: rect.left, y: rect.top });
      if (shouldAnimateRef.current && movedTickersRef.current.has(ticker)) {
        const prev = prevPositionsRef.current.get(ticker);
        if (prev && (prev.x !== rect.left || prev.y !== rect.top)) {
          const dx = prev.x - rect.left;
          const dy = prev.y - rect.top;
          try {
            el.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0px, 0px)' },
              ],
              { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }
            );
          } catch {}
        }
      }
    });
    if (shouldAnimateRef.current && pendingScroll) {
      requestAnimationFrame(() => window.scrollTo(pendingScroll.x, pendingScroll.y));
    }
    prevPositionsRef.current = newPositions;
    movedTickersRef.current = new Set();
    pendingScrollRef.current = null;
    shouldAnimateRef.current = false;
  });

  if (loading) {
    return (
      <div className="min-h-screen px-6 lg:px-12">
        <div className="max-w-7xl mx-auto">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-white rounded-2xl border border-gray-200 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 lg:px-12 pb-16">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in-up relative z-20">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
              <p className="text-sm text-gray-500 mt-1">
                {watching.length} stock{watching.length !== 1 ? 's' : ''} tracked
              </p>
            </div>
            <WatchlistSelector
              watchlists={watchlists}
              activeId={activeId}
              onSwitch={switchWatchlist}
              onCreate={createWatchlist}
              onRename={renameWatchlist}
              onDelete={deleteWatchlist}
            />
          </div>

          {/* Add stock */}
          <form
            onSubmit={(e) => { e.preventDefault(); addStock(); }}
            className="flex items-center gap-2"
          >
            <input
              value={tickerInput}
              onChange={(e) => { setTickerInput(e.target.value.toUpperCase()); setAddError(null); }}
              placeholder="TICKER"
              className="w-28 text-sm font-semibold text-gray-800 bg-white border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 uppercase placeholder:text-gray-400 placeholder:font-normal"
            />
            <button
              type="submit"
              disabled={addChecking}
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-wait px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <Plus size={15} />
              {addChecking ? 'Checking...' : 'Add'}
            </button>
          </form>
        </div>

        {addError && (
          <div className="flex flex-wrap items-center gap-2 -mt-4 mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm animate-fade-in-up">
            <span className="font-medium text-red-700">
              {addError.ticker} isn&apos;t a symbol Yahoo Finance recognizes
              {addError.suggestions.length > 0 ? ' — did you mean:' : '.'}
            </span>
            {addError.suggestions.map((s) => (
              <button
                key={s.symbol}
                onClick={() => { setTickerInput(''); addStock(s.symbol); }}
                className="flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-300 rounded-lg font-semibold text-gray-800 hover:border-emerald-400 hover:text-emerald-700 transition-colors"
              >
                {s.symbol}
                <span className="font-normal text-gray-500">{[s.name, s.exchange].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
            <button
              onClick={() => setAddError(null)}
              className="ml-auto text-gray-400 hover:text-gray-600 font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {watching.length === 0 && (
          <div className="text-center py-24">
            <Eye size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-500">No stocks on your watchlist</h3>
            <p className="text-sm text-gray-400 mt-1">Add a ticker above to start tracking</p>
          </div>
        )}

        {/* Dip Finder */}
        {watching.length > 0 && Object.keys(quotes).length > 0 && (
          <div className="animate-fade-in-up stagger-2">
            <DipFinder
              stocks={watching}
              quotes={quotes}
              period={period}
              setPeriod={setPeriod}
              periodData={periodData}
              periodLoading={periodLoading}
            />
          </div>
        )}

        {/* Order controls */}
        {watching.length > 1 && (
          <div className="flex items-center justify-end gap-2 mb-3">
            <span className="text-xs font-medium text-gray-400">Order</span>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setSortMode('manual')}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                  sortMode === 'manual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Manual
              </button>
              <button
                onClick={() => setSortMode('change')}
                className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                  sortMode === 'change' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
                title="Sort to match the Dip Finder graph (biggest % change first)"
              >
                <ArrowUpNarrowWide size={12} />
                {DIP_PERIODS.find(p => p.key === period)?.label || '% from 52W High'}
              </button>
            </div>
          </div>
        )}

        <div ref={stockAreaRef}>
          {watching.length > 0 && (
            <div data-stock-grid="watching" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in-up stagger-4">
              {displayWatching.map((stock, index) => {
                const prev = displayWatching[index - 1];
                const next = displayWatching[index + 1];
                const manual = sortMode === 'manual';
                return (
                  <StockCard
                    key={stock.ticker}
                    stock={stock}
                    quote={quotes[stock.ticker]}
                    onRemove={removeStock}
                    onMove={moveStock}
                    onMoveOrder={moveStockOrder}
                    onToggleStar={toggleStar}
                    onUpdateNote={updateNote}
                    onSyncNoteRows={syncNoteRows}
                    noteExpanded={expandedNotes.has(stock.ticker)}
                    onToggleNoteExpand={toggleNoteExpand}
                    starred={!!stock.starred}
                    canMoveLeft={manual && index > 0 && !!prev && !!prev.starred === !!stock.starred}
                    canMoveRight={manual && index < displayWatching.length - 1 && !!next && !!next.starred === !!stock.starred}
                    moving={movingTicker === stock.ticker}
                    openCommentCount={reviewSummary[stock.ticker] || 0}
                    author={reviewAuthors[stock.ticker] || null}
                    commentsOpen={openCommentsTicker === stock.ticker}
                    onToggleComments={(t) => setOpenCommentsTicker(prev => (prev === t ? null : t))}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Comments drawer — one instance for whichever card is open, mounted at the page
          level (not inside a card) so it slides in over the full viewport height. */}
      {openCommentsTicker && (
        <WatchlistComments
          ticker={openCommentsTicker}
          review={openReview}
          loading={reviewLoading}
          onChange={(next, persist) => updateReview(openCommentsTicker, next, persist)}
          onNotify={(threadIds) => notifyStockComments(openCommentsTicker, threadIds)}
          onClose={() => setOpenCommentsTicker(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
