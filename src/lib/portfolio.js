import { getDb } from './db';
import { readSetting, writeSetting } from './appSettings';

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
    })),
    cash: Number(cashCfg?.cash) || 0,
  };
}

export async function addHolding(ticker, shares, costBasis) {
  const supabase = await getDb();
  const upper = ticker.trim().toUpperCase();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('holdings')
    .upsert({
      ticker: upper,
      shares,
      cost_basis: costBasis,
      updated_at: now,
    }, { onConflict: 'tenant_id,ticker' });

  if (error) throw new Error(error.message);
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
