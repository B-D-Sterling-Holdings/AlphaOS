'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import {
  Eye, Search, ClipboardList, ArrowRight, ArrowLeft, ChevronDown,
  Check, ChevronRight, FileText, MessagesSquare,
} from 'lucide-react';
import Card from '@/components/Card';
import { useCache } from '@/lib/CacheContext';
import { computeResearchProgress, draftReviewStatus } from '@/lib/researchProgress';
import { persistStageMove, withStageChange, writeWatchlistCache } from '@/lib/stageMove';

// Per-stage accent. Kept restrained — a numbered chip + a single glyph carry the
// colour; rows stay neutral until hovered.
const ACCENT = {
  watchlist:   { text: 'text-emerald-600', step: 'bg-emerald-100 text-emerald-700', soft: 'hover:bg-emerald-50 hover:text-emerald-600' },
  draftReview: { text: 'text-amber-600',   step: 'bg-amber-100 text-amber-700',     soft: 'hover:bg-amber-50 hover:text-amber-600' },
  research:    { text: 'text-blue-600',    step: 'bg-blue-100 text-blue-700',       soft: 'hover:bg-blue-50 hover:text-blue-600' },
  position:    { text: 'text-violet-600',  step: 'bg-violet-100 text-violet-700',   soft: 'hover:bg-violet-50 hover:text-violet-600' },
};

const CAP = 10; // names shown per group before collapsing into "+N more"

// ---- building blocks ------------------------------------------------------

function StageCard({ icon: Icon, accent, title, subtitle, count, step, delay, headerRight, children }) {
  return (
    <Card className={`w-full min-w-0 self-stretch animate-fade-in-up ${delay}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex items-center justify-center w-6 h-6 rounded-lg text-[11px] font-extrabold tabular-nums ${accent.step}`}>
          {step}
        </span>
        <Icon size={15} className={accent.text} />
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {count != null && <span className="text-xs font-semibold text-gray-300 tabular-nums">{count}</span>}
        {headerRight && <div className="ml-auto">{headerRight}</div>}
      </div>
      <p className="text-[11px] text-gray-400 mt-1 mb-5 ml-[2.1rem]">{subtitle}</p>
      {children}
    </Card>
  );
}

function GroupLabel({ icon: Icon, color, label, count }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5 px-1">
      <Icon size={11} className={color} />
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      <span className="text-[10px] text-gray-300 tabular-nums">{count}</span>
    </div>
  );
}

// A watchlist name with a one-click promote to the next stage.
function PromoteRow({ ticker, sub, accent, nextLabel, onPromote }) {
  return (
    <div className="group flex items-center gap-2 rounded-lg pl-2.5 pr-1.5 py-1.5 hover:bg-gray-50 transition-colors">
      <Link href="/watchlist" className="text-[13px] font-bold text-gray-800 hover:text-gray-950 transition-colors">{ticker}</Link>
      {sub && <span className="text-[10px] text-gray-300 truncate">{sub}</span>}
      <button
        onClick={onPromote}
        title={`Promote to ${nextLabel}`}
        className={`ml-auto flex items-center gap-1 text-[10px] font-semibold text-gray-400 px-2 py-1 rounded-md transition-all ${accent.soft}`}
      >
        {nextLabel}
        <ArrowRight size={11} />
      </button>
    </div>
  );
}

// Forward / backward stage controls for a name that already sits inside the
// pipeline (Draft & Review, Research). The forward button carries the accent of
// the stage it promotes into; the back arrow stays neutral.
function StageMove({ accent, backLabel, onBack, nextLabel, onForward }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          title={`Back to ${backLabel}`}
          className="flex items-center justify-center w-6 h-6 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={12} />
        </button>
      )}
      {onForward && (
        <button
          onClick={onForward}
          title={`Promote to ${nextLabel}`}
          className={`flex items-center gap-1 text-[10px] font-semibold text-gray-400 px-2 py-1 rounded-md transition-all ${accent.soft}`}
        >
          {nextLabel}
          <ArrowRight size={11} />
        </button>
      )}
    </div>
  );
}

