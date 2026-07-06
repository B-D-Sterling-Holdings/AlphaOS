# AlphaOS — Multi-Tenant Auth, RBAC & Access Control Architecture

*Last verified against the live database on 2026-07-06, after the remediation
round that landed migrations 018–020 and the F2/F4/F5/F6 code fixes.
Supersedes the cutover-era notes in `MULTITENANCY.md`. Companion docs:
`BACKEND_ARCHITECTURE.md` (request lifecycle, API surface) and
`DATABASE_ARCHITECTURE.md` (schema, RLS mechanics).*

> **Deploy / migration state (2026-07-06, re-verified):** migrations **001–020
> are all applied** to the live database — 019 (lock views) and 020
> (`auth_revocations`) were confirmed by live probes: the `rag_coverage` view
> now denies both anon *and* `authenticated`, and `auth_revocations` exists,
> is service-role-only, and already holds a real logout stamp for `cio-admin`
> (so the F6 wiring has fired end-to-end). The code fixes (F2 API feature
> gate, F4 issues-purge, F5 rate-limit, F6 revocation, **F3 private-storage
> rework**) are **deployed to production**, and migration **021** (private
> buckets, the DB half of F3) is **applied** — the full storage cutover
> (deploy → `migrate-storage-urls.mjs` → 021) was executed and verified live
> in prod on 2026-07-06 (15/15 checks).

This document describes the full authentication and authorization stack: how a
request goes from a browser cookie to a row in Postgres, which role may do
what, every knob you can turn, and the audit findings / residual risks.

---

## 1. The big picture

AlphaOS does **not** use Supabase Auth. It runs its own JWT-cookie auth and
uses Supabase purely as a Postgres + PostgREST + Storage backend. Isolation is
enforced **in the database** by Row Level Security (RLS), not by remembering
to add `WHERE tenant_id = ...` in application code.

```
Browser ──cookie──▶ Edge proxy (src/proxy.js)
                      │  pages: feature gate + /admin role gate
                      │  APIs:  valid-session gate
                      ▼
                    API route ──getDb()──▶ src/lib/db.js
                      │                      │ verify cookie, re-check revocation
                      │                      ▼
                      │                    mintTenantJwt(tenantId)   (supabaseTenant.js)
                      │                      │ short-lived Supabase JWT, tenant_id claim
                      ▼                      ▼
                    PostgREST (`authenticated` role)
                      │
                      ▼
                    Postgres RLS: tenant_isolation policy
                    USING/WITH CHECK (tenant_id = app_current_tenant())
```

Three credentials exist, with strictly different power:

| Credential | Who holds it | Power |
|---|---|---|
| Anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | every browser | **nothing** — RLS on, no anon policies |
| Tenant JWT (minted per request, 1 h TTL) | server only, per request | own tenant's rows only |
| Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) | server only | bypasses RLS entirely |

The design goal, verified in §7: even if application code forgets a filter, or
the anon key is abused directly against PostgREST, no cross-tenant data moves.

---

## 2. Identity layer

### Tables (service-role only)

`tenants` and `users` (migration 005, extended by 008/011/012) have RLS
enabled + forced with **no policies** and explicit `REVOKE` from
anon/authenticated — only the service-role client in `src/lib/users.js` can
touch them. A tenant = one isolated workspace (data partition). A user =
one login belonging to exactly one tenant.

`users` columns that drive authorization:

- `role` — `'admin' | 'owner' | 'user'` (see §4)
- `tenant_id` — the workspace this login can ever see
- `is_active` — kill switch; enforced mid-session, not just at login (§3)
- `disabled_features text[]` — per-user feature denylist (§5)
- `is_demo` — demo accounts get their tenant wiped + re-seeded on every login

### Reserved identities

- **CIO tenant** `11111111-1111-1111-1111-111111111111` — original production
  data; cannot be deleted through any code path (`deleteWorkspace` refuses).
- **Demo tenant** `22222222-2222-2222-2222-222222222222` — reset on every
  demo login (`resetDemoTenant`, non-fatal on failure).
