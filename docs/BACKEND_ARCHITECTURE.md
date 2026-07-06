# AlphaOS — Backend & System Architecture

*Verified against the code on branch `auth_design` and the live database on
2026-07-06. Companion docs: `AUTH_ARCHITECTURE.md` (auth/RBAC/RLS in depth),
`DATABASE_ARCHITECTURE.md` (schema and tenancy mechanics),
`MACRO_REGIME_ALLOCATOR_DEEP_DIVE.md` (allocator math), and the root
`README.md` (allocation optimizer math).*

AlphaOS is a multi-tenant investment-research operating system: portfolio
book, research pipeline (watchlist → draft/review → research → position
review), allocation/risk analytics, macro tactical allocator, CRM, tasks,
lessons, documents, and an in-app issue tracker.

---

## 1. Stack at a glance

| Layer | Technology |
|---|---|
| Web app | Next.js 16 (App Router, plain JavaScript), React 19, Tailwind 4, Chart.js |
| API | Next.js route handlers under `src/app/api/**` (Node runtime) |
| Edge gate | `src/proxy.js` (Next.js proxy/middleware) — session + feature + role gates |
| Auth | self-issued HS256 JWT cookie (`jose`), bcrypt (`bcryptjs`) — **not** Supabase Auth |
| Data | Supabase: Postgres + PostgREST (via `@supabase/supabase-js`) + Storage; RLS-enforced multitenancy |
| Email | Gmail SMTP via `nodemailer` (App Password) |
| Market data | `yahoo-finance2` (quotes/charts/fundamentals), Alpha Vantage (financial statements) |
| AI/ML sidecars | `macro_regime_allocator/` (Python: sklearn regime backtest, FRED data) — run via `uv`, spawned locally or on GitHub runners, never on Vercel |
| Scheduled work | GitHub Actions (`auto-notify.yml` every 30 min; `macro-regime.yml` monthly + dispatch) |
| Exports | `docx` + `file-saver` client-side report generation (`lib/exportReport.js`) |

There is no ORM, no Redis, no queue, and no direct Postgres socket — every
data access is an HTTP call to PostgREST, and all cross-request server state
is either in Postgres or in small per-instance in-memory caches.

---

## 2. Runtime topology

```
                        ┌─────────────────────────────┐
 Browser (React SPA-ish │ Next.js app                 │     Supabase
 pages + fetch)         │                             │  ┌──────────────┐
   │  cookie session    │  src/proxy.js (edge gate)   │  │ PostgREST    │
   ├───────────────────▶│    │                        │  │  + Postgres  │
   │                    │    ▼                        │  │  (RLS)       │
   │                    │  /api/* route handlers ─────┼─▶│              │
   │                    │    │        │               │  │ Storage      │
   │                    │  getDb()  supabaseAdmin ────┼─▶│  (buckets)   │
   │                    │  (tenant JWT) (service key) │  └──────────────┘
   │                    └────┬────────────┬───────────┘
   │                         │            │ spawn (local/CI only)
   ▼                         ▼            ▼
 Yahoo Finance          Gmail SMTP   macro_regime_allocator/ (FRED)
 (client never calls    (nodemailer)
  vendors directly)
        ▲
        │ POST /api/cron/auto-notify (CRON_SECRET)     repository_dispatch
 GitHub Actions ───────────────────────────────────────────────────────────▶
 (auto-notify.yml, macro-regime.yml → scripts/macro-sync.mjs → Supabase)
```

**Environments**

- **Dev**: `npm run dev` on port 3000. The macro-run route spawns `make`/`uv`
  directly; env is read from `.env.local` (the route handler even re-parses it
  for the child process).
- **Local prod build**: `npm run build && npm start` — runs on port 3457 on
  the user's machine. Source edits need a rebuild to show up there.
- **Deployed**: Vercel (Hobby). Constraints that shaped the design:
  serverless default timeout (long routes export `maxDuration = 60`), no
  Python/`make`/writable FS (macro runs are **dispatched to GitHub Actions**
  instead of spawned — see §8), and daily-only Vercel cron (auto-notify runs
  from GitHub Actions instead).
