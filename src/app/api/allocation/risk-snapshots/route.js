import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/*
  Risk factor input history (the Allocation → Inputs tab).

  Supabase table required — created by scripts/migrations/034_risk_factor_snapshots.sql.
  Rows are tenant-scoped by RLS, so the whole tenant shares one risk-input audit log.

  The WORKING risk scores/reasons a stock currently uses live in the
  `allocation_config` app_settings blob (row.factorExposures / factorReasons) — that
  is what the Optimizer reads and it auto-saves as you type. This route is the
  append-only HISTORY: each POST records one committed revision of a ticker's risk
  inputs (scores, per-factor reasoning, factor weights, note) so we can look back and
  see what we were thinking at the time.

  Author is taken from the session, never the client body.

  Degrades gracefully before the migration is applied: callers catch the failure, so
  the Inputs editor keeps working (and auto-saving) — only save-revision / history
  are unavailable until the table exists.
*/

const TABLE = 'risk_factor_snapshots';

const cleanTicker = (t) => (typeof t === 'string' ? t.trim().toUpperCase() : '');

// Normalize a JSON array field to a plain array (defensive against odd bodies).
const asArray = (v) => (Array.isArray(v) ? v : []);

// GET — history rows, newest first. ?ticker=XYZ narrows to one stock; otherwise the
// whole tenant log is returned and the client groups by ticker.
export async function GET(req) {
  try {
    const db = await getDb();
    const ticker = cleanTicker(new URL(req.url).searchParams.get('ticker') || '');
    let query = db
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });
    if (ticker) query = query.eq('ticker', ticker);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ snapshots: Array.isArray(data) ? data : [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — append one revision. Body: { ticker, factors, scores, reasons, factorWeights, note }
export async function POST(req) {
  try {
    const body = await req.json();
    const ticker = cleanTicker(body?.ticker);
    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    const db = await getDb();
    const row = {
      ticker,
      factors: asArray(body?.factors),
      scores: asArray(body?.scores),
      reasons: asArray(body?.reasons),
      factor_weights: asArray(body?.factorWeights),
      note: typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : '',
      author: db.username || '',
    };

    const { data, error } = await db.from(TABLE).insert(row).select('*').single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ snapshot: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — remove one history row by id. ?id=<uuid>
export async function DELETE(req) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }
    const db = await getDb();
    const { error } = await db.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
