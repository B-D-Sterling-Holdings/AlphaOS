import { getDb } from './db';

export async function loadPortfolio() {
  const supabase = await getDb();
  const [{ data: holdings, error: hErr }, { data: cashRow, error: cErr }] = await Promise.all([
    supabase.from('holdings').select('*').order('added_at'),
    supabase.from('portfolio_cash').select('cash').eq('id', 1).single(),
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
    cash: Number(cashRow?.cash) || 0,
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
    }, { onConflict: 'ticker' });

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
  const { error } = await supabase
    .from('portfolio_cash')
    .update({ cash: Number(cash) || 0 })
    .eq('id', 1);

  if (error) throw new Error(error.message);
  return loadPortfolio();
}