- **Bootstrap CIO admin** — lives in env (`AUTH_USERNAME` /
  `AUTH_PASSWORD_HASH`), has no `users` row, id `'cio-admin'`. Shown in the
  admin UI as the CIO workspace owner but not editable/deletable there.
- **Dev fallback** — `cio`/`alpha` works only when `NODE_ENV !== 'production'`.

---

## 3. Session layer (`src/lib/auth.js`, login/me/logout routes)

- **Token**: app-signed JWT (`jose`), **HS256 pinned** on verify (a token
  signed any other way is rejected), 7-day expiry, secret `AUTH_JWT_SECRET`.
  Claims: `userId, username, tenantId, role, disabledFeatures`.
- **Cookie**: `session_token`, `httpOnly`, `secure` in production,
  `sameSite: 'lax'` (blocks cross-site POSTs → CSRF mitigation), `path: '/'`,
  7-day `maxAge` matching the JWT.
- **Login** (`/api/auth/login`): brute-force guard first (§5), then managed
  users (bcrypt, cost 10), then the env bootstrap admin, then the dev
  fallback. All failures return the same `Invalid credentials` 401 — except
  disabled accounts, which say so (accepted enumeration tradeoff).
- **Revocation despite stateless JWTs**: a 7-day token would outlive a
  "disable user" click, so liveness is re-checked server-side:
  - `getDb()`/`getSession()` re-verify `is_active` per request through a
    **30-second in-memory cache** (`src/lib/db.js`) — a revoked account loses
    data access within ~30 s.
  - `/api/auth/me` does a fresh DB read on every call: deleted/disabled
    accounts get a 401 + cookie wipe; if `role`/`disabled_features` drifted
    from the JWT claims, the cookie is **re-issued** so the edge gate picks up
    admin changes without waiting out the 7 days.
  - **Logout / sign-out-everywhere** (`auth_revocations`, migration 020):
    logout stamps a `not_before` instant for the caller's subject; any token
    whose `iat` predates it is rejected by `getSession()`/`me`. This makes a
    *copied* token stop working, not just the browser cookie — and it covers
    the bootstrap `cio-admin` (keyed by the string subject, no `users` row
    needed). The check reuses the same 30 s cache, so it adds no per-request
    round-trip. The comparison is second-granularity, so a re-login in the
    same wall-clock second as the logout is never mistaken for the dead
    session. *(fixed F6; migration 020 is applied, so this is live — verified
    by a real `cio-admin` revocation row stamped by logout. The code would
    still safely no-op if the table were ever missing.)*

---

## 4. RBAC — three roles (`src/lib/roles.js`)

| Capability | `admin` (global) | `owner` (workspace) | `user` (member) |
|---|---|---|---|
| See data outside own tenant | ❌ (data access is still tenant-JWT-scoped)¹ | ❌ | ❌ |
| Feature-restricted (§5) | never | yes (by admin only)² | yes |
| Open `/admin` + users API | ✅ | ✅ (scoped) | ❌ (redirected + 403) |
| Create isolated workspaces | ✅ (any role) | ❌ | ❌ |
| Add members | to any workspace | own workspace only, forced `role:'user'`, inherits the owner's restrictions | ❌ |
| Edit feature toggles | any user | own members only, and **only within its own enabled set** | ❌ |
| Reset passwords | anyone | own members only | ❌ |
| Rename logins/workspaces, promote/demote owner⇄user | ✅ | ❌ | ❌ |
| Delete a member login | ✅ | own members only | ❌ |
| Delete a whole workspace | ✅ (never own; never CIO) | ❌ | ❌ |
| Disable/delete own account | ❌ (blocked) | ❌ (blocked) | — |

¹ Admins are a *management* superrole, not a data superrole: their reads still
go through their own tenant's RLS-scoped client. There is no "read another
tenant's data" path in the app.
² Only `admin` is exempt (`isUnrestrictedRole`); an owner's own
`disabled_features` are enforced like any user's *and* double as the ceiling
for members it creates. (A stale comment in `src/proxy.js`'s page-gate branch
says owners are never restricted — the code restricts them; only the *page
`/admin` role gate* admits owners.)