- **CI compute**: GitHub Actions is the substrate for anything that can't run
  serverless; results always land in Supabase, which the deployed app reads.

---

## 3. Request lifecycle

1. **Browser** — pages are client components behind `AuthGate`; data loading
   is plain `fetch('/api/…')` with the httpOnly session cookie. An in-memory
   per-session cache (`lib/CacheContext.jsx`) memoizes payloads under
   page-scoped keys; cross-page invalidation goes through helpers
   (`lib/stageMove.js` `writeWatchlistCache`, `lib/generateTickerJob.js`).
2. **Edge proxy** (`src/proxy.js`, matcher = `/api/:path*` + every gated page
   route) —
   - *Pages*: `/admin` requires a manager role (redirect home otherwise);
     feature-gated pages check the `disabledFeatures` claim in the signed JWT
     (no DB call) and redirect restricted users home.
   - *APIs*: `/api/auth/*` and `/api/cron/*` pass through (they authenticate
     themselves); everything else requires a verifiable session JWT (from the
     `Authorization: Bearer` header or the cookie) → 401. Then `/api/admin/*`
     is **role-gated** (`canManageUsers` → 403 for a plain user); everything
     else runs the **default-deny** feature gate (`isApiAllowed()` → 403 for a
     disabled area, *and* for any route not classified in `features.js`).
     Admins are exempt from the feature gate.
3. **Route handler** (`src/app/api/**/route.js`) — thin: parse/validate,
   delegate to a lib module or query via `getDb()`, return
   `NextResponse.json`.
4. **Data access** (`src/lib/db.js`) — `getSession()` re-verifies the cookie,
   the user's `is_active` flag, and the logout revocation floor (both behind a
   30 s in-memory cache); `getDb()` then mints a 1 h Supabase JWT for the
   session's tenant (`lib/supabaseTenant.js`) and returns a facade:
   `.from()`/`.rpc()` are RLS-scoped to the tenant, plus
   `tenantId/role/username/userId/isAdmin`. It deliberately exposes **no**
   storage handle — all object access goes through `src/lib/storage.js`
   instead. **Fails closed** — no session, no data.
5. **PostgREST/Postgres** — the `tenant_isolation` policies do the actual
   isolation; a forgotten filter cannot leak (see `DATABASE_ARCHITECTURE.md`).

Security headers (deny framing, nosniff, referrer policy, permissions policy)
are set globally in `next.config.mjs`.

### Who uses which credential

- **34 of 52 routes** call `getDb()` directly; 6 more (portfolio, holdings,
  cash, watchlist, generate-data, ticker) reach it through their lib modules.
- **Service role** (`supabaseAdmin`) appears only in: the auth stack
  (`lib/users.js` — identity tables), `/api/cron/auto-notify` (a scheduler has
  no session; it scans all tenants), demo reset (`lib/demoSeed.js`), storage
  access inside the `getDb()` facade, and CI (`scripts/macro-sync.mjs`).
- **Pure proxies with no DB at all**: `/api/quotes`, `/api/fundamentals`,
  `/api/period-changes`, `/api/validate-ticker`, `/api/realized-vol`,
  `/api/return-covariance` (Yahoo), `/api/notify-review` (SMTP).

---

## 4. API catalog

Auth column: **S** = session required by the proxy (the default), **S+A** =
session + admin/owner enforcement (now at the edge *and* in the route for
`/api/admin/*`), **C** = `CRON_SECRET`, **–** = open (auth endpoints manage
their own session). The API gate is **default-deny**: every `/api/*` route is
classified in `src/lib/features.js` as feature-owned (`API_FEATURES`, 403 when
all owning features are disabled), role-gated (`ROLE_GATED_API_ROUTES`), or
common (`COMMON_API_ROUTES`); an unclassified route is refused. Admins are
exempt from the feature gate.

