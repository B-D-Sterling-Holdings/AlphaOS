# AlphaOS — Database Architecture

*Verified against the live Supabase database on 2026-07-06 (all migrations
001–020 applied). Companion docs: `AUTH_ARCHITECTURE.md` (who may touch what
and why) and `BACKEND_ARCHITECTURE.md` (the app code that talks to this
database).*

This document describes the data layer: how the database is reached, how the
schema is evolved, what every table is for, the multi-tenant mechanics, and
the conventions (JSONB shapes, singletons, retention) that the app relies on.

---

## 1. Engine and access model

The database is a **Supabase project**: managed Postgres fronted by
**PostgREST** (REST over HTTP) plus **Supabase Storage** (object store). Three
facts shape everything else:

1. **There is no direct Postgres connection.** The app holds only PostgREST
   API keys, not a connection string. All reads/writes are HTTP calls through
   `@supabase/supabase-js`. Consequently there is **no programmatic DDL path**
   — schema changes are always applied by hand in the Supabase SQL editor
   (see §3).
2. **Row Level Security is the isolation boundary.** Tenant isolation is
   enforced by Postgres policies, not by application `WHERE` clauses. A query
   that forgets to filter cannot leak (verified by live probe — see
   `AUTH_ARCHITECTURE.md` §7).
3. **Three credential classes** with strictly increasing power:

   | Credential | Held by | Can do |
   |---|---|---|
   | Anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | every browser | nothing (RLS on, no anon policies; 4 relations hard-denied, the rest filter to zero rows) |
   | Tenant JWT (minted per request by `src/lib/supabaseTenant.js`, 1 h TTL, `tenant_id` claim) | server only | its own tenant's rows, via the `tenant_isolation` policies |
   | Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) | server + CI only | everything (BYPASSRLS) — used for identity tables, cron, demo reset, and pipeline sync, always stamping `tenant_id` explicitly |

As of 2026-07-06 the live database exposes **67 relations** through PostgREST:
31 tenant-scoped data tables, `users` + `tenants` + `auth_revocations`
(service-role-only), 8 pipeline/no-tenant relations (one of them a view), and
25 legacy `demo_*` tables (superseded, droppable).

---

## 2. Multi-tenancy mechanics

Introduced by migration `005_multitenancy.sql`; re-assertable by `018`/`019`.

- **`app_current_tenant()`** (SQL function, `STABLE`) reads the `tenant_id`
  claim out of the request JWT (`request.jwt.claims`). It returns NULL for the
  service role — which is why every service-role write must set `tenant_id`
  explicitly.
- Every tenant-scoped table has a **`tenant_id uuid NOT NULL`** column whose
  **DEFAULT is `app_current_tenant()`**, so inserts through a tenant JWT are
  stamped automatically, plus an `idx_<table>_tenant` index for the policy
  filter.
- Each such table carries exactly **one policy**:

  ```sql
  CREATE POLICY tenant_isolation ON <table> FOR ALL TO authenticated
    USING (tenant_id = app_current_tenant())
    WITH CHECK (tenant_id = app_current_tenant());
  ```

  `FOR ALL` + `WITH CHECK` refuses cross-tenant reads, writes, and re-stamping
  a row into another tenant.
- RLS is `ENABLE`d **and `FORCE`d** on *every* public table (001, re-asserted
  by 018), so even the table owner can't bypass it.
- **Identity tables** (`users`, `tenants`) and `auth_revocations` are RLS-on
  with **no policies** and explicit `REVOKE` from anon/authenticated:
  service-role only.
- **Pipeline tables without `tenant_id`** (`rag_*`, `scraped_content`,
  `content_chunks`, `chat_*`, `macro_regime_signal`, `task_comments`) are
  RLS-on with no policies: service-role only by construction.
- **Views bypass table RLS** — migration 019 therefore revokes
  anon/authenticated on every public view and sets `security_invoker = true`,
  so even a later re-grant only exposes what the caller's own RLS allows.

### Reserved tenants

| Tenant | UUID | Notes |
|---|---|---|
| CIO Alpha | `11111111-1111-1111-1111-111111111111` | original production data (005 backfilled every pre-tenancy row here); cannot be deleted through any code path |
| Demo | `22222222-2222-2222-2222-222222222222` | `tenants.is_demo = true`; wiped + re-seeded on every `demo`/`demo` login (§8) |

### The singleton pattern