Server-side enforcement lives in `/api/admin/users/route.js`:
`requireManager()` gates entry by verified session role (never a
client-supplied role), and `requireOwnedSubUser()` confines owners to
`role='user'` rows of their own `tenant_id` — an owner can never touch admins,
other owners, or anyone outside its tenant (no sideways escalation).

Role changes only move between `owner` and `user`; `admin` rows are
unreachable from the management API (`setUserRole` refuses them).

### Deletion semantics (destructive paths, deliberately narrow)

- Member of a shared workspace → only the login row dies; workspace survives.
- Owner / standalone / last login → the **whole workspace** dies: storage
  purge → tenant-scoped rows → tenant row (cascades remaining users).
- The storage purge (`purgeTenantStorage`) is not exported, requires a
  canonical UUID tenant id, and re-checks every object path is inside
  `<tenantId>/` before removal — a malformed prefix can never wipe a bucket.

---

## 5. The configurable controls (what you can turn)

### Per-user feature toggles (`disabled_features`) — your mini-ACL

The registry is `src/lib/features.js` (12 keys: `holdings`, `allocation`,
`macro-regime`, `relationships`, `strategic-hub`, `tasks`, `workspace`,
`lessons`, `research`*, `documents`, `link-database`, `financials`).
*`research` deliberately couples watchlist/draft-review/research/position-review.

Enforced in **four layers**:
1. Edge proxy, pages (`src/proxy.js`) — blocks navigation/deep-links
   server-side, reading the denylist from the *signed JWT* (no DB call at the
   edge).
2. Edge proxy, data APIs (`isApiAllowed` + `API_FEATURES` in `features.js`) —
   a restricted user's direct `fetch('/api/holdings')` is refused with 403,
   not just the page. An API owned by several features is blocked only when
   **all** of them are off (e.g. `/api/thesis` serves Equity Research *and*
   Strategic Hub); routes used by ungated surfaces (dashboard home, command
   palette, issues, uploads) are intentionally never gated. *(fixed F2)*
3. `/api/auth/me` — refreshes the list live and re-issues the cookie on drift.
4. Client (navbar, command palette, in-page guard) — cosmetic hiding.

**To add a feature**: add `{ key, label, hrefs }` to `FEATURES`, the page
prefix to `config.matcher` in `src/proxy.js`, and — if the feature has data
routes — an entry in `API_FEATURES` mapping its `/api/...` prefixes to the
key(s). All three must stay in sync (a `matcher` miss means the edge gate
never runs for that path). Unknown keys in the DB are dropped by
`sanitizeFeatureKeys`, so stale data can't break anything.

### Roles

`src/lib/roles.js` is the single source of truth (used by edge, server, and
client). Adding a role means touching `ROLES`, the two predicate functions,
and the users-API guards.

### Environment knobs

| Var | Controls |
|---|---|
| `AUTH_JWT_SECRET` | session-JWT signing (dev fallback secret exists for non-prod only) |
| `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` | the bootstrap CIO admin (bcrypt hash via `scripts/generate-hash.mjs`) |
| `SUPABASE_JWT_SECRET` | tenant-JWT minting — must match the project's JWT secret |
| `SUPABASE_SERVICE_ROLE_KEY` | the RLS-bypassing client (server-only; build fails if imported client-side via `server-only`) |
| `CRON_SECRET` | shared secret for `/api/cron/*` (no cookie; each route enforces it and fails closed) |

### Tunables in code

- Session lifetime: `7d` in `createSession` + cookie `maxAge` (two places).
- Tenant-JWT TTL: `ttlSeconds = 3600` in `mintTenantJwt`.
- Revocation lag: `ACTIVE_CACHE_TTL_MS = 30_000` in `db.js` (covers both the
  `is_active` check and the logout/`not_before` revocation floor).
- Brute-force limits (`src/lib/loginRateLimit.js`): 5 failures / 15 min per
  ip+username, 20 per ip; failures only, so real users are never throttled.
- Signed-URL lifetimes (`src/lib/storageShared.js`):
  `SIGNED_URL_TTL_SECONDS = 300` for in-app reads (the redirect caches
  `private, max-age=240`, kept just under it), and
  `EMAIL_SIGNED_URL_TTL_SECONDS = 7 d` for image links minted into reminder
  emails at send time.
