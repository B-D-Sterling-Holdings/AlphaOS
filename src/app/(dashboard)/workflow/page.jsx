'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import Link from 'next/link';
import {
  Eye, Search, ClipboardList, ArrowRight, ArrowLeft, ChevronDown,
  FileText, MessagesSquare,
} from 'lucide-react';
import Card from '@/components/Card';
import { useCache } from '@/lib/CacheContext';
import { computeResearchProgress, draftReviewStatus, checklistStatus } from '@/lib/researchProgress';
import { persistStageMove, withStageChange, writeWatchlistCache, persistHoldingsBackfill } from '@/lib/stageMove';

// Per-stage accent. Kept restrained — a numbered chip + a single glyph carry the
// colour; rows stay neutral until hovered, and `btn` is the one soft-filled action
// tint that makes the *primary* forward move in each stage easy to spot.
const ACCENT = {
  watchlist:   { text: 'text-emerald-600', step: 'bg-emerald-100 text-emerald-700', soft: 'hover:bg-emerald-50/60', btn: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  draftReview: { text: 'text-amber-600',   step: 'bg-amber-100 text-amber-700',     soft: 'hover:bg-amber-50/50',  btn: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
  research:    { text: 'text-blue-600',    step: 'bg-blue-100 text-blue-700',       soft: 'hover:bg-blue-50/60',   btn: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
  position:    { text: 'text-violet-600',  step: 'bg-violet-100 text-violet-700',   soft: 'hover:bg-violet-50/50', btn: 'bg-violet-50 text-violet-700 hover:bg-violet-100' },
};

const CAP = 10; // names shown per group before collapsing into "+N more"

// The four pipeline stages, in order. Drives the top stepper and is the single
// place that declares the Watchlist → Draft & Review → Research → Position order.
const PIPELINE = [
  { key: 'watchlist',   icon: Eye,            label: 'Watchlist',       accent: ACCENT.watchlist },
  { key: 'draftReview', icon: MessagesSquare, label: 'Draft & Review',  accent: ACCENT.draftReview },
  { key: 'research',    icon: Search,         label: 'Research',        accent: ACCENT.research },
  { key: 'position',    icon: ClipboardList,  label: 'Position Review', accent: ACCENT.position },
];

// Short labels for the per-name research section pills (one per Research tab).
const STEP_LABEL = {
  fundamentals: 'Fundamentals', thesis: 'Thesis', diligence: 'Diligence',
  valuation: 'Valuation', review: 'Review', news: 'News', decision: 'Decision',
};

// ---- building blocks ------------------------------------------------------

// Horizontal stepper that makes the pipeline order obvious before the cards even
// load. Scrolls horizontally on narrow screens so the flow always reads left→right.
function PipelineStepper({ counts }) {
  return (
    <div className="mb-5 overflow-x-auto animate-fade-in-up">
      <div className="flex min-w-max items-center gap-0.5 rounded-2xl border border-gray-100 bg-white/70 px-2.5 py-2 shadow-sm sm:gap-1.5 sm:px-3">
        {PIPELINE.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && <ArrowRight size={14} className="shrink-0 text-gray-300" />}
            <div className="flex items-center gap-2 rounded-xl px-2 py-1.5">
              <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-extrabold tabular-nums ${s.accent.step}`}>{i + 1}</span>
              <s.icon size={14} className={s.accent.text} />
              <span className="whitespace-nowrap text-[12px] font-bold text-gray-700">{s.label}</span>
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-bold tabular-nums text-gray-500">{counts[s.key] ?? 0}</span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function StageCard({ icon: Icon, accent, title, subtitle, count, step, delay, headerRight, children }) {
  return (
    <Card className={`w-full min-w-0 self-stretch animate-fade-in-up ${delay}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-extrabold tabular-nums ${accent.step}`}>
          {step}
        </span>
        <Icon size={15} className={accent.text} />
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {count != null && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-bold tabular-nums text-gray-500">{count}</span>
        )}
        {headerRight && <div className="ml-auto">{headerRight}</div>}
      </div>
      <p className="ml-[2.1rem] mb-4 mt-1 text-[11px] text-gray-400">{subtitle}</p>
      {children}
    </Card>
  );
}

// Secondary "Move back" control — a neutral icon button (the backward move is the
// quiet option; the labelled accent button is always the primary forward step).
function BackBtn({ onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
    >
      <ArrowLeft size={13} />
    </button>
  );
}

// Neutral secondary action (e.g. "Open Review", "Open Research").
function GhostAction({ href, onClick, children }) {
  const cls = 'inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[11px] font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800';
  return href
    ? <Link href={href} className={cls}>{children}</Link>
    : <button onClick={onClick} className={cls}>{children}</button>;
}

// The single, soft-filled primary action that promotes a name to the next stage.
// `className` lets a call site add `ml-auto` to right-align it within a row.
function ForwardBtn({ href, onClick, accent, className = '', children }) {
  const cls = `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all ${accent.btn} ${className}`;
  return href
    ? <Link href={href} className={cls}>{children}<ArrowRight size={12} /></Link>
    : <button onClick={onClick} className={cls}>{children}<ArrowRight size={12} /></button>;
}

// Labelled status pill for one research section — colour reads progress at a glance.
function SectionPills({ steps }) {
  const tone = {
    done: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    todo: 'bg-gray-100 text-gray-400',
  };
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map(s => (
        <span
          key={s.key}
          title={`${STEP_LABEL[s.key] || s.label}${s.detail ? ` · ${s.detail}` : ''} — ${s.state === 'done' ? 'complete' : s.state === 'partial' ? 'in progress' : 'not started'}`}
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${tone[s.state]}`}
        >
          {STEP_LABEL[s.key] || s.label}
        </span>
      ))}
    </div>
  );
}

