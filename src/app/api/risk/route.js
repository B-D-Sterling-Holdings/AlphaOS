import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fetchRisk } from '@/lib/fetchRisk';

export async function POST(request) {
  const supabase = await getDb();
  try {
    const body = await request.json();
    const { holdings } = body;
    if (!holdings || !holdings.length) {
      return NextResponse.json({ error: 'holdings required' }, { status: 400 });
    }

    // Read factor config from Supabase
    const { data: configRow } = await supabase
      .from('factor_config')
      .select('factors, importance_weights, exposures')
      .eq('id', 1)
      .single();

    const factorConfig = configRow
      ? {
          factors: configRow.factors || [],
          importanceWeights: configRow.importance_weights || { Volatility: 0.9 },
          exposures: configRow.exposures || {},
        }
      : { factors: [], importanceWeights: { Volatility: 0.9 }, exposures: {} };

    const result = await fetchRisk(holdings, factorConfig);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