- New-workspace seed rows: `seedTenantDefaults` in `users.js` (singleton
  config tables every tenant must have).

---

## 6. Data layer — how RLS actually bites

- `app_current_tenant()` (migration 005) reads the `tenant_id` claim from the
  request JWT; it is also the **DEFAULT** for every `tenant_id` column, so
  tenant-scoped inserts are stamped automatically.
- Every tenant-scoped table has exactly **one** policy:

  ```sql
  CREATE POLICY tenant_isolation ON <table> FOR ALL TO authenticated
    USING (tenant_id = app_current_tenant())
    WITH CHECK (tenant_id = app_current_tenant());
  ```

  `FOR ALL` + `WITH CHECK` means reads, writes, and *re-stamping a row into
  another tenant* are all refused by Postgres itself.
- RLS is `ENABLE`d **and `FORCE`d** on every public table (001, re-asserted
  by 018), so even the table owner can't sneak past.
- Tables **without** `tenant_id` (`rag_traces`, `scraped_content`,
  `content_chunks`, `chat_*`, `macro_regime_signal`, `task_comments`, legacy
  `demo_*`) are RLS-on with **no policies**: service-role/pipeline only.
- Singleton config tables are keyed on `tenant_id` (one row per tenant) while
  keeping `id = 1` so legacy `.eq('id', 1)` reads still work under RLS.
- Business uniques are per-tenant (`(tenant_id, ticker)` etc.) so two tenants
  can both hold AAPL.
- `getDb()` **fails closed**: no valid session ⇒ throw, never a fallback
  tenant. 34 of 52 API routes use it; the only route on the admin client is
  `/api/cron/auto-notify` (no user session exists for a scheduler), plus the
  lib helpers that legitimately need identity/admin access.
- **Storage** bypasses table RLS, so it gets its own enforcement layer:
  buckets are **private** (migration 021) and every upload/read/delete goes
  through the narrow helpers in `src/lib/storage.js`
  (`uploadTenantImage`/`uploadTenantDocument`, `getTenantSignedUrl`,
  `deleteTenantImage`/`deleteTenantDocument`). Paths are built server-side
  under the session tenant's `<tenant_id>/` prefix and re-validated on every
  read/delete; content stores only the session-gated app URL
  (`/api/storage/object?...`), which 302s to a 5-minute signed URL after the
  session + tenant check. `getDb()` deliberately no longer exposes
  `.storage`/`storagePrefix` — routes cannot hand-build object paths. (See F3
  for the history and residual risks.)

### Non-app writers

The Python pipeline gets either a scoped tenant JWT or the service key with an
explicit `APP_TENANT_ID` — it refuses to run without one (isolation is
mandatory, never implicit).

---

## 7. Verified state (live probes, re-audited 2026-07-06 after applying 019/020)

Functional audit against all **67** PostgREST-exposed relations (66 + the new
`auth_revocations`) — not a read of the migrations, but actual requests with
each credential class, re-run after 019/020 were applied:

| Probe | Result |
|---|---|
| Anon key, every table **and view** | **0 rows on all 67** — 63 return empty (RLS filters to nothing), 4 are hard-denied outright (`users`, `tenants`, `auth_revocations`, `rag_coverage`) |
| Anon **and** demo-tenant JWT on `rag_coverage` (the view behind F1) | both denied — 019's REVOKE covers `authenticated` too, not just anon |
| Demo-tenant JWT, every tenant-scoped table | only demo rows; **0 foreign-tenant rows** everywhere |
| Demo-tenant JWT, `users` / `tenants` | denied (42501) |
| Cross-tenant INSERT (demo JWT, CIO `tenant_id`, `tasks`) | rejected: *"new row violates row-level security policy"* |
| `macro_regime_config` / `macro_regime_runs` (leaked pre-018) | clean |
| `auth_revocations` (020) | exists, service-role-only (anon → 42501), and holds a live `cio-admin` `not_before` stamped by an actual logout |
| `issues.complexity = 5` (017) | accepted — the 1–5 CHECK is live (017 confirmed applied along with 018–020) |

