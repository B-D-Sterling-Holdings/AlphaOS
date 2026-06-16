import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

async function readConfig() {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from('factor_config')
    .select('factors, importance_weights, exposures')
    .eq('id', 1)
    .single();

  if (error || !data) {
    return { factors: [], importanceWeights: { Volatility: 0.9 }, exposures: {} };
  }

  return {
    factors: data.factors || [],
    importanceWeights: data.importance_weights || { Volatility: 0.9 },
    exposures: data.exposures || {},
  };
}

async function writeConfig(config) {
  const supabase = await getDb();
  const { error } = await supabase
    .from('factor_config')
    .update({
      factors: config.factors,
      importance_weights: config.importanceWeights,
      exposures: config.exposures,
    })
    .eq('id', 1);

  if (error) throw new Error(error.message);
}

export async function GET() {
  return NextResponse.json(await readConfig());
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const config = await readConfig();

    if (body.factors !== undefined) {
      config.factors = body.factors;
    }
    if (body.importanceWeights !== undefined) {
      config.importanceWeights = body.importanceWeights;
    }
    if (body.exposures !== undefined) {
      for (const [ticker, factors] of Object.entries(body.exposures)) {
        config.exposures[ticker] = { ...(config.exposures[ticker] || {}), ...factors };
      }
    }

    await writeConfig(config);
    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