function EmptyHint({ icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 px-4 py-7 text-center">
      {Icon && <Icon size={18} className="text-gray-300" />}
      <p className="max-w-[15rem] text-[11px] leading-relaxed text-gray-400">{children}</p>
    </div>
  );
}

function MoreLink({ count, href }) {
  return (
    <Link href={href} className="flex w-fit items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600">
      +{count} more
    </Link>
  );
}

function ProgressRing({ percent, size = 34 }) {
  const deg = Math.max(0, Math.min(100, percent)) * 3.6;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(#3b82f6 ${deg}deg, #eef2f6 0deg)` }} />
      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white">
        <span className="text-[9px] font-bold leading-none tabular-nums text-gray-700">{percent}</span>
      </div>
    </div>
  );
}

// ---- position helpers -----------------------------------------------------

// Light, graceful status for a Position Review row. Prefers the underwriting verdict
// when a thesis exists; otherwise just "Monitoring". No cost basis is involved —
// Position Review is a pure pipeline stage with no link to the /holdings book.
function positionLabel(item, thesis) {
  const rating = thesis?.underwriting?.equityRating || 0;
  if (rating > 0) return { text: `Rated ${rating}/5`, className: 'font-semibold text-violet-600' };
  return { text: 'Monitoring', className: 'text-gray-400' };
}

// ---- page -----------------------------------------------------------------

