'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, AlertTriangle, Save, Plus, Trash2, CheckCircle, FileDown, Check, X, ClipboardList, FlaskConical, Square, CheckSquare, ChevronRight, ArrowLeft, Star, User } from 'lucide-react';
import Card from '@/components/Card';
import TickerSearchSelect from '@/components/TickerSearchSelect';
import CompanyFundamentals, { computeQuickStats } from '@/components/CompanyFundamentals';
import Toast from '@/components/Toast';
import { useCache } from '@/lib/CacheContext';
import ValuationModel from '@/components/ValuationModel';
import RichTextArea from '@/components/RichTextArea';
import ReviewCommentsPanel from '@/components/ReviewCommentsPanel';
import { RESEARCH_TABS } from '@/lib/researchProgress';
import { persistStageMove, writeWatchlistCache, STAGE_LABELS, routeForStage } from '@/lib/stageMove';
import { migrateNewsImages } from '@/lib/migrateNewsImages';
import { startGeneration, isGenerating, subscribeGeneration } from '@/lib/generateTickerJob';
import {
  fetchComputedValuationModel,
  fetchQuote,
  fetchThesis,
  fetchTickerFundamentals,
  fetchWatchlist,
  saveThesis as saveThesisData,
} from '@/lib/researchApi';

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

