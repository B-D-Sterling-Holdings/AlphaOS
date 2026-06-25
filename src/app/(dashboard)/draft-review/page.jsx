'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, Save, CheckCircle, MessagesSquare, ArrowLeft, ArrowRight, User } from 'lucide-react';
import Card from '@/components/Card';
import Toast from '@/components/Toast';
import DraftReview from '@/components/DraftReview';
import TickerSearchSelect from '@/components/TickerSearchSelect';
import { useCache } from '@/lib/CacheContext';
import { normalizeAutoNotify } from '@/lib/autoNotify';
import { persistStageMove, writeWatchlistCache, STAGE_LABELS } from '@/lib/stageMove';

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
  const appliedTickerParam = useRef(null);

  const [allData, setAllData] = useState(() => cache.get('deep_research_watchlist') || null);
  const [selectedTicker, setSelectedTicker] = useState(() => cache.get('deep_research_selectedTicker') || '');
  const [loading, setLoading] = useState(() => !cache.get('deep_research_watchlist'));
  const [thesis, setThesis] = useState(null);
  const [thesisLoading, setThesisLoading] = useState(false);
  const [thesisSaving, setThesisSaving] = useState(false);
  const [thesisDirty, setThesisDirty] = useState(false);
  const [toast, setToast] = useState(null);

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
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      setAllData(data);
      writeWatchlistCache(cache, data);
    } catch {} finally {
      setLoading(false);
    }
  }, [cache]);

  useEffect(() => { loadResearchStocks(); }, [loadResearchStocks]);

  // Keep a valid research-stage ticker selected.
  useEffect(() => {
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

  // Deep-link support: /draft-review?ticker=XYZ (from the Workflow page).
  useEffect(() => {
    const requested = searchParams.get('ticker')?.toUpperCase();
    if (!requested || appliedTickerParam.current === requested) return;
    if (researchStocks.some(stock => stock.ticker === requested)) {
      appliedTickerParam.current = requested;
      setSelectedTicker(requested);
      cache.set('deep_research_selectedTicker', requested);
      router.replace('/draft-review');
    }
  }, [searchParams, researchStocks, cache, router]);

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
    fetch(`/api/thesis/${selectedTicker}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setThesis(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setThesisLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTicker]);

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
        setToast({ message: 'Draft & review saved', type: 'success' });
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
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      setToast({ message: result.error || 'Failed to send notifications', type: 'error' });
      return;
    }
    if (result.message) {
      setToast({ message: result.message, type: 'info' });
      return;
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
  }, [thesis, selectedTicker]);

  // Promote/demote the selected name. Data-safe: only the stage flips; the paper,
  // threads and every thesis field are preserved (and reappear here if demoted back
  // from Research). Entering Research seeds its workspace once, never overwriting.
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
      <div className="flex items-center justify-between mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Draft &amp; Review</h1>
          <p className="text-sm text-gray-500 mt-1">Write the full thesis, then run the reviewer back-and-forth to pressure-test it.</p>
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

      <Card className="mb-8 animate-fade-in-up stagger-2">
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
                title="Demote back to the Watchlist"
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg transition-colors"
              >
                <ArrowLeft size={13} /> Back to Watchlist
              </button>
              <button
                onClick={() => moveStage('research')}
                title="Promote to Research"
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg transition-colors"
              >
                Move to Research <ArrowRight size={13} />
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
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
