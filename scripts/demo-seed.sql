-- ============================================================
-- DEMO SEED — realistic dummy data for the isolated demo account
-- Run in the Supabase SQL Editor AFTER scripts/demo-schema.sql.
--
-- Writes ONLY to demo_* tables. Re-runnable: it wipes existing demo data first
-- (demo tables only — production tables are never touched).
-- ============================================================

-- ── Wipe demo data only (safe: these are demo-exclusive tables) ──────────────
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'demo_interactions','demo_contact_files','demo_contacts','demo_tasks','demo_ideas',
    'demo_holdings','demo_watchlists','demo_research_links','demo_theses',
    'demo_valuation_models','demo_strategic_notes','demo_fund_nav_data',
    'demo_ticker_fundamentals','demo_ticker_prices','demo_macro_regime_results',
    'demo_macro_regime_runs','demo_prism_recommendations','demo_prism_runs'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE %I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;
END $$;


-- ── Portfolio: holdings + cash ───────────────────────────────────────────────
INSERT INTO demo_holdings (ticker, shares, cost_basis) VALUES
  ('AAPL',  1200, 165.00),
  ('MSFT',   600, 330.00),
  ('NVDA',   900,  78.00),
  ('GOOGL',  800, 138.00),
  ('AMZN',   700, 145.00),
  ('META',   350, 360.00),
  ('AVGO',   250, 950.00),
  ('JPM',    500, 175.00);

UPDATE demo_portfolio_cash SET cash = 185000 WHERE id = 1;


-- ── Fund NAV curve (fund vs S&P 500), trailing 13 months ─────────────────────
INSERT INTO demo_fund_nav_data (date, fund_nav, sp500_nav) VALUES
  ('2025-06-01', 100.0, 100.0),
  ('2025-07-01', 102.3, 101.2),
  ('2025-08-01', 101.1,  99.5),
  ('2025-09-01', 104.8, 102.0),
  ('2025-10-01', 108.2, 104.6),
  ('2025-11-01', 111.5, 107.1),
  ('2025-12-01', 113.9, 108.8),
  ('2026-01-01', 116.2, 110.0),
  ('2026-02-01', 114.0, 108.2),
  ('2026-03-01', 118.7, 111.5),
  ('2026-04-01', 122.3, 113.9),
  ('2026-05-01', 125.6, 116.7),
  ('2026-06-01', 128.4, 118.9);


-- ── Watchlist ────────────────────────────────────────────────────────────────
INSERT INTO demo_watchlists (id, name, stocks) VALUES
  ('default', 'Demo Watchlist',
   '[{"ticker":"TSLA","position":0},{"ticker":"AMD","position":1},{"ticker":"COST","position":2},{"ticker":"LLY","position":3},{"ticker":"V","position":4}]'::jsonb);


-- ── Tasks (Main Board) ───────────────────────────────────────────────────────
INSERT INTO demo_tasks (title, priority, done, notes, assignee, status, position, board_id, subtasks) VALUES
  ('Refresh NVDA thesis after earnings', 'high',   false, 'Update underwriting + DC capex assumptions', 'PM',      'in_progress', 0, 'default', '[{"text":"Pull Q1 transcript","done":true},{"text":"Revisit FCF bridge","done":false}]'::jsonb),
  ('Trim AVGO into strength',            'high',   false, 'Position > 8% of book',                       'CIO',     '',            1, 'default', '[]'::jsonb),
  ('Review fund NAV reconciliation',     'medium', false, 'Tie out May statement vs custodian',          'Ops',     '',            2, 'default', '[]'::jsonb),
  ('Schedule call with banking contact', 'medium', false, '',                                            'IR',      '',            3, 'default', '[]'::jsonb),
  ('Read AMZN AWS margin note',          'low',    false, 'In research queue',                           'Analyst', '',            4, 'default', '[]'::jsonb),
  ('Archive Q4 board deck',              'low',    true,  '',                                            'Ops',     '',            5, 'default', '[]'::jsonb);