### Auth & administration

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/auth/login` | POST | – | rate-limit guard → managed users (bcrypt) → env bootstrap admin → dev fallback; demo logins trigger the tenant reseed; sets the session cookie via `setSessionCookie` (lifetime = `SESSION_TTL_SECONDS`, 7 d) |
| `/api/auth/logout` | POST | – | stamps the `auth_revocations` floor for the subject (best-effort), clears the cookie |
| `/api/auth/me` | GET | – | live session probe: enforces revocation floor + `is_active`, refreshes role/features from the DB, re-issues the cookie when claims drifted |
| `/api/admin/users` | GET/POST/PATCH/DELETE | S+A | user & workspace management; global admins see everything, owners are confined to `role='user'` rows of their own tenant (`requireOwnedSubUser`); handles create (workspace or sub-user), rename login/workspace, password reset, role owner⇄user, feature toggles, enable/disable, delete user/workspace |

### Portfolio & market data

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/portfolio` | GET | S | holdings + cash (`lib/portfolio.js`) |
| `/api/holdings` | POST/DELETE | S | upsert / remove a holding |
| `/api/cash` | POST | S | set the cash balance |
| `/api/quotes` | GET | S | batched live quotes + quoteSummary via Yahoo (`lib/yahoo.js`); one batch request then per-ticker enrichment, tolerant of partial failures |
| `/api/fundamentals` | GET | S | sector/PE/beta-style snapshot per ticker (Yahoo; ETF sector inference fallback) |
| `/api/period-changes` | GET | S | % change over 1d/1mo/…/5y per ticker (Yahoo charts) |
| `/api/validate-ticker` | GET | S | does the symbol exist; suggests listings via Yahoo search when not |
| `/api/risk` | POST | S | underwritten factor-risk engine over the holdings (`lib/fetchRisk.js` + `lib/riskEngine.js`: exposure × crowding × importance, plus observed vol/drawdown/VaR/correlation) |
| `/api/realized-vol` | GET | S | annualized realized vol per ticker (feeds the allocation page's auto vol score) |
| `/api/return-covariance` | GET | S | annualized sample covariance matrix over aligned daily returns (the Markowitz side of the allocation blend) |
| `/api/factor-config`, `/api/sector-labels`, `/api/allocation` | GET/PUT | S | the three config singletons behind risk/treemap/optimizer |

### Financials (fund accounting)

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/accounting-state` | GET/PUT | S | the entire fund-accounting engine state as one JSON string in `app_settings` (`fund-accounting-state`); all NAV/share/IRR math is computed from it in `lib/accounting.js` (client-side) |
| `/api/fund-nav` | GET/POST | S | GET: daily `{date, fund_nav, sp500_nav}` series. POST: turns `{date, aum}` entries into NAV/share using the accounting share ladder, fetches ^GSPC closes, normalizes the S&P leg to inception, replaces the rows |

### Research pipeline

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/watchlist` | GET/POST | S | load/save the whole watchlist payload (lists + stocks + stages + activeWatchlistId) |
| `/api/thesis/[ticker]` | GET/POST/DELETE | S | the per-ticker dossier (merged over a default shape); DELETE is the Strategic Hub "full delete" |
| `/api/model/[ticker]` | GET/POST | S | valuation-model inputs (outputs recomputed client-side by `lib/valuationModel.js`) |
| `/api/generate-data` | POST | S | Generate Data: Yahoo full price history → `ticker_prices`, then 3 Alpha Vantage statements (12 s sleeps between calls) → TTM series → `ticker_fundamentals`. Fails loudly on symbols AV doesn't cover (empty `{}` guard) and refuses "success" with zero fundamentals. `maxDuration = 60` |
| `/api/ticker/[ticker]` | GET | S | stored prices/fundamentals + computed valuation metrics (`dataExists` keyed off fundamentals rows) |
| `/api/links` | GET/POST/PUT/DELETE | S | research links: CRUD + server-side text extraction (SSRF-guarded fetch: DNS-resolves every redirect hop, blocks private/link-local ranges) + extractive summarizer (`lib/summarizer.js`, no LLM) |
| `/api/saved-emails` | GET/PUT | S | the author/reviewer address book (app_settings key) |
| `/api/notify-review` | POST | S | manual "nudge now": computes whose turn each unresolved thread is and emails each role a bundle (inline image refs re-signed for the session tenant at send time) |
| `/api/documents` | GET/POST/PUT/DELETE | S | document library: upload via `uploadTenantDocument` + metadata row; GET re-derives each row's auth-gated URL from `storage_path`; delete removes object (validated) + row |
| `/api/upload` | POST/DELETE | S | rich-text inline images via `uploadTenantImage` / `deleteTenantImage` (paths built + authorized in `lib/storage.js`; returns the session-gated app URL, never a public one) |
| `/api/storage/object` | GET | S | the stable address of every stored file: validates session + tenant prefix, then 302-redirects to a 5-minute signed URL (`private, max-age=240`); `&download[=name]` forces content-disposition. Buckets are private — this is the only read path |

### Strategy, CRM, tasks, lessons, issues

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/strategic-hub` | GET | S | aggregator: joins holdings, cash, notes, candidates, theses, valuation models, research links, tasks into the hub payload |
| `/api/strategic-notes` | GET/POST/DELETE | S | per-position CIO annotations (upsert by ticker) |
| `/api/strategic-candidates` | GET/POST/DELETE | S | research-pipeline candidates |
| `/api/ideas` | GET/POST/PUT/DELETE | S | sticky-note workspace |
| `/api/contacts` | GET/POST/PUT/DELETE | S | CRM contacts (delete cascades interactions/files) |
| `/api/interactions` | GET/POST/DELETE | S | interaction log; POST also bumps the contact's last-contacted/next-action |
| `/api/contact-files` | GET/POST/DELETE | S | links/files per contact |
| `/api/tasks` | GET/POST/PUT/DELETE | S | tasks per board; position auto-assigned per priority |
| `/api/tasks/reorder` | PATCH | S | bulk position/priority updates (drag & drop) |
| `/api/task-boards`, `/api/assignees` | GET/PUT | S | boards + assignee palettes (app_settings keys) |
| `/api/lessons`, `/api/lesson-patterns` | GET/POST/PUT/DELETE | S | lessons-learned CRUD with a writable-column allowlist |
| `/api/issues` | GET/POST/PUT/DELETE | S(+A) | tracker: non-admins see/comment/relabel only their own tickets (author from session, never the body); admin-only resolve/reopen/delete and triage actions (priority/complexity/dev-notes/sort-order, stripped from non-admin GETs) |

### Macro regime

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/macro-regime/run` | POST/GET | S | POST: locally spawns `make <run|fast|validate|predict|clean>` in `macro_regime_allocator/` (config synced from Supabase to `config.yaml` first, YAML-injection-safe); on Vercel, dispatches the `macro-regime.yml` GitHub workflow instead. GET: status (global single-runner lockfile in `/tmp`, foreign-tenant runs masked, stale-PID recovery) + per-tenant log + last-5 history |
| `/api/macro-regime/results` | GET | S | latest parsed backtest/metrics/report/validation + derived current signal |
| `/api/macro-regime/predict` | GET/POST | S | current allocation signal from the latest results row (prefers the final-model `live_prediction`) |
| `/api/macro-regime/plots` | GET | S | list plot names or stream one PNG (decoded from base64 JSONB) |
| `/api/macro-regime/config`, `/api/macro-regime/weights` | GET/PUT | S | allocator hyper-parameters (merged over defaults) and saved weights |

### Cron

| Route | Methods | Auth | What it does |
|---|---|---|---|
| `/api/cron/auto-notify` | GET/POST | C | Draft & Review reminders across **all tenants** (service role): selects due threads per review, emails whoever should speak next, persists the dedup map via the `set_draftreview_autonotify_sent` RPC. Returns 500 when any send/persist failed so the Actions run goes red. Secret accepted via `Authorization: Bearer`, `x-cron-secret`, or `?secret=` (kept for scheduler compatibility); fails closed with no secret configured |

---

## 5. Server library map (`src/lib/`)

**Auth & tenancy** — `auth.js` (JWT mint/verify, HS256 pinned),
`db.js` (`getSession`/`getDb`, revocation caches), `supabaseTenant.js`
(tenant-JWT mint + RLS-scoped client), `supabaseAdmin.js` (service-role
client, `server-only`), `users.js` (identity CRUD, workspace purge,
revocation floor helpers), `storage.js` + `storageShared.js` (the ONLY
storage access path: tenant-prefixed uploads, signed-URL minting, validated
deletes, email URL re-signing; shared pure primitives for scripts/seeder),
`roles.js` + `features.js` (framework-neutral registries used by edge,
server, and client), `loginRateLimit.js` (in-memory failure counters:
5/ip+user, 20/ip, 20/username per 15 min).

**Domain engines (pure, mostly client-consumed)** — `accounting.js` (fund
NAV/share accounting: event timeline → derived shares/NAV/returns; XIRR-based
per-investor performance with an S&P mirror leg — money-weighted by design),
`valuationModel.js` (editable income-statement → EPS/price/CAGR engine),
`riskEngine.js` (underwritten risk: exposure^1.25 × crowding × importance;
factor overlap similarity), `autoNotify.js` (reminder scheduling: absolute
time-of-day cadence in an IANA tz, shared dedup semantics),
`researchProgress.js` (thesis → per-section done/partial/todo strip),
`stageMove.js` (the only sanctioned way to move a name between pipeline
stages; one-time research-workspace seeding; holdings backfill),
`macroRegimeSignal.js` (current-signal derivation from DB rows),
`lessons.js` (lessons enums/templates),
`summarizer.js` (extractive summaries, no LLM), `migrateNewsImages.js`
(legacy thesis image-shape migration).

**Server-side services** — `yahoo.js` (quotes/fundamentals/period changes
with batch-then-fallback and rate-limit tolerance), `generateData.js` (the
Generate Data pipeline with its fail-fast guards), `fetchRisk.js` (price
download + weights + risk-engine orchestration), `portfolio.js`,
`watchlist.js`, `tickerData.js` (Supabase-backed loaders), `email.js`
(nodemailer transport + HTML rendering + turn logic), `demoSeed.js` /
`demoData.js` / `demoSeries.js` (demo reset & dataset).

**Client infrastructure** — `AuthContext.jsx` (session state; global fetch
wrapper that flips a "session expired" overlay on any gated-API 401),
`CacheContext.jsx` (in-memory KV for page payloads), `generateTickerJob.js`
(module-scope owner of in-flight Generate Data runs: dedupe, survives
unmounts, invalidates both research cache families, pub/sub completion),
`useTickerData.js`, `navigation.js`, `exportReport.js` (docx export),
`formatters.js`.

---

## 6. External integrations

| Service | Used by | Auth | Notes / failure behavior |
|---|---|---|---|
| **Yahoo Finance** (`yahoo-finance2`) | quotes, charts, fundamentals, validate-ticker, fund-nav (^GSPC), realized-vol, covariance, generate-data prices, demo quote rescale | none | Batch quote first, per-ticker retry after 500 ms; quoteSummary is best-effort (price survives a fundamentals failure). Unknown symbols return empty objects from `quote()` but throw from `chart()` — `validateTicker`/`generateTickerData` translate that into listing-suggestion errors. |
| **Alpha Vantage** | `lib/generateData.js` (INCOME_STATEMENT, BALANCE_SHEET, CASH_FLOW) | `ALPHA_VANTAGE_API_KEY` | 12 s sleeps between the 3 calls (free-tier rate limit). Uncovered symbols (OTC/foreign) return `{}` — guarded twice so the run errors instead of "succeeding" with no data. |
| **FRED** | `macro_regime_allocator` (macro series) | `FRED_API_KEY` | Pipeline-side only; the workflow writes the key into the runner's `.env.local`. |
| **Gmail SMTP** | `lib/email.js` (auto-notify + manual nudges) | `GMAIL_USER` + `GMAIL_APP_PASSWORD` (16-char App Password; `EMAIL_FROM` display-only) | Cached transport. Send failures surface: cron returns 500 (red Actions run) and the dedup map is *not* stamped, so failed reminders retry next tick. |
| **GitHub API** | `/api/macro-regime/run` on Vercel | `GH_DISPATCH_TOKEN`, `GH_DISPATCH_REPO` (+ optional `GH_DISPATCH_WORKFLOW`/`GH_DISPATCH_REF`) | `workflow_dispatch` with `{command, tenant_id}` inputs; 204 → "dispatched", anything else → 502 with GitHub's message. |

---

## 7. Scheduled & background work

### Draft & Review auto-notify

Two triggers share one decision engine (`lib/autoNotify.js`) and one persisted
dedup map, so they can never double-send:

- **Server cron**: `.github/workflows/auto-notify.yml` (cron `*/30`,
  best-effort timing) POSTs `/api/cron/auto-notify` with `CRON_SECRET`. The
  route scans **every** tenant's theses via the service role.
- **In-app timer**: `DraftReview.jsx` runs the same selection every 60 s while
  a review is open (covers the gap when Actions lags).

Scheduling model: a comment is due at `comment-date + k·everyDays` at
`atMinutes` in the configured IANA timezone (DST-correct, first fire never the
same day). The reminder goes to whoever should speak **next** (the opposite of
the last message's role). The `sent` map (`{threadId: {msgId, at}}`) re-arms
on new replies or the next cadence occurrence, and is persisted through the
`set_draftreview_autonotify_sent` RPC so a concurrent thesis save can't be
clobbered (and vice versa).

### Macro-regime backtest

- **Monthly schedule** (5th, 12:00 UTC — after FRED publishes the prior
  month) and **on-demand** from the app's Run button (repository/workflow
  dispatch) or the Actions tab.
- Runner flow: `scripts/macro-sync.mjs pull-config` (Supabase →
  `config.yaml`, end-date pinned) → `make run|fast|validate` in
  `macro_regime_allocator/` → `macro-sync.mjs push-results` (CSV/plots/report
  → `macro_regime_results`, run record + pruning). Tenant comes from the
  `tenant_id` workflow input (`APP_TENANT_ID`), defaulting to the CIO tenant
  for scheduled runs. Concurrency group prevents overlapping backtests.
- Locally the same pipeline is spawned directly by `/api/macro-regime/run`
  with a `/tmp` status file as the single-runner lock.

### Generate Data (user-triggered long job)

`POST /api/generate-data` takes ~30 s (Alpha Vantage sleeps). The **client**
owns the long-running nature: `lib/generateTickerJob.js` holds the in-flight
promise at module scope so navigation/unmounts don't orphan it, dedupes
per-ticker, invalidates both research cache families on success, and notifies
subscribers (Research + Position Review pages restore spinners on mount).

---

## 8. The Python sidecar

`macro_regime_allocator/` lives in-repo, is dependency-managed by `uv`, and is
**never** executed on Vercel (the run route detects `process.env.VERCEL` and
dispatches to CI; it is only reachable where `uv` exists).

- **`macro_regime_allocator/`** — two-asset (SPY vs T-bills) tactical
  allocator: logistic-regression regime probability on lagged macro + market
  features, walk-forward backtest, crash overlay, plots/report/validation.
  Full math audit in `MACRO_REGIME_ALLOCATOR_DEEP_DIVE.md`. Outputs sync to
  `macro_regime_results`; the app's "current signal" prefers the final-model
  `live_prediction` over the last backtest row.

---

## 9. Conventions

- **Route shape**: try/catch → `NextResponse.json({ error }, { status })`.
  400 invalid input, 401 unauthenticated (proxy), 403 forbidden (role/feature/
  path authorization), 404 not-found-or-not-yours, 409 already-running, 429
  rate-limited, 5xx upstream/unexpected. PostgREST's "no row" from `.single()`
  is `PGRST116` and is treated as empty, not an error.
- **Authorization is server-side state**: author/attribution and role checks
  always come from the verified session (`db.username`, `db.isAdmin`), never
  the request body.
- **Long routes** export `maxDuration` (generate-data, cron) and the cron
  route also `dynamic = 'force-dynamic'`.
- **Never touch storage directly** — go through `lib/storage.js`
  (`uploadTenantImage`/`uploadTenantDocument`, `getTenantSignedUrl`,
  `deleteTenantImage`/`deleteTenantDocument`); it builds tenant-prefixed
  paths from sanitized segments and re-validates every read/delete. Content
  stores app-gated URLs (`/api/storage/object?...`), never provider URLs.
  **DNS-validate anything the server fetches** (`/api/links` SSRF guard
  re-validates every redirect hop).
- **Upserts** always pass the per-tenant `onConflict` key
  (`'tenant_id,ticker'`, `'tenant_id,key'`, …) — see
  `DATABASE_ARCHITECTURE.md` §2.
- **Rich text** is the block-array shape everywhere; readers tolerate legacy
  strings (`normalizeBody`-style helpers).
- **Framework-neutral registries** (`roles.js`, `features.js`) are imported by
  edge, server, and client — keep them free of `server-only`/node/React
  imports. Adding a feature touches `FEATURES`, the proxy `matcher`, and
  `API_FEATURES` together. **Every new `/api/*` route must be classified** in
  `features.js` (feature / role-gated / common) — the API gate is default-deny,
  so an unregistered route 403s, and `tests/apiAccess.test.mjs` (`npm test`)
  fails until it's registered.
- **In-memory server state** (rate-limit counters, revocation caches, macro
  status file) is per-instance by design — acceptable at this deployment's
  scale; noted as a tradeoff in the auth doc.

---

## 10. Environment reference

| Var | Used by |
|---|---|
| `AUTH_JWT_SECRET` | session-JWT signing (dev fallback exists outside production) |
| `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` | bootstrap CIO admin (hash via `scripts/generate-hash.mjs`) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PostgREST endpoint + powerless public key (tenant clients ride on it with a JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role client (server/CI only; build fails if bundled client-side) |
| `SUPABASE_JWT_SECRET` | tenant-JWT minting — must match the Supabase project's JWT secret |
| `ALPHA_VANTAGE_API_KEY` | Generate Data statements |
| `FRED_API_KEY` | macro allocator data pull (local + Actions secret) |
| `GH_DISPATCH_TOKEN` / `GH_DISPATCH_REPO` (+ `GH_DISPATCH_WORKFLOW`, `GH_DISPATCH_REF`) | Vercel → GitHub Actions macro-run dispatch |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `EMAIL_FROM` | reminder email transport |
| `CRON_SECRET` | shared secret for `/api/cron/*` (also an Actions secret, with `APP_URL` as the target origin) |
| `APP_TENANT_ID` | tenancy scope for standalone pipeline/CI runs (never set for the web app itself) |

Operational scripts: `scripts/generate-hash.mjs` (bcrypt hash for the
bootstrap admin), `scripts/provision-demo.mjs` (create/reseed the demo login),
`scripts/macro-sync.mjs` (CI ⇄ Supabase bridge).

---

## 11. Frontend surface (for orientation)

Pages under `src/app/(dashboard)/`: home dashboard, `holdings`, `allocation`,
`financials`, `macro-regime`, `watchlist`, `draft-review`, `research`,
`position-review`, `workspace` (ideas), `strategic-hub`, `relationships`,
`tasks`, `lessons`, `documents`, `link-database`, `admin`, plus the `(auth)`
login page. The research pipeline's stage semantics, move rules, and progress
derivation are shared client logic (`lib/stageMove.js`,
`lib/researchProgress.js`) — every page that moves a name must go through
them. Reusable building blocks live in `src/components/` (RichTextArea,
TickerSearchSelect, DraftReview, IssuesWidget, AccountingTool, ValuationModel,
charts, …).
