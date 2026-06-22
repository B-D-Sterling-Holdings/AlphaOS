-- ============================================================
-- 006 — DRAFT & REVIEW AUTO-NOTIFY (server-cron dedup write-back)
-- Run in the Supabase SQL Editor AFTER 005_multitenancy.sql.
-- Idempotent: CREATE OR REPLACE; safe to run repeatedly.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- The auto-notify cron (src/app/api/cron/auto-notify) emails reminders for Draft
-- & Review comments left waiting, then records what it sent in
--   theses.underwriting -> 'draftReview' -> 'autoNotify' -> 'sent'
-- so the same comment isn't nudged twice.
--
-- The cron runs as the service role and could be writing at the same moment a
-- user is saving their thesis (the app POST writes the WHOLE `underwriting`
-- JSONB). If the cron also wrote the whole object it would clobber that edit.
-- This function instead updates ONLY the nested `sent` path with jsonb_set, on
-- the row's current value, so sibling fields (paper, threads, …) are untouched.
--
-- create_missing = true so the `sent` key is created if absent; jsonb_set is a
-- no-op when the parent `draftReview`/`autoNotify` objects don't exist, which is
-- fine — the cron only calls this for reviews that already have autoNotify.

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

-- Only ever invoked by the cron via the service-role client. Granting execute to
-- service_role is explicit (it bypasses RLS but not function privileges).
GRANT EXECUTE ON FUNCTION public.set_draftreview_autonotify_sent(uuid, text, jsonb) TO service_role;
