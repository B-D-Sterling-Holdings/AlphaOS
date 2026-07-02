import 'server-only';
import { supabaseAdmin } from './supabaseAdmin.js';
import { buildDemoDataset } from './demoData.js';

/*
  Demo tenant reset.

  The `demo` login lives in the users table like any other account, but its
  tenant is the reserved Demo tenant below and its users row has is_demo=true.
  On every successful demo login the login route calls resetDemoTenant(): all
  of the tenant's rows are wiped and re-seeded from the canonical dataset in
  demoData.js. Editing works normally inside a session (it's a real tenant
  behind real RLS) — the changes just never survive to the next login.

  Safety: this module refuses to touch any tenant whose tenants row does not
  say is_demo=true, so a config mistake can never wipe a real workspace.

  Note: stray storage objects a demo user uploads are NOT purged here (their
  DB rows are, so they become unreachable). Keeps the reset fast; run
  deleteUser-style cleanup manually if the demo bucket prefix ever bloats.
*/

export const DEMO_TENANT_ID = '22222222-2222-2222-2222-222222222222';

// Every tenant-scoped table, children before parents (delete order).
const DEMO_TABLES = [
  'interactions', 'contact_files', 'contacts',
  'tasks', 'app_settings', 'research_links', 'documents',
  'theses', 'valuation_models', 'holdings', 'portfolio_cash', 'watchlists',
  'ticker_fundamentals', 'ticker_prices',
  'allocation_config', 'sector_config', 'factor_config', 'fund_nav_data',
  'strategic_notes', 'candidate_positions', 'ideas',
  'prism_recommendations', 'prism_ticker_data', 'prism_ticker_documents',
  'macro_regime_results', 'macro_regime_runs', 'macro_regime_config', 'macro_regime_weights',
  'lessons', 'lesson_patterns',
];

const QUOTE_TIMEOUT_MS = 4000;
const MIN_RESET_INTERVAL_MS = 20_000;

let inFlight = null;
let lastResetAt = 0;

/**
 * Best-effort live quotes so the synthetic price history ends at real prices
 * (holdings P&L and the financials charts then agree with live data). Any
 * failure falls back to the dataset's built-in anchor prices.
 */
async function fetchLiveQuotes(tickers) {
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yahoo = new YahooFinance({ suppressNotices: ['ripHistorical'] });
    const quotes = await Promise.race([
      yahoo.quote(tickers),
      new Promise((resolve) => setTimeout(() => resolve(null), QUOTE_TIMEOUT_MS)),
    ]);
    if (!Array.isArray(quotes)) return {};
    const out = {};
    for (const q2 of quotes) {
      if (q2?.symbol && q2?.regularMarketPrice > 0) out[q2.symbol] = q2.regularMarketPrice;
    }
    return out;
  } catch {
    return {};
  }
}

async function assertDemoTenant(tenantId) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, is_demo')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`demo reset: tenant lookup failed: ${error.message}`);
  if (!data) throw new Error('demo reset: demo tenant does not exist — run scripts/provision-demo.mjs');
  if (data.is_demo !== true) {
    throw new Error(`demo reset: refusing to reset tenant ${tenantId} — tenants.is_demo is not true`);
  }
}

async function wipeTable(table) {
  const { error } = await supabaseAdmin.from(table).delete().eq('tenant_id', DEMO_TENANT_ID);
  // tolerate tables missing in a given deployment (same policy as deleteUser)
  if (error && error.code !== '42P01' && !/does not exist/i.test(error.message)) {
    throw new Error(`demo reset: wipe ${table}: ${error.message}`);
  }
}

async function wipeDemoRows() {
  // FK children first (contacts cascades would race parallel deletes),
  // then everything else concurrently.
  await wipeTable('interactions');
  await wipeTable('contact_files');
  await Promise.all(
    DEMO_TABLES.filter((t) => t !== 'interactions' && t !== 'contact_files').map(wipeTable)
  );
}

// Insert with tenant stamping, chunking, and drift tolerance: if the live DB
// lacks a column the dataset sets (deployments drift from scripts/*.sql), strip
// that column and retry instead of failing the whole reset.
async function insertRows(table, rows, select = null) {
  if (!rows?.length) return [];
  let stamped = rows.map((r) => ({ ...r, tenant_id: DEMO_TENANT_ID }));
  const out = [];
  for (let i = 0; i < stamped.length; i += 400) {
    for (let attempt = 0; ; attempt++) {
      const chunk = stamped.slice(i, i + 400);
      let query = supabaseAdmin.from(table).insert(chunk);
      if (select) query = query.select(select);
      const { data, error } = await query;
      if (!error) { if (data) out.push(...data); break; }
      const missing = attempt < 8 && /Could not find the '([^']+)' column/.exec(error.message)?.[1];
      if (!missing) throw new Error(`demo reset: insert ${table}: ${error.message}`);
      stamped = stamped.map((r) => { const { [missing]: _drop, ...rest } = r; return rest; });
    }
  }
  return out;
}

