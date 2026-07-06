import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, versionOf, VersionConflictError } from '@/lib/concurrency';

export async function GET(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  const { data, error } = await supabase
    .from('valuation_models')
    .select('*')
    .eq('ticker', upper)
    .single();

  if (error || !data) {
    return NextResponse.json({ ticker: upper, exists: false, version: 0 });
  }

  return NextResponse.json({ ticker: upper, exists: true, inputs: data.inputs, version: versionOf(data) });
}

export async function POST(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  try {
    const body = await request.json();
    const { baseVersion } = body;

    let row;
    try {
      row = await versionedWrite(supabase, 'valuation_models', {
        match: { ticker: upper },
        values: { inputs: body.inputs },
        baseVersion,
        onConflict: 'tenant_id,ticker',
      });
    } catch (e) {
      if (e instanceof VersionConflictError) {
        return NextResponse.json({
          conflict: true,
          ticker: upper,
          inputs: e.current?.inputs ?? null,
          version: versionOf(e.current),
        }, { status: 409 });
      }
      throw e;
    }

    return NextResponse.json({ success: true, ticker: upper, version: versionOf(row) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