-- ── CRM: contacts + interactions ─────────────────────────────────────────────
INSERT INTO demo_contacts (id, name, company, role, relationship_type, status, relationship_strength, importance, summary, next_action, city, notes) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Jordan Avery',  'Northbridge Securities', 'Sell-side Analyst', 'broker',   'active', 'strong',  4, 'Semis coverage; useful on NVDA/AVGO supply checks', 'Set up Q2 supply-chain call', 'New York',     'Prefers email'),
  ('a2222222-2222-2222-2222-222222222222', 'Priya Nair',    'Lakeshore Capital',      'Allocator',         'investor', 'active', 'building',5, 'Family office LP; evaluating a follow-on',          'Send updated tear sheet',     'Chicago',      'Met at Q1 conference'),
  ('a3333333-3333-3333-3333-333333333333', 'Marcus Webb',   'Cedar Audit LLP',        'Auditor',           'service',  'active', 'strong',  3, 'Annual fund audit lead',                            'Confirm year-end timeline',   'Boston',       ''),
  ('a4444444-4444-4444-4444-444444444444', 'Sofia Marin',   'Bridge Prime',           'Prime Broker',      'broker',   'active', 'strong',  4, 'Financing + securities lending desk',               'Review margin terms',         'San Francisco','');

INSERT INTO demo_interactions (contact_id, type, summary, next_step, date) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'call', 'Discussed datacenter GPU lead times; still tight into H2', 'Get updated channel checks', now() - interval '6 days'),
  ('a2222222-2222-2222-2222-222222222222', 'meeting', 'Walked through performance + risk framework', 'Share monthly letter', now() - interval '12 days'),
  ('a2222222-2222-2222-2222-222222222222', 'email', 'Sent NAV history and fee terms', '', now() - interval '3 days'),
  ('a4444444-4444-4444-4444-444444444444', 'note', 'Renegotiated stock-loan rates on large caps', 'Document new terms', now() - interval '20 days');


-- ── Ideas (workspace sticky notes) ───────────────────────────────────────────
INSERT INTO demo_ideas (title, content, color, category, pinned, position) VALUES
  ('Watch credit spreads',     'IG/HY spreads widening modestly — flag for risk overlay.', 'orange', 'note',     true,  0),
  ('AI capex durability',      'Is hyperscaler capex a 2-yr or 5-yr cycle? Key to NVDA/AVGO sizing.', 'blue',   'question', false, 1),
  ('Add staple hedge?',        'Consider COST/PG to dampen drawdowns if regime flips to RISK OFF.',   'green',  'idea',     false, 2),
  ('Rebalance reminder',       'Trim positions above 8% target weight at month end.',                 'yellow', 'todo',     false, 3);


-- ── Strategic notes (per-position CIO annotations) ───────────────────────────
INSERT INTO demo_strategic_notes (ticker, sentiment, conviction, action, action_reason, notes, expected_return, target_weight, priority, sort_order) VALUES
  ('NVDA', 'bullish', 5, 'hold', 'Core AI compute position', 'Underwriting hinges on datacenter capex durability', 18.0, 8.0, 'high',   0),
  ('AAPL', 'neutral', 4, 'hold', 'Steady cash compounder',   'Watch services growth and China demand',            9.0, 10.0, 'normal', 1),
  ('AVGO', 'bullish', 4, 'trim', 'Position above target',     'Strong AI + VMware synergy, but size discipline',   12.0, 6.0, 'high',   2),
  ('JPM',  'bullish', 3, 'add',  'Best-in-class bank',        'Beneficiary of higher-for-longer rates',            11.0, 5.0, 'normal', 3);


-- ── Theses ───────────────────────────────────────────────────────────────────
INSERT INTO demo_theses (ticker, core_reasons, assumptions, valuation, underwriting, news_updates, todos, notes) VALUES
  ('NVDA',
   '["Dominant AI training/inference compute","CUDA software moat","Datacenter capex supercycle"]'::jsonb,
   'Datacenter revenue compounds >25% for 3 years; gross margins hold ~72%.',
   'Base case ~30x forward earnings on FY27 EPS.',
   '{"bull":"Sovereign + enterprise AI broadens demand","bear":"Capex digestion / custom silicon share loss"}'::jsonb,
   '[{"date":"2026-05-22","note":"Q1 beat; guided datacenter up sequentially"}]'::jsonb,
   '[{"text":"Refresh FCF bridge","done":false}]'::jsonb,
   '{"links":[],"content":[]}'::jsonb),
  ('AAPL',
   '["Installed base + services flywheel","Premium brand pricing power","Capital return"]'::jsonb,
   'Services grows low-double-digits; iPhone units flattish.',
   '~28x forward earnings; quality premium justified.',
   '{"bull":"AI features drive upgrade cycle","bear":"Regulatory pressure on App Store"}'::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   '{"links":[],"content":[]}'::jsonb);


