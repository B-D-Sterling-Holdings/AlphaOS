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
