import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, writeSetting } from '@/lib/appSettings';

const KEY = 'macro_regime_config';

const DEFAULT_CONFIG = {
  start_date: '2000-01-01',
  end_date: '2026-03-01',
  equity_ticker: 'SPY',
  forecast_horizon_months: 1,
  macro_lag_months: 1,
  momentum_window: 3,
  volatility_window: 3,
  regularization_C: 0.5,
  class_weight: null,
  max_iter: 1000,
  recency_halflife_months: 12,
  window_type: 'expanding',
  rolling_window_months: 120,
  min_train_months: 48,
  holdout_start: '2020-01-01',
  baseline_equity: 0.95,
  baseline_tbills: 0.05,
  min_weight: 0.10,
  max_weight: 0.97,
  allocation_steepness: 13.0,
  weight_smoothing_up: 0.98,
  weight_smoothing_down: 0.97,
  crash_overlay: true,
  vix_spike_threshold: 7.0,
  drawdown_defense_threshold: -10.0,
  credit_spike_threshold: 1.5,
};

export async function GET() {
  try {
    const supabase = await getDb();
    const stored = await readSetting(supabase, KEY, null);
    const config = stored ? { ...DEFAULT_CONFIG, ...stored } : DEFAULT_CONFIG;
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const { config } = await req.json();
    if (!config) return NextResponse.json({ error: 'config is required' }, { status: 400 });

    const merged = { ...DEFAULT_CONFIG, ...config };

    const supabase = await getDb();
    await writeSetting(supabase, KEY, merged);
    return NextResponse.json({ config: merged, saved: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save config: ' + err.message }, { status: 500 });
  }
}