-- ── Valuation model (AAPL) ───────────────────────────────────────────────────
INSERT INTO demo_valuation_models (ticker, inputs) VALUES
  ('AAPL', '{"revenue_growth":0.06,"operating_margin":0.31,"discount_rate":0.085,"terminal_growth":0.025,"shares_outstanding":15200}'::jsonb);


-- ── Sector config (labels + colors) ──────────────────────────────────────────
UPDATE demo_sector_config
   SET config = '{"Technology":{"label":"Technology","color":"#3b82f6"},"Communication Services":{"label":"Comm Services","color":"#8b5cf6"},"Consumer Discretionary":{"label":"Consumer Disc","color":"#f59e0b"},"Financials":{"label":"Financials","color":"#10b981"}}'::jsonb
 WHERE id = 1;


-- ── Ticker fundamentals + prices (AAPL, NVDA) so detail pages render ──────────
INSERT INTO demo_ticker_fundamentals (ticker, data_type, data) VALUES
  ('AAPL', 'revenue', '[{"year":2024,"quarter":"Q3","revenue":85777},{"year":2024,"quarter":"Q4","revenue":94930},{"year":2025,"quarter":"Q1","revenue":124300},{"year":2025,"quarter":"Q2","revenue":95360}]'::jsonb),
  ('AAPL', 'eps',     '[{"year":2024,"quarter":"Q3","eps_diluted":1.40},{"year":2024,"quarter":"Q4","eps_diluted":0.97},{"year":2025,"quarter":"Q1","eps_diluted":2.40},{"year":2025,"quarter":"Q2","eps_diluted":1.65}]'::jsonb),
  ('AAPL', 'fcf',     '[{"year":2024,"quarter":"Q3","free_cash_flow":26700},{"year":2025,"quarter":"Q1","free_cash_flow":33700},{"year":2025,"quarter":"Q2","free_cash_flow":24500}]'::jsonb),
  ('NVDA', 'revenue', '[{"year":2024,"quarter":"Q3","revenue":35082},{"year":2024,"quarter":"Q4","revenue":39331},{"year":2025,"quarter":"Q1","revenue":44062},{"year":2025,"quarter":"Q2","revenue":46700}]'::jsonb),
  ('NVDA', 'eps',     '[{"year":2024,"quarter":"Q3","eps_diluted":0.78},{"year":2024,"quarter":"Q4","eps_diluted":0.89},{"year":2025,"quarter":"Q1","eps_diluted":0.96},{"year":2025,"quarter":"Q2","eps_diluted":1.05}]'::jsonb),
  ('NVDA', 'fcf',     '[{"year":2024,"quarter":"Q4","free_cash_flow":15500},{"year":2025,"quarter":"Q1","free_cash_flow":26100},{"year":2025,"quarter":"Q2","free_cash_flow":27400}]'::jsonb);

INSERT INTO demo_ticker_prices (ticker, data_type, data) VALUES
  ('AAPL', 'market_data', '[{"metric":"current_price","value":212.50},{"metric":"market_cap","value":3230000000000},{"metric":"pe_ratio","value":29.4}]'::jsonb),
  ('AAPL', 'daily_prices', '[{"date":"2026-05-01","close":201.2},{"date":"2026-05-15","close":206.8},{"date":"2026-06-01","close":209.4},{"date":"2026-06-12","close":212.5}]'::jsonb),
  ('NVDA', 'market_data', '[{"metric":"current_price","value":134.20},{"metric":"market_cap","value":3290000000000},{"metric":"pe_ratio","value":48.1}]'::jsonb),
  ('NVDA', 'daily_prices', '[{"date":"2026-05-01","close":118.9},{"date":"2026-05-15","close":125.4},{"date":"2026-06-01","close":130.7},{"date":"2026-06-12","close":134.2}]'::jsonb);


