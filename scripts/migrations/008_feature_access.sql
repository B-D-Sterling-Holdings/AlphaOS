-- ============================================================
-- 008 — PER-USER FEATURE ACCESS
-- Run in the Supabase SQL Editor any time after 005_multitenancy.sql.
-- Idempotent: safe to run repeatedly; never drops user data.
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds `disabled_features` to the users table: a list of feature keys that an
-- admin has switched OFF for that user (empty = full access, the default).
--
-- The keys are defined in src/lib/features.js (e.g. 'relationships',
-- 'financials', 'research'). Enforcement happens server-side in the edge
-- middleware (src/middleware.js) and in the app's auth/me lookup, so a user
-- cannot reach a disabled area even by deep-linking or using the command
-- palette. Admins always have full access regardless of this column.
--
-- This column lives on `users`, which is service-role-only (no authenticated
-- access — see migration 005), so only the server can read or change it.
-- ------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS disabled_features text[] NOT NULL DEFAULT '{}';
