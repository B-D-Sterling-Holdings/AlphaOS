# Database migrations

Ordered, append-only SQL migrations for the Supabase database. Run each new file
**once**, in numeric order, in the Supabase SQL Editor (Dashboard → SQL Editor).

## Single source of truth

**The current database schema is these migrations, replayed in numeric order.**
There is no separate hand-maintained "from-scratch schema" file — that approach
drifted (the file fell behind prod) and has been retired. `000_initial_schema.sql`
is the frozen single-tenant baseline (migration zero); everything after it is an
incremental change. For a human-readable description of the *current* state, read
`docs/DATABASE_ARCHITECTURE.md`, not any one SQL file.

## Convention

- Files are `NNN_short_description.sql`, numbered sequentially.
- Each migration is idempotent where practical (`IF NOT EXISTS`, `DROP ... IF EXISTS`,
  guarded `DO` blocks) so an accidental re-run is harmless.
- **Never edit a migration after it's been applied to prod** — add a new one. This
  includes `000`: it is frozen history, not a living document.

## Order of operations for a fresh database

Run **every** file in this directory in numeric order, once each:

```
000_initial_schema.sql   → 001 → 002 → … → newest
```

`000` creates the base tables, buckets, and triggers; the rest layer on RLS,
multitenancy, and every feature table. (Provisioning a new *customer* never
touches SQL — it adds a **tenant** row + seeded config; see `src/lib/users.js`.)

The demo environment is no longer a set of `demo_*` clone tables — it is the
reserved **Demo tenant**, provisioned by `scripts/provision-demo.mjs` and
re-seeded on every `demo`/`demo` login (see `docs/DATABASE_ARCHITECTURE.md` §8).

## Applied migrations

