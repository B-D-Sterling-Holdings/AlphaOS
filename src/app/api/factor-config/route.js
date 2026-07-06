import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, writeSetting } from '@/lib/appSettings';

const KEY = 'factor_config';

// Stored shape: { factors, importance_weights, exposures }.
// The API speaks camelCase (importanceWeights) to the client.
async function readConfig() {
  const supabase = await getDb();
  const data = await readSetting(supabase, KEY, null);
  return {
    factors: data?.factors || [],
    importanceWeights: data?.importance_weights || { Volatility: 0.9 },
    exposures: data?.exposures || {},
  };
}

async function writeConfig(config) {
  const supabase = await getDb();
  await writeSetting(supabase, KEY, {
    factors: config.factors,
    importance_weights: config.importanceWeights,
    exposures: config.exposures,
  });
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
