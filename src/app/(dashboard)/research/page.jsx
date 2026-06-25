'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, AlertTriangle, Save, Plus, Trash2, CheckCircle, FileDown, Check, X, ClipboardList, FlaskConical, Square, CheckSquare, ChevronRight, ArrowLeft, Star, Sparkles, User } from 'lucide-react';
import Card from '@/components/Card';
import TickerSearchSelect from '@/components/TickerSearchSelect';
import StatCard from '@/components/StatCard';
import FundamentalChart from '@/components/charts/FundamentalChart';
import PriceChart from '@/components/charts/PriceChart';
import Toast from '@/components/Toast';
import { formatLargeNumber, formatNumber, formatShareCount } from '@/lib/formatters';
import { useCache } from '@/lib/CacheContext';
import ValuationModel from '@/components/ValuationModel';
import RichTextArea from '@/components/RichTextArea';
import ReviewCommentsPanel from '@/components/ReviewCommentsPanel';
import { useAuth } from '@/lib/AuthContext';
import { RESEARCH_TABS } from '@/lib/researchProgress';
import { persistStageMove, writeWatchlistCache, STAGE_LABELS } from '@/lib/stageMove';
import { migrateNewsImages } from '@/lib/migrateNewsImages';

const FUNDAMENTALS_BOXES = [
  { key: 'revenueGrowth', label: 'Revenue and Growth', color: 'blue', placeholder: 'Revenue CAGR, segment growth, unit economics, pricing, and demand drivers...' },
  { key: 'profitability', label: 'Profitability', color: 'emerald', placeholder: 'Margins, operating leverage, FCF conversion, EPS quality, and ROIC...' },
  { key: 'capitalReturn', label: 'Capital Returned to Shareholders', color: 'violet', placeholder: 'Buybacks, dividends, share count trends, and capital allocation discipline...' },
  { key: 'misc', label: 'Misc', color: 'gray', placeholder: 'Balance sheet context, cyclicality, one-time items, regulation, or anything else...' },
];

