-- ============================================================
-- 013 — ISSUE NUMBERS + LABELS (GitHub-style issues UI)
-- Run in the Supabase SQL Editor AFTER 010_issues.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Supports the GitHub-style Issues UI (src/components/IssuesWidget.jsx):
--
--   issues.number — per-tenant sequential issue number ("#12"), like a repo's
--                   issue numbers. Assigned by the API at insert time
--                   (max(number)+1 under RLS, so it is tenant-scoped
--                   automatically). Backfilled here for existing rows in
--                   created_at order. Numbers are never reused after delete.
--
--   issues.labels — text[] as jsonb, e.g. ["bug","ui/ux"]. The label palette
--                   itself is a fixed set defined in the UI; rows only store
--                   the names.

ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.issues ADD COLUMN IF NOT EXISTS number bigint;

-- Backfill numbers per tenant, oldest issue = #1 (only fills NULLs, so re-running
-- never renumbers existing issues).
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
  FROM public.issues
  WHERE number IS NULL
),
base AS (
  SELECT tenant_id, COALESCE(MAX(number), 0) AS max_n
  FROM public.issues
  GROUP BY tenant_id
)
UPDATE public.issues i
SET number = o.rn + b.max_n
FROM ordered o, base b
WHERE i.id = o.id AND b.tenant_id = i.tenant_id;

CREATE INDEX IF NOT EXISTS idx_issues_tenant_number ON public.issues(tenant_id, number);

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT number, title, labels FROM issues ORDER BY number;  -- numbers 1..N, labels []
-- ============================================================
