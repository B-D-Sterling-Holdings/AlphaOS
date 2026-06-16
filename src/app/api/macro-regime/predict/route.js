import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLatestResultSignal } from '@/lib/macroRegimeSignal';

export async function GET() {
  const supabase = await getDb();
  try {
    const derived = await getLatestResultSignal(supabase);
    if (!derived?.signal) {
      return NextResponse.json({
        error: 'No backtest data available. Run a backtest first.',
        needsBacktest: true,
      }, { status: 400 });
    }

    return NextResponse.json({ ...derived.signal, raw: derived.raw_output });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST() {
  const supabase = await getDb();
  try {
    const derived = await getLatestResultSignal(supabase);

    if (!derived?.signal) {
      return NextResponse.json({
        error: 'No backtest data available in Supabase. Run a full backtest first.',
        needsBacktest: true,
      }, { status: 400 });
    }

    return NextResponse.json({ ...derived.signal, raw: derived.raw_output });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