// Bulk insert, falling back to row-by-row on duplicate-key errors. Legacy
// global uniques (pre-migration-009 DBs: theses PK on ticker, fund_nav_data
// UNIQUE(date), …) collide with rows other tenants own — those rows are
// skipped with a warning instead of failing the whole reset. Migration 009
// lifts the collisions.
async function insertRowsTolerant(table, rows) {
  if (!rows?.length) return;
  try {
    await insertRows(table, rows);
    return;
  } catch (err) {
    if (!/duplicate key/i.test(err.message)) throw err;
  }
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    // Once everything is colliding (e.g. every fund_nav_data date is taken),
    // stop probing row by row — the rest of the table will collide too.
    if (skipped >= 25 && inserted === 0) { skipped = rows.length - inserted; break; }
    try {
      await insertRows(table, [row]);
      inserted += 1;
    } catch (err) {
      if (!/duplicate key/i.test(err.message)) throw err;
      skipped += 1;
    }
  }
  console.warn(`[demo] ${table}: ${skipped}/${rows.length} rows skipped — cross-tenant unique collision (run migration 009 to lift)`);
}

// Upload the demo document PDFs (deterministic paths, so re-seeding overwrites
// in place) and fill each documents row's storage_path/url.
async function uploadDocuments(documents) {
  await Promise.all(documents.map(async (doc) => {
    const { label, bytes, category } = doc._upload;
    delete doc._upload;
    const slug = label.replace(/[^a-z0-9]+/gi, '-');
    const path = `${DEMO_TENANT_ID}/${category}/${slug}.pdf`;
    const { error } = await supabaseAdmin.storage
      .from('documents')
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (error) throw new Error(`demo reset: upload ${path}: ${error.message}`);
    doc.storage_path = path;
    doc.url = supabaseAdmin.storage.from('documents').getPublicUrl(path).data.publicUrl;
  }));
}

async function performReset() {
  await assertDemoTenant(DEMO_TENANT_ID);

  const dataset = buildDemoDataset({
    now: new Date(),
    quotes: await fetchLiveQuotes([
      'AAPL', 'MSFT', 'AVGO', 'TSM', 'V', 'SPOT', 'DASH', 'COST', 'LLY', 'ISRG',
      'MCO', 'MELI', 'PYPL',
    ]),
  });

  await Promise.all([uploadDocuments(dataset.documents), wipeDemoRows()]);

  // In the deployed DB, ticker_prices/ticker_fundamentals may still be keyed
  // on (ticker, data_type) WITHOUT tenant_id (fixed by migration 009). Until
  // that runs, a pair another tenant already stores can't also exist for the
  // demo — drop those rows up front rather than fail (never touch the other
  // tenant's data). Post-009 nothing matches the filter, so nothing is lost.
  await Promise.all(['ticker_prices', 'ticker_fundamentals'].map(async (table) => {
    const tickers = [...new Set(dataset[table].map((r) => r.ticker))];
    const { data: existing, error } = await supabaseAdmin
      .from(table)
      .select('ticker, data_type')
      .in('ticker', tickers)
      .neq('tenant_id', DEMO_TENANT_ID);
    if (error) throw new Error(`demo reset: scan ${table}: ${error.message}`);
    if (existing?.length) {
      const taken = new Set(existing.map((r) => `${r.ticker}|${r.data_type}`));
      dataset[table] = dataset[table].filter((r) => !taken.has(`${r.ticker}|${r.data_type}`));
      console.warn(`[demo] ${table}: skipped ${taken.size} pairs owned by another tenant (run migration 009 to lift this)`);
    }
  }));

  // Referenced-before-referencing rows first (contacts feed interactions and
  // contact_files; the completed run row feeds macro_regime_results.run_id),
  // then every remaining table concurrently.
  const first = ['contacts', 'macro_regime_runs'];
  const [, runRows] = await Promise.all([
    insertRows('contacts', dataset.contacts),
    insertRows('macro_regime_runs', dataset.macro_regime_runs, 'id, run_type'),
  ]);
  const runRow = runRows.find((r) => r.run_type === 'run');
  if (runRow) {
    for (const res of dataset.macro_regime_results) res.run_id = runRow.id;
  }
  await Promise.all(
    Object.entries(dataset)
      .filter(([table]) => !first.includes(table))
      .map(([table, rows]) => insertRowsTolerant(table, rows))
  );

  lastResetAt = Date.now();
}

/**
 * Wipe + re-seed the demo tenant. Coalesces concurrent calls and skips resets
 * within MIN_RESET_INTERVAL_MS of the last one (double-submit protection).
 */
export async function resetDemoTenant({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastResetAt < MIN_RESET_INTERVAL_MS) return;
  inFlight = performReset().finally(() => { inFlight = null; });
  return inFlight;
}
