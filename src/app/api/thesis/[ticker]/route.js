import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, versionOf, VersionConflictError } from '@/lib/concurrency';

const DEFAULT_THESIS = {
  coreReasons: [{ title: '', description: '' }, { title: '', description: '' }, { title: '', description: '' }],
  assumptions: '',
  valuation: '',
  underwriting: {
    companyOverview: '',
    revenueCAGR: '',
    operatingMargin: '',
    buybackRate: '',
    exitPE: '',
    exitFCFYield: '',
    terminalGrowthRate: '',
    researchWorkspace: {
      note: '',
      fundamentals: {
        revenueGrowth: '',
        profitability: '',
        capitalReturn: '',
        misc: '',
      },
      dueDiligenceItems: [],
      dislocationItems: [],
    },
    draftReview: {
      paper: [],
      threads: [],
    },
  },
  newsUpdates: [],
  todos: [],
  notes: { links: [], tabs: [{ id: '1', title: 'General', content: [] }] },
};

// assumptions is JSONB (migration 029): a rich-text block array (new) or a bare
// string (legacy/empty). It round-trips natively — no serialize/parse needed.
// `??` guards a NULL row into the empty-string default the editor expects.
function normalizeAssumptions(val) {
  return val ?? '';
}

// Map a DB row (or null) into the client thesis shape. `version` drives optimistic
// concurrency: a real number post-migration, 0 when there's no row, and omitted
// (undefined) for a pre-migration row so the client falls back to legacy saves.
// See src/lib/concurrency.js.
function shapeThesis(upper, data) {
  if (!data) {
    return { ticker: upper, ...DEFAULT_THESIS, version: 0 };
  }
  return {
    ticker: upper,
    ...DEFAULT_THESIS,
    coreReasons: data.core_reasons || DEFAULT_THESIS.coreReasons,
    assumptions: normalizeAssumptions(data.assumptions),
    valuation: data.valuation || '',
    underwriting: { ...DEFAULT_THESIS.underwriting, ...(data.underwriting || {}) },
    newsUpdates: data.news_updates || [],
    todos: data.todos || [],
    notes: data.notes || { links: [], tabs: [{ id: '1', title: 'General', content: [] }] },
    version: versionOf(data),
  };
}

export async function GET(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  const { data, error } = await supabase
    .from('theses')
    .select('*')
    .eq('ticker', upper)
    .single();

  if (error || !data) {
    return NextResponse.json(shapeThesis(upper, null));
  }

  return NextResponse.json(shapeThesis(upper, data));
}

export async function POST(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  try {
    const body = await request.json();
    // `baseVersion` is the optimistic-concurrency token (see src/lib/concurrency.js).
    // Everything else is the thesis document itself.
    const { baseVersion } = body;
    const values = {
      core_reasons: body.coreReasons || DEFAULT_THESIS.coreReasons,
      assumptions: normalizeAssumptions(body.assumptions),
      valuation: body.valuation || '',
      underwriting: { ...DEFAULT_THESIS.underwriting, ...(body.underwriting || {}) },
      news_updates: body.newsUpdates || [],
      todos: body.todos || [],
      notes: body.notes || { links: [], tabs: [{ id: '1', title: 'General', content: [] }] },
    };

    let row;
    try {
      row = await versionedWrite(supabase, 'theses', {
        match: { ticker: upper },
        values,
        baseVersion,
        onConflict: 'tenant_id,ticker',
      });
    } catch (e) {
      if (e instanceof VersionConflictError) {
        // Hand the client the fresh server thesis so it can merge its in-flight
        // edits on top and retry, rather than silently overwriting a teammate.
        const current = shapeThesis(upper, e.current);
        return NextResponse.json({ conflict: true, current, version: current.version }, { status: 409 });
      }
      throw e;
    }

    const shaped = shapeThesis(upper, row);
    return NextResponse.json({ success: true, ...shaped });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Permanently delete a thesis (paper, review threads, research workspace, valuation,
// news, todos — everything). Used by the "full delete" action in the Strategic Hub.
export async function DELETE(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  const { error } = await supabase.from('theses').delete().eq('ticker', upper);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
