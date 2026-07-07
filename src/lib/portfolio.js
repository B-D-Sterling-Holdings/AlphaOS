import { getDb } from './db';
import { readSetting, writeSetting } from './appSettings';
import { versionedWrite, versionOf } from './concurrency';

// Per-tenant cash lives in app_settings under this key: { cash: <number> }.
const CASH_KEY = 'portfolio_cash';

export async function loadPortfolio() {
  const supabase = await getDb();
  const [{ data: holdings, error: hErr }, cashCfg] = await Promise.all([
    supabase.from('holdings').select('*').order('added_at'),
    readSetting(supabase, CASH_KEY, { cash: 0 }),
  ]);

  if (hErr) throw new Error(hErr.message);

  return {
    holdings: (holdings || []).map(h => ({
      ticker: h.ticker,
      shares: Number(h.shares),
      cost_basis: Number(h.cost_basis),
      added_at: h.added_at,
      updated_at: h.updated_at,
      version: versionOf(h), // optimistic-concurrency token for in-place edits
    })),
    cash: Number(cashCfg?.cash) || 0,
  };
}

// Add a new holding or overwrite an existing one (upsert by ticker). When editing
// an existing position the caller passes the `baseVersion` it loaded, so a stale
// edit throws VersionConflictError (surfaced as 409) instead of silently
// overwriting a concurrent change to the same ticker. A brand-new ticker has no
// version and takes the plain insert path.
export async function addHolding(ticker, shares, costBasis, baseVersion) {
  const supabase = await getDb();
  const upper = ticker.trim().toUpperCase();
  const now = new Date().toISOString();

  await versionedWrite(supabase, 'holdings', {
    match: { ticker: upper },
    values: { shares, cost_basis: costBasis, updated_at: now },
    baseVersion,
    onConflict: 'tenant_id,ticker',
  });

  return loadPortfolio();
}

export async function removeHolding(ticker) {
  const supabase = await getDb();
  const upper = ticker.trim().toUpperCase();

  const { error } = await supabase
    .from('holdings')
    .delete()
    .eq('ticker', upper);

  if (error) throw new Error(error.message);
  return loadPortfolio();
}

export async function updateCash(cash) {
  const supabase = await getDb();
  await writeSetting(supabase, CASH_KEY, { cash: Number(cash) || 0 });
  return loadPortfolio();
}
