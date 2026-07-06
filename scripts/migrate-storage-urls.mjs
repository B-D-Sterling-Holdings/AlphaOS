#!/usr/bin/env node
/*
  One-time data migration for the private-storage cutover (migration 021).

  Rewrites every persisted Supabase PUBLIC object URL
      https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  into the app's stable, session-gated form
      /api/storage/object?bucket=<bucket>&path=<encoded path>
  across all content tables that can embed file references (rich-text blocks,
  inline <img> HTML, plain-text notes, documents/contact_files url columns).

  Run AFTER deploying the code that serves /api/storage/object, and BEFORE
  (or right after) applying 021 — order vs 021 doesn't matter for the app
  (signed-URL redirects work on public buckets too), but old public URLs left
  in content stop working the moment 021 runs.

    node --env-file=.env.local scripts/migrate-storage-urls.mjs --dry-run
    node --env-file=.env.local scripts/migrate-storage-urls.mjs

  Idempotent: rewritten rows contain no public URLs, so a re-run is a no-op.
  Service-role key required (rewrites every tenant's rows).
*/
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).');
  process.exit(1);
}
const DRY_RUN = process.argv.includes('--dry-run');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BUCKETS = ['documents', 'research-images'];
const escaped = SUPABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Matches inside plain text, HTML attributes, or JSON-serialized strings
// (stop at quote/backslash/whitespace/query — public URLs carry no query).
const PUBLIC_URL_RE = new RegExp(
  `${escaped}/storage/v1/object/public/(${BUCKETS.join('|')})/([^"'\\\\\\s?]+)`,
  'g'
);

function appUrlFor(bucket, rawPath) {
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  return `/api/storage/object?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

function rewriteValue(value) {
  // Serialize the whole column set, string-replace, parse back. URLs never
  // contain characters JSON.stringify escapes, so string-level replacement is
  // faithful for both TEXT and JSONB columns.
  const serialized = JSON.stringify(value);
  const rewritten = serialized.replace(PUBLIC_URL_RE, (_m, bucket, rawPath) => appUrlFor(bucket, rawPath));
  if (rewritten === serialized) return null;
  return JSON.parse(rewritten);
}

// table -> { key: pk column(s), columns: rewritable columns }
const TARGETS = [
  { table: 'documents', key: ['id'], columns: ['url'] },
  { table: 'contact_files', key: ['id'], columns: ['url'] },
  // Live theses table has NO id column (pre-schema-file shape; PK is
  // (tenant_id, ticker) since migration 009).
  { table: 'theses', key: ['tenant_id', 'ticker'], columns: ['core_reasons', 'assumptions', 'valuation', 'underwriting', 'news_updates', 'todos', 'notes'] },
  { table: 'issues', key: ['id'], columns: ['body', 'comments'] },
  { table: 'lessons', key: ['id'], columns: ['detail', 'comments'] },
  { table: 'lesson_patterns', key: ['id'], columns: ['checklist_questions'] },
  { table: 'ideas', key: ['id'], columns: ['content'] },
  { table: 'strategic_notes', key: ['id'], columns: ['notes', 'action_reason', 'alternatives'] },
  { table: 'candidate_positions', key: ['id'], columns: ['notes'] },
  { table: 'research_links', key: ['id'], columns: ['notes', 'pasted_text'] },
  { table: 'tasks', key: ['id'], columns: ['notes', 'subtasks'] },
  { table: 'watchlists', key: ['tenant_id', 'id'], columns: ['stocks'] },
];

const PAGE = 500;

async function migrateTable({ table, key, columns }) {
  const select = [...key, ...columns].join(',');
  let scanned = 0;
  let changed = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data: rows, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + PAGE - 1);
    if (error) {
      // A table may not exist in every deployment — same tolerance as the
      // workspace purge in src/lib/users.js. Only a missing RELATION is
      // skippable; a missing column is a bug here and must surface.
      if (error.code === '42P01' || /relation .* does not exist/i.test(error.message)) {
        console.log(`  ${table}: table missing, skipped`);
        return;
      }
      throw new Error(`${table} select: ${error.message}`);
    }
    if (!rows?.length) break;
    scanned += rows.length;

    for (const row of rows) {
      const current = {};
      for (const c of columns) current[c] = row[c];
      const next = rewriteValue(current);
      if (!next) continue;
      changed += 1;
      if (DRY_RUN) continue;
      let update = supabase.from(table).update(next);
      for (const k of key) update = update.eq(k, row[k]);
      const { error: uErr } = await update;
      if (uErr) throw new Error(`${table} update (${key.map((k) => row[k]).join(',')}): ${uErr.message}`);
    }
    if (rows.length < PAGE) break;
  }
  console.log(`  ${table}: ${changed}/${scanned} rows ${DRY_RUN ? 'would be ' : ''}rewritten`);
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Rewriting public storage URLs -> /api/storage/object …`);
for (const target of TARGETS) {
  await migrateTable(target);
}
console.log('Done.');
