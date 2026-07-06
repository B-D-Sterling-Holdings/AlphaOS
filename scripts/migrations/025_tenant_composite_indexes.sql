-- ============================================================
-- 025 — Tenant-composite secondary indexes
-- Run in the Supabase SQL Editor AFTER 024_config_into_app_settings.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHY
-- ---
-- Under RLS, EVERY query carries `WHERE tenant_id = app_current_tenant()`, so a
-- secondary index that leads with a business column (status, ticker, board_id…)
-- can't fully serve the query — Postgres still has to filter by tenant. The
-- original single-column indexes from 000_initial_schema.sql predate
-- multitenancy. This replaces them with `(tenant_id, <col>)` composites so the
-- tenant filter and the secondary filter/sort are satisfied by one index.
--
-- The newer tables (lessons, issues) already use tenant-composite indexes, and
-- keys already led by tenant_id (holdings/theses/ticker_* PKs, the per-tenant
-- UNIQUEs) are left as-is. The per-table `idx_<table>_tenant` indexes from 005
-- are kept — they still serve the RLS policy filter and workspace-purge deletes.
--
-- Index builds are trivial at this data volume (a single fund); a plain
-- CREATE INDEX is instant. For a large table you'd use CREATE INDEX
-- CONCURRENTLY instead (which can't run inside a transaction/DO block).
-- ------------------------------------------------------------

-- contacts: status filter + follow-up / last-contacted sorts
DROP INDEX IF EXISTS idx_contacts_status;
DROP INDEX IF EXISTS idx_contacts_follow_up;
DROP INDEX IF EXISTS idx_contacts_last_contacted;
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_status         ON contacts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_follow_up      ON contacts(tenant_id, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_last_contacted ON contacts(tenant_id, last_contacted_at);

-- interactions: fetch a contact's log, newest first
DROP INDEX IF EXISTS idx_interactions_contact;
DROP INDEX IF EXISTS idx_interactions_date;
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_contact ON interactions(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_date    ON interactions(tenant_id, date DESC);

-- contact_files: files for a contact
DROP INDEX IF EXISTS idx_contact_files_contact;
CREATE INDEX IF NOT EXISTS idx_contact_files_tenant_contact ON contact_files(tenant_id, contact_id);

-- tasks: board view ordered by manual position; priority filter
DROP INDEX IF EXISTS idx_tasks_priority;
DROP INDEX IF EXISTS idx_tasks_board_id;
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_board    ON tasks(tenant_id, board_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_priority ON tasks(tenant_id, priority);

-- research_links: filter by ticker / content_type
DROP INDEX IF EXISTS idx_research_links_ticker;
DROP INDEX IF EXISTS idx_research_links_content_type;
CREATE INDEX IF NOT EXISTS idx_research_links_tenant_ticker       ON research_links(tenant_id, ticker);
CREATE INDEX IF NOT EXISTS idx_research_links_tenant_content_type ON research_links(tenant_id, content_type);

-- strategic_notes: idx on ticker alone is redundant with UNIQUE(tenant_id, ticker)
-- from 005 (that index already leads with tenant_id) — just drop it.
DROP INDEX IF EXISTS idx_strategic_notes_ticker;

-- candidate_positions: status filter
DROP INDEX IF EXISTS idx_candidate_positions_status;
CREATE INDEX IF NOT EXISTS idx_candidate_positions_tenant_status ON candidate_positions(tenant_id, status);

-- ideas: archived / category / pinned filters
DROP INDEX IF EXISTS idx_ideas_pinned;
DROP INDEX IF EXISTS idx_ideas_category;
DROP INDEX IF EXISTS idx_ideas_archived;
CREATE INDEX IF NOT EXISTS idx_ideas_tenant_archived ON ideas(tenant_id, archived);
CREATE INDEX IF NOT EXISTS idx_ideas_tenant_category ON ideas(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_ideas_tenant_pinned   ON ideas(tenant_id, pinned);

-- macro_regime runs/results: newest-first per tenant (list + retention prune)
DROP INDEX IF EXISTS idx_macro_regime_runs_started;
DROP INDEX IF EXISTS idx_macro_regime_results_created;
CREATE INDEX IF NOT EXISTS idx_macro_regime_runs_tenant_started    ON macro_regime_runs(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_macro_regime_results_tenant_created ON macro_regime_results(tenant_id, created_at DESC);

-- ============================================================
-- VERIFY
-- ============================================================
--   -- old single-column secondary indexes gone (expect 0 rows):
--   SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN
--     ('idx_contacts_status','idx_contacts_follow_up','idx_contacts_last_contacted',
--      'idx_interactions_contact','idx_interactions_date','idx_contact_files_contact',
--      'idx_tasks_priority','idx_tasks_board_id','idx_research_links_ticker',
--      'idx_research_links_content_type','idx_strategic_notes_ticker',
--      'idx_candidate_positions_status','idx_ideas_pinned','idx_ideas_category',
--      'idx_ideas_archived','idx_macro_regime_runs_started','idx_macro_regime_results_created');
--
--   -- new tenant-composite indexes present:
--   SELECT indexname FROM pg_indexes WHERE schemaname='public'
--     AND indexname LIKE 'idx_%_tenant_%' ORDER BY indexname;
-- ============================================================
