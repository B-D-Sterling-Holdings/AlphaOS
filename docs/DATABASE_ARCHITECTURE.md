# AlphaOS — Database Architecture

*Verified against the live Supabase database on 2026-07-06. Companion docs:
`AUTH_ARCHITECTURE.md` (who may touch what and why) and
`BACKEND_ARCHITECTURE.md` (the app code that talks to this database). The
ordered SQL change history lives in `scripts/migrations/`.*

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

The live database exposes **27 relations** through PostgREST: 22 tenant-scoped
data tables, `users` + `tenants` + `auth_revocations` (service-role-only), and
2 no-tenant pipeline tables (`macro_regime_signal`, `task_comments`). (The six
former single-row config tables were folded into `app_settings` — see §2.)

---

## 2. Multi-tenancy mechanics

Tenant isolation is enforced entirely in the database (RLS), not by application
`WHERE` clauses.

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
- RLS is `ENABLE`d **and `FORCE`d** on *every* public table, so even the table
  owner can't bypass it.
- **Identity tables** (`users`, `tenants`) and `auth_revocations` are RLS-on
  with **no policies** and explicit `REVOKE` from anon/authenticated:
  service-role only.
- **Pipeline tables without `tenant_id`** (`macro_regime_signal`,
  `task_comments`) are RLS-on with no policies: service-role only by
  construction.
- **Views bypass table RLS** — so anon/authenticated are revoked on every
  public view and `security_invoker = true` is set, so even a later re-grant
  only exposes what the caller's own RLS allows. (There are no public views
  today; this remains the standing rule for any future one.)

### Reserved tenants

| Tenant | UUID | Notes |
|---|---|---|
| CIO Alpha | `11111111-1111-1111-1111-111111111111` | holds the original production data; cannot be deleted through any code path |
| Demo | `22222222-2222-2222-2222-222222222222` | `tenants.is_demo = true`; wiped + re-seeded on every `demo`/`demo` login (§8) |

### Per-tenant config

All per-tenant configuration lives in **`app_settings`** — one row per
`(tenant_id, key)` with a JSONB `value` (see §6). This includes what used to be
six standalone single-row config tables (`allocation_config`, `sector_config`,
`factor_config`, `macro_regime_config`, `macro_regime_weights`,
`portfolio_cash`), collapsed into keyed rows by migration 024. All access goes
through the tiny `readSetting`/`writeSetting` helpers in `src/lib/appSettings.js`.

Every config reader has a **built-in default** and the first save creates the
row, so a new tenant needs nothing seeded — `seedTenantDefaults()`
(`src/lib/users.js`) is a no-op kept only as a hook for future defaults.

### Per-tenant business keys

Business uniques are scoped per tenant so two tenants can hold the same
ticker/date/key:

| Table | Key |
|---|---|
| `theses`, `valuation_models`, `holdings`, `strategic_notes` | `UNIQUE (tenant_id, ticker)` |
| `ticker_prices`, `ticker_fundamentals` | `PRIMARY KEY (tenant_id, ticker, data_type)` |
| `app_settings` | `PRIMARY KEY (tenant_id, key)`, `value JSONB` |
| `watchlists` | `PRIMARY KEY (tenant_id, id)` (`id` is text, e.g. `'default'`) |
| `fund_nav_data` | `UNIQUE (tenant_id, date)` |

Upsert call sites pass the matching `onConflict` (e.g.
`{ onConflict: 'tenant_id,ticker' }`).

---

## 3. Schema evolution

There is **no programmatic DDL path** (the app holds only PostgREST keys, no
connection string), so every schema change is applied **by hand, once, in the
Supabase SQL editor**.

**The single source of truth is `scripts/migrations/`, replayed in numeric
order.** There is no separate hand-maintained "from-scratch schema" file — that
approach drifted and was retired.

- **`scripts/migrations/000_initial_schema.sql`** — the frozen single-tenant
  baseline (migration zero): the original base tables, buckets, `updated_at`
  triggers, and auto-notify RPC. It does **not** reflect the current schema and
  is **never edited** — it is history.
- **`scripts/migrations/001+`** — the ordered, append-only change history, one
  numbered file per change (RLS, multitenancy, per-tenant keys, feature
  tables…). Each is idempotent where practical; never edit an applied one — add
  a new file. The catalog of what each did lives in
  `scripts/migrations/README.md`.

Building a database from zero (disaster recovery / a fresh clone) means running
every migration `000 → 001 → … → newest` in order. **This document is the
human-readable description of the resulting current state** — read it, not any
one SQL file, to know what the schema looks like today.