*(`security_invoker` on views can't be observed through PostgREST, so 019's
verification here is the grant revocation; the setting itself is asserted by
the migration and can be re-checked with the SQL in `019_lock_views.sql`.)*

Code-level fixes were verified out-of-band with unit checks (all passing):
`isApiAllowed` (F2) across single/multi-owner routes and sub-paths; the
per-username rate-limit cap under IP rotation (F5); and the second-granularity
revocation comparison (F6).

The re-lock tooling is now three idempotent migrations — **re-run them after
any dashboard experiment or pipeline table/view rebuild**; they fix drift
regardless of cause:

- `018_drop_stray_policies.sql` — RLS on every table, drop non-`tenant_isolation`
  policies, recreate tenant policies.
- `019_lock_views.sql` — revoke anon/authenticated on every public **view** +
  `security_invoker` (views bypass table RLS — this is what 018 couldn't reach).
- `020_session_revocation.sql` — the `auth_revocations` table behind logout /
  sign-out-everywhere.

All three are **applied** as of 2026-07-06 (verified live, table above). They
stay useful as re-lock tooling: 018/019 are the ones to re-run after drift;
020 is one-shot (the table persists).

---

## 8. Findings — remediation status

All six findings from the first audit are addressed. ✅ = fixed & verified,
🟡 = accepted/known tradeoff (unchanged by design).

### ✅ F1 — anon-readable `rag_coverage` (was: fix now)

Root cause: a **view**, which bypasses table RLS and so slipped past 018's
table/policy loops. Migration **019** is now **applied**: it revokes
anon/authenticated on *every* public view and sets `security_invoker = true`,
so a re-granted view later still only shows what the caller's own RLS allows,
and any new pipeline view is caught on the next run. Verified live:
`rag_coverage` (the only public view) is denied for the anon key **and** for
tenant JWTs. Closed.

### ✅ F2 — feature toggles now gate data APIs (was: medium)

The proxy's `/api/*` branch now calls `isApiAllowed()` against the same signed
JWT denylist, returning **403** for a disabled area's data routes — a
restricted user can no longer `fetch('/api/holdings')` around the page gate.
The mapping (`API_FEATURES` in `src/lib/features.js`) blocks a shared route
only when *all* owning features are off (`/api/thesis`, `/api/watchlist`,
`/api/realized-vol` are multi-owner) and deliberately leaves ungated surfaces'
routes (dashboard home, command palette, issues, uploads) open. Admins remain
exempt. Verified with unit tests across single/multi-owner and sub-path cases.

### ✅ F3 — storage moved to private buckets + short-lived signed URLs (was: known tradeoff)

Reworked 2026-07-06 and **live in production** (code deployed, data migrated,
migration **021** applied — re-verified against prod: buckets private, old
public URLs dead, gate enforces 401/403, signed round-trip serves):

- **Buckets are private** (021 flips `public = false` and drops the
  public-read policies). Old public object URLs stop resolving entirely.
- **Content stores a stable, session-gated app URL** —
  `/api/storage/object?bucket=…&path=…`. That's what lands in browser
  history, logs, copied links, exports, and referrers, and it is worthless
  without a valid session cookie.
- The route validates the session and the tenant prefix
  (`isPathAllowedForTenant`, including the CIO legacy-path exception), then
  302-redirects to a **5-minute signed URL** (`SIGNED_URL_TTL_SECONDS`).
  `<img>`, `<a href>`, and `fetch()` follow it transparently; the redirect is
  `Cache-Control: private, max-age=240` so pages don't re-mint per render.
- **All storage access is centralized** in `src/lib/storage.js`
  (`uploadTenantImage`/`uploadTenantDocument` build paths server-side;
  `deleteTenant*` re-validate them; `getDb()` no longer exposes `.storage` or
  `storagePrefix`, so no route can hand-roll a path).
- **Emails** can't send cookies, so the cron / manual-nudge paths re-sign
  inline image references at send time with a bounded 7-day TTL
  (`signStorageUrlsForTenant`) — the signing tenant comes from the DB row (or
  verified session), never the payload, so a crafted body can't exfiltrate
  another tenant's file into an email.
- **Existing content** is migrated by `scripts/migrate-storage-urls.mjs`
  (public URL → app URL, all content tables; verified by dry run: 12 rows).
  `/api/documents` also re-derives every row's URL from `storage_path` at
  read time, so that table needs no migration.

Verified end-to-end (21/21 checks): upload → gated redirect → signed fetch →
byte-identical round-trip; 401 without a session; 403 for foreign-tenant
paths, traversal, unknown buckets, and foreign deletes; deleted objects stop
serving. Email signer verified 7/7 (block URLs, `&amp;`-escaped inline HTML,
legacy public URLs, foreign paths untouched).

**Residual risk (accepted):** a signed URL itself is bearer-readable until its
TTL expires (≤5 min in-app, ≤7 days if lifted from a reminder email), and
Supabase signed URLs cannot be revoked individually short of rotating the
project's JWT secret or moving the object. That is the standard bound for
this pattern; the durable, copyable references are now all auth-gated.

### ✅ F4 — `issues` added to the workspace purge list (was: low)

`'issues'` is now in `TENANT_DATA_TABLES` (`src/lib/users.js`), so deleting a
workspace erases its issue reports too — no orphaned tenant data left behind.
(Reminder for the future: add every new tenant-scoped table to this list;
`task_comments` will need it if it's ever wired up.)

### ✅ F5 — rate limiting no longer defeated by IP rotation (was: low)

Added a **per-username** failure counter (20 / 15 min) alongside the existing
per-ip+username (5) and per-ip (20) caps. Because `x-forwarded-for` is
client-spoofable on some hops, this IP-independent ceiling stops an attacker
rotating IPs from guessing one account indefinitely; a real user's successful
login still clears it. Verified with a unit test simulating 20 rotated-IP
failures against one username. *(The in-memory/per-instance nature and the
"Account is disabled" username enumeration remain accepted tradeoffs.)*

### ✅ F6 — logout invalidation + bootstrap-admin revocation (was: low)

Migration **020** (now **applied**) adds `auth_revocations(subject,
not_before)`; logout stamps `now()` for the caller's subject, and
`getSession()` / `/api/auth/me` reject any token whose `iat` predates it — so
a *copied* token dies on logout, and the bootstrap `cio-admin` (keyed by its
string subject) is now revocable without rotating `AUTH_JWT_SECRET`. Reuses
the 30 s cache (no new per-request DB hit); comparison is second-granularity
so an immediate re-login is never misread as the dead session. Verified live:
the table is service-role-only and already carries a `cio-admin` floor
written by a real logout, so the full logout→revocation→rejection path has
executed against the production DB. A future "sign out everywhere" admin
button can call the same `revokeSessionsBefore(subject)` helper.

### Housekeeping (info)

- 25 legacy `demo_*` tables remain (RLS-locked, unread since the demo-tenant
  cutover was validated 2026-07-01) — safe to drop.
- `task_comments` exists in the DB but nothing in `src/` references it.
- Session lifetime (7 d) and cookie `maxAge` are defined in two places in
  `auth.js`/route handlers — keep them in sync if you change one.

---

## 9. Where this can grow: per-user rules inside a tenant (ABAC)

Today the model is: **RBAC for management** (admin/owner/user), **an ACL-ish
feature denylist for app areas**, and **attribute-based tenant isolation in
RLS** — but `tenant_id` is the *only* attribute the database ever sees
(`mintTenantJwt` carries no `user_id`), so Postgres cannot distinguish users
within a workspace. If you ever need "private notes" / "share with Alice
only", the incremental path that keeps enforcement in the database:

1. Add `user_id` (and `role`) claims in `mintTenantJwt` + an
   `app_current_user()` SQL helper.
2. Add row attributes where needed (`owner_user_id`, `visibility`).
3. Extend `tenant_isolation` policies:
   `... AND (visibility = 'tenant' OR owner_user_id = app_current_user())`.

No external policy engine needed at this scale — it would be a second source
of truth to keep consistent with RLS.