| File | Purpose |
|------|---------|
| `000_initial_schema.sql` | Frozen baseline: the original single-tenant base tables, buckets, `updated_at` triggers, auto-notify RPC. **Do not edit.** |
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
| `022_drop_legacy_prism_rag_demo.sql` | Drop the retired Prism AI tables (`prism_recommendations`, `prism_ticker_data`, `prism_ticker_documents`), the RAG/chat pipeline tables + `rag_coverage` view (`scraped_content`, `content_chunks`, `chat_conversations`, `chat_messages`, `rag_traces`), and all pre-multitenancy `demo_*` clones. None are read/written by live app code. |
| `023_app_settings_jsonb.sql` | Convert `app_settings.value` from TEXT to **JSONB** (native per-tenant config; no more stringify/parse). Tolerates bare non-JSON string values (e.g. `activeWatchlistId = 'default'`). |
| `024_config_into_app_settings.sql` | Collapse the six single-row config tables (`allocation_config`, `sector_config`, `factor_config`, `macro_regime_config`, `macro_regime_weights`, `portfolio_cash`) into `app_settings` keyed rows, then drop the tables. Copies data before dropping. |
| `025_tenant_composite_indexes.sql` | Replace pre-multitenancy single-column secondary indexes with `(tenant_id, …)` composites so the RLS tenant filter + the secondary filter/sort share one index. |
| `026_macro_plots_bucket.sql` | Create the private `macro-plots` storage bucket. Plot PNGs move out of `macro_regime_results.plots` base64 JSONB into storage; the row keeps path strings. Backfill existing rows with `scripts/migrate-macro-plots.mjs`. |
| `027_enum_check_constraints.sql` | CHECK constraints on the settled enum-like columns (`strategic_notes` + `candidate_positions` sentiment/action/status/priority/conviction, `tasks.priority`). |
| `028_results_run_fk.sql` | Make `macro_regime_results.run_id → macro_regime_runs(id)` a hard FK with **ON DELETE SET NULL**, removing the delete-order fragility. |
| `029_theses_assumptions_jsonb.sql` | Convert `theses.assumptions` TEXT → JSONB (rich-text block array or bare string, stored natively; drops the route's serialize/deserialize dance). |
| `030_optimistic_concurrency.sql` | Add a monotonic `version integer` + a `bump_version()` BEFORE UPDATE trigger to the document-shaped tables (`theses`, `watchlists`, `valuation_models`, `app_settings`) so saves can compare-and-swap (`UPDATE … WHERE version = <base>`) instead of last-write-wins. Stops two people (or one in two tabs) silently overwriting each other. Carries a deploy-order note in its header (ship the app code first; it falls back to the old unguarded upsert until applied, so there's no hard cutover). See `docs/DATABASE_ARCHITECTURE.md` §11 and `src/lib/concurrency.js`. |
| `031_occ_all_tables.sql` | Extend the **same** OCC mechanism to every remaining table with a user-facing UPDATE path (`holdings`, `research_links`, `documents`, `strategic_notes`, `candidate_positions`, `ideas`, `contacts`, `tasks`, `lessons`, `lesson_patterns`, `issues`) — just adds the `version` column and re-runs 030's generic trigger loop. Append-only/machine tables are intentionally excluded (listed in the file header). Same code-first deploy story as 030. |
| `032_drop_macro_regime_weights_setting.sql` | Delete the orphaned `macro_regime_weights` rows from `app_settings`. The standalone `/macro-regime` page (its only reader/writer, via `/api/macro-regime/weights`) was removed 2026-07-07; the Macro Risk tab under `/allocation` sources base weights from `allocation_schemes` instead. No schema change, no deploy-order dependency (the referencing code is already gone), idempotent — safe to run anytime. |
| `033_issue_archived.sql` | Add `archived_at` (+ partial index) to `issues` for the Issues widget's new **Archived** tab. Archiving is orthogonal to open/resolved (either can be archived) and is admin-only, enforced in `/api/issues`. Code degrades gracefully before it runs — a missing column just reads as "not archived" everywhere; the Archive button starts working once applied. Idempotent, no deploy-order dependency. |
| `034_risk_factor_snapshots.sql` | Add `risk_factor_snapshots` — the per-stock revision history behind the Allocation → **Inputs** tab (API `/api/allocation/risk-snapshots`). The working risk scores/reasons still live in the `allocation_config` blob; this table is the append-only audit log (scores, per-factor reasoning, factor weights, note, author, timestamp) so past reasoning is recoverable. Tenant-scoped like every data table. Code degrades gracefully before it runs — the Inputs editor works and auto-saves, only the "save revision"/history calls fail (caught) until applied. Idempotent, no deploy-order dependency. |
| `035_research_tasks.sql` | Add `research_tasks` — the per-company to-do list behind the collapsible Research Task panel that rides along on Draft & Review / Research / Position Review (API `/api/research-tasks`, reorder at `/api/research-tasks/reorder`). One row per item, scoped to a ticker, with a status (`todo`/`in_progress`/`blocked`/`done`), a priority (`high`/`medium`/`low`), an optional assignee (picked from the same saved-assignee roster as the `/tasks` board, via `/api/assignees`), free-form tags, notes, and a manual drag-order `position`. Deliberately separate from the firm-wide `tasks` board. Tenant-scoped, version-guarded (attaches the shared `bump_version` trigger like 031). The panel needs the table to function — until this runs, opening the panel just shows an empty list and adds fail (caught). Idempotent, no deploy-order dependency. |
| `036_task_due_date.sql` | Add an optional `due_date DATE` to `tasks`, backing the new **Week** view on `/tasks` (a Mon–Sun grid that buckets each card by its due date; undated cards stay in the Backlog rail). Day-grained by design (no time component). Everything else about the board is untouched; existing rows read as undated. Code degrades gracefully before it runs — the Week view shows every task in Backlog and dropping onto a day fails (caught) until applied. Idempotent, no deploy-order dependency. |
| `037_sticky_notes.sql` | Add `sticky_notes` — the app-wide **Sticky Notes** layer (component `src/components/StickyNotes.jsx`, API `/api/sticky-notes`). One row per note holding both the content (title, body, `color`) and the floating card's UI state (`pinned`, `minimized`, `pos_x`/`pos_y`, `width`/`height`, stacking `z`), so a pinned note returns exactly where it was across navigation, refreshes and sessions. `created_by` scopes notes to their author (product-level, via the route); RLS `tenant_id` stays the hard boundary. Tenant-scoped, version-guarded (attaches the shared `bump_version` trigger like 031) so two tabs never clobber a note. The feature needs the table to function — until this runs, the panel shows an empty list and create/save fail (caught). Idempotent, no deploy-order dependency. |
| `038_drop_ideas.sql` | Drop the `ideas` table. The **Workspace** section (the `/workspace` Ideas board + `/api/ideas` route) was removed 2026-07-11 — superseded by the app-wide Sticky Notes layer (037). With the page, API, feature gate, nav item and demo seed all gone, nothing reads `ideas`, so its rows are dead data. `DROP TABLE … CASCADE` also removes its `tenant_isolation` policy, grants and `bump_version_ideas` trigger. **This deletes data** (every tenant's Workspace notes) — that's the intent. Code-first is already satisfied (the referencing code is gone), so no deploy-order dependency; safe to run anytime. Idempotent. |

All of 001–021 are applied to the live database (001–020 verified by probe
2026-07-06; 021 applied and verified live in prod the same day, after the
code deploy and `scripts/migrate-storage-urls.mjs`). **022, 023 and 024 are
written but not yet applied — run them by hand in the Supabase SQL editor, in
order.** 023 and 024 each carry a deploy-order note in their header (ship the
app code first); the two are otherwise independent-but-ordered (024 assumes 023
has made `value` JSONB).

025 is a plain index swap (no app dependency). 026 creates the `macro-plots`
bucket; after applying it and deploying, run `scripts/migrate-macro-plots.mjs`
to backfill existing base64 plot rows into storage (the reader route handles
un-migrated base64 rows in the meantime, so there's no hard cutover).

027 (CHECK constraints) and 028 (FK) have no app dependency — run anytime; live
data was verified to conform before writing them. 029 (assumptions → JSONB)
carries a deploy-order note in its header (ship the app code first); the reader
tolerates both shapes so ordering is low-risk.

030 and 031 (optimistic concurrency) carry a deploy-order note in their headers:
**ship the app code first**, then apply them (031 after 030). Until they run, GETs
omit `version`, clients send no base version, and every save takes the historical
unguarded path — behaviour identical to before. Once applied, every editable row
save is a version-guarded compare-and-swap, so a stale write is rejected (409 →
the client reloads/merges) instead of silently clobbering a concurrent editor. No
data backfill beyond the column default; no hard cutover. 031 is a pure superset
of 030's approach (same trigger, more tables) and can be applied immediately after
030 in the same session.
