-- ============================================================
-- FULL SUPABASE SCHEMA — Research Management Tool
-- Run this in the Supabase SQL Editor to set up from scratch
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql
-- ============================================================


-- ============================================================
-- 1. CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT DEFAULT '',
  role TEXT DEFAULT '',
  relationship_type TEXT DEFAULT 'other',
  contact_method TEXT DEFAULT '',
  contact_value TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  relationship_strength TEXT DEFAULT 'new',
  importance INTEGER DEFAULT 3,
  outreach_type TEXT DEFAULT 'other',
  summary TEXT DEFAULT '',
  next_action TEXT DEFAULT '',
  follow_up_date DATE,
  last_contacted_at TIMESTAMPTZ,
  tags JSONB DEFAULT '[]'::jsonb,
  city TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  last_meeting_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_follow_up ON contacts(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted ON contacts(last_contacted_at);


-- ============================================================
-- 2. INTERACTIONS (linked to contacts)
-- ============================================================
CREATE TABLE IF NOT EXISTS interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',
  summary TEXT DEFAULT '',
  next_step TEXT DEFAULT '',
  date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_interactions_date ON interactions(date DESC);


-- ============================================================
-- 3. CONTACT FILES (linked to contacts)
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT DEFAULT '',
  type TEXT DEFAULT 'link',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_files_contact ON contact_files(contact_id);


-- ============================================================
-- 4. TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'low',
  done BOOLEAN DEFAULT false,
  notes TEXT DEFAULT '',
  assignee TEXT DEFAULT '',
  subtasks JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT '',
  position INT DEFAULT 0,
  board_id TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_board_id ON tasks(board_id);


-- ============================================================
-- 5. APP SETTINGS (key-value store)
-- Keys: task_boards, activeTaskBoardId, assignees_[boardId],
--        activeWatchlistId
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 6. RESEARCH LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS research_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT,
  url TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'other',
  title TEXT,
  source TEXT,
  published_at TIMESTAMPTZ,
  notes TEXT,
  extracted_text TEXT,
  pasted_text TEXT,
  auto_summary TEXT,
  manual_summary TEXT,
  summary_status TEXT DEFAULT 'pending',
  summary_method TEXT DEFAULT 'none',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_links_ticker ON research_links(ticker);
CREATE INDEX IF NOT EXISTS idx_research_links_content_type ON research_links(content_type);


-- ============================================================
-- 7. DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  category TEXT,
  ticker TEXT,
  notes TEXT DEFAULT '',
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  storage_path TEXT,
  url TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 8. THESES
-- ============================================================
CREATE TABLE IF NOT EXISTS theses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT UNIQUE,
  core_reasons JSONB,
  assumptions TEXT,
  valuation TEXT,
  underwriting JSONB,
  news_updates JSONB DEFAULT '[]'::jsonb,
  todos JSONB DEFAULT '[]'::jsonb,
  notes JSONB DEFAULT '{"links":[],"content":[]}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 9. VALUATION MODELS
-- ============================================================
CREATE TABLE IF NOT EXISTS valuation_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT UNIQUE,
  inputs JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 10. HOLDINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS holdings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT UNIQUE NOT NULL,
  shares NUMERIC NOT NULL,
  cost_basis NUMERIC NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 11. PORTFOLIO CASH (single-row table, id always = 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_cash (
  id INTEGER PRIMARY KEY DEFAULT 1,
  cash NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO portfolio_cash (id, cash) VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 12. WATCHLISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stocks JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 13. TICKER FUNDAMENTALS
-- data_type: revenue, eps, fcf, operating_margins, buybacks
-- ============================================================
CREATE TABLE IF NOT EXISTS ticker_fundamentals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 14. TICKER PRICES
-- data_type: daily_prices, market_data
-- ============================================================
CREATE TABLE IF NOT EXISTS ticker_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 15. ALLOCATION CONFIG (single-row table, id always = 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS allocation_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO allocation_config (id, config) VALUES (1, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 16. SECTOR CONFIG (single-row table, id always = 1)
-- config: { [sector]: { label, color } }
-- ============================================================
CREATE TABLE IF NOT EXISTS sector_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO sector_config (id, config) VALUES (1, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 17. FACTOR CONFIG (single-row table, id always = 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS factor_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  factors JSONB DEFAULT '[]'::jsonb,
  importance_weights JSONB DEFAULT '{"Volatility": 0.9}'::jsonb,
  exposures JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO factor_config (id, factors, importance_weights, exposures)
  VALUES (1, '[]'::jsonb, '{"Volatility": 0.9}'::jsonb, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 18. FUND NAV DATA
-- ============================================================
CREATE TABLE IF NOT EXISTS fund_nav_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE,
  fund_nav NUMERIC,
  sp500_nav NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 19. STRATEGIC NOTES (per-position CIO annotations)
-- ============================================================
CREATE TABLE IF NOT EXISTS strategic_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT UNIQUE NOT NULL,
  sentiment TEXT DEFAULT 'neutral',        -- bullish, neutral, bearish
  conviction INTEGER DEFAULT 3,            -- 1-5
  action TEXT DEFAULT 'hold',              -- hold, trim, add, watch, exit
  action_reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  alternatives TEXT DEFAULT '',            -- alternative tickers / ideas
  expected_return NUMERIC,                  -- expected return %
  target_weight NUMERIC,                   -- target portfolio weight %
  priority TEXT DEFAULT 'normal',          -- urgent, high, normal, low
  sort_order NUMERIC DEFAULT 0,            -- manual ordering within a priority bucket
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_notes_ticker ON strategic_notes(ticker);


-- ============================================================
-- 19.5 CANDIDATE POSITIONS (research pipeline — names being researched
--      or with potential to enter the portfolio; not yet held)
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_positions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  status TEXT DEFAULT 'researching',       -- researching, watching, ready, passed
  sentiment TEXT DEFAULT 'neutral',        -- uneasy, neutral, feeling_good (our read)
  conviction INTEGER DEFAULT 3,            -- 1-5
  priority TEXT DEFAULT 'normal',          -- urgent, high, normal, low
  target_weight NUMERIC,                   -- prospective portfolio weight %
  notes TEXT DEFAULT '',
  sort_order NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_positions_status ON candidate_positions(status);


-- ============================================================
-- 20. IDEAS (free-form workspace; not tied to any ticker)
-- category: idea, question, todo, note, random
-- color:    yellow, blue, green, pink, purple, gray, orange
-- ============================================================
CREATE TABLE IF NOT EXISTS ideas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  color TEXT DEFAULT 'yellow',
  category TEXT DEFAULT 'idea',
  tags JSONB DEFAULT '[]'::jsonb,
  pinned BOOLEAN DEFAULT false,
  archived BOOLEAN DEFAULT false,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ideas_pinned ON ideas(pinned);
CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
CREATE INDEX IF NOT EXISTS idx_ideas_archived ON ideas(archived);


-- ============================================================
-- 25. MACRO REGIME — CONFIG (single-row table, id always = 1)
-- UI-editable allocator settings; synced to config.yaml before each run.
-- ============================================================
CREATE TABLE IF NOT EXISTS macro_regime_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO macro_regime_config (id, config) VALUES (1, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 26. MACRO REGIME — RUNS (allocator pipeline job history)
-- run_type: run, predict, fast, validate, clean
-- status:   running, completed, failed
-- The app keeps only the most recent 5 runs (see api/macro-regime/run).
-- ============================================================
CREATE TABLE IF NOT EXISTS macro_regime_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_type TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  log_output TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_macro_regime_runs_started ON macro_regime_runs(started_at DESC);


-- ============================================================
-- 27. MACRO REGIME — RESULTS (parsed backtest/prediction outputs)
-- One row per completed run; the app keeps only the most recent 3.
-- run_id references macro_regime_runs(id) but is intentionally NOT a hard FK:
-- runs and results are pruned on independent schedules, so a results row may
-- outlive its run. backtest/metrics are JSON arrays; plots is { filename: base64 }.
-- ============================================================
CREATE TABLE IF NOT EXISTS macro_regime_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID,
  backtest JSONB DEFAULT '[]'::jsonb,
  live_prediction JSONB,
  metrics JSONB DEFAULT '[]'::jsonb,
  report TEXT,
  plots JSONB DEFAULT '{}'::jsonb,
  validation_report TEXT,
  validation_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_macro_regime_results_created ON macro_regime_results(created_at DESC);


-- ============================================================
-- STORAGE BUCKETS (PRIVATE — see scripts/migrations/021_private_storage.sql)
-- Run these separately or create via the Supabase dashboard
-- Dashboard > Storage > New Bucket
-- ============================================================

-- Bucket: documents
-- Used for: uploaded research documents (PDFs, Word, Excel, etc.)
-- Path format: {tenant_id}/{category}/{timestamp}_{filename}
-- Public: NO — reads go through /api/storage/object (session + tenant check,
-- then a short-lived signed URL). See src/lib/storage.js.
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

-- Bucket: research-images
-- Used for: inline images in rich text editors
-- Path format: {tenant_id}/{ticker}/{timestamp}_{filename}
-- Public: NO (same signed-URL flow as documents)
INSERT INTO storage.buckets (id, name, public) VALUES ('research-images', 'research-images', false)
  ON CONFLICT (id) DO UPDATE SET public = false;


-- ============================================================
-- STORAGE POLICIES: none.
-- Buckets are private and hold NO policies for anon/authenticated — every
-- upload/read/delete goes through the server's service-role client behind the
-- narrow helpers in src/lib/storage.js, which validate the session and the
-- `<tenant_id>/` path prefix and mint short-lived signed URLs for reads.
-- The DROPs clean up the pre-021 public policies on older databases.
-- ============================================================
DROP POLICY IF EXISTS "Allow public read on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read on research-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert on research-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete on research-images" ON storage.objects;


-- ============================================================
-- updated_at TRIGGERS
-- Auto-maintain updated_at on every table that has the column (see
-- scripts/migrations/003_add_updated_at_triggers.sql). Runs last, after all
-- tables exist.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'set_updated_at_' || r.table_name
        AND tgrelid = format('public.%I', r.table_name)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
        'set_updated_at_' || r.table_name, r.table_name
      );
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- DRAFT & REVIEW AUTO-NOTIFY (see scripts/migrations/006_autonotify_sent.sql)
-- The auto-notify cron records what it has emailed in
-- theses.underwriting->'draftReview'->'autoNotify'->'sent'. This updates ONLY
-- that nested path so it can't clobber a user's concurrent thesis edit.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_draftreview_autonotify_sent(
  p_tenant uuid,
  p_ticker text,
  p_sent   jsonb
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.theses
  SET underwriting = jsonb_set(
        COALESCE(underwriting, '{}'::jsonb),
        '{draftReview,autoNotify,sent}',
        COALESCE(p_sent, '{}'::jsonb),
        true
      ),
      updated_at = now()
  WHERE tenant_id = p_tenant
    AND ticker = p_ticker;
$$;

GRANT EXECUTE ON FUNCTION public.set_draftreview_autonotify_sent(uuid, text, jsonb) TO service_role;
