# Database migrations

Ordered, append-only SQL migrations for the Supabase database. Run each new file
**once**, in numeric order, in the Supabase SQL Editor (Dashboard → SQL Editor).

## Why this exists

`scripts/supabase-schema.sql` is the *from-scratch* schema (idempotent, safe to
re-run). It does **not** track incremental changes to an already-deployed database
— which is how the live DB drifted ahead of the schema (e.g. the `macro_regime_*`
tables existed in prod but were never in the schema file).

Migrations close that gap: every change to a live database goes in a numbered file
here AND is folded into `supabase-schema.sql` so fresh setups stay correct.

## Convention

- Files are `NNN_short_description.sql`, numbered sequentially.
- Each migration is idempotent where practical (`IF NOT EXISTS`, `DROP ... IF EXISTS`,
  guarded `DO` blocks) so an accidental re-run is harmless.
- Never edit a migration after it's been applied to prod — add a new one.
- After writing a migration, mirror the end-state into `supabase-schema.sql` and,
  if it touches a cloned table, `demo-schema.sql`.

## Order of operations for a fresh database

1. `supabase-schema.sql`     — base tables, buckets, storage policies
2. `demo-schema.sql`         — demo_* clones (optional; demo env only)
3. `demo-seed.sql`           — demo data (optional)
4. `migrations/*.sql`        — in numeric order

## Applied migrations

| File | Purpose |
|------|---------|
| `001_enable_rls.sql` | Enable RLS on all public tables; lock the anon key out of the DB. |
| `002_drop_prism_runs.sql` | Drop the orphaned `prism_runs` / `demo_prism_runs` tables. |
| `003_add_updated_at_triggers.sql` | Auto-maintain `updated_at` on every table that has the column. |
| `004_tighten_storage_policies.sql` | Drop public INSERT/DELETE on storage buckets (keep public read). |
| `005_multitenancy.sql` | Row-level multitenancy: `tenant_id` on every data table, RLS-enforced. |
| `006_autonotify_sent.sql` | RPC for the auto-notify cron to write its dedup map without clobbering concurrent thesis edits. |
| `007_lessons_learned.sql` | Lessons-learned tables. |
| `008_feature_access.sql` | `users.disabled_features` — per-user feature suppression (admin "guard" toggles). |
| `009_finish_tenant_keys.sql` | Re-scope the remaining GLOBAL keys per tenant (ticker_prices/fundamentals, theses, valuation_models, fund_nav_data, app_settings) so two tenants can hold the same ticker/date/setting. Also required for the demo login to seed those sections fully. |
| `010_issues.sql` | `issues` table behind the in-app issue tracker (tenant-scoped, RichTextArea JSONB body/comments). |
| `011_sub_users.sql` | Multiple users per tenant (sub-users). |
| `012_promote_legacy_owners.sql` | Promote pre-011 single logins to workspace owners. |
| `013_issue_numbers_labels.sql` | GitHub-style Issues UI: per-tenant sequential `issues.number` (#12) and `issues.labels` (label-name array). |
| `014_issue_dev_triage.sql` | Admin "Dev" tab in Issues: `issues.priority` (1–4) and `issues.dev_notes` (admin-only triage note). |
| `015_issue_sort_order.sql` | `issues.sort_order` — manual up/down reordering within a priority band in the Dev tab. |
| `016_issue_complexity.sql` | `issues.complexity` (1–4) — admin triage sizing pill in the Dev tab. |
| `017_issue_complexity_scale.sql` | Widen `issues.complexity` CHECK to 1–5 (adds "Very hard"). |
| `018_drop_stray_policies.sql` | Re-lock RLS on every public table, drop stray (non-`tenant_isolation`) policies, recreate tenant policies — fixes the anon/cross-tenant read leak on `macro_regime_config`, `macro_regime_runs`, `rag_coverage`. |
| `019_lock_views.sql` | Revoke anon/authenticated from every public VIEW + set `security_invoker` — views bypass table RLS, which is how `rag_coverage` stayed anon-readable after 018. |
| `020_session_revocation.sql` | `auth_revocations(subject, not_before)` — session-revocation floor behind logout / "sign out everywhere"; also makes the bootstrap `cio-admin` revocable. Service-role-only (RLS forced, no grants). |
| `021_private_storage.sql` | Flip the `documents` / `research-images` buckets to **private** + drop the public-read policies (closes audit finding F3). Reads now go through `/api/storage/object` → short-lived signed URLs. ⚠️ Deploy order: ship the app code and run `scripts/migrate-storage-urls.mjs` first — see the header of the migration file. |

All of 001–021 are applied to the live database (001–020 verified by probe
2026-07-06; 021 applied and verified live in prod the same day, after the
code deploy and `scripts/migrate-storage-urls.mjs`).
