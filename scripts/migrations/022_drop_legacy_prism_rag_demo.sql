-- ============================================================
-- 022 — Drop the legacy Prism AI, RAG/chat, and demo_* clone tables
-- ============================================================
-- Three families of tables that no live app code reads or writes anymore:
--
--   1. Prism AI pipeline tables. The `prism_ai` Python pipeline and its two
--      research routes (company-overview / thesis-fundamentals) were removed;
--      the UI over `prism_recommendations` was archived long before. Nothing
--      in `src/` touches these tables now.
--        - prism_recommendations
--        - prism_ticker_data
--        - prism_ticker_documents
--
--   2. RAG / chat tables from the Python-pipeline era. No `src/` code and no
--      remaining Python reads them; they were service-role-only with no
--      policies (locked by 018/019).
--        - scraped_content
--        - content_chunks
--        - chat_conversations
--        - chat_messages
--        - rag_traces
--        - rag_coverage (VIEW over the above)
--
--   3. The pre-multitenancy `demo_*` clones (25 tables). Superseded by the
--      Demo tenant on 2026-07-01; unread, RLS-locked. Dropped by matching the
--      `demo_%` name pattern so we don't have to enumerate them by hand.
--
-- CASCADE is used so inter-table FKs (e.g. chat_messages → chat_conversations,
-- content_chunks → scraped_content) don't block the drop. Safe to re-run.
-- ============================================================

-- 2. RAG / chat: drop the view first, then the tables it read.
DROP VIEW  IF EXISTS rag_coverage CASCADE;
DROP TABLE IF EXISTS chat_messages       CASCADE;
DROP TABLE IF EXISTS chat_conversations  CASCADE;
DROP TABLE IF EXISTS content_chunks      CASCADE;
DROP TABLE IF EXISTS scraped_content     CASCADE;
DROP TABLE IF EXISTS rag_traces          CASCADE;

-- 1. Prism AI pipeline tables.
DROP TABLE IF EXISTS prism_recommendations  CASCADE;
DROP TABLE IF EXISTS prism_ticker_data       CASCADE;
DROP TABLE IF EXISTS prism_ticker_documents  CASCADE;

-- 3. All remaining pre-multitenancy demo_* clones.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'demo\_%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE;', r.tablename);
  END LOOP;
END $$;
