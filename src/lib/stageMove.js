// Single source of truth for moving a watchlist name between pipeline stages.
//
// Pipeline order is Watchlist → Draft & Review → Research → Position Review. The
// `stage` enum is: `watching` → `draft` → `research` → `position`. Position Review
// is a real pipeline stage that lives on the watchlist stock — it is NOT the
// portfolio holdings table (that stays the actual book on /holdings). Promoting a
// researched name just flips its stage to `position`, and it can be sent back to
// Research at any time with no loss of work.
//
// The cardinal rule (every page that moves a name must obey it): moving a name
// between stages NEVER destroys data. A stage move only flips `stock.stage`; every
// other store keyed by ticker — the watchlist stock fields, the thesis
// (researchWorkspace, draftReview, valuation, …) — is left untouched and survives
// demote → re-promote in either direction. The one place data *could* be lost is
// seeding the research workspace on entry to Research, so that seed is strictly
// one-time: it only fills an EMPTY workspace and never overwrites existing work.

export const STAGES = ['watching', 'draft', 'research', 'position'];

// Every page that renders the watchlist caches the same /api/watchlist payload, but
// under its own key (the Watchlist, Draft & Review, Research and Workflow pages each
// picked their own). A stage move — or any watchlist edit — on one page must refresh
// ALL of them, otherwise a name promoted/demoted on one page stays stale on the
// others until a full reload clears the in-memory cache. Write through this helper.
export const WATCHLIST_CACHE_KEYS = ['watchlist_data', 'deep_research_watchlist', 'workflow_watchlist'];

export function writeWatchlistCache(cache, data) {
  if (!cache?.set || !data) return;
  for (const key of WATCHLIST_CACHE_KEYS) cache.set(key, data);
}

export const STAGE_LABELS = {
  watching: 'Watchlist',
  draft: 'Draft & Review',
  research: 'Research',
  position: 'Position Review',
};

// Each pipeline stage lives on its own page/tab. Promoting or demoting a name should
// carry the analyst along to the destination tab with the same name focused, so the
// pipeline reads as one continuous flow rather than a name vanishing from the current
// tab. Every one of these pages honors a `?ticker=XYZ` deep link.
export const STAGE_ROUTES = {
  watching: '/watchlist',
  draft: '/draft-review',
  research: '/research',
  position: '/position-review',
};

// Build the destination URL for a stage move, pre-selecting the moved name.
export function routeForStage(stage, ticker) {
  const path = STAGE_ROUTES[stage];
  if (!path) return null;
  return ticker ? `${path}?ticker=${encodeURIComponent(ticker)}` : path;
}

// Normalize the legacy/retired `researching` stage into `watching`.
export function normalizeStage(stage) {
  return stage === 'researching' ? 'watching' : (stage || 'watching');
}

// Accept legacy string items or partial objects and produce the canonical
// question shape used by the research workspace.
function normalizeQuestionItems(items) {
  return (items || []).map(item => {
    if (typeof item === 'string') {
      return { text: item, done: false, answer: '', subQuestions: [] };
    }
    return {
      text: item?.text || '',
      done: !!item?.done,
      answer: item?.answer ?? '',
      subQuestions: (item?.subQuestions || []).map(sq => ({
        text: sq?.text || '',
        done: !!sq?.done,
        answer: sq?.answer ?? '',
      })),
    };
  });
}

// True when the research workspace already holds analyst work worth keeping.
export function workspaceHasContent(ws) {
  return !!ws && Boolean(
    (typeof ws.note === 'string' ? ws.note.trim() : ws.note) ||
    Object.values(ws.fundamentals || {}).some(Boolean) ||
    (ws.dueDiligenceItems || []).length ||
    (ws.dislocationItems || []).length
  );
}

// Pure: return a copy of the watchlist payload with one stock's stage changed.
export function withStageChange(watchlistData, watchlistId, ticker, newStage) {
  return {
    ...watchlistData,
    watchlists: (watchlistData?.watchlists || []).map(w =>
      w.id === watchlistId
        ? { ...w, stocks: (w.stocks || []).map(s => s.ticker === ticker ? { ...s, stage: newStage } : s) }
        : w
    ),
  };
}