export default function WorkflowPage() {
  const cache = useCache();
  const [watchlistData, setWatchlistData] = useState(() => cache.get('workflow_watchlist') || null);
  const [theses, setTheses] = useState(() => cache.get('workflow_theses') || {});
  const [loading, setLoading] = useState(() => !cache.get('workflow_watchlist'));
  const [selectedWl, setSelectedWl] = useState(null);

  // Load the two sources once (warm-start from cache). Position Review is driven
  // purely by the `position` pipeline stage; the portfolio is loaded only to run the
  // one-time backfill that turns any pre-existing holding into a pipeline stock so it
  // doesn't vanish when the holdings↔positions link is cut.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/watchlist').then(r => r.json()).catch(() => null),
      fetch('/api/portfolio').then(r => r.json()).catch(() => null),
    ]).then(async ([wl, pf]) => {
      if (!alive) return;
      let nextWl = wl;
      if (wl) {
        // Idempotent: only writes when a holding has no watchlist entry yet.
        try {
          const migrated = await persistHoldingsBackfill({ watchlistData: wl, holdings: pf?.holdings });
          if (migrated) nextWl = migrated;
        } catch {}
        if (!alive) return;
        setWatchlistData(nextWl);
        writeWatchlistCache(cache, nextWl);
      }
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

  const { watching, draftNames, researchNames, positionNames } = useMemo(() => {
    const stocks = (selectedWatchlist?.stocks || []).map(s => ({
      ...s, watchlistId: selectedWatchlist.id, watchlistName: selectedWatchlist.name,
    }));
    return {
      // 'researching' (old On Queue stage) is retired — fold leftovers into Watching.
      watching: stocks.filter(s => s.stage === 'watching' || s.stage === 'researching'),
      draftNames: stocks.filter(s => s.stage === 'draft'),
      researchNames: stocks.filter(s => s.stage === 'research'),
      positionNames: stocks.filter(s => s.stage === 'position'),
    };
  }, [selectedWatchlist]);

  // Pull a thesis for every deep-dive name (Draft & Review + Research + Position) so
  // we can score draft status, research progress and the position's underwriting verdict.
  useEffect(() => {
    const tickers = [...draftNames, ...researchNames, ...positionNames].map(s => s.ticker);
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
  }, [draftNames, researchNames, positionNames, theses, cache]);

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

  // Position Review is driven PURELY by the `position` pipeline stage — no link to the
  // portfolio holdings book. Every row is a real watchlist stock, so every row can be
  // demoted, and demoting truly removes it from here. Pre-existing holdings were turned
  // into `position` stocks by the one-time backfill above, so nothing disappeared.
  const positionItems = useMemo(() => (
    positionNames.map(s => ({ ticker: s.ticker, watchlistId: s.watchlistId }))
  ), [positionNames]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 pb-16 lg:px-12">
        <div className="skeleton mb-6 h-12 w-64 rounded-2xl" />
        <div className="skeleton mb-5 h-14 rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-44 rounded-3xl" />)}
        </div>
      </div>
    );
  }

  const hasAnything = watching.length || draftNames.length || researchNames.length || positionItems.length;

  const counts = {
    watchlist: watching.length,
    draftReview: draftNames.length,
    research: researchNames.length,
    position: positionItems.length,
  };

  // The watchlist scope selector — lives inside the Watchlist card header so it
  // reads as "List: <name>". Falls back to a static name chip when there's only one.
  const watchlistSelector = (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">List</span>
      {watchlists.length > 1 ? (
        <div className="relative">
          <select
            value={activeWlId || ''}
            onChange={e => setSelectedWl(e.target.value)}
            className="cursor-pointer appearance-none rounded-lg border border-emerald-200/70 bg-emerald-50/70 py-1 pl-2.5 pr-7 text-[11px] font-semibold text-emerald-700 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-emerald-500"
          >
            {watchlists.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500" />
        </div>
      ) : (
        <span className="rounded-lg border border-emerald-200/70 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          {selectedWatchlist?.name || 'My Watchlist'}
        </span>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 pb-16 lg:px-12">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Workflow</h1>
          <p className="mt-1 text-sm text-gray-500">One ordered pipeline — promote a name forward or send it back from any stage.</p>
        </div>
      </div>

      {!hasAnything ? (
        <Card className="py-20 text-center animate-fade-in-up stagger-2">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <Eye size={26} className="text-emerald-500" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-900">Nothing in the pipeline yet</h2>
          <p className="mx-auto max-w-md text-sm text-gray-500">
            Add tickers on the <Link href="/watchlist" className="font-semibold text-emerald-600 hover:underline">Watchlist</Link> to start the research journey.
          </p>
        </Card>
      ) : (
        <>
          {/* Pipeline order, made obvious before the cards */}
          <PipelineStepper counts={counts} />

          {/* 1 Watchlist · 2 Draft & Review · 3 Research · 4 Position Review */}
          <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
            {/* 1 — Watchlist */}
            <StageCard icon={Eye} accent={ACCENT.watchlist} title="Watchlist" subtitle="Tracked & triaged — promote a name straight into Draft & Review." count={watching.length} step={1} delay="stagger-1" headerRight={watchlistSelector}>
              {watching.length ? (
                <>
                  <div className="grid grid-cols-1 gap-1 xl:grid-cols-2">
                    {watching.slice(0, CAP).map(s => (
                      <div key={s.ticker} className={`group flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all ${ACCENT.watchlist.soft}`}>
                        <Link href="/watchlist" className="min-w-0">
                          <span className="block text-[13px] font-bold leading-tight text-gray-900">{s.ticker}</span>
                          <span className="text-[10px] font-medium text-gray-400">Watching</span>
                        </Link>
                        <ForwardBtn accent={ACCENT.draftReview} className="ml-auto" onClick={() => promote(s.ticker, s.watchlistId, 'draft')}>
                          Move to Draft
                        </ForwardBtn>
                      </div>
                    ))}
                  </div>
                  {watching.length > CAP && <div className="mt-1.5"><MoreLink count={watching.length - CAP} href="/watchlist" /></div>}
                </>
              ) : <EmptyHint icon={Eye}>No names on this watchlist yet. Add tickers on the Watchlist page to start the pipeline.</EmptyHint>}
            </StageCard>

            {/* 2 — Draft & Review */}
            <StageCard icon={MessagesSquare} accent={ACCENT.draftReview} title="Draft & Review" subtitle="Write the paper, run the reviewer back-and-forth — send to Research when ready." count={draftNames.length} step={2} delay="stagger-2">
              {draftNames.length ? (
                <div className="space-y-0.5">
                  {draftNames.slice(0, CAP).map(s => {
                    const st = draftReviewStatus(theses[s.ticker]);
                    const cl = checklistStatus(theses[s.ticker]);
                    return (
                      <div key={s.ticker} className={`group rounded-xl px-2.5 py-2 transition-all ${ACCENT.draftReview.soft}`}>
                        <div className="flex items-center gap-2.5">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${st.hasPaper ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                            <FileText size={13} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <Link href={`/draft-review?ticker=${s.ticker}`} className="text-[13px] font-bold text-gray-900 hover:text-gray-950">{s.ticker}</Link>
                            <p className="mt-0.5 truncate text-[10px] font-medium text-gray-400">
                              <span className={st.hasPaper ? 'font-semibold text-emerald-600' : 'text-gray-400'}>{st.hasPaper ? 'Drafted' : 'No draft yet'}</span>
                              {st.total > 0 && <> · {st.open} comment{st.open !== 1 ? 's' : ''} open</>}
                              {cl.total > 0 && <> · {cl.done}/{cl.total} checklist done</>}
                            </p>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 pl-9">
                          <BackBtn onClick={() => promote(s.ticker, s.watchlistId, 'watching')} title="Move back to Watchlist" />
                          <GhostAction href={`/draft-review?ticker=${s.ticker}`}>Open Review</GhostAction>
                          <ForwardBtn accent={ACCENT.research} className="ml-auto" onClick={() => promote(s.ticker, s.watchlistId, 'research')}>
                            Send to Research
                          </ForwardBtn>
                        </div>
                      </div>
                    );
                  })}
                  {draftNames.length > CAP && <MoreLink count={draftNames.length - CAP} href="/draft-review" />}
                </div>
              ) : <EmptyHint icon={MessagesSquare}>No names in Draft &amp; Review yet. Move a watchlist name into Draft to start a paper.</EmptyHint>}
            </StageCard>

            {/* 3 — Research */}
            <StageCard icon={Search} accent={ACCENT.research} title="Research" subtitle="Deep-dive underwriting across every section." count={researchNames.length} step={3} delay="stagger-3">
              {researchProgress.length ? (
                <div className="space-y-1">
                  {researchProgress.slice(0, CAP).map(({ ticker, watchlistId, progress }) => (
                    <div key={ticker} className={`group rounded-xl px-2.5 py-2 transition-all ${ACCENT.research.soft}`}>
                      <Link href={`/research?ticker=${ticker}`} className="flex w-full items-center gap-3">
                        <ProgressRing percent={progress.percent} />
                        <div className="min-w-0 flex-1">
                          <span className="text-[13px] font-bold text-gray-900">{ticker}</span>
                          <p className="mt-0.5 text-[10px] font-medium text-gray-400">Research sections: {progress.doneCount}/{progress.total} complete</p>
                        </div>
                      </Link>
                      <div className="mt-1.5 pl-1"><SectionPills steps={progress.steps} /></div>
                      <div className="mt-1.5 flex items-center gap-1">
                        <BackBtn onClick={() => promote(ticker, watchlistId, 'draft')} title="Move back to Draft & Review" />
                        <GhostAction href={`/research?ticker=${ticker}`}>Open Research</GhostAction>
                        <ForwardBtn accent={ACCENT.position} className="ml-auto" onClick={() => promote(ticker, watchlistId, 'position')}>
                          Promote to Position
                        </ForwardBtn>
                      </div>
                    </div>
                  ))}
                  {researchProgress.length > CAP && <MoreLink count={researchProgress.length - CAP} href="/research" />}
                </div>
              ) : <EmptyHint icon={Search}>No active research names. Send a draft into Research when ready.</EmptyHint>}
            </StageCard>

            {/* 4 — Position Review */}
            <StageCard icon={ClipboardList} accent={ACCENT.position} title="Position Review" subtitle="Names you now monitor — open one to review, or send it back to Research." count={positionItems.length} step={4} delay="stagger-4">
              {positionItems.length ? (
                <>
                  <div className="grid grid-cols-1 gap-1 xl:grid-cols-2">
                    {positionItems.slice(0, CAP).map(item => {
                      const ctx = positionLabel(item, theses[item.ticker]);
                      return (
                        <div key={item.ticker} className={`group flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 transition-all ${ACCENT.position.soft}`}>
                          <Link href={`/position-review?ticker=${item.ticker}`} className="min-w-0 flex-1">
                            <span className="block text-[13px] font-bold leading-tight text-gray-900">{item.ticker}</span>
                            <span className={`text-[10px] font-medium ${ctx.className}`}>{ctx.text}</span>
                          </Link>
                          <BackBtn onClick={() => promote(item.ticker, item.watchlistId, 'research')} title="Move back to Research" />
                          <ForwardBtn accent={ACCENT.position} href={`/position-review?ticker=${item.ticker}`}>
                            Open Review
                          </ForwardBtn>
                        </div>
                      );
                    })}
                  </div>
                  {positionItems.length > CAP && <div className="mt-1.5"><MoreLink count={positionItems.length - CAP} href="/position-review" /></div>}
                </>
              ) : <EmptyHint icon={ClipboardList}>No positions yet. Promote a researched name into Position to monitor it here.</EmptyHint>}
            </StageCard>
          </div>
        </>
      )}
    </div>
  );
}
