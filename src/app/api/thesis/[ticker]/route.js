import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

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
    return NextResponse.json({ ticker: upper, ...DEFAULT_THESIS });
  }

  return NextResponse.json({
    ticker: upper,
    ...DEFAULT_THESIS,
    coreReasons: data.core_reasons || DEFAULT_THESIS.coreReasons,
    assumptions: normalizeAssumptions(data.assumptions),
    valuation: data.valuation || '',
    underwriting: { ...DEFAULT_THESIS.underwriting, ...(data.underwriting || {}) },
    newsUpdates: data.news_updates || [],
    todos: data.todos || [],
    notes: data.notes || { links: [], tabs: [{ id: '1', title: 'General', content: [] }] },
  });
}

export async function POST(request, { params }) {
  const supabase = await getDb();
  const { ticker } = await params;
  const upper = ticker.toUpperCase();

  try {
    const body = await request.json();
    const row = {
      ticker: upper,
      core_reasons: body.coreReasons || DEFAULT_THESIS.coreReasons,
      assumptions: normalizeAssumptions(body.assumptions),
      valuation: body.valuation || '',
      underwriting: { ...DEFAULT_THESIS.underwriting, ...(body.underwriting || {}) },
      news_updates: body.newsUpdates || [],
      todos: body.todos || [],
      notes: body.notes || { links: [], tabs: [{ id: '1', title: 'General', content: [] }] },
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('theses').upsert(row, { onConflict: 'tenant_id,ticker' });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      success: true,
      ticker: upper,
      coreReasons: row.core_reasons,
      assumptions: normalizeAssumptions(row.assumptions),
      valuation: row.valuation,
      underwriting: row.underwriting,
      newsUpdates: row.news_updates,
      todos: row.todos,
      notes: row.notes,
    });
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
