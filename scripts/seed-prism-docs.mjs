// One-off: seed research PDFs into prism_ticker_documents from a source data dir
// (default: the standalone /home/datta/base/prism_ai/data). Documents only — does
// NOT touch prism_ticker_data, so freshly fetched CSVs are preserved.
//   node scripts/seed-prism-docs.mjs [sourceDataDir]
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env.local'), quiet: true });

const SRC = process.argv[2] || '/home/datta/base/prism_ai/data';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }
if (!fs.existsSync(SRC)) { console.error(`No source dir: ${SRC}`); process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const docRows = [];
for (const ticker of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!ticker.isDirectory() || ticker.name.startsWith('.')) continue;
  const docsDir = path.join(SRC, ticker.name, 'documents');
  if (!fs.existsSync(docsDir)) continue;
  for (const f of fs.readdirSync(docsDir)) {
    if (!f.toLowerCase().endsWith('.pdf')) continue;
    const buf = fs.readFileSync(path.join(docsDir, f));
    docRows.push({ ticker: ticker.name.toUpperCase(), filename: f, content_base64: buf.toString('base64') });
  }
}
if (!docRows.length) { console.log('No PDFs found.'); process.exit(0); }
const { error } = await sb.from('prism_ticker_documents').upsert(docRows, { onConflict: 'ticker,filename' });
if (error) { console.error('Upsert failed:', error.message); process.exit(1); }
console.log(`Seeded ${docRows.length} document(s):`, docRows.map((d) => `${d.ticker}/${d.filename}`).join(', '));
