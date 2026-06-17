import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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
      // Return list of available plots
      return NextResponse.json({ plots: Object.keys(data.plots) });
    }

    // Get specific plot
    const safeName = name.endsWith('.png') ? name : `${name}.png`;
    const base64 = data.plots[safeName];

    if (!base64) {
      return NextResponse.json({ error: 'Plot not found' }, { status: 404 });
    }

    const buffer = Buffer.from(base64, 'base64');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
