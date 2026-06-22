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

// assumptions can be a plain string (legacy) or a JSON array of blocks (new rich text)
// Store as JSON string in TEXT column for backwards compat
function serializeAssumptions(val) {
  if (Array.isArray(val)) return JSON.stringify(val);
  return val || '';
}

function deserializeAssumptions(val) {
  if (!val) return '';
  if (typeof val === 'string' && val.startsWith('[')) {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
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
    assumptions: deserializeAssumptions(data.assumptions),
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
      assumptions: serializeAssumptions(body.assumptions),
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
      assumptions: deserializeAssumptions(row.assumptions),
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