**Drift discipline:** anything created outside the repo (dashboard quick-adds,
pipeline `CREATE TABLE`) starts unlocked. The RLS/view-lock migrations are
idempotent — re-running them restores the intended end-state regardless of
cause.

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
| `fund_nav_data` | daily `date`, `fund_nav`, `sp500_nav` series. NAV/share is computed by `/api/fund-nav` POST from the accounting state's share ladder; the S&P leg is normalized to inception (2024-09-17, ^GSPC 5634.58 → NAV 100). Read by the Financials charts and the investor-IRR engine. |
| `app_settings` | per-tenant key/value store (`PRIMARY KEY (tenant_id, key)`, `value` is **JSONB**). The single home for per-tenant config; all access via `readSetting`/`writeSetting` in `lib/appSettings.js`. Known keys: `fund-accounting-state` (the entire fund accounting engine state — quarters, periods, contributions), `activeWatchlistId`, `task_boards`, `activeTaskBoardId`, `assignees` / `assignees_<boardId>`, `saved_emails`, and the former config tables `portfolio_cash` (`{cash}`), `allocation_config`, `sector_config`, `factor_config`, `macro_regime_config`. |

### Research pipeline (Watchlist → Draft & Review → Research → Position Review)

| Table | Purpose |
|---|---|
| `watchlists` | `id text` + `name` + **`stocks JSONB`** — the array of stock objects `{ ticker, stage, position, note, fundamentals{}, dueDiligenceItems[], dislocationItems[], … }`. `stage ∈ watching | draft | research | position` (the retired `researching` is folded into `watching` on read). Stage moves only flip this field (`lib/stageMove.js`). |
| `theses` | the per-ticker research dossier. `core_reasons JSONB`, **`assumptions JSONB`** (rich-text block array, or a bare string for legacy/empty — stored natively since 029), `valuation TEXT` (plain string), **`underwriting JSONB`** (see §6), `news_updates JSONB`, `todos JSONB`, `notes JSONB`. `UNIQUE (tenant_id, ticker)`. |
| `valuation_models` | `inputs JSONB` for the editable income-statement valuation engine (`lib/valuationModel.js`); outputs are recomputed client-side, never stored. |
| `ticker_prices` | generated market data, one row per `(ticker, data_type)` with `data_type ∈ daily_prices | market_data` and `data JSONB` (arrays of `{date, close}` / metric rows). Written by Generate Data (`lib/generateData.js`) from Yahoo. |
| `ticker_fundamentals` | same shape, `data_type ∈ revenue | eps | fcf | operating_margins | buybacks`, each a TTM quarterly frame computed from Alpha Vantage statements. **The app treats "has fundamentals rows" as "data exists"** (`/api/ticker/[ticker]`), which is why Generate Data refuses to report success without them. |
| `research_links` | saved links with extraction + summary state: `url`, `content_type` (tweet/web_article/…), `pasted_text`, `extracted_text` (server-fetched with an SSRF-guarded fetcher), `auto_summary`/`manual_summary`, `summary_status`, `is_read`. |
| `documents` | metadata for uploaded files (title, category, ticker, `storage_path`, public `url`); the bytes live in the `documents` storage bucket. |

### Strategy & ideas

| Table | Purpose |
|---|---|
| `strategic_notes` | per-held-position CIO annotations, **one row per held ticker** (`UNIQUE (tenant_id, ticker)`, upsert). `sentiment` ∈ uneasy/neutral/feeling_good, `conviction` 1–5, `action` ∈ exit/trim/hold/add(/watch), `priority` ∈ low/normal/high/urgent, plus `action_reason`, `alternatives`, `expected_return`, `target_weight`, `sort_order`. Enum columns are CHECK-constrained (027). |
| `candidate_positions` | research-pipeline candidates not yet held — an **id-keyed list** (a ticker may recur), distinct from `strategic_notes`. `status` ∈ researching/watching/ready/passed, `sentiment`/`priority`/`conviction` share the same vocab as strategic_notes, plus `target_weight`, `sort_order`. Enum columns CHECK-constrained (027). *Not merged with `strategic_notes`: different key model + different type-specific fields (see note below).* |
| `ideas` | free-form sticky notes: title/content/color/category/tags, pinned, archived, position. |

