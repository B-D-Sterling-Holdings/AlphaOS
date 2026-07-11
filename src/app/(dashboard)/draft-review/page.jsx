'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, Save, CheckCircle, MessagesSquare, ArrowLeft, ArrowRight, User, AlertTriangle } from 'lucide-react';
import Card from '@/components/Card';
import Toast from '@/components/Toast';
import DraftReview from '@/components/DraftReview';
import ValuationModel from '@/components/ValuationModel';
import CompanyFundamentals from '@/components/CompanyFundamentals';
import TickerSearchSelect from '@/components/TickerSearchSelect';
import { useCache } from '@/lib/CacheContext';
import { normalizeAutoNotify } from '@/lib/autoNotify';
import { useTickerData } from '@/lib/useTickerData';
import ResearchTaskPanel from '@/components/ResearchTaskPanel';
import { persistStageMove, writeWatchlistCache, STAGE_LABELS, routeForStage } from '@/lib/stageMove';
import { startGeneration, isGenerating, subscribeGeneration } from '@/lib/generateTickerJob';
import {
  fetchQuote,
  fetchThesis,
  fetchWatchlist,
  saveThesisReconciled,
} from '@/lib/researchApi';

// --- thesis.underwriting.draftReview shaping (kept local to this page) -------

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeThread(thread) {
  return {
    id: thread?.id || makeId(),
    title: thread?.title || '',
    resolved: !!thread?.resolved,
    createdAt: thread?.createdAt || new Date().toISOString(),
    messages: (thread?.messages || []).map(msg => ({
      id: msg?.id || makeId(),
      role: msg?.role === 'reviewer' ? 'reviewer' : 'author',
      body: msg?.body ?? '',
      createdAt: msg?.createdAt || new Date().toISOString(),
    })),
  };
}

function normalizePerson(person) {
  return { name: person?.name || '', email: person?.email || '' };
}

function buildDraftReview(thesis) {
  const draftReview = thesis?.underwriting?.draftReview || {};
  const paper = draftReview.paper;
  return {
    paper: Array.isArray(paper)
      ? paper
      : (typeof paper === 'string' && paper.trim() ? [{ type: 'text', value: paper }] : []),
    threads: (draftReview.threads || []).map(normalizeThread),
    author: normalizePerson(draftReview.author),
    reviewer: normalizePerson(draftReview.reviewer),
    autoNotify: normalizeAutoNotify(draftReview.autoNotify),
  };
}