function TickerChip({ ticker, href, sub, accent }) {
  return (
    <Link
      href={href}
      title={sub ? `${ticker} · ${sub}` : ticker}
      className={`group inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] font-bold text-gray-800 transition-all ${accent ? accent.soft : 'hover:bg-gray-50 hover:text-gray-950'}`}
    >
      {ticker}
      <ChevronRight size={12} className="text-gray-300 group-hover:text-current transition-colors" />
    </Link>
  );
}

function EmptyHint({ children }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center">
      <p className="text-[11px] text-gray-400">{children}</p>
    </div>
  );
}

function MoreLink({ count, href }) {
  return (
    <Link href={href} className="flex w-fit items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
      +{count} more
    </Link>
  );
}

function ProgressRing({ percent, size = 34 }) {
  const deg = Math.max(0, Math.min(100, percent)) * 3.6;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(#3b82f6 ${deg}deg, #eef2f6 0deg)` }} />
      <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center">
        <span className="text-[9px] font-bold text-gray-700 tabular-nums leading-none">{percent}</span>
      </div>
    </div>
  );
}

function StepDot({ state, size = 'md' }) {
  const dim = size === 'sm' ? 'w-3.5 h-3.5' : 'w-6 h-6';
  if (state === 'done') {
    return (
      <span className={`${dim} rounded-full bg-emerald-500 text-white flex items-center justify-center`}>
        <Check size={size === 'sm' ? 8 : 12} strokeWidth={3} />
      </span>
    );
  }
  if (state === 'partial') return <span className={`${dim} rounded-full border-2 border-amber-400 bg-amber-50`} />;
  return <span className={`${dim} rounded-full border-2 border-gray-200 bg-white`} />;
}

// The full-width, labelled "click any step → jump in" strip for one name.
function JourneyStrip({ ticker, progress }) {
  return (
    <div className="flex items-stretch overflow-x-auto pb-1">
      {progress.steps.map((s, i) => {
        const href = s.target === 'draftReview'
          ? `/draft-review?ticker=${ticker}`
          : `/research?ticker=${ticker}&tab=${s.tab}`;
        return (
          <Fragment key={s.key}>
            {i > 0 && (
              <div className="flex items-center px-1 sm:px-2 pt-3">
                <span className={`h-[2px] w-4 sm:w-8 rounded-full ${s.state !== 'todo' || progress.steps[i - 1].state !== 'todo' ? 'bg-emerald-200' : 'bg-gray-200'}`} />
              </div>
            )}
            <Link
              href={href}
              title={`Open ${s.label}${s.detail ? ` · ${s.detail}` : ''}`}
              className="group flex flex-col items-center gap-1.5 px-0.5 shrink-0"
            >
              <span className="relative inline-flex rounded-full transition-transform group-hover:scale-110">
                <StepDot state={s.state} />
              </span>
              <span className={`text-[10px] font-semibold whitespace-nowrap transition-colors ${s.state === 'todo' ? 'text-gray-400' : 'text-gray-700'} group-hover:text-blue-600`}>
                {s.label}
              </span>
              <span className="text-[9px] text-gray-300 tabular-nums h-3 leading-none">{s.detail || ''}</span>
            </Link>
          </Fragment>
        );
      })}
    </div>
  );
}

// ---- page -----------------------------------------------------------------

