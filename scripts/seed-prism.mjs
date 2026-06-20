// Import prism_ai analysis outputs into Supabase so the AI Pipeline tab's
// Signal History has data immediately.
//
// Usage:
//   node scripts/seed-prism.mjs            # -> prism_recommendations (prod)
//   node scripts/seed-prism.mjs --demo     # -> demo_prism_recommendations
//
// Reads prism_ai/outputs/recommendations/*_analysis.json (+ matching .md for the
// raw response) and upserts one row per file, keyed by source_file (re-runnable).

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const isDemo = process.argv.includes('--demo');
const TABLE = isDemo ? 'demo_prism_recommendations' : 'prism_recommendations';
const RECS_DIR = path.join(ROOT, 'prism_ai', 'outputs', 'recommendations');

function normalizeSignal(signal) {
  if (!signal) return null;
  const s = String(signal).trim().toUpperCase();
  return s === 'SELL' ? 'AVOID' : s;
}

function toRow(filename) {
  const raw = JSON.parse(fs.readFileSync(path.join(RECS_DIR, filename), 'utf8'));
  if (!raw.ticker) return null;
  const rec = raw.recommendation || {};

  // Pair with the raw .md response if present.
  let fullResponse = null;
  const mdPath = path.join(RECS_DIR, filename.replace(/\.json$/, '.md'));
  if (fs.existsSync(mdPath)) fullResponse = fs.readFileSync(mdPath, 'utf8');

  return {
    ticker: String(raw.ticker).toUpperCase(),
    analysis_date: raw.analysis_date || null,
    signal: normalizeSignal(rec.signal),
    conviction: rec.conviction ? String(rec.conviction).toUpperCase() : null,
    position_size_pct: rec.position_size_pct ?? null,
    price_target: rec.price_target_12mo ?? null,
    expected_return_pct: rec.expected_return_pct ?? null,
    model: raw.model || null,
    analysis_mode: raw.analysis_mode || null,
    recommendation: rec,
    sections: raw.sections || {},
    full_response: fullResponse,
    source_file: filename,
  };
}

async function main() {
  if (!fs.existsSync(RECS_DIR)) {
    console.error(`No recommendations dir: ${RECS_DIR}`);
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const files = fs.readdirSync(RECS_DIR).filter((f) => f.endsWith('_analysis.json'));
  const rows = files.map(toRow).filter(Boolean);
  if (!rows.length) {
    console.log('No analysis files to import.');
    return;
  }

  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'source_file' });
  if (error) {
    console.error(`Upsert into ${TABLE} failed:`, error.message);
    process.exit(1);
  }
  console.log(`Imported ${rows.length} recommendation(s) into ${TABLE}.`);
}

main();
