import { NextResponse } from 'next/server';
import path from 'path';
import { getDb } from '@/lib/db';

// POST - upload a research document into Supabase (prism_ticker_documents) so the
// analysis pipeline reads it from Supabase, not the local folder. Pipeline step 3.
// Body: { ticker, filename, file (base64) }.
export async function POST(req) {
  const supabase = await getDb();
  if (supabase.isDemo) {
    return NextResponse.json({ error: 'Uploads are disabled in demo mode.' }, { status: 403 });
  }
  try {
    const { ticker, filename, file } = await req.json();
    const cleanTicker = (ticker || '').trim().toUpperCase();
    if (!cleanTicker) return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
    if (!filename || !file) return NextResponse.json({ error: 'filename and file are required' }, { status: 400 });

    const safeName = path.basename(filename);
    const base64 = file.includes(',') ? file.split(',').pop() : file;

    const { error } = await supabase
      .from('prism_ticker_documents')
      .upsert(
        { ticker: cleanTicker, filename: safeName, content_base64: base64, updated_at: new Date().toISOString() },
        { onConflict: 'ticker,filename' }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const size = Math.floor((base64.length * 3) / 4);
    return NextResponse.json({ success: true, filename: safeName, size });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
