// Migrate the bundled prism_ai/data/ sample tickers (CSVs + research PDFs) into
// Supabase so the analysis pipeline reads them from Supabase, not the local folder.
//
// Usage:
//   node scripts/seed-prism-data.mjs           # -> prism_ticker_data / prism_ticker_documents
//   node scripts/seed-prism-data.mjs --demo    # -> demo_* tables
//
// Re-runnable (upserts). After running, the local data/ folder is no longer
// needed by the pipeline.

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
const DATA_TABLE = isDemo ? 'demo_prism_ticker_data' : 'prism_ticker_data';
const DOCS_TABLE = isDemo ? 'demo_prism_ticker_documents' : 'prism_ticker_documents';
const DATA_DIR = path.join(ROOT, 'prism_ai', 'data');
const SUBDIRS = ['fundamentals', 'price_data', 'ratios', 'valuation'];

function countRows(csv) {
  const lines = csv.trim().split('\n');
  return Math.max(0, lines.length - 1); // minus header
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`No data dir: ${DATA_DIR}`);
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const dataRows = [];
  const docRows = [];

  for (const ticker of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!ticker.isDirectory() || ticker.name.startsWith('.')) continue;
    const T = ticker.name.toUpperCase();
    const tickerDir = path.join(DATA_DIR, ticker.name);

    for (const sub of SUBDIRS) {
      const subDir = path.join(tickerDir, sub);
      if (!fs.existsSync(subDir)) continue;
      for (const f of fs.readdirSync(subDir)) {
        if (!f.endsWith('.csv')) continue;
        const csv = fs.readFileSync(path.join(subDir, f), 'utf8');
        dataRows.push({
          ticker: T,
          category: `${sub}/${f.replace(/\.csv$/, '')}`,
          csv_content: csv,
          rows: countRows(csv),
        });
      }
    }

    const docsDir = path.join(tickerDir, 'documents');
    if (fs.existsSync(docsDir)) {
      for (const f of fs.readdirSync(docsDir)) {
        if (!f.toLowerCase().endsWith('.pdf')) continue;
        const buf = fs.readFileSync(path.join(docsDir, f));
        docRows.push({ ticker: T, filename: f, content_base64: buf.toString('base64') });
      }
    }
  }

  if (dataRows.length) {
    const { error } = await supabase.from(DATA_TABLE).upsert(dataRows, { onConflict: 'ticker,category' });
    if (error) { console.error(`Upsert ${DATA_TABLE} failed:`, error.message); process.exit(1); }
  }
  if (docRows.length) {
    const { error } = await supabase.from(DOCS_TABLE).upsert(docRows, { onConflict: 'ticker,filename' });
    if (error) { console.error(`Upsert ${DOCS_TABLE} failed:`, error.message); process.exit(1); }
  }

  console.log(`Migrated ${dataRows.length} dataset(s) into ${DATA_TABLE} and ${docRows.length} document(s) into ${DOCS_TABLE}.`);
}

main();