Config tables that used to be single-row (`portfolio_cash`,
`allocation_config`, `sector_config`, `factor_config`, `macro_regime_config`,
`macro_regime_weights`) are keyed by **`PRIMARY KEY (tenant_id)`** — one row
per tenant — while keeping an `id` column defaulted to `1` so legacy
`.eq('id', 1)` reads and `{ id: 1 }` upserts still resolve under RLS. New
tenants get these rows from `seedTenantDefaults()` (`src/lib/users.js`) at
creation; the two reserved tenants were seeded by 005.

### Per-tenant business keys

Global uniques were re-scoped so two tenants can hold the same ticker/date/key
(005 did most; `009_finish_tenant_keys.sql` finished the stragglers):

| Table | Key |
|---|---|
| `theses`, `valuation_models`, `holdings`, `strategic_notes` | `UNIQUE (tenant_id, ticker)` |
| `ticker_prices`, `ticker_fundamentals` | `PRIMARY KEY (tenant_id, ticker, data_type)` |
| `app_settings` | `UNIQUE (tenant_id, key)` |
| `watchlists` | `PRIMARY KEY (tenant_id, id)` (`id` is text, e.g. `'default'`) |
| `fund_nav_data` | `UNIQUE (tenant_id, date)` |
| `prism_recommendations` | `UNIQUE (tenant_id, source_file)` |
| `prism_ticker_data` | `UNIQUE (tenant_id, ticker, category)` |
| `prism_ticker_documents` | `UNIQUE (tenant_id, ticker, filename)` |

Upsert call sites pass the matching `onConflict` (e.g.
`{ onConflict: 'tenant_id,ticker' }`).

---

## 3. Schema evolution (migrations)

Two artifacts, complementary:

- **`scripts/supabase-schema.sql`** — the idempotent *from-scratch* schema
  (base tables, buckets, storage policies, `updated_at` triggers, the
  auto-notify RPC). Safe to re-run; used only for brand-new projects.
- **`scripts/migrations/NNN_*.sql`** — ordered, append-only migrations, run
  **once, by hand, in the Supabase SQL editor** (no programmatic DDL path
  exists). Each is idempotent where practical; never edit an applied one —
  add a new number. After writing one, mirror the end-state into
  `supabase-schema.sql`.

Catalog (001–021 all **applied** to the live DB as of 2026-07-06):