-- ── Macro-regime allocator: seeded run + result so the dashboard renders ──────
-- (The "run" action is disabled for demo, so this seeded output is what's shown.)
UPDATE demo_macro_regime_config
   SET config = '{"start_date":"2000-01-01","end_date":"2026-05-01","equity_ticker":"SPY","baseline_equity":0.95,"baseline_tbills":0.05,"min_weight":0.10,"max_weight":0.97,"crash_overlay":true}'::jsonb
 WHERE id = 1;

-- Insert the run and link its result via the auto-generated id (works whether the
-- id column is serial/integer or uuid — we never hardcode it).
WITH new_run AS (
  INSERT INTO demo_macro_regime_runs (run_type, status, started_at)
  VALUES ('run', 'completed', now() - interval '2 days')
  RETURNING id
)
INSERT INTO demo_macro_regime_results (run_id, backtest, live_prediction, metrics, report, plots, validation_report, validation_data)
SELECT
  new_run.id,
  '[{"date":"2026-03-01","rebalance_date":"2026-03-01","weight_equity":0.88,"weight_tbills":0.12,"prob_equity":0.71,"prob_tbills":0.29,"overlay":"none"},{"date":"2026-04-01","rebalance_date":"2026-04-01","weight_equity":0.90,"weight_tbills":0.10,"prob_equity":0.74,"prob_tbills":0.26,"overlay":"none"},{"date":"2026-05-01","rebalance_date":"2026-05-01","weight_equity":0.92,"weight_tbills":0.08,"prob_equity":0.77,"prob_tbills":0.23,"overlay":"none"}]'::jsonb,
  '{"weight_equity":0.92,"weight_tbills":0.08,"rebalance_date":"2026-05-01","allocation_month":"2026-06","prob_equity":0.77,"prob_tbills":0.23,"overlay":"none","market_signals":{"momentum_3m":0.041,"volatility_3m":0.118,"credit_spread":1.05}}'::jsonb,
  '[{"metric":"CAGR","value":0.114},{"metric":"Sharpe","value":1.32},{"metric":"Max Drawdown","value":-0.143}]'::jsonb,
  'Demo backtest summary: the regime model favors equities (92%) heading into 2026-06 with no crash overlay engaged.',
  '{}'::jsonb,
  NULL,
  '{}'::jsonb
FROM new_run;


-- ── Prism AI: recommendation history (Signal History tab) ────────────────────
-- Multiple analyses per ticker so the timeline shows signal changes. The "run"
-- action is disabled in demo, so this seeded history is what the tab displays.
INSERT INTO demo_prism_recommendations
  (ticker, analysis_date, signal, conviction, position_size_pct, price_target, expected_return_pct, model, analysis_mode, recommendation, sections, source_file)
VALUES
  ('AAPL', now() - interval '90 days', 'HOLD', 'MODERATE', 3.0, 205, 8.5, 'llama3.1:8b', 'balanced',
   '{"signal":"HOLD","conviction":"MODERATE","position_size_pct":3.0,"price_target_12mo":205,"expected_return_pct":8.5,"key_catalysts":["Services growth","Buybacks"],"key_risks":["China demand","Regulatory"],"reasoning":"Quality franchise but limited near-term dislocation; expected return below the BUY threshold."}'::jsonb,
   '{"executive_summary":"High-quality compounder trading near fair value; no clear dislocation yet.","fundamental_analysis":"Durable FCF and margins with steady buybacks.","qualitative_factors":"Strong ecosystem moat and brand.","risk_factors":"China demand softness and regulatory scrutiny."}'::jsonb,
   'demo_20260320_AAPL_analysis.json'),
  ('AAPL', now() - interval '45 days', 'BUY', 'HIGH', 6.5, 230, 14.2, 'llama3.1:8b', 'balanced',
   '{"signal":"BUY","conviction":"HIGH","position_size_pct":6.5,"price_target_12mo":230,"expected_return_pct":14.2,"key_catalysts":["AI device cycle","Services margin expansion"],"key_risks":["Hardware demand"],"reasoning":"Pullback created a dislocation while fundamentals kept improving — classic DHQ setup."}'::jsonb,
   '{"executive_summary":"Price weakness despite improving fundamentals — a temporary dislocation.","fundamental_analysis":"Revenue and EPS reaccelerating; FCF strong.","qualitative_factors":"Ecosystem lock-in intact.","risk_factors":"Dislocation appears temporary, not structural."}'::jsonb,
   'demo_20260504_AAPL_analysis.json'),
  ('AAPL', now() - interval '5 days', 'BUY', 'VERY_HIGH', 8.0, 245, 17.8, 'llama3.1:8b', 'balanced',
   '{"signal":"BUY","conviction":"VERY_HIGH","position_size_pct":8.0,"price_target_12mo":245,"expected_return_pct":17.8,"key_catalysts":["AI refresh","Capital returns"],"key_risks":["Valuation"],"reasoning":"Dislocation persists with strengthening fundamentals and >17% expected return."}'::jsonb,
   '{"executive_summary":"Conviction increased as the dislocation persisted and fundamentals strengthened.","fundamental_analysis":"Accelerating growth with record FCF.","qualitative_factors":"Best-in-class capital allocation.","risk_factors":"Primary risk is multiple compression."}'::jsonb,
   'demo_20260613_AAPL_analysis.json'),
  ('NFLX', now() - interval '60 days', 'BUY', 'HIGH', 5.0, 720, 13.1, 'llama3.1:8b', 'growth',
   '{"signal":"BUY","conviction":"HIGH","position_size_pct":5.0,"price_target_12mo":720,"expected_return_pct":13.1,"key_catalysts":["Ad tier","Password sharing"],"key_risks":["Content costs"],"reasoning":"Subscriber re-acceleration with expanding margins supports a BUY."}'::jsonb,
   '{"executive_summary":"Growth re-accelerating with improving profitability.","fundamental_analysis":"Revenue growth with operating leverage.","qualitative_factors":"Scale advantage in content.","risk_factors":"Competitive content spend."}'::jsonb,
   'demo_20260419_NFLX_analysis.json'),
  ('NFLX', now() - interval '8 days', 'HOLD', 'MODERATE', 2.5, 690, 7.0, 'llama3.1:8b', 'growth',
   '{"signal":"HOLD","conviction":"MODERATE","position_size_pct":2.5,"price_target_12mo":690,"expected_return_pct":7.0,"key_catalysts":["Ad tier"],"key_risks":["Valuation","Content costs"],"reasoning":"Strong run leaves limited upside to fair value; downgrade to HOLD."}'::jsonb,
   '{"executive_summary":"Re-rated to fair value after a strong run; upside now limited.","fundamental_analysis":"Healthy fundamentals already reflected in price.","qualitative_factors":"Leadership intact.","risk_factors":"Valuation risk dominates."}'::jsonb,
   'demo_20260610_NFLX_analysis.json'),
  ('GOOGL', now() - interval '30 days', 'BUY', 'HIGH', 6.0, 215, 15.4, 'llama3.1:8b', 'balanced',
   '{"signal":"BUY","conviction":"HIGH","position_size_pct":6.0,"price_target_12mo":215,"expected_return_pct":15.4,"key_catalysts":["Cloud growth","AI monetization"],"key_risks":["Antitrust"],"reasoning":"Underappreciated cloud and AI optionality with a reasonable valuation."}'::jsonb,
   '{"executive_summary":"Cloud and AI optionality underpriced by the market.","fundamental_analysis":"Strong revenue growth and FCF.","qualitative_factors":"Data and distribution moat.","risk_factors":"Regulatory and antitrust overhang."}'::jsonb,
   'demo_20260519_GOOGL_analysis.json');

-- A couple of completed pipeline runs for the run-history list.
INSERT INTO demo_prism_runs (run_type, ticker, status, started_at, completed_at, exit_code, log_output) VALUES
  ('analyze', 'AAPL', 'completed', now() - interval '5 days', now() - interval '5 days' + interval '22 seconds', 0,
   E'Analyzing AAPL (mode: balanced)...\nAnalysis complete for AAPL: BUY (VERY_HIGH)'),
  ('analyze', 'NFLX', 'completed', now() - interval '8 days', now() - interval '8 days' + interval '19 seconds', 0,
   E'Analyzing NFLX (mode: growth)...\nAnalysis complete for NFLX: HOLD (MODERATE)');


-- ── App settings (active selections) ─────────────────────────────────────────
INSERT INTO demo_app_settings (key, value) VALUES
  ('activeWatchlistId', 'default'),
  ('activeTaskBoardId', 'default'),
  ('task_boards', '[{"id":"default","name":"Main Board"}]')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Done. Log in with demo / demo to explore the seeded environment.
