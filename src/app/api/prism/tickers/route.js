import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';

const DATA_DIR = path.resolve(process.cwd(), 'prism_ai', 'data');

// GET - tickers available for the pipeline dropdowns. Primary source is Supabase
// (prism_ticker_data); the local data/ folder is unioned in so bundled sample
// tickers still appear before they are migrated.
export async function GET() {
  const supabase = await getDb();
  const tickers = new Set();

  try {
    const { data } = await supabase.from('prism_ticker_data').select('ticker');
    for (const row of data || []) if (row.ticker) tickers.add(String(row.ticker).toUpperCase());
  } catch { /* table may not exist yet */ }

  try {
    if (fs.existsSync(DATA_DIR)) {
      for (const d of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('.')) tickers.add(d.name.toUpperCase());
      }
    }
  } catch { /* ignore */ }

  return NextResponse.json({ tickers: [...tickers].sort() });
}