export default function DraftReviewPage() {
  const cache = useCache();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The ticker this page was opened on via ?ticker= (carried along by a stage move).
  // Captured on mount and honored stubbornly: the "keep a valid ticker" fallback below
  // won't run until this name is selected or proven absent after a real fetch — so a
  // momentarily-stale watchlist load can't bounce the selection to the first name.
  const requestedTickerRef = useRef(searchParams.get('ticker')?.toUpperCase() || null);

  const [allData, setAllData] = useState(() => cache.get('deep_research_watchlist') || null);
  const [selectedTicker, setSelectedTicker] = useState(() => searchParams.get('ticker')?.toUpperCase() || cache.get('deep_research_selectedTicker') || '');
  const [loading, setLoading] = useState(() => !cache.get('deep_research_watchlist'));
  const [fetchedOnce, setFetchedOnce] = useState(false);
  const [thesis, setThesis] = useState(null);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisDirty, setThesisDirty] = useState(false);
  const [toast, setToast] = useState(null);
  // Live quote feeds the valuation model's share price (same as Research / Position
  // Review). The valuation itself (rows, assumptions) lives in /api/model/<ticker>,
  // shared across the pipeline, so work started here follows the name into Research.
  const [liveQuote, setLiveQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  // Which stage a promote/demote is currently persisting to (null = idle). Drives the
  // per-button spinner so the click has immediate feedback while the move resolves.
  const [movingTo, setMovingTo] = useState(null);
  // 'draft' (paper + threads) | 'fundamentals' (the company data view shared with
  // Research). Consolidation of the two pages: the discussion happens with the
  // numbers one tab away instead of one stage away.
  const [activeTab, setActiveTab] = useState(() => cache.get('draft_review_activeTab') || 'draft');
  const [generating, setGenerating] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  // Company fundamentals for the Fundamentals tab. Same cache slots + generation
  // job as the Research page, so data loaded (or generated) on either page is
  // immediately available on the other.
  const { tickerData, tickerLoading, reload: reloadTickerData } = useTickerData(selectedTicker);

  // Only names actively in the Draft & Review stage. Research is its own page now;
  // a name's paper/threads are preserved in its thesis and reappear here untouched
  // if it is ever demoted back from Research.
  const researchStocks = useMemo(() => (
    (allData?.watchlists || []).flatMap(watchlist =>
      (watchlist.stocks || [])
        .filter(stock => stock.stage === 'draft')
        .map(stock => ({ ...stock, watchlistId: watchlist.id, watchlistName: watchlist.name }))
    )
  ), [allData]);

  const selectedStock = useMemo(
    () => researchStocks.find(stock => stock.ticker === selectedTicker) || null,
    [researchStocks, selectedTicker]
  );

  const draftReview = useMemo(() => buildDraftReview(thesis), [thesis]);

  const loadResearchStocks = useCallback(async () => {
    try {
      const cached = cache.get('deep_research_watchlist');
      if (cached?.watchlists) { setAllData(cached); setLoading(false); }
      const data = await fetchWatchlist();
      setAllData(data);
      writeWatchlistCache(cache, data);
    } catch {} finally {
      setLoading(false);
      setFetchedOnce(true);
    }
  }, [cache]);

  useEffect(() => { loadResearchStocks(); }, [loadResearchStocks]);

  // Keep a valid research-stage ticker selected. Skipped while a deep-link target is
  // still pending so it can't override the moved name with the first in the list.
  useEffect(() => {
    if (requestedTickerRef.current) return;
    if (!researchStocks.length) {
      if (selectedTicker) { setSelectedTicker(''); cache.set('deep_research_selectedTicker', ''); }
      return;
    }
    if (!selectedTicker || !researchStocks.some(stock => stock.ticker === selectedTicker)) {
      const nextTicker = researchStocks[0].ticker;
      setSelectedTicker(nextTicker);
      cache.set('deep_research_selectedTicker', nextTicker);
    }
  }, [cache, researchStocks, selectedTicker]);

  // Deep-link support: /draft-review?ticker=XYZ (from a stage move or the Workflow
  // page). Honor it as soon as the name appears in this stage; give up only once a
  // real fetch has confirmed it isn't here, so the fallback above can take over.
  useEffect(() => {
    const requested = requestedTickerRef.current;
    if (!requested) return;
    if (researchStocks.some(stock => stock.ticker === requested)) {
      requestedTickerRef.current = null;
      setSelectedTicker(requested);
      cache.set('deep_research_selectedTicker', requested);
      if (searchParams.get('ticker')) router.replace('/draft-review');
    } else if (fetchedOnce && researchStocks.length) {
      requestedTickerRef.current = null;
    }
  }, [searchParams, researchStocks, fetchedOnce, cache, router]);

  useEffect(() => {
    if (!selectedTicker) { setThesis(null); return; }
    let cancelled = false;
    // Drop the previous ticker's thesis up front so its paper/threads can never
    // flash — or be saved — under the newly selected ticker while this fetch is in
    // flight. The `cancelled` guard ignores a slow response for a ticker we've
    // already navigated away from, so an out-of-order fetch can't leak across names.
    setThesis(null);
    setThesisLoading(true);
    setThesisDirty(false);
    fetchThesis(selectedTicker)
      .then(data => { if (!cancelled) setThesis(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setThesisLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTicker]);

  // Live quote for the valuation model's share price and the Fundamentals stat
  // tiles. Cleared up front and guarded so a slow response can't leak the prior
  // name's price onto the new selection.
  useEffect(() => {
    if (!selectedTicker) { setLiveQuote(null); return; }
    let cancelled = false;
    setLiveQuote(null);
    setQuoteLoading(true);
    fetchQuote(selectedTicker)
      .then(quote => { if (!cancelled && quote) setLiveQuote(quote); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTicker]);

  useEffect(() => {
    cache.set('draft_review_activeTab', activeTab);
  }, [activeTab, cache]);

  // "Generate Data" runs in the module-scope job (src/lib/generateTickerJob) so
  // navigating away doesn't orphan it. Mirrors the Research page: restore the
  // spinner on mount / company change, and on completion reload only if the
  // finished name is the one on screen.
  useEffect(() => {
    setGenerating(isGenerating(selectedTicker));
    return subscribeGeneration(({ ticker, ok, error }) => {
      if (ticker === selectedTicker) {
        setGenerating(false);
        if (ok) {
          setToast({ message: `Data generated for ${ticker}`, type: 'success' });
          reloadTickerData();
        } else {
          setToast({ message: `Error: ${error}`, type: 'error' });
        }
      } else {
        setToast(ok
          ? { message: `Data generated for ${ticker}`, type: 'success' }
          : { message: `${ticker}: ${error}`, type: 'error' });
      }
    });
  }, [selectedTicker, reloadTickerData]);

  const generateData = () => {
    setShowGenerateModal(false);
    if (!selectedTicker || isGenerating(selectedTicker)) return;
    setGenerating(true);
    setToast({ message: `Generating data for ${selectedTicker}... This may take ~30 seconds.`, type: 'info' });
    startGeneration(selectedTicker, cache);
  };

  // Save with optimistic-concurrency reconciliation: on a version conflict (a
  // teammate saved the same thesis first) the reviewer's in-flight comments/edits
  // are merged on top of the fresh server copy and retried, so no one's Draft &
  // Review work is silently overwritten. See saveThesisReconciled / mergeThesis.
  const saveThesis = useCallback(async (data) => {
    if (!selectedTicker || (!thesisDirty && !data)) return;
    setThesisSaving(true);
    try {
      const result = await saveThesisReconciled(selectedTicker, data || thesis);
      if (result.ok) {
        setThesisDirty(false);
        // Surface the merged document on a reconciled save; otherwise just stamp
        // the new version so the next save guards against the right row (without
        // clobbering keystrokes typed while this save was in flight).
        if (result.reloaded) setThesis(result.thesis);
        else setThesis(prev => (prev ? { ...prev, version: result.thesis.version } : prev));
        setToast({ message: result.reloaded ? 'Merged a teammate’s changes and saved' : 'Draft & review saved', type: 'success' });
      } else if (result.conflict) {
        setThesis(result.thesis);
        setThesisDirty(true);
        setToast({ message: 'Loaded a teammate’s latest changes — review and save again', type: 'info' });
      } else {
        setToast({ message: 'Failed to save', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to save', type: 'error' });
    } finally {
      setThesisSaving(false);
    }
  }, [selectedTicker, thesis, thesisDirty]);

  const updateDraftReview = useCallback((updater, persist = false) => {
    const nextDraftReview = updater(buildDraftReview(thesis));
    const updated = {
      ...(thesis || {}),
      underwriting: {
        ...((thesis || {}).underwriting || {}),
        draftReview: nextDraftReview,
      },
    };
    setThesis(updated);
    setThesisDirty(true);
    if (persist) saveThesis(updated);
  }, [saveThesis, thesis]);

  const notifyReview = useCallback(async (threadIds) => {
    const dr = buildDraftReview(thesis);
    const res = await fetch('/api/notify-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: selectedTicker,
        author: dr.author,
        reviewer: dr.reviewer,
        threads: dr.threads,
        threadIds: Array.isArray(threadIds) ? threadIds : undefined,
        stage: 'draft',
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      setToast({ message: result.error || 'Failed to send notifications', type: 'error' });
      return null;
    }
    if (result.message) {
      setToast({ message: result.message, type: 'info' });
      return result;
    }
    const sentMsg = (result.sent || [])
      .map(s => `${s.role === 'author' ? 'Author' : 'Reviewer'} (${s.count})`)
      .join(', ');
    if (result.skipped?.length) {
      const skipMsg = result.skipped
        .map(s => `${s.role === 'author' ? 'Author' : 'Reviewer'}: ${s.reason}`)
        .join('; ');
      setToast({
        message: sentMsg ? `Notified ${sentMsg}. Skipped — ${skipMsg}` : `Skipped — ${skipMsg}`,
        type: sentMsg ? 'success' : 'error',
      });
    } else {
      setToast({ message: `Notified ${sentMsg}`, type: 'success' });
    }
    return result;
  }, [thesis, selectedTicker]);

  // Promote/demote the selected name. Data-safe: only the stage flips; the paper,
  // threads and every thesis field are preserved (and reappear here if demoted back
  // from Research). Entering Research seeds its workspace once, never overwriting.
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
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <MessagesSquare size={28} className="text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Draft &amp; Review</h1>
          <p className="text-gray-500 max-w-xl mx-auto leading-relaxed">
            Promote a ticker into the Draft &amp; Review stage from the
            {' '}<Link href="/workflow" className="text-emerald-600 font-semibold hover:underline">Workflow</Link>, then
            write the paper here and run the reviewer back-and-forth.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      <ResearchTaskPanel ticker={selectedTicker} companyName={selectedStock?.name} />
      <div className="flex items-center justify-between mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Draft &amp; Review</h1>
        </div>
        {thesis && (
          <button
            onClick={() => saveThesis()}
            disabled={thesisSaving || !thesisDirty}
            className={`flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-2xl shadow-md transition-all duration-200 ${
              thesisDirty
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 hover:shadow-lg hover:shadow-emerald-200/50'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {thesisSaving ? <RefreshCw size={14} className="animate-spin" /> : thesisDirty ? <Save size={14} /> : <CheckCircle size={14} />}
            {thesisSaving ? 'Saving...' : thesisDirty ? 'Save Notes' : 'Saved'}
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

          {selectedStock && draftReview.author?.name?.trim() && (
            <span
              title={draftReview.author.email ? `Author · ${draftReview.author.email}` : 'Author'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold"
            >
              <User size={13} className="shrink-0" />
              <span className="truncate max-w-[160px]">Author: {draftReview.author.name.trim()}</span>
            </span>
          )}

          {selectedStock && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => moveStage('watching')}
                disabled={!!movingTo}
                title="Demote back to the Watchlist"
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {movingTo === 'watching' ? <RefreshCw size={13} className="animate-spin" /> : <ArrowLeft size={13} />}
                {movingTo === 'watching' ? 'Moving…' : 'Back to Watchlist'}
              </button>
              <button
                onClick={() => moveStage('research')}
                disabled={!!movingTo}
                title="Promote to Research"
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {movingTo === 'research' ? 'Moving…' : 'Move to Research'}
                {movingTo === 'research' ? <RefreshCw size={13} className="animate-spin" /> : <ArrowRight size={13} />}
              </button>
            </div>
          )}
        </div>
      </Card>

      {!selectedTicker ? (
        <div className="text-center py-20">
          <p className="text-lg text-gray-400 mb-2">Select a ticker to open its draft &amp; review</p>
          <p className="text-sm text-gray-300">Only companies in the Draft &amp; Review stage appear here</p>
        </div>
      ) : (
        <>
          {/* Same tab pattern as Research: the discussion and the company data are
              two tabs on one page, so referencing the numbers mid-review never
              means leaving the page. */}
          <div className="flex items-center justify-between mb-8 animate-fade-in-up stagger-3">
            <div className="flex flex-wrap gap-1 bg-gray-100/80 rounded-2xl p-1">
              {[
                { key: 'fundamentals', label: 'Fundamentals' },
                { key: 'draft', label: 'Draft & Review' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    activeTab === tab.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {activeTab === 'fundamentals' && tickerData?.dataExists && (
              <button
                onClick={() => setShowGenerateModal(true)}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-white border border-gray-200 rounded-2xl text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 hover:shadow-md transition-all duration-200 disabled:opacity-40"
              >
                <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
                Update Data
              </button>
            )}
          </div>

          {activeTab === 'fundamentals' ? (
            tickerLoading ? (
              <div className="space-y-6">
                <div className="skeleton h-28 rounded-2xl" />
                <div className="skeleton h-72 rounded-3xl" />
              </div>
            ) : !tickerData?.dataExists ? (
              <Card className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
                  <AlertTriangle size={28} className="text-amber-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">No data generated for {selectedTicker}</h2>
                <p className="text-sm text-gray-500 mb-8 max-w-md mx-auto leading-relaxed">
                  Generate fundamentals and price history for this company to reference its numbers right here while you draft and review.
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
              <CompanyFundamentals tickerData={tickerData} liveQuote={liveQuote} quoteLoading={quoteLoading} />
            )
          ) : thesisLoading ? (
            <div className="space-y-6">
              <div className="skeleton h-48 rounded-2xl" />
              <div className="skeleton h-64 rounded-2xl" />
            </div>
          ) : !thesis ? null : (
            <DraftReview
              key={selectedTicker}
              ticker={selectedTicker}
              paper={draftReview.paper}
              threads={draftReview.threads}
              author={draftReview.author}
              reviewer={draftReview.reviewer}
              autoNotify={draftReview.autoNotify}
              onPaperChange={(value, persist = false) => updateDraftReview(dr => ({ ...dr, paper: value }), persist)}
              onThreadsChange={(threads, persist = false) => updateDraftReview(dr => ({ ...dr, threads }), persist)}
              onAuthorChange={(value, persist = false) => updateDraftReview(dr => ({ ...dr, author: value }), persist)}
              onReviewerChange={(value, persist = false) => updateDraftReview(dr => ({ ...dr, reviewer: value }), persist)}
              onAutoNotifyChange={(value, persist = false) => updateDraftReview(dr => ({ ...dr, autoNotify: value }), persist)}
              onNotify={notifyReview}
              valuationSlot={<ValuationModel ticker={selectedTicker} livePrice={liveQuote?.price || null} embedded />}
            />
          )}
        </>
      )}

      {showGenerateModal && (
        <div className="modal-overlay" onClick={() => setShowGenerateModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              {tickerData?.dataExists ? `Update Data for ${selectedTicker}` : `Generate Data for ${selectedTicker}`}
            </h3>
            <p className="text-sm text-gray-500 mb-4 leading-relaxed">
              {tickerData?.dataExists
                ? 'This will re-fetch the latest fundamental and price data, overwriting the existing data. Use this after an earnings release or if the data is stale.'
                : 'This will fetch fundamental data from Alpha Vantage and price data from Yahoo Finance. The data will be saved locally so you only need to do this once.'}
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2 mb-5">
              Note: Alpha Vantage free tier allows 5 API calls/minute. Generation takes ~30 seconds.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowGenerateModal(false)} className="px-5 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-all duration-200">
                Cancel
              </button>
              <button onClick={generateData} className="px-5 py-2.5 text-sm bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold rounded-xl hover:from-emerald-700 hover:to-emerald-600 shadow-md hover:shadow-lg hover:shadow-emerald-200/50 transition-all duration-200">
                {tickerData?.dataExists ? 'Update Data' : 'Generate Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
