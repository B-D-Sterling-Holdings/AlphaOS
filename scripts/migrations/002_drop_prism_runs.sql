-- ============================================================
-- 002 — Drop the orphaned prism_runs table
-- ============================================================
-- prism_runs was defined in the schema and seeded for the demo account, but it
-- is never read or written at runtime (no JS route, no prism_ai Python path).
-- The active Prism tables are prism_recommendations, prism_ticker_data and
-- prism_ticker_documents. Remove the dead table from prod (and its demo twin).
--
-- Safe to re-run. Drops no live data you rely on (the table is unused).
-- ============================================================

DROP TABLE IF EXISTS prism_runs;
DROP TABLE IF EXISTS demo_prism_runs;