export default function WorkflowPage() {
  const cache = useCache();
  const [watchlistData, setWatchlistData] = useState(() => cache.get('workflow_watchlist') || null);
  const [portfolio, setPortfolio] = useState(() => cache.get('workflow_portfolio') || null);
  const [theses, setTheses] = useState(() => cache.get('workflow_theses') || {});
  const [loading, setLoading] = useState(() => !cache.get('workflow_watchlist'));
  const [selected, setSelected] = useState(null);
  const [selectedWl, setSelectedWl] = useState(null);

  // Load the two list sources once (warm-start from cache).
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/watchlist').then(r => r.json()).catch(() => null),
      fetch('/api/portfolio').then(r => r.json()).catch(() => null),
    ]).then(([wl, pf]) => {
      if (!alive) return;
      if (wl) { setWatchlistData(wl); writeWatchlistCache(cache, wl); }
      if (pf) { setPortfolio(pf); cache.set('workflow_portfolio', pf); }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [cache]);

  // Scope the whole pipeline to one watchlist (defaults to the saved active one).
  const watchlists = useMemo(() => watchlistData?.watchlists || [], [watchlistData]);
  const activeWlId = (selectedWl && watchlists.some(w => w.id === selectedWl))
    ? selectedWl
    : (watchlists.some(w => w.id === watchlistData?.activeWatchlistId) ? watchlistData.activeWatchlistId : watchlists[0]?.id) || null;
  const selectedWatchlist = watchlists.find(w => w.id === activeWlId) || null;

  const { watching, draftNames, researchNames } = useMemo(() => {
    const stocks = (selectedWatchlist?.stocks || []).map(s => ({
      ...s, watchlistId: selectedWatchlist.id, watchlistName: selectedWatchlist.name,
    }));
    return {
      // 'researching' (old On Queue stage) is retired — fold leftovers into Watching.
      watching: stocks.filter(s => s.stage === 'watching' || s.stage === 'researching'),
      draftNames: stocks.filter(s => s.stage === 'draft'),
      researchNames: stocks.filter(s => s.stage === 'research'),
    };
  }, [selectedWatchlist]);

  const positions = useMemo(() => portfolio?.holdings || [], [portfolio]);

  // Pull a thesis for every deep-dive name (Draft & Review + Research) so we can
  // score draft status and research progress.
  useEffect(() => {
    const tickers = [...draftNames, ...researchNames].map(s => s.ticker);
    const missing = tickers.filter(t => !theses[t]);
    if (!missing.length) return;
    let alive = true;
    Promise.all(missing.map(t =>
      fetch(`/api/thesis/${t}`).then(r => r.json()).then(d => [t, d]).catch(() => [t, null])
    )).then(entries => {
      if (!alive) return;
      setTheses(prev => {
        const next = { ...prev };
        for (const [t, d] of entries) if (d) next[t] = d;
        cache.set('workflow_theses', next);
        return next;
      });
    });
    return () => { alive = false; };
  }, [draftNames, researchNames, theses, cache]);

  // Move a watchlist name between pipeline stages
  // (watching → draft → research, or any step back) straight from the
  // overview — same persistence the Watchlist page uses, and the same one-time
  // seeding of the research workspace when a name reaches Research.
  const promote = useCallback(async (ticker, watchlistId, newStage) => {
    if (!watchlistData) return;
    // Optimistic local update for an instant UI; persistStageMove then writes the
    // watchlist and (one-time) seeds the research workspace without clobbering work.
    const optimistic = withStageChange(watchlistData, watchlistId, ticker, newStage);
    setWatchlistData(optimistic);
    writeWatchlistCache(cache, optimistic);
    try {
      const { thesis } = await persistStageMove({ watchlistData, watchlistId, ticker, newStage });
      if (thesis) {
        setTheses(prev => {
          const n = { ...prev, [ticker]: thesis };
          cache.set('workflow_theses', n);
          return n;
        });
      }
    } catch {}
  }, [watchlistData, cache]);

  const researchProgress = useMemo(() => (
    researchNames.map(s => ({
      ticker: s.ticker,
      watchlistId: s.watchlistId,
      watchlistName: s.watchlistName,
      progress: computeResearchProgress(theses[s.ticker]),
    }))
  ), [researchNames, theses]);

  // Derive the name shown in the detail strip: the user's pick while still valid,
  // otherwise fall back to the first research name (no effect / no extra render).
  const selectedRow = useMemo(() => {
    if (!researchProgress.length) return null;
    return (selected && researchProgress.find(r => r.ticker === selected)) || researchProgress[0];
  }, [researchProgress, selected]);
  const activeTicker = selectedRow?.ticker || null;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="skeleton h-12 w-64 rounded-2xl mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-44 rounded-3xl" />)}
        </div>
      </div>
    );
  }

  const hasAnything = watching.length || draftNames.length || researchNames.length || positions.length;

  // The watchlist scope selector — moved out of the page header to live inside the
  // Watchlist card (it only ever scopes that pipeline's source list).
  const watchlistSelector = watchlists.length > 1 ? (
    <div className="relative">
      <select
        value={activeWlId || ''}
        onChange={e => setSelectedWl(e.target.value)}
        className="appearance-none bg-emerald-50/70 border border-emerald-200/70 rounded-lg pl-2.5 pr-7 py-1 text-[11px] font-semibold text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all cursor-pointer"
      >
        {watchlists.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
    </div>
  ) : null;

  // Two-column grid of pipeline rows with a "+N more" deep link when capped.
  const pipelineGrid = (items, renderItem, empty, moreHref) => {
    if (!items.length) return <EmptyHint>{empty}</EmptyHint>;
    return (
      <>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5">{items.slice(0, CAP).map(renderItem)}</div>
        {items.length > CAP && <div className="mt-1.5"><MoreLink count={items.length - CAP} href={moreHref} /></div>}
      </>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Workflow</h1>
          <p className="text-sm text-gray-500 mt-1">Move a name through the pipeline — Watchlist → Draft &amp; Review → Research → Position. Promote forward or back from any stage.</p>
        </div>
      </div>

      {!hasAnything ? (
        <Card className="text-center py-20 animate-fade-in-up stagger-2">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <Eye size={26} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Nothing in the pipeline yet</h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Add tickers on the <Link href="/watchlist" className="text-emerald-600 font-semibold hover:underline">Watchlist</Link> to start the research journey.
          </p>
        </Card>
      ) : (
        <>
          {/* 1 Watchlist · 2 Draft & Review · 3 Research · 4 Position Review */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
            {/* 1 — Watchlist */}
            <StageCard icon={Eye} accent={ACCENT.watchlist} title="Watchlist" subtitle="Tracked & triaged — promote a name straight into Draft & Review" count={watching.length} step={1} delay="stagger-1" headerRight={watchlistSelector}>
              <GroupLabel icon={Eye} color="text-emerald-500" label="Watching" count={watching.length} />
              {watching.length ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-5 gap-y-0.5">
                  {watching.slice(0, CAP).map(s => (
                    <PromoteRow key={s.ticker} ticker={s.ticker} accent={ACCENT.draftReview} nextLabel="Draft" onPromote={() => promote(s.ticker, s.watchlistId, 'draft')} />
                  ))}
                  {watching.length > CAP && <MoreLink count={watching.length - CAP} href="/watchlist" />}
                </div>
              ) : <EmptyHint>No names being watched</EmptyHint>}
            </StageCard>

            {/* 2 — Draft & Review */}
            <StageCard icon={MessagesSquare} accent={ACCENT.draftReview} title="Draft & Review" subtitle="Write the paper, run the reviewer back-and-forth — promote to Research when ready" count={draftNames.length} step={2} delay="stagger-2">
              {pipelineGrid(draftNames, (s) => {
                const st = draftReviewStatus(theses[s.ticker]);
                return (
                  <div key={s.ticker} className="group flex items-center gap-2 rounded-xl px-2.5 py-2 hover:bg-amber-50/60 transition-all">
                    <Link href={`/draft-review?ticker=${s.ticker}`} className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${st.hasPaper ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                        <FileText size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] font-bold text-gray-900">{s.ticker}</span>
                        <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-medium">
                          <span className={st.hasPaper ? 'text-emerald-600' : 'text-gray-400'}>{st.hasPaper ? 'Drafted' : 'No draft'}</span>
                          {st.total > 0 && <span className="text-gray-400">· {st.open} open / {st.resolved} done</span>}
                        </div>
                      </div>
                    </Link>
                    <StageMove
                      accent={ACCENT.research}
                      backLabel="Watchlist"
                      onBack={() => promote(s.ticker, s.watchlistId, 'watching')}
                      nextLabel="Research"
                      onForward={() => promote(s.ticker, s.watchlistId, 'research')}
                    />
                  </div>
                );
              }, <>Promote a name from the <span className="font-semibold text-gray-500">Watchlist</span> to start its paper</>, '/draft-review')}
            </StageCard>

            {/* 3 — Research */}
            <StageCard icon={Search} accent={ACCENT.research} title="Research" subtitle="Deep-dive underwriting across every section" count={researchNames.length} step={3} delay="stagger-3">
              {pipelineGrid(researchProgress, ({ ticker, watchlistId, progress }) => {
                const active = ticker === activeTicker;
                return (
                  <div key={ticker} className={`group flex items-center gap-1.5 rounded-xl px-2 py-2 transition-all ${active ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'}`}>
                    <button onClick={() => setSelected(ticker)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                      <ProgressRing percent={progress.percent} />
                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] font-bold text-gray-900">{ticker}</span>
                        <div className="flex items-center gap-1 mt-1">
                          {progress.steps.map(s => <StepDot key={s.key} state={s.state} size="sm" />)}
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-gray-300 tabular-nums shrink-0">{progress.doneCount}/{progress.total}</span>
                    </button>
                    <button
                      onClick={() => promote(ticker, watchlistId, 'draft')}
                      title="Back to Draft & Review"
                      className="flex items-center justify-center w-6 h-6 rounded-md text-gray-300 hover:text-amber-600 hover:bg-amber-50 transition-colors shrink-0"
                    >
                      <ArrowLeft size={12} />
                    </button>
                  </div>
                );
              }, <>Promote a name from <span className="font-semibold text-gray-500">Draft &amp; Review</span> once its paper is ready</>, '/research')}
            </StageCard>

            {/* 4 — Position Review */}
            <StageCard icon={ClipboardList} accent={ACCENT.position} title="Position Review" subtitle="Monitor names you actually hold" count={positions.length} step={4} delay="stagger-4">
              {positions.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {positions.slice(0, CAP).map(h => <TickerChip key={h.ticker} ticker={h.ticker} href={`/position-review?ticker=${h.ticker}`} accent={ACCENT.position} />)}
                  {positions.length > CAP && <MoreLink count={positions.length - CAP} href="/position-review" />}
                </div>
              ) : <EmptyHint>No active positions to review</EmptyHint>}
            </StageCard>
          </div>

          {/* Per-name deep-dive progress — the "go to any part and add to it" strip */}
          {researchProgress.length > 0 && (
            <Card className="mt-5 animate-fade-in-up stagger-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Deep-dive progress</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Pick a name, then click a step to open and edit that section.</p>
                </div>
                {researchProgress.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {researchProgress.map(({ ticker, progress }) => (
                      <button key={ticker} onClick={() => setSelected(ticker)} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${ticker === activeTicker ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        {ticker}
                        <span className={`tabular-nums ${ticker === activeTicker ? 'text-blue-100' : 'text-gray-400'}`}>{progress.percent}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedRow && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <ProgressRing percent={selectedRow.progress.percent} size={44} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-lg font-bold text-gray-900">{selectedRow.ticker}</span>
                        <Link href={`/research?ticker=${selectedRow.ticker}`} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline">Open research →</Link>
                        <Link href={`/draft-review?ticker=${selectedRow.ticker}`} className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 hover:underline">Draft &amp; review →</Link>
                      </div>
                      <p className="text-[11px] text-gray-400">{selectedRow.progress.doneCount} of {selectedRow.progress.total} sections complete</p>
                    </div>
                  </div>
                  <JourneyStrip ticker={selectedRow.ticker} progress={selectedRow.progress} />
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