| # | What it did |
|---|---|
| 001 | RLS enabled + forced on every public table (locks the anon key out) |
| 002 | Dropped orphaned `prism_runs` / `demo_prism_runs` |
| 003 | `set_updated_at()` trigger on every table with an `updated_at` column |
| 004 | Dropped public INSERT/DELETE storage policies (public read kept) |
| 005 | Multitenancy: `tenants`/`users`, `tenant_id` everywhere, `app_current_tenant()`, `tenant_isolation` policies, singleton re-keying, per-tenant uniques, demo/CIO seed |
| 006 | `set_draftreview_autonotify_sent()` RPC (nested-path JSONB update for the cron's dedup map) |
| 007 | `lessons` + `lesson_patterns` tables |
| 008 | `users.disabled_features text[]` (per-user feature denylist) |
| 009 | Finished per-tenant keys (`ticker_prices`/`ticker_fundamentals` PK, `theses`/`valuation_models`, `fund_nav_data`, `app_settings`) |
| 010 | `issues` table (tenant-scoped tracker) |
| 011 | Sub-users: role CHECK widened to `admin/owner/user`, `users.created_by` |
| 012 | One-time promotion of legacy single logins to workspace `owner` |
| 013 | `issues.number` (per-tenant sequential) + `issues.labels` |
| 014 | `issues.priority` (1–4) + `issues.dev_notes` (admin triage) |
| 015 | `issues.sort_order` (manual ordering within a priority band) |
| 016 | `issues.complexity` (1–4) |
| 017 | Widened complexity CHECK to 1–5 |
| 018 | Re-lock: RLS everywhere, drop stray policies, recreate `tenant_isolation` — re-run after any dashboard experiment or pipeline table rebuild |
| 019 | Lock views: revoke anon/authenticated on every public view + `security_invoker = true` |
| 020 | `auth_revocations(subject, not_before)` — session-revocation floor (service-role-only) |
| 021 | **Private storage buckets** (drop public read; reads go through `/api/storage/object` → signed URLs). Applied 2026-07-06 after the code deploy + `scripts/migrate-storage-urls.mjs`; verified live in prod. |

**Drift discipline:** anything created outside the repo (dashboard quick-adds,
pipeline `CREATE TABLE`) starts unlocked. Re-running 018 + 019 restores the
intended end-state regardless of cause.

---

## 4. Table inventory

Every table below is tenant-scoped (RLS `tenant_isolation`) unless marked
otherwise. "Writers" name the API routes / modules that touch it (see
`BACKEND_ARCHITECTURE.md` for the route catalog).

### Identity & auth (service-role only)

| Table | Purpose / key columns |
|---|---|
| `tenants` | one row per workspace: `id`, `name`, `is_demo`. Deleting a tenant cascades its `users` rows (but *not* data tables — see purge note below). |
| `users` | logins: `username` (unique, ci-indexed), `password_hash` (bcrypt), `role` (`admin`\|`owner`\|`user`), `tenant_id` (FK → tenants, CASCADE), `is_active`, `is_demo`, `disabled_features text[]`, `created_by` (FK → users, SET NULL). |
| `auth_revocations` | `subject text PK` (a users.id UUID or the literal `'cio-admin'`), `not_before timestamptz` — session JWTs issued before this instant are rejected. Written by logout via `revokeSessionsBefore()`. |

**Purge discipline:** data tables deliberately have **no FK to `tenants`**, so
deleting a workspace walks `TENANT_DATA_TABLES` in `src/lib/users.js`
explicitly (storage purge → data rows → tenant row). **Every new tenant-scoped
table must be added to that list** or workspace deletion will orphan its rows.

### Portfolio & financials

| Table | Purpose |
|---|---|
| `holdings` | the actual book: `ticker`, `shares`, `cost_basis`, `added_at`. `UNIQUE (tenant_id, ticker)`. Writers: `/api/holdings` via `lib/portfolio.js`. |
| `portfolio_cash` | singleton — one `cash` number per tenant. |
| `fund_nav_data` | daily `date`, `fund_nav`, `sp500_nav` series. NAV/share is computed by `/api/fund-nav` POST from the accounting state's share ladder; the S&P leg is normalized to inception (2024-09-17, ^GSPC 5634.58 → NAV 100). Read by the Financials charts and the investor-IRR engine. |
| `app_settings` | per-tenant key/value store (`UNIQUE (tenant_id, key)`, `value` is TEXT, usually JSON-stringified). Known keys: `fund-accounting-state` (the entire fund accounting engine state — quarters, periods, contributions), `activeWatchlistId`, `task_boards`, `activeTaskBoardId`, `assignees` / `assignees_<boardId>`, `saved_emails`. |

### Research pipeline (Watchlist → Draft & Review → Research → Position Review)

| Table | Purpose |
|---|---|
| `watchlists` | `id text` + `name` + **`stocks JSONB`** — the array of stock objects `{ ticker, stage, position, note, fundamentals{}, dueDiligenceItems[], dislocationItems[], … }`. `stage ∈ watching | draft | research | position` (the retired `researching` is folded into `watching` on read). Stage moves only flip this field (`lib/stageMove.js`). |
| `theses` | the per-ticker research dossier. `core_reasons JSONB`, `assumptions TEXT` (legacy plain string or JSON-stringified rich-text blocks), `valuation`, **`underwriting JSONB`** (see §6), `news_updates JSONB`, `todos JSONB`, `notes JSONB`. `UNIQUE (tenant_id, ticker)`. |
| `valuation_models` | `inputs JSONB` for the editable income-statement valuation engine (`lib/valuationModel.js`); outputs are recomputed client-side, never stored. |
| `ticker_prices` | generated market data, one row per `(ticker, data_type)` with `data_type ∈ daily_prices | market_data` and `data JSONB` (arrays of `{date, close}` / metric rows). Written by Generate Data (`lib/generateData.js`) from Yahoo. |
| `ticker_fundamentals` | same shape, `data_type ∈ revenue | eps | fcf | operating_margins | buybacks`, each a TTM quarterly frame computed from Alpha Vantage statements. **The app treats "has fundamentals rows" as "data exists"** (`/api/ticker/[ticker]`), which is why Generate Data refuses to report success without them. |
| `research_links` | saved links with extraction + summary state: `url`, `content_type` (tweet/web_article/…), `pasted_text`, `extracted_text` (server-fetched with an SSRF-guarded fetcher), `auto_summary`/`manual_summary`, `summary_status`, `is_read`. |
| `documents` | metadata for uploaded files (title, category, ticker, `storage_path`, public `url`); the bytes live in the `documents` storage bucket. |

### Strategy & ideas

| Table | Purpose |
|---|---|
| `strategic_notes` | per-held-position CIO annotations: sentiment, conviction 1–5, action (hold/trim/add/watch/exit), target_weight, priority, sort_order. `UNIQUE (tenant_id, ticker)`. |
| `candidate_positions` | research-pipeline candidates not yet held: status (researching/watching/ready/passed), sentiment, conviction, target_weight, sort_order. |
| `ideas` | free-form sticky notes: title/content/color/category/tags, pinned, archived, position. |

### Relationships (CRM)

| Table | Purpose |
|---|---|
| `contacts` | people: name/company/role, relationship_type & strength, importance, status, next_action, `follow_up_date`, `last_contacted_at`, tags. |
| `interactions` | log entries `FK contact_id → contacts ON DELETE CASCADE`; creating one also bumps the contact's `last_contacted_at` / `next_action`. |
| `contact_files` | links/files attached to a contact (CASCADE on delete). |

### Tasks

| Table | Purpose |
|---|---|
| `tasks` | kanban-ish todo rows: title, priority, done, notes, assignee, `subtasks JSONB`, status, `position` (manual order), `board_id` (boards live in `app_settings`). |
| `task_comments` | **exists in the DB but is referenced nowhere in `src/`** — service-role-only, no policies. If it's ever wired up it must join `TENANT_DATA_TABLES` and get a tenant policy. |

### Lessons learned

| Table | Purpose |
|---|---|
| `lessons` | post-mortems: ticker/company/title, enums (type, outcome, category, severity, repeat_risk, status, position_type), dates, `tags`, `pattern_ids` (uuid[] → lesson_patterns), `detail JSONB` (section editors), `comments JSONB` (Draft-&-Review-style threads). |
| `lesson_patterns` | named recurring patterns: description, why_it_matters, `checklist_questions JSONB`. Linked from lessons via `pattern_ids`; "related stocks" are derived client-side. |

### Issues tracker

| Table | Purpose |
|---|---|
| `issues` | GitHub-style tickets: `title`, `body JSONB` (rich-text blocks), `status open|resolved`, `author` (server-set from the session; non-admins only ever see their own), `comments JSONB`, per-tenant `number`, `labels JSONB`, and the admin-only triage columns `priority` (1–4), `complexity` (1–5, CHECK widened by 017), `dev_notes`, `sort_order`. `number` is assigned by a read-max+1 under RLS (races acceptable, no uniqueness constraint). |

### Config singletons (one row per tenant, `id = 1`)

`allocation_config` (optimizer settings JSONB), `sector_config`
(`{ sector: { label, color } }`), `factor_config` (`factors[]`,
`importance_weights`, `exposures` — feeds both the allocation optimizer and
the risk engine), `macro_regime_config` (allocator hyper-parameters, synced to
`config.yaml` before every pipeline run), `macro_regime_weights` (saved
portfolio weights), `portfolio_cash`.

### Macro-regime allocator

| Table | Purpose |
|---|---|
| `macro_regime_runs` | job history: `run_type` (run/fast/validate/predict/clean), status, timestamps, `log_output` (last 10 kB). **Retention: newest 5 per tenant** (pruned by the run route and `scripts/macro-sync.mjs`). |
| `macro_regime_results` | parsed outputs of a completed run: `backtest JSONB` (row array from CSV), `live_prediction JSONB` (final-model signal — preferred over the last backtest row), `metrics`, `report` (markdown), **`plots JSONB` (`{filename: base64 png}`)**, validation report/data. ⚠️ The schema file calls `run_id` a soft reference, but the **live DB has a hard FK to `macro_regime_runs.id`** (no cascade) — so results must always be deleted *before* runs (demo wipe and workspace purge are ordered accordingly), and pruning runs before their results can fail quietly. **Retention: newest 3 per tenant.** |
| `macro_regime_signal` | legacy pipeline-era signal cache; no `tenant_id`, service-role only, unread by current app code. |

### Prism AI (LLM fundamental-analysis pipeline)

| Table | Purpose |
|---|---|
| `prism_recommendations` | one row per analysis output: ticker, analysis_date, signal (BUY/HOLD/AVOID), conviction, position_size_pct, price_target, `recommendation`/`sections JSONB`, `full_response`, `source_file`. Signal-history helpers live in `lib/prismSignal.js`. The UI over this was archived (`docs/ai-pipeline-archive.md`) but the data + pipeline remain. |
| `prism_ticker_data` | generated CSVs stored as text, keyed `(tenant_id, ticker, category)` — e.g. `fundamentals/revenue`. |
| `prism_ticker_documents` | uploaded research PDFs, base64, keyed `(tenant_id, ticker, filename)`. |

### RAG / chat (service-role-only, no tenant_id, no policies)

`scraped_content`, `content_chunks` (with `embedding`), `chat_conversations`,
`chat_messages`, `rag_traces`, and the **`rag_coverage` view** (ingest stats —
the view that caused audit finding F1). These belong to the Python-pipeline
era; nothing in `src/` reads them today. They are locked (018/019) and safe to
leave or drop.

### Legacy `demo_*` clones (25 tables)

Pre-multitenancy demo copies of the data tables. Superseded by the Demo tenant
on 2026-07-01, unread, RLS-locked. Safe to drop whenever.

---

## 5. Functions, triggers, views

| Object | Purpose |
|---|---|
| `app_current_tenant() → uuid` | reads the JWT `tenant_id` claim; used by every policy and as the column DEFAULT. `GRANT EXECUTE` to authenticated + anon (policies call it). |
| `set_updated_at()` + `set_updated_at_<table>` triggers | BEFORE UPDATE on every table with an `updated_at` column (003; the schema file re-creates them for new tables). |
| `set_draftreview_autonotify_sent(p_tenant, p_ticker, p_sent)` | 006 — `jsonb_set` of exactly `underwriting → draftReview → autoNotify → sent` on one thesis, so the auto-notify cron can persist its dedup map **without clobbering a concurrent full-thesis save**. `service_role` execute only. |
| `rag_coverage` (view) | pipeline ingest stats. Locked by 019 (no anon/authenticated grants, `security_invoker = true`). |

---

## 6. JSONB conventions

The schema is deliberately JSONB-heavy: documents-shaped state (a thesis, a
watchlist, an accounting timeline) is stored as one row the app reads/writes
whole, rather than normalized across many tables. Conventions to preserve:

- **Rich text** is an array of blocks:
  `[{ type: 'text', value: '<html>' }, { type: 'image', url, path, name }]`.
  Legacy plain/HTML strings still appear and every reader tolerates them
  (`normalizeBody` in the issues route, `richHasContent` in
  `lib/researchProgress.js`, `renderBody` in `lib/email.js`).
- **`theses.underwriting`** is the biggest document. Load-bearing paths:
  - `researchWorkspace` — `{ note, fundamentals{revenueGrowth, profitability, capitalReturn, misc}, dueDiligenceItems[], dislocationItems[] }`; seeded **once** on entry to the research stage and never overwritten (`workspaceHasContent` guard in `lib/stageMove.js`).
  - `draftReview` — `{ paper: blocks[], threads: [{ id, title, resolved, messages: [{ id, role: 'author'|'reviewer', body, createdAt }] }], author {name,email}, reviewer {name,email}, autoNotify { enabled, everyDays 1–3, atMinutes, tz, roles, sent } }`.
  - `autoNotify.sent` — `{ [threadId]: { msgId, at } }`, the cron/in-app shared dedup map. Written only through the 006 RPC on the server path.
  - `sectionsComplete`, `equityRating`, valuation input fields — drive the Workflow progress strip (`lib/researchProgress.js`).
- **`watchlists.stocks[*].stage`** is the pipeline enum
  (`watching → draft → research → position`); every other ticker-keyed store
  survives stage moves untouched (the "no data loss" rule).
- **`app_settings.value`** is always TEXT; JSON is stringified in and parsed
  out by each route.
- **`macro_regime_results.plots`** stores whole PNGs as base64 in JSONB —
  results rows are megabytes; that's why retention is 3 and reads select only
  the columns they need.

---

## 7. Storage (private buckets + signed URLs)

Two **private** buckets (migration 021, applied); table RLS does not apply to
objects, so isolation is enforced in the app's storage layer instead:

| Bucket | Contents | Path convention |
|---|---|---|
| `research-images` | inline images from rich-text editors | `<tenant_id>/<TICKER>/<timestamp>_<filename>` |
| `documents` | uploaded files behind `/documents` | `<tenant_id>/<category>/<timestamp>_<filename>` |

- **All access is centralized in `src/lib/storage.js`** (pure primitives in
  `storageShared.js`): `uploadTenantImage`/`uploadTenantDocument` build the
  tenant-prefixed path server-side from sanitized segments;
  `getTenantSignedUrl` and `deleteTenantImage`/`deleteTenantDocument`
  re-validate every path against the session tenant. `getDb()` exposes no
  storage handle at all.
- **What content stores is the session-gated app URL**
  `/api/storage/object?bucket=…&path=…`. That route validates the session +
  tenant prefix and 302-redirects to a **signed URL** (5 min TTL; the
  redirect is `Cache-Control: private, max-age=240`). Leaked links (history,
  logs, exports, referrers) are therefore worthless without a session, and
  the only bearer-readable artifact is a signed URL bounded by its TTL
  (7 days for the ones minted into reminder emails at send time).
- The buckets hold **no anon/authenticated policies**; every operation runs
  through the service-role client behind the helpers above. Public
  INSERT/DELETE were dropped in 004, public READ in 021.
- The CIO tenant may additionally read/delete pre-multitenancy paths that
  carry no tenant prefix (they predate prefixing and can never collide with a
  tenant UUID prefix) — `isPathAllowedForTenant` encodes this exception once
  for reads, deletes, and email signing.
- Rows/content written before the cutover stored public object URLs;
  `scripts/migrate-storage-urls.mjs` rewrites them to app URLs (and
  `/api/documents` re-derives `url` from `storage_path` on every read
  regardless).
- Workspace deletion purges `<tenant_id>/` in both buckets via the non-exported
  `purgeTenantStorage()` (UUID-shape check + per-path prefix re-check).
- Demo resets do **not** purge storage (rows are wiped so objects become
  unreachable; deterministic seed paths overwrite in place).

---

## 8. The demo tenant lifecycle

- `scripts/provision-demo.mjs` (idempotent) creates the reserved Demo tenant +
  a `demo`/`demo` users row with `is_demo = true`.
- On every successful demo login, `resetDemoTenant()` (`src/lib/demoSeed.js`):
  1. refuses unless `tenants.is_demo = true` (a config mistake can never wipe
     a real workspace);
  2. wipes all Demo-tenant rows (FK children first, rest in parallel);
  3. re-seeds from `lib/demoData.js` (fictional "Blue Harbor Capital"
     narrative) + `lib/demoSeries.js` (deterministic PRNG price/NAV series,
     rescaled to live Yahoo quotes when reachable);
  4. uploads demo PDFs to deterministic storage paths (upsert-in-place).
- Resets are coalesced and throttled (20 s min interval); insert helpers
  tolerate schema drift (strip unknown columns and retry) and, pre-009,
  tolerated cross-tenant unique collisions (no longer relevant — 009 applied).
- Everything runs through the service role with `tenant_id` stamped explicitly.

---

## 9. Retention & data hygiene

| Data | Policy | Enforced by |
|---|---|---|
| `macro_regime_runs` | keep newest 5 per tenant | run route `pruneRuns()` + `macro-sync.mjs` |
| `macro_regime_results` | keep newest 3 per tenant | `pruneResults()` in both writers |
| `autoNotify.sent` dedup maps | entries for gone/resolved threads dropped on every write | `computeNextSent()` (`lib/autoNotify.js`) |
| demo tenant | full wipe + reseed on every demo login | `resetDemoTenant()` |
| deleted workspace | storage purge → all `TENANT_DATA_TABLES` rows → tenant row (cascades users) | `deleteWorkspace()` (`lib/users.js`) |

Everything else is kept indefinitely; there are no other TTLs.

---

## 10. Checklist — adding a new tenant-scoped table

1. Write a numbered migration: `CREATE TABLE … tenant_id uuid NOT NULL DEFAULT
   public.app_current_tenant()`, tenant index, `ENABLE`+`FORCE` RLS, the
   `tenant_isolation` policy, `GRANT SELECT, INSERT, UPDATE, DELETE … TO
   authenticated` (copy the 010 pattern) — or just create the table and re-run
   018, which retrofits all of that.
2. Business uniques go per-tenant: `UNIQUE (tenant_id, …)`, and upserts pass
   the matching `onConflict`.
3. Add the table to `TENANT_DATA_TABLES` in `src/lib/users.js` (workspace
   purge) and, if the demo should showcase it, to `DEMO_TABLES` +
   `lib/demoData.js`.
4. If it has `updated_at`, the 003 trigger loop in `supabase-schema.sql`
   covers it on fresh installs; live DBs get it by re-running that DO block.
5. Mirror the end-state into `scripts/supabase-schema.sql` and add the row to
   `scripts/migrations/README.md`.
6. If the table's API should be feature-gated, map its route prefix in
   `API_FEATURES` (`src/lib/features.js`) — see `AUTH_ARCHITECTURE.md` §5.
