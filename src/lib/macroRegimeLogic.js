export const DEFAULT_CONFIG = {
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

export const CFG = [
  {
    label: 'Dates',
    fields: [
      { key: 'end_date', label: 'Data through', type: 'month', desc: 'Latest data month to include. The model allocates for the following month.' },
      { key: 'start_date', label: 'History start', type: 'month', desc: 'First month of training history.' },
      { key: 'equity_ticker', label: 'Ticker', type: 'text' },
      { key: 'forecast_horizon_months', label: 'Horizon', type: 'number', step: 1, suffix: 'mo' },
    ],
  },
  {
    label: 'Features',
    fields: [
      { key: 'macro_lag_months', label: 'Macro Lag', type: 'number', step: 1, suffix: 'mo' },
      { key: 'momentum_window', label: 'Momentum', type: 'number', step: 1, suffix: 'mo' },
      { key: 'volatility_window', label: 'Volatility', type: 'number', step: 1, suffix: 'mo' },
    ],
  },
  {
    label: 'Model',
    fields: [
      { key: 'regularization_C', label: 'C', type: 'number', step: 0.05 },
      { key: 'max_iter', label: 'Iters', type: 'number', step: 100 },
    ],
  },
  {
    label: 'Training',
    fields: [
      { key: 'recency_halflife_months', label: 'Halflife', type: 'number', step: 1, suffix: 'mo' },
      { key: 'window_type', label: 'Window', type: 'select', options: ['expanding', 'rolling'] },
      { key: 'rolling_window_months', label: 'Rolling', type: 'number', step: 12, suffix: 'mo' },
      { key: 'min_train_months', label: 'Min Train', type: 'number', step: 6, suffix: 'mo' },
      { key: 'holdout_start', label: 'Holdout', type: 'text' },
    ],
  },
  {
    label: 'Allocation',
    fields: [
      { key: 'baseline_equity', label: 'Base Eq', type: 'number', step: 0.05 },
      { key: 'baseline_tbills', label: 'Base TB', type: 'number', step: 0.05 },
      { key: 'min_weight', label: 'Min', type: 'number', step: 0.05 },
      { key: 'max_weight', label: 'Max', type: 'number', step: 0.01 },
      { key: 'allocation_steepness', label: 'Steep', type: 'number', step: 0.5 },
      { key: 'weight_smoothing_up', label: 'Sm Up', type: 'number', step: 0.01 },
      { key: 'weight_smoothing_down', label: 'Sm Dn', type: 'number', step: 0.01 },
    ],
  },
  {
    label: 'Crash Overlay',
    fields: [
      { key: 'crash_overlay', label: 'Enable', type: 'toggle' },
      { key: 'vix_spike_threshold', label: 'VIX', type: 'number', step: 0.5 },
      { key: 'drawdown_defense_threshold', label: 'DD', type: 'number', step: 1, suffix: '%' },
      { key: 'credit_spike_threshold', label: 'Credit', type: 'number', step: 0.1 },
    ],
  },
];

export const METRICS_KEYS = [
  { k: 'cagr', l: 'CAGR', f: 'p' },
  { k: 'total_return', l: 'Total Return', f: 'p' },
  { k: 'volatility', l: 'Volatility', f: 'p' },
  { k: 'sharpe', l: 'Sharpe', f: 'n' },
  { k: 'sortino', l: 'Sortino', f: 'n' },
  { k: 'calmar', l: 'Calmar', f: 'n' },
  { k: 'max_drawdown', l: 'Max DD', f: 'p' },
  { k: 'max_dd_duration', l: 'DD Duration', f: 'm' },
  { k: 'hit_rate', l: 'Hit Rate', f: 'p' },
  { k: 'best_month', l: 'Best Mo', f: 'p' },
  { k: 'worst_month', l: 'Worst Mo', f: 'p' },
  { k: 'up_down_ratio', l: 'Up/Down', f: 'n' },
];

export const MACRO_CHART_COLORS = {
  m: '#10b981',
  e: '#8b5cf6',
  b: '#3b82f6',
  s: '#f59e0b',
  r: '#ef4444',
};

export const DERISK_DEFAULTS = {
  alpha: 0.5,
  derisk_start: 0.70,
  max_trim: 0.20,
  max_boost: 0.10,
  cash_min: 0.002,
  cash_max: 0.02,
};

export const fp = (value) => {
  const n = Number(value);
  return value != null && isFinite(n) ? `${(n * 100).toFixed(1)}%` : '--';
};

export const fn = (value) => {
  const n = Number(value);
  return value != null && isFinite(n) ? n.toFixed(2) : '--';
};

export const fd = (date) => (date ? String(date).slice(0, 7) : '--');

export function drawdowns(rows, key) {
  let peak = 0;
  return rows.map(row => {
    const value = row[key];
    if (value == null) return null;
    if (value > peak) peak = value;
    return peak > 0 ? value / peak - 1 : 0;
  });
}

export function rollingSharpe(rows, key, window = 24) {
  const returns = rows.map(row => row[key]);
  return returns.map((_, index) => {
    if (index < window) return null;
    const sample = returns.slice(index - window, index).filter(value => value != null);
    if (sample.length < window * 0.75) return null;
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const stdDev = Math.sqrt(sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample.length);
    return stdDev > 0 ? (mean * 12) / (stdDev * Math.sqrt(12)) : 0;
  });
}

export function computePerStockRisk(allocations, riskFactorWeights) {
  if (!allocations?.length || !riskFactorWeights?.length) return {};
  const result = {};
  for (const allocation of allocations) {
    if (!allocation.ticker) continue;
    const exposures = (allocation.factorExposures || []).map(value => Number(value) || 0);
    let score = 0;
    let weightSum = 0;
    for (let i = 0; i < exposures.length; i += 1) {
      const weight = Number(riskFactorWeights[i]) || 0;
      score += exposures[i] * weight;
      weightSum += weight;
    }
    result[allocation.ticker] = weightSum > 0 ? score / weightSum : 0;
  }
  return result;
}

function minMaxNormalize(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values.map(value => (range > 1e-9 ? (value - min) / range : 0.5));
}

export function computeDeriskOverlay({ baseWeights, volScores, compRisks, M, cfg = {} }) {
  const config = { ...DERISK_DEFAULTS, ...cfg };
  const tickers = Object.keys(baseWeights).filter(ticker => ticker !== 'CASH');

  if (tickers.length === 0 || M == null) {
    return {
      weights: { ...baseWeights },
      cash: Number(baseWeights.CASH || 0) / 100,
      D: 0,
      aggressiveness: {},
      trimmed: false,
    };
  }

  const baseFractions = {};
  for (const ticker of tickers) {
    baseFractions[ticker] = (Number(baseWeights[ticker]) || 0) / 100;
  }
  const baseCash = (Number(baseWeights.CASH) || 0) / 100;

  const volNorm = minMaxNormalize(tickers.map(ticker => Number(volScores[ticker]) || 0));
  const compNorm = minMaxNormalize(tickers.map(ticker => Number(compRisks[ticker]) || 0));
  const aggressiveness = {};
  tickers.forEach((ticker, index) => {
    aggressiveness[ticker] = config.alpha * volNorm[index] + (1 - config.alpha) * compNorm[index];
  });

  const D = Math.max(0, (config.derisk_start - M) / config.derisk_start);
  if (D === 0) {
    const weights = {};
    for (const ticker of tickers) weights[ticker] = Number(baseWeights[ticker]) || 0;
    weights.CASH = Number(baseWeights.CASH) || 0;
    return { weights, cash: baseCash, D: 0, aggressiveness, trimmed: false };
  }

  const values = tickers.map(ticker => aggressiveness[ticker]);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const aggressiveSide = {};
  const defensiveSide = {};
  for (const ticker of tickers) {
    const z = aggressiveness[ticker] - mean;
    aggressiveSide[ticker] = Math.max(0, z);
    defensiveSide[ticker] = Math.max(0, -z);
  }

  const maxAggressive = Math.max(...tickers.map(ticker => aggressiveSide[ticker]));
  const maxDefensive = Math.max(...tickers.map(ticker => defensiveSide[ticker]));
  const aggressiveScaled = {};
  const defensiveScaled = {};
  for (const ticker of tickers) {
    aggressiveScaled[ticker] = maxAggressive > 1e-9 ? aggressiveSide[ticker] / maxAggressive : 0;
    defensiveScaled[ticker] = maxDefensive > 1e-9 ? defensiveSide[ticker] / maxDefensive : 0;
  }

  // Absolute per-name weight cap (fraction). Opt-in: only enforced when a positive
  // max_weight (percent) is configured, so callers that don't set it keep the prior
  // relative-only behavior. The effective ceiling for a name is the tighter of its
  // relative boost cap and this absolute cap.
  const capFraction = Number(config.max_weight) > 0 ? Number(config.max_weight) / 100 : Infinity;
  const capOf = (ticker) => Math.min(baseFractions[ticker] * (1 + config.max_boost), capFraction);

  // 1) Trim aggressive names. They are only ever trimmed here (never boosted), so an
  //    aggressive name's delta is always ≤ 0. Also hard-cap anything already above the
  //    absolute ceiling. Everything trimmed goes into `removed`.
  const trimmedWeights = {};
  let removed = 0;
  for (const ticker of tickers) {
    const trim = D * config.max_trim * aggressiveScaled[ticker];
    let w = baseFractions[ticker] * (1 - trim);
    if (w > capFraction) w = capFraction;
    trimmedWeights[ticker] = w;
    removed += baseFractions[ticker] - w;
  }

  // 2) Route removed weight to cash first (up to the derisk cash target)…
  const targetCash = config.cash_min + D * (config.cash_max - config.cash_min);
  const cashExtra = Math.max(0, targetCash - baseCash);
  const actualCashExtra = Math.min(cashExtra, removed);
  let cash = baseCash + actualCashExtra;
  let pool = removed - actualCashExtra; // …then redistribute the rest to defensive names.

  // 3) Water-fill the pool into defensive names in proportion to how defensive each is,
  //    never past that name's ceiling. Unlike the old code we do NOT rescale the whole
  //    book afterwards — that uniform rescale leaked capped-out boosts back into the
  //    aggressive names we just trimmed and let deltas accelerate past the cap. Anything
  //    that can't be placed (every defensive name capped) falls back to cash.
  const finalStock = { ...trimmedWeights };
  let guard = 0;
  while (pool > 1e-9 && guard < 128) {
    guard += 1;
    const active = tickers.filter((t) => defensiveScaled[t] > 1e-9 && capOf(t) - finalStock[t] > 1e-9);
    if (active.length === 0) break;
    const weightSum = active.reduce((sum, t) => sum + defensiveScaled[t], 0);
    if (weightSum <= 1e-9) break;
    let placed = 0;
    for (const t of active) {
      const give = Math.min(pool * (defensiveScaled[t] / weightSum), capOf(t) - finalStock[t]);
      finalStock[t] += give;
      placed += give;
    }
    pool -= placed;
    if (placed <= 1e-12) break; // no measurable progress — stop
  }
  cash += Math.max(0, pool); // leftover nobody could absorb becomes cash

  // 4) Emit. Stocks + cash sum to 1 by construction; make CASH the exact residual so
  //    the rounded weights always total 100.00 (no uniform rescale needed).
  const finalWeights = {};
  let stockSum = 0;
  for (const ticker of tickers) {
    const v = Number((finalStock[ticker] * 100).toFixed(2));
    finalWeights[ticker] = v;
    stockSum += v;
  }
  const cashPct = Number((100 - stockSum).toFixed(2));
  finalWeights.CASH = cashPct;

  return { weights: finalWeights, cash: cashPct / 100, D, aggressiveness, trimmed: true };
}