// One-time seed of the research workspace from the watchlist stock. Returns the
// thesis as persisted (unchanged when the workspace already had content).
async function seedResearchWorkspace(ticker, stock) {
  const thesis = await fetch(`/api/thesis/${ticker}`).then(r => r.json());
  if (workspaceHasContent(thesis?.underwriting?.researchWorkspace)) return thesis;
  const updated = {
    ...thesis,
    underwriting: {
      ...(thesis?.underwriting || {}),
      researchWorkspace: {
        note: stock?.note || '',
        fundamentals: {
          revenueGrowth: stock?.fundamentals?.revenueGrowth || '',
          profitability: stock?.fundamentals?.profitability || '',
          capitalReturn: stock?.fundamentals?.capitalReturn || '',
          misc: stock?.fundamentals?.misc || '',
        },
        dueDiligenceItems: normalizeQuestionItems(stock?.dueDiligenceItems || []),
        dislocationItems: normalizeQuestionItems(stock?.dislocationItems || []),
      },
    },
  };
  // Guard the seed on the version we just read so it never clobbers a concurrent
  // save of the same thesis (the write is a no-op-if-conflicting compare-and-swap;
  // losing here is fine — the seed only fills an empty workspace).
  await fetch(`/api/thesis/${ticker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updated, baseVersion: thesis?.version }),
  });
  return updated;
}

/**
 * POST a full watchlist payload. On an optimistic-concurrency conflict the server
 * returns 409 with the fresh watchlist (`{ conflict, current }`); otherwise
 * `{ ok }`. Exported so every watchlist writer shares one conflict-aware path.
 */
export async function postWatchlist(payload) {
  const res = await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    return { conflict: true, current: data.current || null };
  }
  return { conflict: false, ok: res.ok };
}

/**
 * Persist a stage move for one name. Flips `stage` on the watchlist and, when the
 * name enters Research, seeds the research workspace exactly once (never clobbers
 * existing research). Callers should optimistically update their own state with the
 * returned `next` payload and refresh any thesis cache from the returned `thesis`.
 *
 * Conflict-safe: if a teammate saved the watchlist first, we re-apply this single
 * stage flip on top of their fresh state and retry — so the teammate's concurrent
 * change (e.g. moving a different name) is preserved, not overwritten.
 *
 * @returns {Promise<{ next: object, thesis: object|null }>}
 */
export async function persistStageMove({ watchlistData, watchlistId, ticker, newStage }) {
  let base = watchlistData;
  let next = withStageChange(base, watchlistId, ticker, newStage);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await postWatchlist(next);
    if (!res.conflict) break;
    base = res.current || base;                                   // adopt teammate's fresh state…
    next = withStageChange(base, watchlistId, ticker, newStage);  // …re-apply our flip on top
  }
  let thesis = null;
  if (newStage === 'research') {
    const stock = (watchlistData?.watchlists || [])
      .find(w => w.id === watchlistId)?.stocks?.find(s => s.ticker === ticker);
    if (stock) {
      try { thesis = await seedResearchWorkspace(ticker, stock); } catch {}
    }
  }
  return { next, thesis };
}

// Position Review is driven PURELY by the pipeline (`stage === 'position'` watchlist
// stocks) — it has no link to the live portfolio `holdings` book. To keep existing
// names from vanishing when that link is cut, this one-time idempotent backfill
// represents every real holding as a pipeline stock at `stage: 'position'`, exactly
// as if it had been added through the pipeline from the start.
//
// It ONLY adds tickers that aren't on ANY watchlist yet (at any stage), so:
//   - a name later demoted out of Position Review is never silently re-added, and
//   - nothing is ever deleted — the `holdings` table is independent and untouched.
// Returns the next watchlist payload, or null when nothing needs migrating.
export function withHoldingsBackfilled(watchlistData, holdings) {
  const watchlists = watchlistData?.watchlists || [];
  if (!watchlists.length) return null;
  const known = new Set(watchlists.flatMap(w => (w.stocks || []).map(s => s.ticker)));
  const missing = [...new Set((holdings || []).map(h => h?.ticker).filter(Boolean))]
    .filter(ticker => !known.has(ticker));
  if (!missing.length) return null;
  const targetId = watchlists.some(w => w.id === watchlistData?.activeWatchlistId)
    ? watchlistData.activeWatchlistId
    : watchlists[0].id;
  return {
    ...watchlistData,
    watchlists: watchlists.map(w =>
      w.id === targetId
        ? { ...w, stocks: [...(w.stocks || []), ...missing.map(ticker => ({ ticker, stage: 'position' }))] }
        : w
    ),
  };
}

// Persist the holdings backfill. Returns the next payload (so callers can update
// their state/cache), or null when there was nothing to migrate. Conflict-safe:
// re-derives the backfill against the server's fresh state on a version conflict.
export async function persistHoldingsBackfill({ watchlistData, holdings }) {
  let base = watchlistData;
  let next = withHoldingsBackfilled(base, holdings);
  if (!next) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await postWatchlist(next);
    if (!res.conflict) break;
    base = res.current || base;
    next = withHoldingsBackfilled(base, holdings);
    if (!next) return base; // everything already present after adopting server state
  }
  return next;
}
