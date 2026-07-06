# Multitenancy (Option B — RLS-enforced)

AlphaOS supports many users, each with a **completely isolated workspace**. An
admin (the CIO login) creates users from the in-app **User Management** page; each
new user gets its own *tenant* (data partition). No per-user tables — every table
carries a `tenant_id` and Postgres **Row Level Security enforces isolation in the
database**, so a query that forgets to filter by tenant still cannot leak.

## How it works

- **Login** issues the app's own JWT cookie with `{ userId, tenantId, role, isDemo }`
  (`src/lib/auth.js`). Users are looked up in the `users` table; the CIO admin and
  `demo` logins are built-in bootstrap fallbacks.
- **Data access** (`src/lib/db.js → getDb()`) mints a short-lived *Supabase*-signed
  `authenticated` JWT carrying the `tenant_id` claim (`src/lib/supabaseTenant.js`)
  and talks to PostgREST as the `authenticated` role. The RLS policy
  `tenant_id = app_current_tenant()` does the rest. `getDb()` **fails closed** — no
  valid session means no data access.
- **Service role** (`supabaseAdmin`) still bypasses RLS and is used only for
  auth/admin/user-management and the macro-allocator pipeline (which stamps
  `tenant_id` explicitly via `APP_TENANT_ID`).
- **Two reserved tenants** with fixed UUIDs:
  - `11111111-…-111111111111` → **CIO Alpha** (holds the original production data)
  - `22222222-…-222222222222` → **Demo** (wiped + re-seeded on every `demo`/`demo` login)

## Adding a workspace

Multitenancy is live. To add an isolated workspace, log in as the CIO admin (or
a workspace owner), open **User Management** (shield icon in the navbar), and
create a user — each gets a fresh, isolated, empty workspace. Its config
singletons are seeded by `seedTenantDefaults()` at creation.

For CI macro-regime runs, pass the tenant via the workflow input `tenant_id`
(blank = CIO). The route forwards it automatically when dispatching.

## Notes / follow-ups

- There are no `demo_*` clone tables — the demo environment is the reserved
  Demo tenant, wiped and re-seeded on every demo login.
- Standalone macro-allocator runs (local `make`, CI) must set `APP_TENANT_ID` or
  the run defaults to the CIO tenant (isolation is mandatory, never implicit).
- Storage objects are isolated by path prefix (`<tenant_id>/…`) and the buckets
  are **private** — all access goes through `src/lib/storage.js` (signed URLs,
  no public read), which re-validates every path against the session tenant.