> **Why `strategic_notes` and `candidate_positions` stay separate.** They look
> similar (both carry sentiment/conviction/priority/target_weight for a ticker)
> but model different things: `strategic_notes` is a **1:1 annotation on a held
> position** (ticker-unique, upsert), while `candidate_positions` is a **list of
> research ideas** (id-keyed, a ticker may appear more than once) with its own
> `status` lifecycle and none of the held-position fields (`action`,
> `expected_return`, `alternatives`). Merging them behind a discriminator would
> force those columns nullable and break the ticker-unique upsert — a
> single-table-inheritance smell for no real gain. They share the same enum
> vocabularies (enforced by 027), which is the consistency that actually matters.

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
| `issues` | GitHub-style tickets: `title`, `body JSONB` (rich-text blocks), `status open|resolved`, `author` (server-set from the session; non-admins only ever see their own), `comments JSONB`, per-tenant `number`, `labels JSONB`, and the admin-only triage columns `priority` (1–4), `complexity` (1–5), `dev_notes`, `sort_order`. `number` is assigned by a read-max+1 under RLS (races acceptable, no uniqueness constraint). |

### Per-tenant config (keys in `app_settings`)

These were once six single-row config tables; migration 024 folded them into
`app_settings` as one JSONB row each (key = the old table name), read/written
via `lib/appSettings.js`:

- `allocation_config` — optimizer settings.
- `sector_config` — `{ sector: { label, color } }`.
- `factor_config` — `{ factors[], importance_weights, exposures }`, feeds both
  the allocation optimizer and the risk engine.
- `macro_regime_config` — allocator hyper-parameters, synced to `config.yaml`
  before every pipeline run.
- `portfolio_cash` — `{ cash }`, one number per tenant.

### Macro-regime allocator

| Table | Purpose |
|---|---|
| `macro_regime_runs` | job history: `run_type` (run/fast/validate/predict/clean), status, timestamps, `log_output` (last 10 kB). **Retention: newest 5 per tenant** (pruned by the run route and `scripts/macro-sync.mjs`). |
| `macro_regime_results` | parsed outputs of a completed run: `backtest JSONB` (row array from CSV), `live_prediction JSONB` (final-model signal — preferred over the last backtest row), `metrics`, `report` (markdown), **`plots JSONB` (`{filename: storage_path}`)** — the PNGs live in the `macro-plots` bucket (see §7), not inline; the row stores only paths. Validation report/data. `run_id` is a hard FK to `macro_regime_runs.id` with **ON DELETE SET NULL** (029→028): deleting a run nulls the reference instead of erroring, so the old "delete results before runs" ordering is now just belt-and-suspenders, not a correctness requirement. **Retention: newest 3 per tenant** (pruning a result also purges its plot folder). |
| `macro_regime_signal` | legacy pipeline-era signal cache; no `tenant_id`, service-role only, unread by current app code. |

---

## 5. Functions, triggers, views

| Object | Purpose |
|---|---|
| `app_current_tenant() → uuid` | reads the JWT `tenant_id` claim; used by every policy and as the column DEFAULT. `GRANT EXECUTE` to authenticated + anon (policies call it). |
| `set_updated_at()` + `set_updated_at_<table>` triggers | BEFORE UPDATE on every table with an `updated_at` column (the schema file re-creates them for new tables). |
| `bump_version()` + `bump_version_<table>` triggers | BEFORE UPDATE on every table with a `version` column (`theses`, `watchlists`, `valuation_models`, `app_settings`), incrementing it on each update. This is the optimistic-concurrency counter — see §11. |
| `set_draftreview_autonotify_sent(p_tenant, p_ticker, p_sent)` | `jsonb_set` of exactly `underwriting → draftReview → autoNotify → sent` on one thesis, so the auto-notify cron can persist its dedup map **without clobbering a concurrent full-thesis save**. `service_role` execute only. (The `bump_version` trigger also advances the thesis version on this write, so a client holding a stale version is detected — see §11.) |

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
  `theses.assumptions` is a JSONB column of exactly this shape (or a bare string
  for legacy/empty rows), stored natively since 029 — no serialize/parse.
- **`theses.underwriting`** is the biggest document. Load-bearing paths:
  - `researchWorkspace` — `{ note, fundamentals{revenueGrowth, profitability, capitalReturn, misc}, dueDiligenceItems[], dislocationItems[] }`; seeded **once** on entry to the research stage and never overwritten (`workspaceHasContent` guard in `lib/stageMove.js`).
  - `draftReview` — `{ paper: blocks[], threads: [{ id, title, resolved, messages: [{ id, role: 'author'|'reviewer', body, createdAt }] }], author {name,email}, reviewer {name,email}, autoNotify { enabled, everyDays 1–3, atMinutes, tz, roles, sent } }`.
  - `autoNotify.sent` — `{ [threadId]: { msgId, at } }`, the cron/in-app shared dedup map. Written only through the `set_draftreview_autonotify_sent` RPC on the server path.
  - `sectionsComplete`, `equityRating`, valuation input fields — drive the Workflow progress strip (`lib/researchProgress.js`).
