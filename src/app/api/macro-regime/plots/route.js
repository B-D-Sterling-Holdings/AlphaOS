import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getMacroPlotSignedUrl } from '@/lib/storage';

// A stored plot value is either a storage PATH ("<tenant>/<runId>/<file>.png",
// the current shape) or a legacy base64 PNG blob. Paths contain "/" and are
// short; base64 blobs are long and have no "/".
function looksLikePath(v) {
  return typeof v === 'string' && v.includes('/') && v.length < 512;
}

export async function GET(req) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');

    // Get the latest results with plots from Supabase
    const { data, error } = await supabase
      .from('macro_regime_results')
      .select('plots')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data || !data.plots) {
      if (!name) return NextResponse.json({ plots: [] });
      return NextResponse.json({ error: 'No plots available' }, { status: 404 });
    }

    if (!name) {
      // Return list of available plot filenames
      return NextResponse.json({ plots: Object.keys(data.plots) });
    }

    // Get specific plot
    const safeName = name.endsWith('.png') ? name : `${name}.png`;
    const value = data.plots[safeName];
    if (!value) {
      return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    }

    // Current shape: a storage path -> 302 to a short-lived signed URL.
    if (looksLikePath(value)) {
      const signedUrl = await getMacroPlotSignedUrl(value);
      return NextResponse.redirect(signedUrl, {
        status: 302,
        headers: { 'Cache-Control': 'private, max-age=240' },
      });
    }

    // Legacy shape: base64 PNG inlined in the row -> decode and stream.
    const buffer = Buffer.from(value, 'base64');
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    const status = err?.status || 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
