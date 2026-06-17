import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { buildSignalFromBacktest } from '@/lib/macroRegimeSignal';

export async function GET() {
  const supabase = await getDb();
  try {
    // Get the latest results from Supabase
    const { data, error } = await supabase
      .from('macro_regime_results')
      .select('backtest, metrics, report, plots, validation_report, validation_data, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({
        backtest: null,
        metrics: null,
        report: null,
        plots: [],
        currentSignal: null,
      });
    }

    const result = {
      backtest: data.backtest || [],
      metrics: data.metrics || [],
      report: data.report,
      plots: data.plots ? Object.keys(data.plots) : [],
      validationReport: data.validation_report || null,
      validationData: data.validation_data || {},
      currentSignal: null,
    };

    result.currentSignal = buildSignalFromBacktest(data.backtest || []);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