const BOX_STYLES = {
  blue: { bg: 'bg-blue-50/50', taBg: 'bg-blue-50/10', border: 'border-blue-200/60', ring: 'focus:ring-blue-200 focus:border-blue-300', label: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-50/50', taBg: 'bg-emerald-50/10', border: 'border-emerald-200/60', ring: 'focus:ring-emerald-200 focus:border-emerald-300', label: 'text-emerald-600' },
  violet: { bg: 'bg-violet-50/50', taBg: 'bg-violet-50/10', border: 'border-violet-200/60', ring: 'focus:ring-violet-200 focus:border-violet-300', label: 'text-violet-600' },
  gray: { bg: 'bg-gray-50', taBg: 'bg-white/70', border: 'border-gray-200', ring: 'focus:ring-gray-200 focus:border-gray-300', label: 'text-gray-600' },
};

function autoExpand(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// "Why This Name Is Here" note, isolated into its own component so typing only
// re-renders this textarea — not the whole research page. Editing it in place used
// to call setThesis on every keystroke, which re-rendered (and re-animated) every
// chart below it, causing a jarring flicker. Here the text lives in local state
// while editing and is committed to the thesis only on blur. Keyed by ticker
// upstream so it resets cleanly when the selected company changes.
// Resync with the upstream value is handled by the parent remounting this via a
// `key` that includes the note value, so this component just owns its local text
// while editing and commits on blur. That keeps typing from re-rendering (and
// re-animating) the charts below.
function WorkspaceNote({ value, onCommit }) {
  const [text, setText] = useState(value || '');
  const ref = useRef(null);
  // Keep the box sized to its content (mount + on every edit).
  useEffect(() => { autoExpand(ref.current); }, [text]);
  return (
    <textarea
      spellCheck
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      rows={3}
      placeholder="Summarize why this company graduated from the watchlist into deep research..."
      className="w-full bg-gray-50/50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none overflow-hidden"
    />
  );
}

function makeEditorItemId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createSubQuestion(overrides = {}) {
  return {
    id: overrides.id || makeEditorItemId(),
    text: overrides.text || '',
    done: !!overrides.done,
    answer: overrides.answer ?? '',
  };
}

function createQuestionItem(overrides = {}) {
  return {
    id: overrides.id || makeEditorItemId(),
    text: overrides.text || '',
    done: !!overrides.done,
    answer: overrides.answer ?? '',
    subQuestions: (overrides.subQuestions || []).map(createSubQuestion),
  };
}

function normalizeQuestionItems(items) {
  return (items || []).map(item => {
    if (typeof item === 'string') {
      return createQuestionItem({ text: item });
    }
    return createQuestionItem({
      id: item?.id,
      text: item?.text || '',
      done: !!item?.done,
      answer: item?.answer ?? '',
      subQuestions: (item?.subQuestions || []).map(sq => ({
        id: sq?.id,
        text: sq?.text || '',
        done: !!sq?.done,
        answer: sq?.answer ?? '',
      })),
    });
  });
}

function hasTextValue(value) {
  if (Array.isArray(value)) {
    return value.some(block => block?.type === 'text'
      ? Boolean(block.value?.trim())
      : Boolean(block?.url));
  }
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value);
}

function pickWorkspaceValue(primary, fallback) {
  // Only seed from the watchlist stock when the workspace value was NEVER set.
  // An explicit empty string / array / object means the analyst cleared it on
  // purpose, so respect it — otherwise deleting the note (or a fundamentals box)
  // re-populates from the stock value and it can never be emptied.
  return primary === undefined || primary === null ? fallback : primary;
}


function buildResearchWorkspace(thesis, stock) {
  const workspace = thesis?.underwriting?.researchWorkspace || {};
  const stockFundamentals = stock?.fundamentals || {};
  const workspaceFundamentals = workspace.fundamentals || {};
  return {
    note: pickWorkspaceValue(workspace.note, stock?.note ?? '') || '',
    fundamentals: {
      revenueGrowth: pickWorkspaceValue(workspaceFundamentals.revenueGrowth, stockFundamentals.revenueGrowth || ''),
      profitability: pickWorkspaceValue(workspaceFundamentals.profitability, stockFundamentals.profitability || ''),
      capitalReturn: pickWorkspaceValue(workspaceFundamentals.capitalReturn, stockFundamentals.capitalReturn || ''),
      misc: pickWorkspaceValue(workspaceFundamentals.misc, stockFundamentals.misc || ''),
    },
    dueDiligenceItems: normalizeQuestionItems(
      pickWorkspaceValue(workspace.dueDiligenceItems, stock?.dueDiligenceItems ?? [])
    ),
    dislocationItems: normalizeQuestionItems(
      pickWorkspaceValue(workspace.dislocationItems, stock?.dislocationItems ?? [])
    ),
  };
}

function makeTtmQuarterLabel(row) {
  return `${row.quarter}'${String(row.year).slice(-2)}`;
}

function ttmPctChange(curr, prior) {
  if (curr == null || prior == null || prior === 0) return null;
  return Math.round(((curr - prior) / Math.abs(prior)) * 1000) / 10;
}

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

// Build a compact, narration-ready TTM fundamentals summary from the data shown
// in the Fundamentals tab (tickerData). IMPORTANT: those series are ALREADY
// trailing-twelve-month figures — revenue/eps/fcf are TTM sums, operating margin
// is TTM-based, shares are a TTM mean — each indexed by quarter-end (see
// generateData.js). So every data point IS a rolling 12-month value; a "lookback
// of k quarters" is simply the value k points back, never a sum across points.
// Monetary values are pre-formatted so the model narrates rather than re-deriving
// magnitudes; growth/CAGRs are computed here so the figures are authoritative.
function buildFundamentalsTTM(tickerData, liveQuote) {
  if (!tickerData) return null;
  const rev = tickerData.revenue || [];
  const eps = tickerData.eps || [];
  const fcf = tickerData.fcf || [];
  const margins = tickerData.operating_margins || [];
  const shares = tickerData.buybacks || [];
  const valuation = tickerData.valuation || {};

  const revVals = rev.map(r => r.revenue);
  const epsVals = eps.map(e => e.eps_diluted);
  const fcfVals = fcf.map(f => f.free_cash_flow);
  const marginVals = margins.map(m => m.operating_margin * 100);
  const shareVals = shares.map(s => s.shares_outstanding);

  // at(vals, k): the TTM value k quarters before the latest quarter-end. k=0 is
  // the current TTM, k=4 the TTM one year ago, k=8 two years ago, etc. Each point
  // is already a rolling 12-month figure, so this is a direct lookup — no summing.
  const at = (vals, k) => {
    const idx = vals.length - 1 - k;
    return idx >= 0 && vals[idx] != null ? Number(vals[idx]) : null;
  };
  const cagrPct = (current, past, years) => {
    if (current == null || past == null || past <= 0 || current <= 0) return null;
    return Math.round((Math.pow(current / past, 1 / years) - 1) * 1000) / 10;
  };
  // CAGR ladder for a TTM metric. Each rung is null when history is too short, so
  // the model can read the trajectory (e.g. 5Y < 3Y < 1Y reads as accelerating).
  const cagrLadder = (vals) => ({
    cagr2yPct: cagrPct(at(vals, 0), at(vals, 8), 2),
    cagr3yPct: cagrPct(at(vals, 0), at(vals, 12), 3),
    cagr5yPct: cagrPct(at(vals, 0), at(vals, 20), 5),
  });

  const ttmRevenue = at(revVals, 0);
  const ttmEps = at(epsVals, 0);
  const ttmFcf = at(fcfVals, 0);
  const priorRevenue = at(revVals, 4);
  const priorEps = at(epsVals, 4);
  const priorFcf = at(fcfVals, 4);

  const latestShares = at(shareVals, 0);
  const yearAgoShares = at(shareVals, 4);
  const threeYrAgoShares = at(shareVals, 12);
  const fiveYrAgoShares = at(shareVals, 20);

  const price = liveQuote?.price || (valuation.currentPrice ? Number(valuation.currentPrice) : null);
  const ttmPe = (price && ttmEps && ttmEps > 0) ? price / ttmEps : null;
  const ttmFcfYield = (price && ttmFcf && latestShares && latestShares > 0)
    ? (ttmFcf / (price * latestShares)) * 100 : null;
  const ttmPs = (price && ttmRevenue && latestShares && latestShares > 0)
    ? (price * latestShares) / ttmRevenue : null;

  // FCF margin at a given lookback (both already TTM at the same quarter-end).
  const fcfMarginAt = (k) => {
    const f = at(fcfVals, k);
    const r = at(revVals, k);
    return (f != null && r) ? round1((f / r) * 100) : null;
  };

  // A trailing series of TTM snapshots for trend color. Because the underlying
  // values are rolling 12-month figures, this shows the smoothed trend (it does
  // NOT show quarterly seasonality).
  const series = (rows, vals, fmt, n = 8) => {
    const startIdx = Math.max(0, rows.length - n);
    return rows.slice(startIdx).map((row, i) => ({
      asOf: makeTtmQuarterLabel(row),
      value: fmt(vals[startIdx + i]),
    }));
  };
  const money = (v) => (v == null ? null : formatLargeNumber(v));
  const dollars = (v) => (v == null ? null : `$${Number(v).toFixed(2)}`);
  const pct = (v) => (v == null ? null : `${round1(v)}%`);

  return {
    asOf: rev.length ? makeTtmQuarterLabel(rev[rev.length - 1]) : null,
    quartersOfHistory: rev.length,
    note: 'All revenue/EPS/FCF figures are trailing-twelve-month (TTM); each series point is a rolling 12-month value at that quarter-end.',
    price: price != null ? Number(price.toFixed(2)) : null,
    revenue: {
      ttm: money(ttmRevenue),
      ttmOneYearAgo: money(priorRevenue),
      yoyGrowthPct: ttmPctChange(ttmRevenue, priorRevenue),
      ...cagrLadder(revVals),
      ttmTrend: series(rev, revVals, money),
    },
    eps: {
      ttm: dollars(ttmEps),
      ttmOneYearAgo: dollars(priorEps),
      yoyGrowthPct: ttmPctChange(ttmEps, priorEps),
      ...cagrLadder(epsVals),
      ttmTrend: series(eps, epsVals, dollars),
    },
    fcf: {
      ttm: money(ttmFcf),
      ttmOneYearAgo: money(priorFcf),
      yoyGrowthPct: ttmPctChange(ttmFcf, priorFcf),
      ...cagrLadder(fcfVals),
      ttmMarginPct: fcfMarginAt(0),
      ttmMarginOneYearAgoPct: fcfMarginAt(4),
      ttmTrend: series(fcf, fcfVals, money),
    },
    operatingMargin: {
      ttmPct: round1(at(marginVals, 0)),
      ttmOneYearAgoPct: round1(at(marginVals, 4)),
      ttmThreeYearsAgoPct: round1(at(marginVals, 12)),
      ttmTrend: series(margins, marginVals, pct),
    },
    shares: {
      latest: latestShares != null ? formatShareCount(latestShares) : null,
      yoyChangePct: ttmPctChange(latestShares, yearAgoShares),
      threeYrChangePct: ttmPctChange(latestShares, threeYrAgoShares),
      fiveYrChangePct: ttmPctChange(latestShares, fiveYrAgoShares),
      // Annualized pace of the share-count change (negative = net buybacks).
      annualized3yChangePct: cagrPct(latestShares, threeYrAgoShares, 3),
    },
    valuation: {
      peRatioTtm: round1(ttmPe),
      fcfYieldTtmPct: round1(ttmFcfYield),
      priceToSalesTtm: round1(ttmPs),
    },
  };
}

function updateStockInData(data, ticker, updater) {
  if (!data || !ticker) return data;
  return {
    ...data,
    watchlists: (data.watchlists || []).map(watchlist => ({
      ...watchlist,
      stocks: (watchlist.stocks || []).map(stock => (
        stock.ticker === ticker ? updater(stock) : stock
      )),
    })),
  };
}

function QuestionSection({
  title,
  subtitle,
  icon: Icon,
  accentClasses,
  items,
  ticker,
  onAdd,
  onToggleDone,
  onChangeQuestion,
  onSaveQuestion,
  onChangeAnswer,
  onSaveAnswer,
  onRemove,
  onUpdateSubQuestions,
}) {
  const [expandedSubs, setExpandedSubs] = useState({});
  const [subInputs, setSubInputs] = useState({});

  const toggleSubExpanded = (itemId) => {
    setExpandedSubs(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const addSubQuestion = (parentId) => {
    const text = (subInputs[parentId] || '').trim();
    if (!text) return;
    const item = items.find(entry => entry.id === parentId);
    const newSubs = [...(item?.subQuestions || []), createSubQuestion({ text })];
    onUpdateSubQuestions(parentId, newSubs);
    setSubInputs(prev => ({ ...prev, [parentId]: '' }));
  };

  const toggleSubDone = (parentId, subId) => {
    const item = items.find(entry => entry.id === parentId);
    const newSubs = (item.subQuestions || []).map((sq, si) =>
      sq.id === subId ? { ...sq, done: !sq.done } : sq
    );
    onUpdateSubQuestions(parentId, newSubs);
  };

  const updateSubText = (parentId, subId, text, persist = false) => {
    const item = items.find(entry => entry.id === parentId);
    const newSubs = (item.subQuestions || []).map((sq, si) =>
      sq.id === subId ? { ...sq, text } : sq
    );
    onUpdateSubQuestions(parentId, newSubs, persist);
  };

  const updateSubAnswer = (parentId, subId, value, persist = false) => {
    const item = items.find(entry => entry.id === parentId);
    const newSubs = (item.subQuestions || []).map((sq, si) =>
      sq.id === subId ? { ...sq, answer: value } : sq
    );
    onUpdateSubQuestions(parentId, newSubs, persist);
  };

  const removeSubQuestion = (parentId, subId) => {
    const item = items.find(entry => entry.id === parentId);
    const newSubs = (item.subQuestions || []).filter((sq) => sq.id !== subId);
    onUpdateSubQuestions(parentId, newSubs);
  };

  const doneCount = items.filter(i => i.done).length;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${accentClasses.button}`}>
            <Icon size={15} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {items.length === 0 ? subtitle : `${doneCount}/${items.length} answered`}
            </p>
          </div>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-400">No questions yet</p>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {items.map((item, idx) => {
            const subs = item.subQuestions || [];
            const isSubExpanded = expandedSubs[item.id] !== false;
            return (
              <div key={item.id} className={`group/q rounded-xl border transition-all duration-200 shadow-sm hover:shadow-md ${item.done ? 'border-gray-100 bg-gray-50/40' : 'border-gray-200/80 bg-white hover:border-gray-300'}`}>
                {/* Question row */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <button
                    onClick={() => onToggleDone(item.id, !item.done)}
                    className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${
                      item.done
                        ? `${accentClasses.doneBg} border-transparent text-white`
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    title={item.done ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {item.done && <Check size={12} strokeWidth={3} />}
                  </button>
                  <input
                    type="text" spellCheck={true}
                    value={item.text}
                    onChange={(e) => onChangeQuestion(item.id, e.target.value)}
                    onBlur={(e) => onSaveQuestion(item.id, e.target.value)}
                    placeholder="Write the research question..."
                    className={`flex-1 bg-transparent text-sm font-medium outline-none placeholder-gray-300 ${item.done ? 'text-gray-400' : 'text-gray-900'}`}
                  />
                  <div className="flex items-center gap-1.5">
                    {item.done && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${accentClasses.doneBg} text-white`}>
                        Answered
                      </span>
                    )}
                    {subs.length > 0 && (
                      <button
                        onClick={() => toggleSubExpanded(item.id)}
                        className="text-[10px] font-semibold text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded transition-colors"
                      >
                        {subs.filter(s => s.done).length}/{subs.length}
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(item.id)}
                      className="opacity-0 group-hover/q:opacity-100 p-1 text-gray-300 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Answer — collapsible, shows when question has focus or has content */}
                <div className="px-4 pb-3 pt-0">
                  <RichTextArea
                    value={item.answer || ''}
                    onChange={(value) => onChangeAnswer(item.id, value)}
                    onBlur={(value) => onSaveAnswer(item.id, value)}
                    onCommit={(value) => onSaveAnswer(item.id, value)}
                    ticker={ticker}
                    placeholder="Write your answer..."
                    rows={4}
                    className="w-full bg-gray-50/80 border border-gray-100 rounded-lg px-3 py-2.5 text-sm text-gray-700 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none overflow-hidden"
                  />
                </div>

                {/* Sub-questions */}
                <div className="px-4 pb-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleSubExpanded(item.id)}
                      className="flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <ChevronRight size={11} className={`transition-transform duration-200 ${isSubExpanded ? 'rotate-90' : ''}`} />
                      Sub-questions {subs.length > 0 && <span className="text-gray-300">({subs.length})</span>}
                    </button>
                    <button
                      onClick={() => { setExpandedSubs(prev => ({ ...prev, [item.id]: true })); addSubQuestion(item.id); }}
                      className="opacity-0 group-hover/q:opacity-100 text-gray-300 hover:text-gray-500 transition-all"
                    >
                      <Plus size={12} />
                    </button>
                  </div>

                  {isSubExpanded && subs.length > 0 && (
                    <div className="mt-2 ml-1 space-y-1 border-l-2 border-gray-100 pl-3">
                      {subs.map((sq, si) => (
                        <div key={sq.id} className="group/sq">
                          <div className="flex items-center gap-2 py-1.5">
                            <button
                              onClick={() => toggleSubDone(item.id, sq.id)}
                              className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-200 ${
                                sq.done
                                  ? `${accentClasses.doneBg} border-transparent text-white`
                                  : 'border-gray-300 hover:border-gray-400'
                              }`}
                            >
                              {sq.done && <Check size={10} strokeWidth={3} />}
                            </button>
                            <input
                              type="text" spellCheck={true}
                              value={sq.text}
                              onChange={(e) => updateSubText(item.id, sq.id, e.target.value)}
                              onBlur={(e) => updateSubText(item.id, sq.id, e.target.value, true)}
                              placeholder="Sub-question..."
                              className={`flex-1 bg-transparent text-[13px] outline-none placeholder-gray-300 ${sq.done ? 'text-gray-400' : 'text-gray-700'}`}
                            />
                            <button
                              onClick={() => removeSubQuestion(item.id, sq.id)}
                              className="opacity-0 group-hover/sq:opacity-100 p-0.5 text-gray-300 hover:text-red-400 transition-all"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <div className="ml-6 pb-1.5">
                            <RichTextArea
                              value={sq.answer || ''}
                              onChange={(value) => updateSubAnswer(item.id, sq.id, value)}
                              onBlur={(value) => updateSubAnswer(item.id, sq.id, value, true)}
                              onCommit={(value) => updateSubAnswer(item.id, sq.id, value, true)}
                              ticker={ticker}
                              placeholder="Answer..."
                              rows={2}
                              className="w-full bg-gray-50/60 border border-gray-100 rounded-lg px-3 py-2 text-xs text-gray-600 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none overflow-hidden"
                            />
                          </div>
                        </div>
                      ))}
                      <form
                        onSubmit={(e) => { e.preventDefault(); addSubQuestion(item.id); }}
                        className="flex items-center gap-2 pt-1"
                      >
                        <input
                          value={subInputs[item.id] || ''}
                          onChange={(e) => setSubInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Add sub-question..."
                          className="flex-1 text-xs text-gray-500 bg-transparent outline-none placeholder-gray-300"
                        />
                        {(subInputs[item.id] || '').trim() && (
                          <button type="submit" className="text-gray-400 hover:text-gray-600 transition-colors">
                            <Plus size={12} />
                          </button>
                        )}
                      </form>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function ResearchPage() {
  const cache = useCache();
  const { isDemo } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const appliedTickerParam = useRef(null);
  const [allData, setAllData] = useState(() => cache.get('deep_research_watchlist') || null);
  const [selectedTicker, setSelectedTicker] = useState(() => cache.get('deep_research_selectedTicker') || '');
  const [tickerData, setTickerData] = useState(() => cache.get('deep_research_tickerData') || null);
  const [loading, setLoading] = useState(() => !cache.get('deep_research_watchlist'));
  const [tickerLoading, setTickerLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [overviewGenerating, setOverviewGenerating] = useState(false);
  const [fundamentalsGenerating, setFundamentalsGenerating] = useState(false);
  const [liveQuote, setLiveQuote] = useState(() => cache.get('deep_research_liveQuote') || null);
  const [quoteLoading, setQuoteLoading] = useState(() => !cache.get('deep_research_liveQuote') && !!cache.get('deep_research_selectedTicker'));
  const [activeResearchTab, setActiveResearchTab] = useState(() => cache.get('deep_research_activeTab') || 'fundamentals');
  const [thesis, setThesis] = useState(null);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisDirty, setThesisDirty] = useState(false);
  const modelRef = useRef(null);
  const [exporting, setExporting] = useState(false);

  const researchStocks = useMemo(() => (
    (allData?.watchlists || []).flatMap(watchlist =>
      (watchlist.stocks || [])
        .filter(stock => stock.stage === 'research')
        .map(stock => ({
          ...stock,
          watchlistId: watchlist.id,
          watchlistName: watchlist.name,
        }))
    )
  ), [allData]);

  const selectedStock = useMemo(
    () => researchStocks.find(stock => stock.ticker === selectedTicker) || null,
    [researchStocks, selectedTicker]
  );

  const researchWorkspace = useMemo(
    () => buildResearchWorkspace(thesis, selectedStock),
    [thesis, selectedStock]
  );

  const dueDiligenceItems = researchWorkspace.dueDiligenceItems;
  const dislocationItems = researchWorkspace.dislocationItems;

  // Draft & Review discussion threads, carried over untouched from the Draft &
  // Review stage (a stage move never destroys data). Surfaced read-only beside the
  // Diligence question editors so the reviewer back-and-forth is on hand while the
  // analyst turns those comments into DD / dislocation questions.
  const draftReviewThreads = useMemo(
    () => thesis?.underwriting?.draftReview?.threads || [],
    [thesis]
  );

  // The author set in Draft & Review (via its people icon), carried over with the
  // rest of the draftReview block. Shown as a tag on the comments panel so it's
  // clear here who is on the hook to answer.
  const draftReviewAuthor = useMemo(
    () => thesis?.underwriting?.draftReview?.author || null,
    [thesis]
  );

  const loadResearchStocks = useCallback(async () => {
    try {
      const cached = cache.get('deep_research_watchlist');
      if (cached?.watchlists) {
        setAllData(cached);
        setLoading(false);
      }

      const res = await fetch('/api/watchlist');
      const data = await res.json();
      setAllData(data);
      writeWatchlistCache(cache, data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
      return null;
    }
  }, [cache]);

  const loadTickerData = useCallback(async (ticker) => {
    if (!ticker) return;
    const cached = cache.get(`deep_research_tickerData_${ticker}`);
    if (cached) {
      setTickerData(cached);
      cache.set('deep_research_tickerData', cached);
      return;
    }
    setTickerLoading(true);
    try {
      const res = await fetch(`/api/ticker/${ticker}`);
      const data = await res.json();
      setTickerData(data);
      cache.set('deep_research_tickerData', data);
      cache.set(`deep_research_tickerData_${ticker}`, data);
    } catch {
      setToast({ message: `Failed to load data for ${ticker}`, type: 'error' });
    } finally {
      setTickerLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    loadResearchStocks();
  }, [loadResearchStocks]);

  useEffect(() => {
    if (!researchStocks.length) {
      if (selectedTicker) {
        setSelectedTicker('');
        cache.set('deep_research_selectedTicker', '');
      }
      return;
    }
    if (!selectedTicker || !researchStocks.some(stock => stock.ticker === selectedTicker)) {
      const nextTicker = researchStocks[0].ticker;
      setSelectedTicker(nextTicker);
      cache.set('deep_research_selectedTicker', nextTicker);
    }
  }, [cache, researchStocks, selectedTicker]);

  // Deep-link support: /research?ticker=XYZ (e.g. from the command palette).
  // Select the requested ticker if it exists as a research-stage stock, then
  // strip the query param so it doesn't override later manual selections.
  useEffect(() => {
    const requested = searchParams.get('ticker')?.toUpperCase();
    const requestedTab = searchParams.get('tab');
    if (!requested || appliedTickerParam.current === requested) return;
    if (researchStocks.some(stock => stock.ticker === requested)) {
      appliedTickerParam.current = requested;
      setSelectedTicker(requested);
      cache.set('deep_research_selectedTicker', requested);
      if (requestedTab && RESEARCH_TABS.includes(requestedTab)) {
        setActiveResearchTab(requestedTab);
        cache.set('deep_research_activeTab', requestedTab);
      }
      router.replace('/research');
    }
  }, [searchParams, researchStocks, cache, router]);

  useEffect(() => {
    if (!selectedTicker) return;
    cache.set('deep_research_selectedTicker', selectedTicker);
    loadTickerData(selectedTicker);

    const cachedQuote = cache.get(`deep_research_quote_${selectedTicker}`);
    if (cachedQuote) {
      setLiveQuote(cachedQuote);
      setQuoteLoading(false);
    } else {
      setLiveQuote(null);
      setQuoteLoading(true);
      fetch(`/api/quotes?tickers=${selectedTicker}`)
        .then(r => r.json())
        .then(data => {
          if (data.quotes?.[selectedTicker]) {
            setLiveQuote(data.quotes[selectedTicker]);
            cache.set('deep_research_liveQuote', data.quotes[selectedTicker]);
            cache.set(`deep_research_quote_${selectedTicker}`, data.quotes[selectedTicker]);
          }
        })
        .catch(() => {})
        .finally(() => setQuoteLoading(false));
    }
  }, [cache, loadTickerData, selectedTicker]);

  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;
    // Clear the prior ticker's thesis and ignore an out-of-order response, so a slow
    // fetch for a ticker we've navigated away from can't overwrite (and then get
    // saved under) the currently selected name.
    setThesis(null);
    setThesisLoading(true);
    setThesisDirty(false);
    fetch(`/api/thesis/${selectedTicker}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setThesis(migrateNewsImages(data)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setThesisLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTicker]);

  useEffect(() => {
    cache.set('deep_research_activeTab', activeResearchTab);
  }, [activeResearchTab, cache]);

  const saveThesis = useCallback(async (data) => {
    if (!selectedTicker || (!thesisDirty && !data)) return;
    setThesisSaving(true);
    try {
      const res = await fetch(`/api/thesis/${selectedTicker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify((() => {
          const { _activeNewsIdx, ...rest } = data || thesis;
          return rest;
        })()),
      });
      const result = await res.json();
      if (result.success) {
        setThesisDirty(false);
        setToast({ message: 'Research notes saved', type: 'success' });
      }
    } catch {
      setToast({ message: 'Failed to save research notes', type: 'error' });
    } finally {
      setThesisSaving(false);
    }
  }, [selectedTicker, thesis, thesisDirty]);

  // Demote the selected name out of Research. Data-safe: only the stage flips —
  // the research workspace and the rest of the thesis are preserved and reappear
  // here untouched if the name is ever promoted back into Research.
  const moveStage = useCallback(async (newStage) => {
    if (!selectedStock || !allData) return;
    const ticker = selectedStock.ticker;
    try {
      const { next } = await persistStageMove({
        watchlistData: allData,
        watchlistId: selectedStock.watchlistId,
        ticker,
        newStage,
      });
      setAllData(next);
      writeWatchlistCache(cache, next);
      setToast({ message: `${ticker} moved to ${STAGE_LABELS[newStage]}`, type: 'success' });
    } catch {
      setToast({ message: `Failed to move ${ticker}`, type: 'error' });
    }
  }, [selectedStock, allData, cache]);

  // AI generation (company overview / thesis fundamentals) is not production-ready
  // yet, so the buttons are wired to this no-op warning instead of the real
  // generators. Re-point them at generateCompanyOverview / generateThesisFundamentals
  // to re-enable once it's ready.
  const aiNotReady = useCallback(() => {
    setToast({
      message: 'AI generation is still in development and not available in production yet.',
      type: 'info',
    });
  }, []);

  const updateThesisField = (field, value) => {
    setThesis(prev => ({ ...prev, [field]: value }));
    setThesisDirty(true);
  };

  const commitThesisField = useCallback((field, value) => {
    const updated = { ...(thesis || {}), [field]: value };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  }, [saveThesis, thesis]);

  const updateUnderwriting = (field, value) => {
    setThesis(prev => ({
      ...prev,
      underwriting: { ...((prev || {}).underwriting || {}), [field]: value },
    }));
    setThesisDirty(true);
  };

  const commitUnderwriting = useCallback((field, value) => {
    const updated = {
      ...(thesis || {}),
      underwriting: { ...((thesis || {}).underwriting || {}), [field]: value },
    };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  }, [saveThesis, thesis]);

  const updateResearchWorkspace = useCallback((updater, persist = false) => {
    const nextWorkspace = updater(buildResearchWorkspace(thesis, selectedStock));
    const updated = {
      ...(thesis || {}),
      underwriting: {
        ...((thesis || {}).underwriting || {}),
        researchWorkspace: nextWorkspace,
      },
    };
    setThesis(updated);
    setThesisDirty(true);
    if (persist) saveThesis(updated);
  }, [saveThesis, selectedStock, thesis]);

  const addNewsUpdate = () => {
    setThesis(prev => ({
      ...prev,
      newsUpdates: [...(prev.newsUpdates || []), { title: '', date: new Date().toISOString().slice(0, 10), body: '', impactOnAssumptions: '' }],
    }));
    setThesisDirty(true);
  };

  const removeNewsUpdate = (idx) => {
    setThesis(prev => ({
      ...prev,
      newsUpdates: (prev.newsUpdates || []).filter((_, i) => i !== idx),
    }));
    setThesisDirty(true);
  };

  const updateNewsUpdate = (idx, field, value) => {
    setThesis(prev => ({
      ...prev,
      newsUpdates: (prev.newsUpdates || []).map((entry, i) => i === idx ? { ...entry, [field]: value } : entry),
    }));
    setThesisDirty(true);
  };

  const addTodo = () => {
    const updated = { ...thesis, todos: [...(thesis.todos || []), { text: '', done: false }] };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  };

  const removeTodo = (idx) => {
    const updated = { ...thesis, todos: (thesis.todos || []).filter((_, i) => i !== idx) };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  };

  const updateTodo = (idx, field, value) => {
    const updated = { ...thesis, todos: (thesis.todos || []).map((todo, i) => i === idx ? { ...todo, [field]: value } : todo) };
    setThesis(updated);
    setThesisDirty(true);
    if (field === 'done') saveThesis(updated);
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

  const generateData = async () => {
    setGenerating(true);
    setShowGenerateModal(false);
    setShowUpdateModal(false);
    setToast({ message: `Generating data for ${selectedTicker}... This may take ~30 seconds.`, type: 'info' });
    try {
      const res = await fetch('/api/generate-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTicker }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({ message: `Data generated for ${selectedTicker}`, type: 'success' });
        cache.set(`deep_research_tickerData_${selectedTicker}`, null);
        cache.set(`deep_research_quote_${selectedTicker}`, null);
        cache.set('deep_research_liveQuote', null);
        loadTickerData(selectedTicker);
      } else {
        setToast({ message: `Error: ${data.error}`, type: 'error' });
      }
    } catch (e) {
      setToast({ message: `Generation failed: ${e.message}`, type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const updateFundamentalBox = (key, value, persist = false) => {
    updateResearchWorkspace((workspace) => ({
      ...workspace,
      fundamentals: {
        ...workspace.fundamentals,
        [key]: value,
      },
    }), persist);
  };

  const updateQuestionList = (field, items, persist = false) => {
    updateResearchWorkspace((workspace) => ({
      ...workspace,
      [field]: items,
    }), persist);
  };

  const addQuestion = (field) => {
    const sourceItems = field === 'dueDiligenceItems' ? dueDiligenceItems : dislocationItems;
    updateQuestionList(field, [...sourceItems, createQuestionItem()], true);
  };

  const updateQuestionText = (field, itemId, value, persist = false) => {
    const sourceItems = field === 'dueDiligenceItems' ? dueDiligenceItems : dislocationItems;
    const nextItems = sourceItems.map((item) => item.id === itemId ? { ...item, text: value } : item);
    updateQuestionList(field, nextItems, persist);
  };

  const updateQuestionAnswer = (field, itemId, value, persist = false) => {
    const sourceItems = field === 'dueDiligenceItems' ? dueDiligenceItems : dislocationItems;
    const nextItems = sourceItems.map((item) => item.id === itemId ? { ...item, answer: value } : item);
    updateQuestionList(field, nextItems, persist);
  };

  const toggleQuestionDone = (field, itemId, done) => {
    const sourceItems = field === 'dueDiligenceItems' ? dueDiligenceItems : dislocationItems;
    const nextItems = sourceItems.map((item) => item.id === itemId ? { ...item, done } : item);
    updateQuestionList(field, nextItems, true);
  };

  const removeQuestion = (field, itemId) => {
    const sourceItems = field === 'dueDiligenceItems' ? dueDiligenceItems : dislocationItems;
    updateQuestionList(field, sourceItems.filter((item) => item.id !== itemId), true);
  };

  const updateSubQuestions = (field, parentId, newSubs, persist = true) => {
    const sourceItems = field === 'dueDiligenceItems' ? dueDiligenceItems : dislocationItems;
    const nextItems = sourceItems.map((item) =>
      item.id === parentId ? { ...item, subQuestions: newSubs.map(createSubQuestion) } : item
    );
    updateQuestionList(field, nextItems, persist);
  };

  // ---- Native Company Overview generation -----------------------------------
  // Generates a business overview grounded in the company's latest 10-K
  // (Item 1: Business) and 10-Q, then writes it straight into the Company
  // Overview editor. Existing analyst notes are preserved — generated text is
  // appended under a divider, never overwritten.
  const overviewHasContent = (val) => {
    if (Array.isArray(val)) {
      return val.some(b => b?.type === 'image' || (b?.value && b.value.replace(/<[^>]+>/g, '').trim()));
    }
    return typeof val === 'string' && val.replace(/<[^>]+>/g, '').trim().length > 0;
  };

  const mergeOverview = (existing, html) => {
    const divider = `<b>— AI-generated from SEC filings —</b><br>`;
    if (!overviewHasContent(existing)) return html;
    if (Array.isArray(existing)) {
      return [...existing, { type: 'text', value: `<br>${divider}${html}` }];
    }
    return `${existing}<br><br>${divider}${html}`;
  };

  const generateCompanyOverview = async () => {
    if (!selectedTicker || overviewGenerating) return;
    setOverviewGenerating(true);
    setToast({ message: `Generating company overview for ${selectedTicker} from SEC filings… This may take ~30 seconds.`, type: 'info' });
    try {
      const res = await fetch('/api/research/company-overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTicker }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ message: data.error || 'Failed to generate company overview', type: 'error' });
        return;
      }
      const existing = thesis?.underwriting?.companyOverview;
      commitUnderwriting('companyOverview', mergeOverview(existing, data.html));
      setToast({ message: `Company overview generated for ${selectedTicker}`, type: 'success' });
    } catch (e) {
      setToast({ message: `Generation failed: ${e.message}`, type: 'error' });
    } finally {
      setOverviewGenerating(false);
    }
  };

  // ---- Native Thesis Structure (fundamentals) generation --------------------
  // Computes TTM figures from the Fundamentals-tab data (tickerData) and asks
  // the model to fill all four thesis boxes at once. Like the overview, each box
  // appends under a divider so the analyst's own notes are never overwritten.
  const mergeBox = (existing, text) => {
    const add = String(text || '').trim();
    const cur = typeof existing === 'string' ? existing.trim() : '';
    if (!add) return cur;
    return cur ? `${cur}\n\n— Generated from TTM fundamentals —\n${add}` : add;
  };

  const generateThesisFundamentals = async () => {
    if (!selectedTicker || fundamentalsGenerating) return;
    const summary = buildFundamentalsTTM(tickerData, liveQuote);
    if (!summary || !summary.revenue.ttm) {
      setToast({ message: 'No fundamentals data available yet — generate data for this ticker first.', type: 'error' });
      return;
    }
    setFundamentalsGenerating(true);
    setToast({ message: `Filling the thesis fundamentals for ${selectedTicker} from TTM data… This may take ~20 seconds.`, type: 'info' });
    try {
      const res = await fetch('/api/research/thesis-fundamentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTicker, fundamentals: summary }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ message: data.error || 'Failed to generate thesis fundamentals', type: 'error' });
        return;
      }
      const boxes = data.boxes || {};
      updateResearchWorkspace((ws) => ({
        ...ws,
        fundamentals: {
          revenueGrowth: mergeBox(ws.fundamentals.revenueGrowth, boxes.revenueGrowth),
          profitability: mergeBox(ws.fundamentals.profitability, boxes.profitability),
          capitalReturn: mergeBox(ws.fundamentals.capitalReturn, boxes.capitalReturn),
          misc: mergeBox(ws.fundamentals.misc, boxes.misc),
        },
      }), true);
      setToast({ message: `Thesis fundamentals filled for ${selectedTicker}`, type: 'success' });
    } catch (e) {
      setToast({ message: `Generation failed: ${e.message}`, type: 'error' });
    } finally {
      setFundamentalsGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="skeleton h-14 w-72 rounded-2xl mb-8" />
        <div className="skeleton h-96 rounded-3xl" />
      </div>
    );
  }

  if (!researchStocks.length) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
            <ClipboardList size={28} className="text-blue-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Research</h1>
          <p className="text-gray-500 max-w-xl mx-auto leading-relaxed">
            Promote a ticker from Watchlist to Currently Researching, then move it into Research to open the full deep-dive workspace.
          </p>
        </div>
      </div>
    );
  }

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

  const livePrice = liveQuote?.price || null;
  const csvPrice = valuation.currentPrice ? Number(valuation.currentPrice) : null;
  const displayPrice = livePrice || csvPrice;

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
      let modelData = modelRef.current?.getModelData?.() || null;

      if (!modelData) {
        try {
          const modelRes = await fetch(`/api/model/${selectedTicker}`);
          const modelJson = await modelRes.json();
          if (modelJson.exists && modelJson.inputs) {
            const inp = modelJson.inputs;
            const p = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v))) ? 0 : Number(v);
            const sharePrice = p(inp.sharePrice) || (livePrice || 0);
            const targetPE = p(inp.targetPE);
            const revG = p(inp.revenueGrowth);
            const targetMargin = p(inp.targetOpMargin);
            const dilution = p(inp.netShareDilution);
            const divG = p(inp.dividendGrowth);
            const curDiv = p(inp.currentDividend);
            const taxRate = p(inp.taxRate);
            const baseYear = p(inp.baseYear);
            const revenue = [p(inp.baseRevenue)];
            for (let i = 1; i <= 5; i++) revenue.push(revenue[i - 1] * (1 + revG));
            const baseOpex = p(inp.baseOpex);
            const baseMargin = revenue[0] ? (revenue[0] - baseOpex) / revenue[0] : 0;
            const opMargin = [0, 1, 2, 3, 4, 5].map(i => i === 0 ? baseMargin : baseMargin + (i / 5) * (targetMargin - baseMargin));
            const opIncome = [0, 1, 2, 3, 4, 5].map(i => i === 0 ? (revenue[0] - baseOpex) : revenue[i] * opMargin[i]);
            const opex = [0, 1, 2, 3, 4, 5].map(i => i === 0 ? baseOpex : revenue[i] - opIncome[i]);
            const nonOpIncome = [p(inp.baseNonOpIncome), 0, 0, 0, 0, 0];
            const taxExpense = [p(inp.baseTaxExpense)];
            for (let i = 1; i <= 5; i++) taxExpense.push(opIncome[i] * taxRate);
            const netIncome = [0, 1, 2, 3, 4, 5].map(i => opIncome[i] - taxExpense[i] + nonOpIncome[i]);
            const shares = [p(inp.baseShares)];
            for (let i = 1; i <= 5; i++) shares.push(shares[i - 1] * (1 + dilution));
            const eps = [0, 1, 2, 3, 4, 5].map(i => shares[i] ? netIncome[i] / shares[i] : 0);
            const epsGrowth = (eps[0] && eps[5]) ? Math.pow(eps[5] / eps[0], 0.2) - 1 : 0;
            const targetPrice5 = targetPE * eps[5];
            const priceCAGR = (sharePrice > 0 && targetPrice5 > 0) ? Math.pow(targetPrice5 / sharePrice, 0.2) - 1 : 0;
            const priceArr = [sharePrice];
            for (let i = 1; i <= 5; i++) priceArr.push(priceArr[i - 1] * (1 + priceCAGR));
            const divShares = [1];
            for (let i = 1; i <= 5; i++) {
              const df = sharePrice > 0 ? (curDiv / sharePrice) * Math.pow((1 + divG) / (1 + priceCAGR), i - 1) : 0;
              divShares.push((1 + df) * divShares[i - 1]);
            }
            const totalCAGRNoDivs = priceCAGR;
            const totalCAGR = (sharePrice > 0 && divShares[5] * priceArr[5] > 0) ? Math.pow((divShares[5] * priceArr[5]) / sharePrice, 0.2) - 1 : 0;
            modelData = {
              inputs: { ...inp, sharePrice },
              computed: {
                yearLabels: [0, 1, 2, 3, 4, 5].map(i => baseYear + i),
                revenue,
                opex,
                opIncome,
                opMargin,
                nonOpIncome,
                taxExpense,
                netIncome,
                shares,
                eps,
                epsGrowth,
                priceArr,
                divShares,
                totalCAGRNoDivs,
                totalCAGR,
                priceTarget: priceArr[2],
                targetPrice5,
                priceCAGR,
              },
            };
          }
        } catch {}
      }

      let freshQuote = liveQuote;
      try {
        const quoteRes = await fetch(`/api/quotes?tickers=${selectedTicker}`);
        const quoteJson = await quoteRes.json();
        if (quoteJson.quotes?.[selectedTicker]) freshQuote = quoteJson.quotes[selectedTicker];
      } catch {}

      const prevTab = activeResearchTab;
      if (prevTab !== 'fundamentals') {
        setActiveResearchTab('fundamentals');
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      const { exportReport } = await import('@/lib/exportReport');

      await exportReport({
        ticker: selectedTicker,
        thesis,
        model: modelData,
        tickerData,
        liveQuote: freshQuote,
        displayPrice: freshQuote?.price || displayPrice,
        reportType: 'research_workspace',
        equityRating: thesis?.underwriting?.equityRating || 0,
      });

      if (prevTab !== 'fundamentals') {
        setActiveResearchTab(prevTab);
      }
      setToast({ message: 'Report exported', type: 'success' });
    } catch (e) {
      console.error(e);
      setToast({ message: `Export failed: ${e.message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      <div className="flex items-center justify-between mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Research</h1>
        </div>
        {dataExists && (
          <button
            onClick={() => setShowUpdateModal(true)}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-white border border-gray-200 rounded-2xl text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 hover:shadow-md transition-all duration-200 disabled:opacity-40"
          >
            <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
            Update Data
          </button>
        )}
      </div>

      <Card className="mb-8 animate-fade-in-up stagger-2">
        <div className="flex items-center gap-4">
          <label className="text-xs text-gray-500 uppercase tracking-wider font-bold">Select Company</label>
          <TickerSearchSelect items={researchStocks} selectedTicker={selectedTicker} onSelect={setSelectedTicker} />

          {selectedStock && draftReviewAuthor?.name?.trim() && (
            <span
              title={draftReviewAuthor.email ? `Author · ${draftReviewAuthor.email}` : 'Author'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold"
            >
              <User size={13} className="shrink-0" />
              <span className="truncate max-w-[160px]">Author: {draftReviewAuthor.name.trim()}</span>
            </span>
          )}

          {selectedStock && (
            <button
              onClick={() => moveStage('draft')}
              title="Demote back to Draft & Review"
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors"
            >
              <ArrowLeft size={13} /> Back to Draft &amp; Review
            </button>
          )}
        </div>
      </Card>

      {!selectedTicker ? (
        <div className="text-center py-20">
          <p className="text-lg text-gray-400 mb-2">Select a ticker to open the research workspace</p>
          <p className="text-sm text-gray-300">Only companies moved into the Research stage appear here</p>
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
          <h2 className="text-xl font-bold text-gray-900 mb-2">No data generated for {selectedTicker}</h2>
          <p className="text-sm text-gray-500 mb-8 max-w-md mx-auto leading-relaxed">
            Generate fundamentals and price history for this company to unlock the full research workflow.
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
          <div className="flex items-center justify-between mb-8 animate-fade-in-up stagger-3">
            <div className="flex flex-wrap gap-1 bg-gray-100/80 rounded-2xl p-1">
              {[
                { key: 'fundamentals', label: 'Fundamentals' },
                { key: 'thesis', label: 'Thesis' },
                { key: 'diligence', label: 'Diligence' },
                { key: 'valuation', label: 'Valuation' },
                { key: 'news', label: 'News' },
                { key: 'decision', label: 'Decision' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveResearchTab(tab.key)}
                  className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    activeResearchTab === tab.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {['thesis', 'diligence', 'news', 'decision'].includes(activeResearchTab) && thesis && (
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
                {thesisSaving ? 'Saving...' : thesisDirty ? 'Save Notes' : 'Saved'}
              </button>
            )}
          </div>

          {activeResearchTab === 'fundamentals' ? (
            <>
              <Card className="mb-8">
                <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-3">Why This Name Is Here</label>
                <WorkspaceNote
                  key={`${selectedTicker}::${researchWorkspace.note}`}
                  value={researchWorkspace.note}
                  onCommit={(v) => updateResearchWorkspace(workspace => ({ ...workspace, note: v }), true)}
                />
              </Card>

              <PriceChart labels={priceLabels} data={priceData} color="#10b981" />

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

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <FundamentalChart title="Revenue" labels={revenueLabels} data={revenueData} label="Revenue" formatY={(v) => formatLargeNumber(v)} />
                <FundamentalChart title="EPS (Diluted)" labels={epsLabels} data={epsData} label="EPS" formatY={(v) => `$${v.toFixed(2)}`} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <FundamentalChart title="Free Cash Flow" labels={fcfLabels} data={fcfData} label="FCF" formatY={(v) => formatLargeNumber(v)} />
                <FundamentalChart title="Operating Margins" labels={marginLabels} data={marginData} chartType="line" label="Op Margin" color="#f59e0b" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <FundamentalChart title="Outstanding Shares" labels={sharesLabels} data={sharesData} label="Shares" formatY={(v) => formatLargeNumber(v)} colorPositive="#06b6d4" colorNegative="#06b6d4" />
                <PriceChart title="PE Ratio" labels={peLabels} data={peData} label="PE Ratio" color="#8b5cf6" formatY={(v) => v.toFixed(1)} showCagr={false} className="" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <PriceChart title="FCF Yield" labels={fcfYieldLabels} data={fcfYieldData} label="FCF Yield" color="#10b981" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} className="" />
              </div>
            </>
          ) : thesisLoading ? (
            <div className="space-y-6">
              <div className="skeleton h-48 rounded-2xl" />
              <div className="skeleton h-64 rounded-2xl" />
            </div>
          ) : !thesis ? null : activeResearchTab === 'thesis' ? (
            <div className="space-y-8" onBlur={() => saveThesis()}>
              <Card>
                <div className="mb-1">
                  <h2 className="text-lg font-bold text-gray-900">Company Overview</h2>
                </div>

                <RichTextArea
                  value={thesis?.underwriting?.companyOverview || ''}
                  onChange={value => updateUnderwriting('companyOverview', value)}
                  onBlur={value => commitUnderwriting('companyOverview', value)}
                  onCommit={value => commitUnderwriting('companyOverview', value)}
                  ticker={selectedTicker}
                  enableTables
                  stickyToolbar
                  placeholder="Cover the business model, key segments, customers, competitive position, moat, regulatory backdrop, and anything else worth knowing about this name. Paste charts or screenshots inline..."
                  rows={6}
                />
              </Card>

              <Card>
                <div className="mb-1">
                  <h2 className="text-lg font-bold text-gray-900">Thesis Structure</h2>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {FUNDAMENTALS_BOXES.map(({ key, label, color, placeholder }) => {
                    const styles = BOX_STYLES[color];
                    return (
                      <div key={key} className={`${styles.bg} border ${styles.border} rounded-2xl p-4`}>
                        <label className={`text-[11px] font-bold uppercase tracking-[0.18em] ${styles.label}`}>
                          {label}
                        </label>
                        <textarea
                          value={researchWorkspace.fundamentals[key] || ''}
                          onChange={(e) => updateFundamentalBox(key, e.target.value)}
                          onBlur={(e) => updateFundamentalBox(key, e.target.value, true)}
                          onInput={(e) => autoExpand(e.target)}
                          rows={6}
                          spellCheck={true}
                          placeholder={placeholder}
                          className={`mt-3 w-full ${styles.taBg} border ${styles.border} rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none ${styles.ring} transition-all resize-none overflow-hidden`}
                        />
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Story</h2>
                <p className="text-sm text-gray-500 mb-6">Keep the broader narrative and valuation framing here while the structured question workflow stays above.</p>

                <div className="mb-6">
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-bold block mb-2">Company Narrative</label>
                  <RichTextArea
                    value={thesis.assumptions || ''}
                    onChange={value => updateThesisField('assumptions', value)}
                    onBlur={value => commitThesisField('assumptions', value)}
                    onCommit={value => commitThesisField('assumptions', value)}
                    ticker={selectedTicker}
                    enableTables
                    stickyToolbar
                    placeholder="Write the main narrative, what matters most, and how the fundamental pieces connect..."
                    rows={5}
                  />
                </div>
              </Card>
            </div>
          ) : activeResearchTab === 'diligence' ? (
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              <div className="min-w-0 w-full lg:flex-1 space-y-8" onBlur={() => saveThesis()}>
              <QuestionSection
                title="Due Diligence Questions"
                subtitle="Use this section for the key questions that need direct, evidence-backed answers before the company can be underwritten."
                icon={ClipboardList}
                accentClasses={{
                  label: 'text-blue-600',
                  button: 'text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100',
                  empty: 'bg-blue-50/40 border-blue-200/70',
                  card: 'bg-white border-blue-100/80',
                  icon: 'text-blue-500 hover:text-blue-600',
                  doneBg: 'bg-blue-500',
                }}
                items={dueDiligenceItems}
                ticker={selectedTicker}
                onAdd={() => addQuestion('dueDiligenceItems')}
                onToggleDone={(idx, done) => toggleQuestionDone('dueDiligenceItems', idx, done)}
                onChangeQuestion={(idx, value) => updateQuestionText('dueDiligenceItems', idx, value)}
                onSaveQuestion={(idx, value) => updateQuestionText('dueDiligenceItems', idx, value, true)}
                onChangeAnswer={(idx, value) => updateQuestionAnswer('dueDiligenceItems', idx, value)}
                onSaveAnswer={(idx, value) => updateQuestionAnswer('dueDiligenceItems', idx, value, true)}
                onRemove={(idx) => removeQuestion('dueDiligenceItems', idx)}
                onUpdateSubQuestions={(idx, subs, persist) => updateSubQuestions('dueDiligenceItems', idx, subs, persist)}
              />

              <QuestionSection
                title="Dislocation Questions"
                subtitle="Document the market disconnect, what could close it, and the evidence that supports the variant view."
                icon={FlaskConical}
                accentClasses={{
                  label: 'text-amber-600',
                  button: 'text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100',
                  empty: 'bg-amber-50/40 border-amber-200/70',
                  card: 'bg-white border-amber-100/80',
                  icon: 'text-amber-500 hover:text-amber-600',
                  doneBg: 'bg-amber-500',
                }}
                items={dislocationItems}
                ticker={selectedTicker}
                onAdd={() => addQuestion('dislocationItems')}
                onToggleDone={(idx, done) => toggleQuestionDone('dislocationItems', idx, done)}
                onChangeQuestion={(idx, value) => updateQuestionText('dislocationItems', idx, value)}
                onSaveQuestion={(idx, value) => updateQuestionText('dislocationItems', idx, value, true)}
                onChangeAnswer={(idx, value) => updateQuestionAnswer('dislocationItems', idx, value)}
                onSaveAnswer={(idx, value) => updateQuestionAnswer('dislocationItems', idx, value, true)}
                onRemove={(idx) => removeQuestion('dislocationItems', idx)}
                onUpdateSubQuestions={(idx, subs, persist) => updateSubQuestions('dislocationItems', idx, subs, persist)}
              />
              </div>
              <ReviewCommentsPanel threads={draftReviewThreads} />
            </div>
          ) : activeResearchTab === 'news' ? (
            <div className="space-y-8" onBlur={() => saveThesis()}>
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
                <p className="text-xs text-gray-400 mb-6">Log earnings, guidance, and any development that should change the research file.</p>

                {(!thesis.newsUpdates || thesis.newsUpdates.length === 0) ? (
                  <div className="text-center py-8 border border-dashed border-gray-200 rounded-xl">
                    <p className="text-sm text-gray-400 mb-1">No updates yet</p>
                    <p className="text-xs text-gray-300">Add an entry when a major development occurs.</p>
                  </div>
                ) : (() => {
                  const updates = thesis.newsUpdates || [];
                  const latestIdx = updates.length - 1;
                  const activeIdx = thesis._activeNewsIdx !== undefined && thesis._activeNewsIdx < updates.length ? thesis._activeNewsIdx : latestIdx;
                  const entry = updates[activeIdx];

                  return (
                    <div>
                      {updates.length > 1 && (
                        <div className="flex items-center gap-3 mb-4">
                          <select
                            value={activeIdx}
                            onChange={e => setThesis(prev => ({ ...prev, _activeNewsIdx: Number(e.target.value) }))}
                            className="flex-1 bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                          >
                            {updates.map((update, i) => (
                              <option key={i} value={i}>
                                {i === latestIdx ? '(Latest) ' : ''}{update.title || 'Untitled'}{update.date ? ` — ${update.date}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-all duration-200 group">
                        <div className="flex items-start gap-4 mb-4">
                          <div className="flex-1">
                            <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Title</label>
                            <input
                              type="text" spellCheck={true}
                              value={entry.title || ''}
                              onChange={e => updateNewsUpdate(activeIdx, 'title', e.target.value)}
                              placeholder="e.g., Q3 earnings, product launch, guidance cut..."
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
                            onClick={() => {
                              removeNewsUpdate(activeIdx);
                              setThesis(prev => ({ ...prev, _activeNewsIdx: undefined }));
                            }}
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
                          <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Impact on Research</label>
                          <textarea spellCheck={true}
                            value={entry.impactOnAssumptions || ''}
                            onChange={e => updateNewsUpdate(activeIdx, 'impactOnAssumptions', e.target.value)}
                            onInput={e => autoExpand(e.target)}
                            rows={2}
                            placeholder="How does this change the questions, thesis, or valuation?"
                            className="w-full bg-amber-50/50 border border-amber-200/60 rounded-xl px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all duration-200 placeholder:text-amber-300 resize-none overflow-hidden"
                          />
                        </div>

                      </div>
                    </div>
                  );
                })()}
              </Card>
            </div>
          ) : activeResearchTab === 'valuation' ? (
            <ValuationModel ref={modelRef} ticker={selectedTicker} livePrice={livePrice} />
          ) : activeResearchTab === 'decision' ? (
            <div className="space-y-8">
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
                    {exporting ? 'Generating Report...' : 'Export Research Primer'}
                  </button>
                </div>
              </Card>
            </div>
          ) : null}
        </>
      )}

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
