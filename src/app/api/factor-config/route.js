import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, mutateSetting } from '@/lib/appSettings';

const KEY = 'factor_config';

// Stored shape (snake_case): { factors, importance_weights, exposures }. The API
// speaks camelCase (importanceWeights) to the client.
const toApi = (stored) => ({
  factors: stored?.factors || [],
  importanceWeights: stored?.importance_weights || { Volatility: 0.9 },
  exposures: stored?.exposures || {},
});

export async function GET() {
  const supabase = await getDb();
  return NextResponse.json(toApi(await readSetting(supabase, KEY, null)));
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const supabase = await getDb();

    // Server-side read-modify-write under the version guard: two analysts editing
    // different factor exposures (or one adding a factor while another edits an
    // exposure) both land instead of one clobbering the other. mutateSetting reads
    // the current value, applies this patch, and commits with retry-on-conflict.
    const stored = await mutateSetting(supabase, KEY, (current) => {
      const next = {
        factors: current?.factors || [],
        importance_weights: current?.importance_weights || { Volatility: 0.9 },
        exposures: current?.exposures || {},
      };
      if (body.factors !== undefined) next.factors = body.factors;
      if (body.importanceWeights !== undefined) next.importance_weights = body.importanceWeights;
      if (body.exposures !== undefined) {
        for (const [ticker, factors] of Object.entries(body.exposures)) {
          next.exposures[ticker] = { ...(next.exposures[ticker] || {}), ...factors };
        }
      }
      return next;
    }, { factors: [], importance_weights: { Volatility: 0.9 }, exposures: {} });

    return NextResponse.json(toApi(stored));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
