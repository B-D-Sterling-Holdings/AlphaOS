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
  auth/admin/user-management and the Python pipeline (which stamps `tenant_id`
  explicitly via `APP_TENANT_ID`).
- **Two reserved tenants** with fixed UUIDs:
  - `11111111-…-111111111111` → **CIO Alpha** (all pre-existing data is backfilled here)
  - `22222222-…-222222222222` → **Demo** (starts empty)

## Cutover — what to run

1. **Set env** (see `.env.example`): add `SUPABASE_JWT_SECRET`
   (Supabase → Project Settings → API → JWT Settings → *JWT Secret*).
   Keep `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` (the bootstrap CIO admin).
2. **Run the migration** in the Supabase SQL editor:
   `scripts/migrations/005_multitenancy.sql` (idempotent; backfills CIO, adds
   `tenant_id` + RLS policies + grants to every data table, creates `users` /
   `tenants`). Run it *after* `001_enable_rls.sql`.
3. **Deploy** the app. Log in as the CIO admin → existing data appears (CIO tenant).
4. **Add users** from the shield icon (User Management) in the navbar. Each gets a
   fresh, isolated, empty workspace.

For CI macro-regime runs, pass the tenant via the workflow input `tenant_id`
(blank = CIO). The route forwards it automatically when dispatching.

## Notes / follow-ups

- The old `demo_*` tables are **superseded** by the Demo tenant and no longer read.
  They're left in place (RLS-locked) so nothing is lost — drop them once you're
  confident in the cutover. Demo now starts empty; re-seed it as a tenant if you
  want showcase data.
- Standalone pipeline runs (local `make analyze`, CI) must set `APP_TENANT_ID` or
  the prism store refuses to read/write (isolation is mandatory, never implicit).
- Storage objects are isolated by path prefix (`<tenant_id>/…`); the buckets keep
  public read. Tightening storage RLS per tenant is a sensible follow-up.
