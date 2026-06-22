import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  const { data, error } = await supabase
    .from('valuation_models')
    .select('inputs')
    .eq('ticker', upper)
    .single();

  if (error || !data) {
    return NextResponse.json({ ticker: upper, exists: false });
  }

  return NextResponse.json({ ticker: upper, exists: true, inputs: data.inputs });
}

export async function POST(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  try {
    const body = await request.json();
    const { error } = await supabase.from('valuation_models').upsert({
      ticker: upper,
      inputs: body.inputs,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,ticker' });

    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, ticker: upper });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