- **`watchlists.stocks[*].stage`** is the pipeline enum
  (`watching → draft → research → position`); every other ticker-keyed store
  survives stage moves untouched (the "no data loss" rule).
- **`app_settings.value`** is **JSONB** — stored and read natively via
  `readSetting`/`writeSetting` (`lib/appSettings.js`), no stringify/parse. The
  helpers still tolerate a legacy stringified value so a mid-deploy row can't
  break a read. (One exception: `/api/accounting-state` keeps a string-based
  wire contract with its client, parsing/serializing at the route boundary.)
- **`macro_regime_results.plots`** is `{ filename: storage_path }` — the PNGs
  live in the `macro-plots` bucket (§7), not inline, so results rows stay small.
  (Legacy rows may still hold base64; the reader route handles both until
  `scripts/migrate-macro-plots.mjs` backfills them.)

---

## 7. Storage (private buckets + signed URLs)

Three **private** buckets; table RLS does not apply to objects, so isolation is
enforced in the app's storage layer instead:

| Bucket | Contents | Path convention |
|---|---|---|
| `research-images` | inline images from rich-text editors | `<tenant_id>/<TICKER>/<timestamp>_<filename>` |
| `documents` | uploaded files behind `/documents` | `<tenant_id>/<category>/<timestamp>_<filename>` |
| `macro-plots` | macro-regime backtest plot PNGs | `<tenant_id>/<run_id>/<filename>.png` |

- **All access is centralized in `src/lib/storage.js`** (pure primitives in
  `storageShared.js`): `uploadTenantImage`/`uploadTenantDocument` build the
  tenant-prefixed path server-side from sanitized segments;
  `getTenantSignedUrl` and `deleteTenantImage`/`deleteTenantDocument`
  re-validate every path against the session tenant. Macro plots use the
  parallel `uploadMacroPlotForTenant` (explicit tenant — the writer is a
  background run/CI callback) + `getMacroPlotSignedUrl` (session-checked, behind
  `/api/macro-regime/plots`). `getDb()` exposes no storage handle at all.
- **What content stores is the session-gated app URL**
  `/api/storage/object?bucket=…&path=…`. That route validates the session +
  tenant prefix and 302-redirects to a **signed URL** (5 min TTL; the
  redirect is `Cache-Control: private, max-age=240`). Leaked links (history,
  logs, exports, referrers) are therefore worthless without a session, and
  the only bearer-readable artifact is a signed URL bounded by its TTL
  (7 days for the ones minted into reminder emails at send time).
- The buckets hold **no anon/authenticated policies** at all — no public
  INSERT, DELETE, or READ; every operation runs through the service-role
  client behind the helpers above.
- The CIO tenant may additionally read/delete pre-multitenancy paths that
  carry no tenant prefix (they predate prefixing and can never collide with a
  tenant UUID prefix) — `isPathAllowedForTenant` encodes this exception once
  for reads, deletes, and email signing.
- Stored URLs are never trusted: `/api/documents` re-derives `url` from
  `storage_path` on every read, so a row always resolves to the current
  session-gated app URL.