// Footer for each Research section: an explicit "is this section finished?" toggle.
// Marking it complete is the single source of truth for the section reading as `done`
// in the Strategic Hub — it never alters the section's content either way.
function SectionCompleteBar({ done, onToggle }) {
  return (
    <div className="mt-8 flex items-center justify-end gap-3 border-t border-gray-100 pt-5">
      <span className={`text-xs font-medium ${done ? 'text-emerald-600' : 'text-gray-400'}`}>
        {done ? 'Marked complete' : 'Not marked complete'}
      </span>
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
          done
            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
        title={done ? 'Mark this section as not complete' : 'Mark this section as complete'}
      >
        {done ? <CheckCircle size={15} /> : <Check size={15} />}
        {done ? 'Completed' : 'Mark as completed'}
      </button>
    </div>
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
  const router = useRouter();
  const searchParams = useSearchParams();
  // The ticker this page was opened on via ?ticker= (carried along by a stage move).
  // Captured on mount and honored stubbornly: the "keep a valid ticker" fallback below
  // won't run until this name is selected or proven absent after a real fetch — so a
  // momentarily-stale watchlist load can't bounce the selection to the first name.
  const requestedTickerRef = useRef(searchParams.get('ticker')?.toUpperCase() || null);
  const tickerDataReqRef = useRef(null);
  const [allData, setAllData] = useState(() => cache.get('deep_research_watchlist') || null);
  const [selectedTicker, setSelectedTicker] = useState(() => searchParams.get('ticker')?.toUpperCase() || cache.get('deep_research_selectedTicker') || '');
  // Fundamentals are cached per ticker. Seed from the initially-selected name's own
  // cache entry — never a generic shared slot, which is how one company's charts used
  // to bleed onto another's page.
  const [loadedTickerData, setLoadedTickerData] = useState(() => {
    const t = searchParams.get('ticker')?.toUpperCase() || cache.get('deep_research_selectedTicker');
    return t ? (cache.get(`deep_research_tickerData_${t}`) || null) : null;
  });
  const [loading, setLoading] = useState(() => !cache.get('deep_research_watchlist'));
  const [fetchedOnce, setFetchedOnce] = useState(false);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [liveQuote, setLiveQuote] = useState(() => cache.get('deep_research_liveQuote') || null);
  const [quoteLoading, setQuoteLoading] = useState(() => !cache.get('deep_research_liveQuote') && !!cache.get('deep_research_selectedTicker'));
  const [activeResearchTab, setActiveResearchTab] = useState(() => cache.get('deep_research_activeTab') || 'fundamentals');
  const [thesis, setThesis] = useState(null);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisDirty, setThesisDirty] = useState(false);
  const modelRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  // Which stage a promote/demote is currently persisting to (null = idle). Drives the
  // per-button spinner so the click has immediate feedback while the move + navigation
  // resolve.
  const [movingTo, setMovingTo] = useState(null);

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

  // Only ever render fundamentals tagged with the currently selected name. A stale
  // in-flight fetch or a leftover cache payload could otherwise briefly surface one
  // company's charts under another company's header.
  const tickerData = loadedTickerData?.ticker === selectedTicker ? loadedTickerData : null;

  const researchWorkspace = useMemo(
    () => buildResearchWorkspace(thesis, selectedStock),
    [thesis, selectedStock]
  );

  const dueDiligenceItems = researchWorkspace.dueDiligenceItems;
  const dislocationItems = researchWorkspace.dislocationItems;
  const sectionsComplete = thesis?.underwriting?.sectionsComplete || {};

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

      const data = await fetchWatchlist();
      setAllData(data);
      writeWatchlistCache(cache, data);
      setLoading(false);
      setFetchedOnce(true);
      return data;
    } catch {
      setLoading(false);
      setFetchedOnce(true);
      return null;
    }
  }, [cache]);

  const loadTickerData = useCallback(async (ticker) => {
    if (!ticker) return;
    // Track the latest requested ticker so a slow fetch for a name we've navigated
    // away from can't overwrite the current selection's data.
    tickerDataReqRef.current = ticker;
    const cached = cache.get(`deep_research_tickerData_${ticker}`);
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
      cache.set(`deep_research_tickerData_${ticker}`, data);
      if (tickerDataReqRef.current === ticker) setLoadedTickerData(data);
    } catch {
      setToast({ message: `Failed to load data for ${ticker}`, type: 'error' });
    } finally {
      if (tickerDataReqRef.current === ticker) setTickerLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    loadResearchStocks();
  }, [loadResearchStocks]);

  // Keep a valid research-stage ticker selected. Skipped while a deep-link target is
  // still pending so it can't override the moved name with the first in the list.
  useEffect(() => {
    if (requestedTickerRef.current) return;
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

  // Deep-link support: /research?ticker=XYZ (from a stage move or the command palette).
  // Honor it as soon as the name appears as a research-stage stock; give up only once a
  // real fetch has confirmed it isn't here, so the fallback above can take over.
  useEffect(() => {
    const requested = requestedTickerRef.current;
    if (!requested) return;
    if (researchStocks.some(stock => stock.ticker === requested)) {
      requestedTickerRef.current = null;
      setSelectedTicker(requested);
      cache.set('deep_research_selectedTicker', requested);
      const requestedTab = searchParams.get('tab');
      if (requestedTab && RESEARCH_TABS.includes(requestedTab)) {
        setActiveResearchTab(requestedTab);
        cache.set('deep_research_activeTab', requestedTab);
      }
      if (searchParams.get('ticker')) router.replace('/research');
    } else if (fetchedOnce && researchStocks.length) {
      requestedTickerRef.current = null;
    }
  }, [searchParams, researchStocks, fetchedOnce, cache, router]);

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
      fetchQuote(selectedTicker)
        .then(quote => {
          if (quote) {
            setLiveQuote(quote);
            cache.set('deep_research_liveQuote', quote);
            cache.set(`deep_research_quote_${selectedTicker}`, quote);
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
    fetchThesis(selectedTicker)
      .then(data => { if (!cancelled) setThesis(migrateNewsImages(data)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setThesisLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTicker]);

  useEffect(() => {
    cache.set('deep_research_activeTab', activeResearchTab);
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

  const saveThesis = useCallback(async (data) => {
    if (!selectedTicker || (!thesisDirty && !data)) return;
    setThesisSaving(true);
    try {
      const result = await saveThesisData(selectedTicker, data || thesis);
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
    if (!selectedStock || !allData || movingTo) return;
    const ticker = selectedStock.ticker;
    setMovingTo(newStage);
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
      // Follow the name to its new stage's tab so the pipeline reads as one flow.
      router.push(routeForStage(newStage, ticker));
    } catch {
      setToast({ message: `Failed to move ${ticker}`, type: 'error' });
      setMovingTo(null);
    }
  }, [selectedStock, allData, cache, router, movingTo]);

  const updateThesisField = (field, value) => {
    setThesis(prev => ({ ...prev, [field]: value }));
    setThesisDirty(true);
  };

  // Flip a research section's explicit completion mark. This is the ONLY thing that
  // makes a section read as "done" in the Strategic Hub (see lib/researchProgress).
  // Stored under underwriting.sectionsComplete — a free-form JSON blob — so it
  // persists through the thesis save without a schema change, and never touches any
  // of the section's actual content.
  const toggleSectionComplete = useCallback((sectionKey) => {
    const current = thesis?.underwriting?.sectionsComplete || {};
    const updated = {
      ...(thesis || {}),
      underwriting: {
        ...((thesis || {}).underwriting || {}),
        sectionsComplete: { ...current, [sectionKey]: !current[sectionKey] },
      },
    };
    setThesis(updated);
    setThesisDirty(true);
    saveThesis(updated);
  }, [thesis, saveThesis]);

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

  const livePrice = liveQuote?.price || null;
  // Chart series + the live PE / FCF-yield / P/S tiles now live in
  // CompanyFundamentals (shared with Draft & Review); the export below still
  // needs the headline price.
  const { displayPrice } = computeQuickStats(tickerData, liveQuote);

  const handleExport = async () => {
    setExporting(true);
    try {
      let modelData = modelRef.current?.getModelData?.() || null;

      if (!modelData) {
        try {
          modelData = await fetchComputedValuationModel(selectedTicker, livePrice);
        } catch {}
      }

      let freshQuote = liveQuote;
      try {
        freshQuote = await fetchQuote(selectedTicker) || freshQuote;
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
          <h1 className="text-3xl font-bold text-gray-900">
            Research{selectedTicker && <span className="text-gray-400 font-normal"> · {selectedTicker}</span>}
          </h1>
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

      {/* relative z-50: the fade-in-up transform makes this Card its own stacking
          context, which would otherwise trap the company dropdown's z-index and let
          the content section below paint over the open option list. */}
      <Card className="relative z-50 mb-8 animate-fade-in-up stagger-2">
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
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => moveStage('draft')}
                disabled={!!movingTo}
                title="Demote back to Draft & Review"
                className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {movingTo === 'draft' ? <RefreshCw size={13} className="animate-spin" /> : <ArrowLeft size={13} />}
                {movingTo === 'draft' ? 'Moving…' : 'Back to Draft & Review'}
              </button>
              <button
                onClick={() => moveStage('position')}
                disabled={!!movingTo}
                title="Promote to Position Review"
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {movingTo === 'position' ? 'Moving…' : 'Promote to Position Review'}
                {movingTo === 'position' ? <RefreshCw size={13} className="animate-spin" /> : <ChevronRight size={13} />}
              </button>
            </div>
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

              <CompanyFundamentals tickerData={tickerData} liveQuote={liveQuote} quoteLoading={quoteLoading} />
              {thesis && <SectionCompleteBar done={!!sectionsComplete.fundamentals} onToggle={() => toggleSectionComplete('fundamentals')} />}
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
              <SectionCompleteBar done={!!sectionsComplete.thesis} onToggle={() => toggleSectionComplete('thesis')} />
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
              <SectionCompleteBar done={!!sectionsComplete.diligence} onToggle={() => toggleSectionComplete('diligence')} />
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
              <SectionCompleteBar done={!!sectionsComplete.news} onToggle={() => toggleSectionComplete('news')} />
            </div>
          ) : activeResearchTab === 'valuation' ? (
            <div className="space-y-8">
              <ValuationModel ref={modelRef} ticker={selectedTicker} livePrice={livePrice} />
              {thesis && <SectionCompleteBar done={!!sectionsComplete.valuation} onToggle={() => toggleSectionComplete('valuation')} />}
            </div>
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
              <SectionCompleteBar done={!!sectionsComplete.decision} onToggle={() => toggleSectionComplete('decision')} />
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
