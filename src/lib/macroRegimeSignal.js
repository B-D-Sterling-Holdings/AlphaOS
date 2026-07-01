function toMonthString(value) {
  if (!value) return '--';
  const s = String(value);
  if (s.length >= 7) return s.slice(0, 7);
  return s;
}

function addOneMonth(value) {
  if (!value) return '--';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '--';
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 7);
}

function deriveRegime(eqWeight = 0) {
  if (eqWeight >= 0.85) return { regime: 'RISK ON', regimeColor: 'emerald' };
  if (eqWeight >= 0.60) return { regime: 'CAUTIOUS', regimeColor: 'amber' };
  return { regime: 'RISK OFF', regimeColor: 'red' };
}

/**
 * Build the current signal from the live prediction saved by the final model.
 * This is the correct prediction — the final model is trained on ALL available
 * data, unlike the walk-forward backtest models which only see partial data.
 */
export function buildSignalFromLivePrediction(lp) {
  if (!lp || lp.weight_equity == null) return null;

  const eqWeight = Number(lp.weight_equity) || 0;
  const tbillsWeight = lp.weight_tbills != null ? Number(lp.weight_tbills) : 1 - eqWeight;
  const dataAsOf = toMonthString(lp.rebalance_date);
  const allocationFor = toMonthString(lp.allocation_month);

  return {
    date: lp.rebalance_date || null,
    rebalanceDate: lp.rebalance_date || null,
    dataAsOf,
    allocationFor,
    equityWeight: eqWeight,
    tbillsWeight,
    probEquity: lp.prob_equity != null ? Number(lp.prob_equity) : null,
    probTbills: lp.prob_tbills != null ? Number(lp.prob_tbills) : null,
    overlay: lp.overlay || 'none',
    marketSignals: lp.market_signals || {},
    source: 'live',
    ...deriveRegime(eqWeight),
  };
}

export function buildSignalFromBacktest(backtest = []) {
  const validRows = (backtest || []).filter((r) => r.weight_equity != null);
  if (!validRows.length) return null;

  // Pick the row with the latest rebalance_date (the most recent decision).
  const last = validRows.reduce((latest, row) => {
    const latestRd = new Date(latest.rebalance_date || latest.date);
    const currentRd = new Date(row.rebalance_date || row.date);
    return currentRd > latestRd ? row : latest;
  });
  const eqWeight = Number(last.weight_equity) || 0;
  const tbillsWeight = last.weight_tbills != null ? Number(last.weight_tbills) : 1 - eqWeight;
  const dataAsOf = toMonthString(last.rebalance_date || last.date);
  const allocationFor = addOneMonth(last.rebalance_date || last.date);

  return {
    date: last.date || null,
    rebalanceDate: last.rebalance_date || null,
    dataAsOf,
    allocationFor,
    equityWeight: eqWeight,
    tbillsWeight,
    probEquity: last.prob_equity != null ? Number(last.prob_equity) : null,
    probTbills: last.prob_tbills != null ? Number(last.prob_tbills) : null,
    overlay: last.overlay || 'none',
    marketSignals: last.market_signals || {},
    source: 'backtest',
    ...deriveRegime(eqWeight),
  };
}

export function signalToRawOutput(signal) {
  const lines = [
    'CURRENT ALLOCATION SIGNAL',
    `  Data as of:              ${signal.dataAsOf || '--'}`,
    `  Allocation for:          ${signal.allocationFor || '--'}`,
    `  P(equity beats T-bills): ${signal.probEquity != null ? Number(signal.probEquity).toFixed(3) : '--'}`,
    `  P(T-bills win):          ${signal.probTbills != null ? Number(signal.probTbills).toFixed(3) : '--'}`,
    `  Crash overlay:           ${signal.overlay || 'none'}`,
  ];

  const marketSignals = signal.marketSignals && typeof signal.marketSignals === 'object'
    ? Object.entries(signal.marketSignals)
    : [];
  if (marketSignals.length) {
    lines.push('  Market signals:');
    for (const [key, value] of marketSignals) {
      const num = Number(value);
      lines.push(`    ${key}: ${Number.isFinite(num) ? (num > 0 ? '+' : '') + num.toFixed(2) : String(value)}`);
    }
  }

  lines.push('  RECOMMENDED ALLOCATION');
  lines.push(`    equity: ${((signal.equityWeight || 0) * 100).toFixed(1)}%`);
  lines.push(`    tbills: ${((signal.tbillsWeight || 0) * 100).toFixed(1)}%`);

  return lines.join('\n');
}

export async function getLatestResultSignal(supabase) {
  const { data, error } = await supabase
    .from('macro_regime_results')
    .select('backtest, live_prediction, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  // Prefer the live prediction from the final model (matches `make predict`).
  // Fall back to deriving from the last backtest row for older runs that
  // don't have a live_prediction saved.
  const signal = data.live_prediction
    ? buildSignalFromLivePrediction(data.live_prediction)
    : buildSignalFromBacktest(data.backtest || []);
  if (!signal) return null;

  return {
    signal,
    raw_output: signalToRawOutput(signal),
    created_at: data.created_at,
  };
}
