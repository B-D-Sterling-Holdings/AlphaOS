# AlphaOS — Multi-Tenant Auth, RBAC & Access Control Architecture

*Last verified against the live database on 2026-07-06. Supersedes the
cutover-era notes in `MULTITENANCY.md`. Companion docs:
`BACKEND_ARCHITECTURE.md` (request lifecycle, API surface) and
`DATABASE_ARCHITECTURE.md` (schema, RLS mechanics).*

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

`tenants` and `users` have RLS enabled + forced with **no policies** and
explicit `REVOKE` from
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
  signed any other way is rejected), secret `AUTH_JWT_SECRET`. Claims:
  `userId, username, tenantId, role, disabledFeatures`.
- **Cookie**: `session_token`, `httpOnly`, `secure` in production,
  `sameSite: 'lax'` (blocks cross-site POSTs → CSRF mitigation), `path: '/'`.
- **Lifetime, defined once** (`src/lib/auth.js`): `SESSION_TTL_SECONDS` (7 d)
  is the single source for **both** the JWT `exp` and the cookie `maxAge`, and
  `createSession` pins `iat`/`exp` to the same instant so token and cookie
  expire together to the second. Every write of the cookie goes through
  `setSessionCookie` / `clearSessionCookie` (login, `me` reissue, logout), so
  the cookie attributes live in exactly one place — no route hand-builds a
  `Set-Cookie`.
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
  - **Logout / sign-out-everywhere** (`auth_revocations`): logout stamps a
    `not_before` instant for the caller's subject; any token whose `iat`
    predates it is rejected by `getSession()`/`me`. This makes a *copied* token
    stop working, not just the browser cookie — and it covers the bootstrap
    `cio-admin` (keyed by the string subject, no `users` row needed). The check
    reuses the same 30 s cache, so it adds no per-request round-trip. The
    comparison is second-granularity, so a re-login in the same wall-clock
    second as the logout is never mistaken for the dead session.

---

## 4. RBAC — three roles (`src/lib/roles.js`)

| Capability | `admin` (global) | `owner` (workspace) | `user` (member) |
|---|---|---|---|
| See data outside own tenant | ❌ (data access is still tenant-JWT-scoped)¹ | ❌ | ❌ |
| Feature-restricted (§5) | never | yes (by admin only)² | yes |
| Open `/admin` page + `/api/admin/*` | ✅ | ✅ (scoped) | ❌ (page → redirect; API → **403 at the edge**) |
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

The users API is gated at **two** levels, both from the verified session role
(never a client-supplied role):
- **Edge** (`src/proxy.js`): `/api/admin/*` is refused (403) unless
  `canManageUsers(role)` — a plain `user` never reaches the handler. This
  mirrors the `/admin` *page* gate and is why `/api/admin` is classified
  `ROLE_GATED_API_ROUTES`, not feature-gated (there is no feature key for user
  management).
- **Handler** (`/api/admin/users/route.js`): `requireManager()` re-checks the
  role, and `requireOwnedSubUser()` confines owners to `role='user'` rows of
  their own `tenant_id` — an owner can never touch admins, other owners, or
  anyone outside its tenant (no sideways escalation). Admins additionally see
  every workspace; owners see only their own (`listUsers({ tenantId })`).

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
2. Edge proxy, data APIs (`isApiAllowed` in `features.js`) — **DEFAULT DENY**.
   Every non-admin `/api/*` request is classified into exactly one bucket:
   feature-owned (`API_FEATURES`), role-gated (`ROLE_GATED_API_ROUTES`), or
   common (`COMMON_API_ROUTES`). A feature route is refused (403) when **all**
   its owning features are off (e.g. `/api/thesis` serves Equity Research *and*
   Strategic Hub — losing one must not break the other). Anything
   **unclassified fails closed** — so a new route that someone forgets to
   register denies access instead of leaking a hidden feature's data.
   - `/api/admin/*` is **role-gated at the edge**: the proxy checks
     `canManageUsers(role)` and 403s a plain `user` *before* the request
     reaches the handler, mirroring the `/admin` page gate. The handler
     re-checks (`requireManager`) and additionally scopes owners to their own
     workspace — defense-in-depth, and there is no *feature* key for user
     management so role is the correct axis.
   - The short `COMMON_API_ROUTES` list is the only always-open escape hatch,
     each entry justified inline (`/api/quotes` public market data,
     `/api/upload`/`/api/storage`/`/api/issues` app-wide surfaces,
     `/api/auth`+`/api/cron` short-circuited earlier). Note "common" means only
     "skipped by the feature gate" — a valid session is still required, and RLS
     still scopes every read to the caller's tenant.
   *(F2; hardened to default-deny — closed the macro-regime/allocation/tasks
   leaks — plus an edge role gate for `/api/admin`)*
