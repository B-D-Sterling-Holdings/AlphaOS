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
  await fetch(`/api/thesis/${ticker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updated),
  });
  return updated;
}

/**
 * Persist a stage move for one name. Flips `stage` on the watchlist and, when the
 * name enters Research, seeds the research workspace exactly once (never clobbers
 * existing research). Callers should optimistically update their own state with the
 * returned `next` payload and refresh any thesis cache from the returned `thesis`.
 *
 * @returns {Promise<{ next: object, thesis: object|null }>}
 */
export async function persistStageMove({ watchlistData, watchlistId, ticker, newStage }) {
  const next = withStageChange(watchlistData, watchlistId, ticker, newStage);
  await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
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
// their state/cache), or null when there was nothing to migrate.
export async function persistHoldingsBackfill({ watchlistData, holdings }) {
  const next = withHoldingsBackfilled(watchlistData, holdings);
  if (!next) return null;
  await fetch('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  return next;
}