- Workspace deletion purges `<tenant_id>/` in all three buckets via the
  non-exported `purgeTenantStorage()` (UUID-shape check + per-path prefix
  re-check).
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
  tolerate schema drift (strip unknown columns and retry).
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
   authenticated` (copy an existing tenant-scoped table's block) — or just
   create the table and re-run the RLS-lock migration, which retrofits all of
   that.
2. Business uniques go per-tenant: `UNIQUE (tenant_id, …)`, and upserts pass
   the matching `onConflict`.
3. Add the table to `TENANT_DATA_TABLES` in `src/lib/users.js` (workspace
   purge) and, if the demo should showcase it, to `DEMO_TABLES` +
   `lib/demoData.js`.
4. If it has `updated_at`, include the `set_updated_at` trigger in your
   migration (copy an existing table's block, or re-run `003`'s DO loop, which
   attaches it to any table that has the column).
5. If it has **any user-facing edit (UPDATE) path**, give it a `version integer
   NOT NULL DEFAULT 1` column so the `bump_version` trigger picks it up, write
   through `versionedWrite` / `versionedMutate` (`src/lib/concurrency.js`) in the
   route, and save from the client through `saveWithOCC` / `saveRow`
   (`src/lib/occClient.js`). Every editable table is expected to be OCC-guarded —
   see §11. (Append-only logs and machine-generated tables are the only
   exceptions; 031's header lists them.)
6. Record the change in `scripts/migrations/README.md`. (There is no
   separate schema file to mirror into — the migrations are the source of
   truth; see §3.)
7. If the table's API should be feature-gated, map its route prefix in
   `API_FEATURES` (`src/lib/features.js`) — see `AUTH_ARCHITECTURE.md` §5.

---

## 11. Optimistic concurrency (no lost updates)

**Every user-editable row in the database is guarded against lost updates by
optimistic concurrency control (OCC)** — not just the big documents. A blind
`update`/`upsert` is last-write-wins: two people (or one person in two tabs)
editing the same row silently overwrite each other. OCC makes that impossible.

Coverage (migrations 030 + 031 add the `version` column; the trigger is generic):

| Kind | Tables | Client policy on conflict |
|---|---|---|
| Collaborative documents | `theses`, `watchlists` | **merge + retry** — union Draft & Review threads / re-apply stage moves (no edit lost) |
| Autosaved documents | `lessons`, `fund-accounting-state` (`app_settings`) | merge comment threads + retry (lessons) / reload latest (accounting) |
| Per-row records | `ideas`, `research_links`, `documents`, `tasks`, `contacts`, `lesson_patterns`, `strategic_notes`, `candidate_positions`, `holdings`, `valuation_models` | **reload-and-redo** — adopt the server's fresh row + notify |
| Server-side read-modify-write | `issues.comments`, `factor_config`/`sector_config` exposures | **server-side guarded retry** — the append/patch always lands, never 409s the user |
| Single-writer config | `allocation_config`, `macro_regime_config`/`_weights`, `task_boards`, `assignees`, `saved_emails` | last-write-wins retained deliberately (the `version` column exists; wire `baseVersion` if they become multi-writer) |
| UI pointers | `activeWatchlistId`, `activeTaskBoardId` | unguarded by design (a scalar cursor, no document to lose) |

The mechanism below is identical for all of them — one `version` counter, one
server helper, one client helper. What differs per surface is only the *policy*
in the table above.

- **The token.** Each such table carries a monotonic **`version integer`**,
  advanced on every UPDATE by the `bump_version` trigger (§5). Every document GET
  returns the current `version`; the client echoes it back on save.
- **Compare-and-swap.** A save is an `UPDATE … WHERE <key> AND version = <base>`.
  Postgres row locking makes it atomic, so of two saves that both started from
  version *N*, exactly one lands (row → *N+1*) and the other matches **zero
  rows**. The loser is reported as a conflict (HTTP **409** carrying the current
  server row) rather than being allowed to clobber. All of this is centralized in
  **`versionedWrite`** (`src/lib/concurrency.js`); routes translate a
  `VersionConflictError` into the 409.
- **Server-side read-modify-write.** For mutations the server performs itself —
  appending a comment to `issues.comments`, patching one field of the
  `factor_config`/`sector_config` blob — there is nothing to 409 the user with, so
  **`versionedMutate`** (`src/lib/concurrency.js`) reads the row, applies the
  change, and commits under the guard, **retrying on a concurrent change**. Two
  people commenting on the same issue at once therefore both land.
- **Client reconciliation is one helper.** The browser never hand-writes 409
  handling: **`saveWithOCC`** (`src/lib/occClient.js`) owns the fetch → detect-409
  → merge → retry loop, and each surface passes only a `merge(local, server)`
  policy (or none, for reload-and-redo). Concretely:
  - *Theses* union Draft & Review comment threads/messages, todos and news **by id**
    and retry, so two reviewers commenting at once both survive (`mergeThesis`,
    `src/lib/thesisMerge.js`); a genuine same-field edit is last-write-wins **but
    visible**. *Lessons* do the same for their comment threads.
  - *Watchlist stage moves* re-apply the single flip onto the server's fresh state
    and retry (`persistStageMove`); direct watchlist edits reload + prompt a redo.
  - *Per-row records* (ideas, links, documents, tasks, contacts, notes, holdings, …)
    adopt the server's fresh row and prompt the user to re-apply — the safe default
    when two people edit the same scalar field.
  - *Accounting* adopts the server version and reloads the latest.
- **Row lifecycle.** New rows start at `version = 1`; the client represents "no row
  yet" as base **0**, which routes to an INSERT (a losing INSERT trips the
  per-tenant unique key and is reported as a conflict, so a create race can't lose
  data either).
- **Back-compatible rollout.** `versionedWrite` treats a missing base version
  (`undefined`) as the legacy unguarded write, and every GET selects `*` (never a
  bare `version` column), so the app behaves exactly as before until the `version`
  columns exist and then upgrades itself with no hard cutover. This is why 030/031
  can ship code-first and be applied later.
