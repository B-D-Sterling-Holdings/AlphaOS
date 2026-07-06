#!/usr/bin/env node
/**
 * One-time backfill: move existing macro_regime_results.plots base64 PNGs into
 * the private `macro-plots` storage bucket, rewriting each row's `plots` JSONB
 * from `{ filename: <base64> }` to `{ filename: "<tenant>/<run>/<file>.png" }`.
 *
 * Prereqs: migration 026 (bucket created) + the app code deployed.
 * Safe to run repeatedly — a value that's already a path is left untouched.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-macro-plots.mjs        # apply
 *   node --env-file=.env.local scripts/migrate-macro-plots.mjs --dry  # preview
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role).
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'macro-plots';
const DRY = process.argv.includes('--dry');
const seg = (v, fb) => (String(v ?? '').replace(/[/\\]/g, '_').replace(/\.{2,}/g, '.').trim() || fb);
const looksLikePath = (v) => typeof v === 'string' && v.includes('/') && v.length < 512;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await db
  .from('macro_regime_results')
  .select('id, tenant_id, run_id, plots');
if (error) { console.error('read failed:', error.message); process.exit(1); }

let rowsChanged = 0, filesUploaded = 0, skipped = 0;
for (const row of rows) {
  const plots = row.plots || {};
  const entries = Object.entries(plots);
  if (entries.length === 0) { continue; }

  // Already migrated? (every value is a path)
  if (entries.every(([, v]) => looksLikePath(v))) { skipped++; continue; }

  const folder = seg(row.run_id || row.id, 'run');
  const next = {};
  let changed = false;
  for (const [filename, value] of entries) {
    if (looksLikePath(value)) { next[filename] = value; continue; } // already a path
    const path_ = `${row.tenant_id}/${folder}/${seg(filename, 'plot.png')}`;
    if (DRY) {
      console.log(`  would upload ${filename} (${Math.round((value.length * 0.75) / 1024)} KB) -> ${path_}`);
    } else {
      const buffer = Buffer.from(value, 'base64');
      const { error: upErr } = await db.storage.from(BUCKET).upload(path_, buffer, {
        contentType: 'image/png', upsert: true,
      });
      if (upErr) { console.error(`  upload ${path_} failed: ${upErr.message}`); continue; }
    }
    next[filename] = path_;
    filesUploaded++;
    changed = true;
  }

  if (changed && !DRY) {
    const { error: uErr } = await db
      .from('macro_regime_results')
      .update({ plots: next })
      .eq('id', row.id);
    if (uErr) { console.error(`  row ${row.id} update failed: ${uErr.message}`); continue; }
  }
  if (changed) { rowsChanged++; console.log(`${DRY ? '[dry] ' : ''}row ${row.id}: ${entries.length} plot(s) -> storage`); }
}

console.log(`\n${DRY ? '[dry] ' : ''}done: ${rowsChanged} row(s) ${DRY ? 'would be ' : ''}rewritten, ` +
  `${filesUploaded} file(s) ${DRY ? 'would be ' : ''}uploaded, ${skipped} already-migrated row(s) skipped.`);