3. `/api/auth/me` — refreshes the list live and re-issues the cookie on drift.
4. Client (navbar, command palette, in-page guard, **home dashboard**) — the
   ungated home page and the app-wide command palette call the *same*
   `isApiAllowed` before fetching feature data, so they never even request an
   area the edge would 403. Cosmetic + no-console-error, not a security layer.

**To add a feature**: add `{ key, label, hrefs }` to `FEATURES`, the page
prefix to `config.matcher` in `src/proxy.js`, and map every one of its
`/api/...` prefixes in `API_FEATURES`. Because the API gate is default-deny,
forgetting the `API_FEATURES` entry now **fails closed** (403) instead of
leaking — and `tests/apiAccess.test.mjs` (run via `npm test`) walks the whole
`src/app/api` tree and fails CI until the route is classified. A `matcher` miss
still silently skips the *page* gate, so keep that in sync too. Unknown keys in
the DB are dropped by `sanitizeFeatureKeys`.

**To add a new API route** (even one that isn't feature-specific): it must land
in exactly one of the three buckets in `features.js`, or `npm test` fails and
the proxy 403s it. Choose deliberately:
- `API_FEATURES` — the route serves a feature's tenant data (the common case).
  Map it to every feature whose pages consume it.
- `ROLE_GATED_API_ROUTES` — access is decided by *role*, not a feature toggle
  (today only `/api/admin`; add the matching edge check in `src/proxy.js`).
- `COMMON_API_ROUTES` — no per-feature/role restriction beyond a valid session
  (public data, or something gated by its own stronger check). Keep this list
  short; every entry is a deliberate hole and should be justifiable inline.

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

- Session lifetime: `SESSION_TTL_SECONDS` (7 d) in `src/lib/auth.js` — the
  single source for both the JWT `exp` and the cookie `maxAge`. The cookie
  itself is written only through `setSessionCookie` / `clearSessionCookie`
  there, so attributes (`httpOnly`/`secure`/`sameSite`/`path`) live in one
  place too.
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

- `app_current_tenant()` reads the `tenant_id` claim from the request JWT; it
  is also the **DEFAULT** for every `tenant_id` column, so
  tenant-scoped inserts are stamped automatically.
- Every tenant-scoped table has exactly **one** policy:

  ```sql
  CREATE POLICY tenant_isolation ON <table> FOR ALL TO authenticated
    USING (tenant_id = app_current_tenant())
    WITH CHECK (tenant_id = app_current_tenant());
  ```

  `FOR ALL` + `WITH CHECK` means reads, writes, and *re-stamping a row into
  another tenant* are all refused by Postgres itself.
- RLS is `ENABLE`d **and `FORCE`d** on every public table, so even the table
  owner can't sneak past.
- Tables **without** `tenant_id` (`macro_regime_signal`, `task_comments`) are
  RLS-on with **no policies**: service-role/pipeline only.
- Singleton config tables are keyed on `tenant_id` (one row per tenant) while
  keeping `id = 1` so legacy `.eq('id', 1)` reads still work under RLS.
- Business uniques are per-tenant (`(tenant_id, ticker)` etc.) so two tenants
  can both hold AAPL.
- `getDb()` **fails closed**: no valid session ⇒ throw, never a fallback
  tenant. 34 of 52 API routes use it; the only route on the admin client is
  `/api/cron/auto-notify` (no user session exists for a scheduler), plus the
  lib helpers that legitimately need identity/admin access.
- **Storage** bypasses table RLS, so it gets its own enforcement layer:
  buckets are **private** and every upload/read/delete goes
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

## 7. Verified state (live probes)

Isolation is verified by **actual requests** with each credential class — not a
read of the schema — against every PostgREST-exposed relation:

| Probe | Result |
|---|---|
| Anon key, every relation | **0 rows everywhere** — most filter to nothing under RLS, and `users` / `tenants` / `auth_revocations` are hard-denied outright by explicit `REVOKE` |
| Demo-tenant JWT, every tenant-scoped table | only demo rows; **0 foreign-tenant rows** everywhere |
| Demo-tenant JWT, `users` / `tenants` | denied (42501) |
| Cross-tenant INSERT (demo JWT, CIO `tenant_id`, `tasks`) | rejected: *"new row violates row-level security policy"* |
| `macro_regime_config` / `macro_regime_runs` | tenant-isolated; no cross-tenant leakage |
| `auth_revocations` | service-role-only (anon → 42501), and holds a live `cio-admin` `not_before` stamped by an actual logout |
| `issues.complexity = 5` | accepted — the 1–5 CHECK is live |

There are **no public views**; the standing rule is that any view added later
must revoke anon/authenticated and set `security_invoker = true` (views bypass
table RLS).

Code-level guarantees are covered by unit checks (all passing, `npm test` →
`node --test`). `tests/apiAccess.test.mjs` is the load-bearing one: it **walks
the real `src/app/api` tree and fails if any route is unclassified**, so the
default-deny gate can't silently regress, plus cases for the historical leaks,
multi-owner routes, sub-paths, role-gated `/api/admin`, and common routes.
Other checks cover the per-username rate-limit cap under IP rotation and the
second-granularity revocation comparison.

**Drift discipline:** the RLS/view-lock SQL is idempotent — re-run it after any
dashboard experiment or pipeline table/view rebuild to restore the intended
end-state regardless of cause.

---

## 8. Findings — remediation status

All six findings from the first audit are addressed. ✅ = fixed & verified,
🟡 = accepted/known tradeoff (unchanged by design).

### ✅ F1 — anon-readable `rag_coverage` (was: fix now)

Root cause: a **view**, which bypasses table RLS. The RAG/chat pipeline tables
and that view have since been removed from the database entirely, so the
surface no longer exists. The standing rule remains for any view added later:
revoke anon/authenticated and set `security_invoker = true`, so a view only
ever shows what the caller's own RLS allows. Closed.

### ✅ F2 — feature toggles gate data APIs, default-deny (was: medium)

The proxy's `/api/*` branch calls `isApiAllowed()` against the same signed JWT
denylist, returning **403** for a disabled area's data routes — a restricted
user can no longer `fetch('/api/holdings')` around the page gate. Admins remain
exempt.

**Hardened to default-deny.** The original allowlist-of-denials had drifted:
`/api/allocation`, all `/api/macro-regime/*`, `/api/tasks`, `/api/task-boards`,
and `/api/strategic-candidates` were absent from the map, so a user with those
features disabled could still pull the data directly while the page was
blocked. Root cause was structural — an *unlisted* route defaulted to
**allowed**. `isApiAllowed` now **fails closed**: a route must be classified
feature-owned (`API_FEATURES`) or common (`COMMON_API_ROUTES`) or it is
refused. The map was completed (multi-owner where shared: `/api/portfolio`
feeds four holdings-derived pages; `/api/thesis`/`/api/watchlist`/
`/api/realized-vol` span two features). The ungated home dashboard and the
command palette now consult `isApiAllowed` before fetching, so they don't 403
on the newly-gated routes. `/api/admin/*` was additionally given an **edge
role gate** in the proxy (`canManageUsers`) so a plain user is bounced before
the handler, and moved out of `COMMON_API_ROUTES` into its own
`ROLE_GATED_API_ROUTES` bucket so the classification is honest about *why*
it's exempt from feature toggles. Enforced by `tests/apiAccess.test.mjs`
(`npm test`), which walks the real route tree and fails if any route is
unclassified, plus unit cases for the historical leaks, default-deny,
multi-owner, role-gated, and common routes.

### ✅ F3 — storage moved to private buckets + short-lived signed URLs (was: known tradeoff)

**Live in production** — re-verified against prod: buckets private, old public
URLs dead, gate enforces 401/403, signed round-trip serves:

- **Buckets are private** (`public = false`, no public-read policies). Old
  public object URLs stop resolving entirely.
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
- **Stored URLs are never trusted** — `/api/documents` re-derives every row's
  URL from `storage_path` at read time, so a row always resolves to the
  current session-gated app URL.

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

`auth_revocations(subject, not_before)` backs this: logout stamps `now()` for
the caller's subject, and `getSession()` / `/api/auth/me` reject any token
whose `iat` predates it — so
a *copied* token dies on logout, and the bootstrap `cio-admin` (keyed by its
string subject) is now revocable without rotating `AUTH_JWT_SECRET`. Reuses
the 30 s cache (no new per-request DB hit); comparison is second-granularity
so an immediate re-login is never misread as the dead session. Verified live:
the table is service-role-only and already carries a `cio-admin` floor
written by a real logout, so the full logout→revocation→rejection path has
executed against the production DB. A future "sign out everywhere" admin
button can call the same `revokeSessionsBefore(subject)` helper.

### Housekeeping (info)

- `task_comments` exists in the DB but nothing in `src/` references it.

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
