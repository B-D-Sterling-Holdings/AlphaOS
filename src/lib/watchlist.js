import { getDb } from './db';
import { versionedWrite, versionOf, VersionConflictError } from './concurrency';

const DEFAULT_WATCHLIST = {
  watchlists: [
    { id: 'default', name: 'My Watchlist', stocks: [] }
  ],
  activeWatchlistId: 'default',
};

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

export async function loadWatchlist() {
  const supabase = await getDb();
  const [{ data: watchlists, error: wErr }, { data: setting, error: sErr }] = await Promise.all([
    supabase.from('watchlists').select('*'),
    supabase.from('app_settings').select('value').eq('key', 'activeWatchlistId').single(),
  ]);

  if (wErr || !watchlists || watchlists.length === 0) {
    return { ...DEFAULT_WATCHLIST, watchlists: [{ ...DEFAULT_WATCHLIST.watchlists[0] }] };
  }

  return {
    watchlists: watchlists.map(w => ({
      id: w.id,
      name: w.name,
      stocks: orderStocks(w.stocks || []),
      version: versionOf(w), // optimistic-concurrency token (migration 030)
    })),
    activeWatchlistId: setting?.value || 'default',
  };
}

export async function saveWatchlist(data) {
  const supabase = await getDb();
  const { watchlists, activeWatchlistId } = data;

  // Get existing watchlist IDs
  const { data: existing } = await supabase.from('watchlists').select('id');
  const existingIds = new Set((existing || []).map(w => w.id));
  const newIds = new Set(watchlists.map(w => w.id));

  // Delete removed watchlists
  const toDelete = [...existingIds].filter(id => !newIds.has(id));
  if (toDelete.length > 0) {
    await supabase.from('watchlists').delete().in('id', toDelete);
  }

  // Upsert each list under its own optimistic-concurrency guard. Two people
  // editing the same watchlist (or one in two tabs) would otherwise clobber each
  // other's stocks array. `w.version` is the token the client loaded; a stale one
  // trips VersionConflictError, which we re-raise carrying the fresh full state so
  // the route can hand it back (409) for the caller to reconcile. New lists have
  // no version (undefined) and take the plain-insert/legacy path.
  //
  // Each write returns the persisted row carrying its freshly-bumped `version`. We
  // collect them so the caller can echo the new tokens back to the client — without
  // that, the client keeps sending the version it first loaded and its NEXT save
  // trips a false conflict against the row it just advanced.
  const versions = [];
  for (const w of watchlists) {
    try {
      const row = await versionedWrite(supabase, 'watchlists', {
        match: { id: w.id },
        values: { name: w.name, stocks: orderStocks(w.stocks || []) },
        baseVersion: w.version,
        onConflict: 'tenant_id,id',
      });
      if (row && typeof row.version === 'number') {
        versions.push({ id: w.id, version: row.version });
      }
    } catch (e) {
      if (e instanceof VersionConflictError) {
        throw new VersionConflictError(await loadWatchlist());
      }
      throw e;
    }
  }

  // The active-list pointer is a single scalar with no real contention — a plain
  // upsert is fine (nobody loses stock data if it races).
  await supabase.from('app_settings').upsert({
    key: 'activeWatchlistId',
    value: activeWatchlistId || 'default',
  }, { onConflict: 'tenant_id,key' });

  return { versions };
}
