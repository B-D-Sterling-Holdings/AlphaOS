-- ============================================================
-- 007 — LESSONS LEARNED (post-mortems + pattern library)
-- Run in the Supabase SQL Editor AFTER 005_multitenancy.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds the two tables behind the Lessons Learned tab (src/app/(dashboard)/lessons):
--
--   lessons          — one row per post-mortem / lesson / good decision. The
--                      long-form template fields live in `detail` (JSONB), keeping
--                      the schema flat and extensible (same approach as `theses`).
--   lesson_patterns  — recurring themes across stocks (e.g. "Value trap"). Linked
--                      from lessons.pattern_ids; "related stocks" are derived from
--                      that link in the app.
--
-- Both are tenant-scoped exactly like every other data table: tenant_id defaults
-- to the request's JWT claim, RLS isolates rows, and the authenticated role gets
-- standard grants. See 005_multitenancy.sql for the mechanism.

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT public.app_current_tenant(),
  ticker        text DEFAULT '',
  company       text DEFAULT '',
  title         text NOT NULL,
  type          text DEFAULT 'post_mortem',
  outcome       text DEFAULT 'uncertain',
  category      text DEFAULT 'business',
  severity      text DEFAULT 'medium',
  repeat_risk   text DEFAULT 'medium',
  status        text DEFAULT 'not_reviewed',
  position_type text DEFAULT 'owned',
  date_opened   date,
  date_reviewed date,
  tags          jsonb DEFAULT '[]'::jsonb,
  pattern_ids   jsonb DEFAULT '[]'::jsonb,
  detail        jsonb DEFAULT '{}'::jsonb,
  -- Draft & Review-style discussion threads (Reviewer <-> Author, resolvable):
  -- [{ id, title, resolved, createdAt, messages:[{ id, role, body, createdAt }] }]
  comments      jsonb DEFAULT '[]'::jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lesson_patterns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT public.app_current_tenant(),
  name                text NOT NULL,
  description         text DEFAULT '',
  why_it_matters      text DEFAULT '',
  checklist_questions jsonb DEFAULT '[]'::jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. Defaults / backfill (in case the tables pre-existed without tenant default)
-- ------------------------------------------------------------
ALTER TABLE public.lessons         ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant();
ALTER TABLE public.lesson_patterns ALTER COLUMN tenant_id SET DEFAULT public.app_current_tenant();

-- Discussion threads column (idempotent for tables created before this column existed).
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS comments jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_lessons_tenant          ON public.lessons(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lessons_ticker          ON public.lessons(tenant_id, ticker);
CREATE INDEX IF NOT EXISTS idx_lesson_patterns_tenant  ON public.lesson_patterns(tenant_id);

-- ------------------------------------------------------------
-- 3. RLS + grants (mirror the tenant_isolation policy used everywhere)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lessons','lesson_patterns'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.app_current_tenant())
        WITH CHECK (tenant_id = public.app_current_tenant())
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. Seed the starter pattern library for the two well-known tenants so the
--    Pattern Library is useful on day one. New tenants start empty; the app's
--    empty state explains how to add their own.
-- ------------------------------------------------------------
DO $$
DECLARE
  tid uuid;
  seed_tenants uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111',  -- CIO Alpha
    '22222222-2222-2222-2222-222222222222'   -- Demo
  ];
  patterns jsonb := '[
    {"name":"Misread capital allocation","description":"Management deployed capital (M&A, buybacks, capex) in a way that destroyed rather than created value, and we did not weight it heavily enough.","why":"Capital allocation compounds over years; getting it wrong quietly erodes intrinsic value even when the operating business looks fine.","q":["What is managements track record of allocating capital across cycles?","Are buybacks happening above or below intrinsic value?","Do incentives reward per-share value or empire-building?"]},
    {"name":"Underestimated regulatory risk","description":"A regulatory, legal, or political change impaired the business model in a way the thesis treated as remote.","why":"Regulatory shifts can permanently reset the earnings power or even the legality of a business with little warning.","q":["What regulatory regimes is this business exposed to, and how concentrated?","What happens to unit economics under the plausible adverse rule change?","Is the moat partly regulatory, and could it be removed?"]},
    {"name":"Value trap / declining intrinsic value","description":"The stock looked cheap on trailing metrics, but intrinsic value was eroding faster than the price.","why":"A low multiple on a shrinking business is not a margin of safety; it is a melting ice cube.","q":["Is intrinsic value growing, flat, or declining over the next 5 years?","Is the cheapness a function of a structural problem or a temporary one?","What is the terminal value, honestly?"]},
    {"name":"Overpaid for quality","description":"A genuinely great business, but the entry price embedded expectations that left no margin of safety.","why":"Even wonderful businesses produce poor returns when bought at a price that already discounts the next decade.","q":["What growth and margin path is the current price implying?","What is the return if the business merely meets (not beats) expectations?","How much multiple compression can the thesis survive?"]},
    {"name":"Misread cyclicality","description":"We extrapolated peak (or trough) economics through the cycle and mis-timed the position.","why":"Cyclical earnings look cheapest at the top and dearest at the bottom; getting the cycle phase wrong inverts the thesis.","q":["Where are we in this industrys cycle, and on what evidence?","Are current margins above or below mid-cycle?","What do normalized earnings look like?"]},
    {"name":"Ignored balance sheet constraints","description":"Leverage, maturities, or covenants limited the companys options exactly when it needed flexibility.","why":"Debt is not only a solvency issue; it is a capital allocation constraint that shapes every decision in a downturn.","q":["Does the debt load limit the ability to return capital, do M&A, or invest through a downturn?","What is the maturity wall and refinancing risk?","How do covenants behave under a stress scenario?"]},
    {"name":"Overweighted short-term sentiment","description":"We let recent price action, narrative, or momentum stand in for analysis of the underlying business.","why":"Sentiment mean-reverts; basing conviction on it leads to buying high and selling low.","q":["Would I hold this if the price were quoted only once a year?","Is my conviction driven by the business or by the tape?","What has actually changed in the fundamentals?"]},
    {"name":"Underweighted management incentives","description":"Compensation and ownership structures pointed management away from per-share value creation, and we discounted it.","why":"Incentives drive behavior; misaligned incentives reliably surface as value-destructive decisions over time.","q":["What specifically are executives paid to maximize?","How much skin in the game do they have, and at what cost basis?","Do incentives reward the same outcome a long-term owner would want?"]}
  ]'::jsonb;
  p jsonb;
BEGIN
  FOREACH tid IN ARRAY seed_tenants LOOP
    FOR p IN SELECT * FROM jsonb_array_elements(patterns) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.lesson_patterns
        WHERE tenant_id = tid AND name = (p->>'name')
      ) THEN
        INSERT INTO public.lesson_patterns (tenant_id, name, description, why_it_matters, checklist_questions)
        VALUES (tid, p->>'name', p->>'description', p->>'why', COALESCE(p->'q', '[]'::jsonb));
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
--   SELECT count(*) FROM lesson_patterns;   -- >= 8 per seeded tenant
--   SELECT tablename, rowsecurity FROM pg_tables
--     WHERE tablename IN ('lessons','lesson_patterns');  -- rowsecurity = true
-- ============================================================
