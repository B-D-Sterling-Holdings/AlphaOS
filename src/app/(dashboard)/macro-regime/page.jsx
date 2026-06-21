'use client';

import Image from 'next/image';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import { Play, Zap, RefreshCw, Shield, Settings, Check, Loader2, Terminal, ChevronDown, SlidersHorizontal, FlaskConical } from 'lucide-react';
import Card from '@/components/Card';
import Toast from '@/components/Toast';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend);

/* ── Config ──────────────────────────────────────────────────────── */

const DEFAULT_CONFIG = {
  start_date: '2000-01-01', end_date: '2026-03-01', equity_ticker: 'SPY',
  forecast_horizon_months: 1, macro_lag_months: 1, momentum_window: 3,
  volatility_window: 3, regularization_C: 0.5, class_weight: null, max_iter: 1000,
  recency_halflife_months: 12, window_type: 'expanding', rolling_window_months: 120,
  min_train_months: 48, holdout_start: '2020-01-01', baseline_equity: 0.95,
  baseline_tbills: 0.05, min_weight: 0.10, max_weight: 0.97,
  allocation_steepness: 13.0, weight_smoothing_up: 0.98, weight_smoothing_down: 0.97,
  crash_overlay: true, vix_spike_threshold: 7.0, drawdown_defense_threshold: -10.0,
  credit_spike_threshold: 1.5,
};

const CFG = [
  { label: 'Data', fields: [
    { key: 'start_date', label: 'Start', type: 'text' }, { key: 'end_date', label: 'End', type: 'text' },
    { key: 'equity_ticker', label: 'Ticker', type: 'text' }, { key: 'forecast_horizon_months', label: 'Horizon', type: 'number', step: 1, suffix: 'mo' },
  ]},
  { label: 'Features', fields: [
    { key: 'macro_lag_months', label: 'Macro Lag', type: 'number', step: 1, suffix: 'mo' },
    { key: 'momentum_window', label: 'Momentum', type: 'number', step: 1, suffix: 'mo' },
    { key: 'volatility_window', label: 'Volatility', type: 'number', step: 1, suffix: 'mo' },
  ]},
  { label: 'Model', fields: [
    { key: 'regularization_C', label: 'C', type: 'number', step: 0.05 },
    { key: 'max_iter', label: 'Iters', type: 'number', step: 100 },
  ]},
  { label: 'Training', fields: [
    { key: 'recency_halflife_months', label: 'Halflife', type: 'number', step: 1, suffix: 'mo' },
    { key: 'window_type', label: 'Window', type: 'select', options: ['expanding', 'rolling'] },
    { key: 'rolling_window_months', label: 'Rolling', type: 'number', step: 12, suffix: 'mo' },
    { key: 'min_train_months', label: 'Min Train', type: 'number', step: 6, suffix: 'mo' },
    { key: 'holdout_start', label: 'Holdout', type: 'text' },
  ]},
  { label: 'Allocation', fields: [
    { key: 'baseline_equity', label: 'Base Eq', type: 'number', step: 0.05 },
    { key: 'baseline_tbills', label: 'Base TB', type: 'number', step: 0.05 },
    { key: 'min_weight', label: 'Min', type: 'number', step: 0.05 },
    { key: 'max_weight', label: 'Max', type: 'number', step: 0.01 },
    { key: 'allocation_steepness', label: 'Steep', type: 'number', step: 0.5 },
    { key: 'weight_smoothing_up', label: 'Sm Up', type: 'number', step: 0.01 },
    { key: 'weight_smoothing_down', label: 'Sm Dn', type: 'number', step: 0.01 },
  ]},
  { label: 'Crash Overlay', fields: [
    { key: 'crash_overlay', label: 'Enable', type: 'toggle' },
    { key: 'vix_spike_threshold', label: 'VIX', type: 'number', step: 0.5 },
    { key: 'drawdown_defense_threshold', label: 'DD', type: 'number', step: 1, suffix: '%' },
    { key: 'credit_spike_threshold', label: 'Credit', type: 'number', step: 0.1 },
  ]},
];

const METRICS_KEYS = [
  { k: 'cagr', l: 'CAGR', f: 'p' }, { k: 'total_return', l: 'Total Return', f: 'p' },
  { k: 'volatility', l: 'Volatility', f: 'p' }, { k: 'sharpe', l: 'Sharpe', f: 'n' },
  { k: 'sortino', l: 'Sortino', f: 'n' }, { k: 'calmar', l: 'Calmar', f: 'n' },
  { k: 'max_drawdown', l: 'Max DD', f: 'p' }, { k: 'max_dd_duration', l: 'DD Duration', f: 'm' },
  { k: 'hit_rate', l: 'Hit Rate', f: 'p' }, { k: 'best_month', l: 'Best Mo', f: 'p' },
  { k: 'worst_month', l: 'Worst Mo', f: 'p' }, { k: 'up_down_ratio', l: 'Up/Down', f: 'n' },
];

/* ── Helpers ─────────────────────────────────────────────────────── */

const fp = (v) => { const n = Number(v); return v != null && isFinite(n) ? `${(n * 100).toFixed(1)}%` : '--'; };
const fn = (v) => { const n = Number(v); return v != null && isFinite(n) ? n.toFixed(2) : '--'; };
const fd = (d) => d ? String(d).slice(0, 7) : '--';

function drawdowns(rows, key) {
  let pk = 0;
  return rows.map(r => { const v = r[key]; if (v == null) return null; if (v > pk) pk = v; return pk > 0 ? v / pk - 1 : 0; });
}

function rollingSharpe(rows, key, w = 24) {
  const r = rows.map(x => x[key]);
  return r.map((_, i) => {
    if (i < w) return null;
    const s = r.slice(i - w, i).filter(v => v != null);
    if (s.length < w * 0.75) return null;
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length);
    return sd > 0 ? (m * 12) / (sd * Math.sqrt(12)) : 0;
  });
}

const C = { m: '#10b981', e: '#8b5cf6', b: '#3b82f6', s: '#f59e0b', r: '#ef4444' };

/* ── Per-stock standalone risk (weighted sum of bad-factor exposures) ── */

function computePerStockRisk(allocations, riskFactorWeights) {
  if (!allocations?.length || !riskFactorWeights?.length) return {};
  const result = {};
  for (const a of allocations) {
    if (!a.ticker) continue;
    const exposures = (a.factorExposures || []).map(v => Number(v) || 0);
    let score = 0;
    let wSum = 0;
    for (let i = 0; i < exposures.length; i++) {
      const w = Number(riskFactorWeights[i]) || 0;
      score += exposures[i] * w;
      wSum += w;
    }
    // Normalize to 0-1 scale (exposures are 0-1, weights are 0-1)
    result[a.ticker] = wSum > 0 ? score / wSum : 0;
  }
  return result;
}

/* ── Macro derisk overlay engine ──────────────────────────────── */

const DERISK_DEFAULTS = {
  alpha: 0.5,           // blend between vol and composite risk for aggressiveness
  derisk_start: 0.70,   // M threshold below which derisking kicks in
  max_trim: 0.20,       // max relative cut from base weight
  max_boost: 0.10,      // max relative boost above base weight
  cash_min: 0.002,      // 0.2%
  cash_max: 0.02,       // 2.0%
};

/**
 * Compute macro-adjusted portfolio weights.
 *
 * @param {Object} params
 * @param {Object} params.baseWeights   { ticker: percent } — base portfolio weights (sum ~100)
 * @param {Object} params.volScores  { ticker: number }  — Realized annualized vol per stock (e.g. 0.32 = 32%)
 * @param {Object} params.compRisks     { ticker: 0-1 }    — Standalone composite risk per stock
 * @param {number} params.M             Macro regime score 0-1 (higher = stronger / risk-on)
 * @param {Object} params.cfg           Override config fields from DERISK_DEFAULTS
 * @returns {{ weights: Object, cash: number, D: number, aggressiveness: Object, trimmed: boolean }}
 */
function computeDeriskOverlay({ baseWeights, volScores, compRisks, M, cfg = {} }) {
  const c = { ...DERISK_DEFAULTS, ...cfg };
  const tickers = Object.keys(baseWeights).filter(t => t !== 'CASH');

  // If no stocks or no signal, return base weights unchanged
  if (tickers.length === 0 || M == null) {
    return { weights: { ...baseWeights }, cash: Number(baseWeights.CASH || 0) / 100, D: 0, aggressiveness: {}, trimmed: false };
  }

  // Convert base weights from percent to fractions
  const wBase = {};
  let stockSum = 0;
  for (const t of tickers) {
    wBase[t] = (Number(baseWeights[t]) || 0) / 100;
    stockSum += wBase[t];
  }
  const cashBase = (Number(baseWeights.CASH) || 0) / 100;

  // Step 2: Stock aggressiveness score
  // Collect raw vol and composite for normalization
  const rawVol = tickers.map(t => Number(volScores[t]) || 0);
  const rawComp = tickers.map(t => Number(compRisks[t]) || 0);

  const minMax = (arr) => {
    const mn = Math.min(...arr);
    const mx = Math.max(...arr);
    const range = mx - mn;
    return arr.map(v => range > 1e-9 ? (v - mn) / range : 0.5);
  };

  const volNorm = minMax(rawVol);
  const compNorm = minMax(rawComp);

  const agg = {};
  tickers.forEach((t, i) => {
    agg[t] = c.alpha * volNorm[i] + (1 - c.alpha) * compNorm[i];
  });

  // Step 3: Derisk strength
  const D = Math.max(0, (c.derisk_start - M) / c.derisk_start);

  // If no derisking needed, return base unchanged with min cash
  if (D === 0) {
    const result = {};
    for (const t of tickers) result[t] = Number(baseWeights[t]) || 0;
    result.CASH = Number(baseWeights.CASH) || 0;
    return { weights: result, cash: cashBase, D: 0, aggressiveness: agg, trimmed: false };
  }

  // Step 4: Relative aggressiveness
  const aggValues = tickers.map(t => agg[t]);
  const aggMean = aggValues.reduce((s, v) => s + v, 0) / aggValues.length;

  const Z = {};
  const aggSide = {};
  const defSide = {};
  for (const t of tickers) {
    Z[t] = agg[t] - aggMean;
    aggSide[t] = Math.max(0, Z[t]);
    defSide[t] = Math.max(0, -Z[t]);
  }

  // Scale to [0,1] using cross-sectional max
  const maxAgg = Math.max(...tickers.map(t => aggSide[t]));
  const maxDef = Math.max(...tickers.map(t => defSide[t]));

  const aggScaled = {};
  const defScaled = {};
  for (const t of tickers) {
    aggScaled[t] = maxAgg > 1e-9 ? aggSide[t] / maxAgg : 0;
    defScaled[t] = maxDef > 1e-9 ? defSide[t] / maxDef : 0;
  }

  // Step 5: Trim aggressive names
  const wTrim = {};
  for (const t of tickers) {
    wTrim[t] = wBase[t] * (1 - c.max_trim * D * aggScaled[t]);
  }

  // Step 6: Removed weight
  let removed = 0;
  for (const t of tickers) {
    removed += wBase[t] - wTrim[t];
  }

  // Step 7: Cash target (strictly one-sided — only use what trimming freed)
  const cashTarget = c.cash_min + D * (c.cash_max - c.cash_min);
  const cashExtra = Math.max(0, cashTarget - cashBase);
  const actualCashExtra = Math.min(cashExtra, removed);
  const actualCash = cashBase + actualCashExtra;
  const redistribute = Math.max(0, removed - actualCashExtra);

  // Step 8: Redistribute toward defensive names
  const defSum = tickers.reduce((s, t) => s + defScaled[t], 0);
  const wNew = {};
  for (const t of tickers) {
    const add = defSum > 1e-9 ? redistribute * (defScaled[t] / defSum) : 0;
    wNew[t] = wTrim[t] + add;
  }

  // Step 9: Bound all changes relative to base weight
  const wBounded = {};
  for (const t of tickers) {
    const lower = wBase[t] * (1 - c.max_trim);
    const upper = wBase[t] * (1 + c.max_boost);
    wBounded[t] = Math.min(upper, Math.max(lower, wNew[t]));
  }

  // Step 10: Final renormalization — stocks sum to (1 - actualCash)
  const boundedSum = tickers.reduce((s, t) => s + wBounded[t], 0);
  const targetStockSum = 1 - actualCash;
  const scale = boundedSum > 1e-9 ? targetStockSum / boundedSum : 1;

  const finalWeights = {};
  for (const t of tickers) {
    finalWeights[t] = Math.round(wBounded[t] * scale * 10000) / 100; // back to percent, 2 decimals
  }
  finalWeights.CASH = Math.round(actualCash * 10000) / 100;

  return { weights: finalWeights, cash: actualCash, D, aggressiveness: agg, trimmed: true };
}

function cOpts(yf) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 5, font: { size: 10 }, padding: 12, color: '#6b7280' } },
      tooltip: {
        backgroundColor: '#fff', titleColor: '#111', bodyColor: '#6b7280', borderColor: '#e5e7eb', borderWidth: 1, padding: 8,
        callbacks: { label: ctx => {
          const v = ctx.parsed.y;
          return yf === 'pct' ? `${ctx.dataset.label}: ${(v * 100).toFixed(1)}%` : yf === '$' ? `${ctx.dataset.label}: $${v.toFixed(0)}` : `${ctx.dataset.label}: ${v.toFixed(2)}`;
        }},
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9 }, color: '#9ca3af' } },
      y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 9 }, color: '#9ca3af',
        callback: v => yf === 'pct' ? `${(v * 100).toFixed(0)}%` : yf === '$' ? `$${v}` : v.toFixed(1),
      }},
    },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0.3, borderWidth: 1.5 } },
  };
}

function ds(label, data, color, fill, dash) {
  return { label, data, borderColor: color, backgroundColor: fill ? `${color}12` : 'transparent', fill: !!fill, borderDash: dash, borderWidth: 1.5 };
}

const cOpts01 = o => ({ ...o, scales: { ...o.scales, y: { ...o.scales.y, min: 0, max: 1 } } });

function useGridReorderAnimation(containerRef, itemIds, duration = 380) {
  const positionsRef = useRef(new Map());
  const orderRef = useRef([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = Array.from(container.querySelectorAll('[data-reorder-id]'));
    const nextPositions = new Map(
      items.map(el => [el.dataset.reorderId, el.getBoundingClientRect()]),
    );

    const prevOrder = orderRef.current;
    const orderChanged =
      prevOrder.length === itemIds.length && prevOrder.some((id, idx) => id !== itemIds[idx]);

    let cleanupTimer = null;
    let frame1 = null;
    let frame2 = null;

    if (positionsRef.current.size > 0 && orderChanged) {
      const moved = [];

      for (const el of items) {
        const id = el.dataset.reorderId;
        const prev = positionsRef.current.get(id);
        const next = nextPositions.get(id);
        if (!prev || !next) continue;

        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        moved.push(el);
      }

      if (moved.length > 0) {
        frame1 = requestAnimationFrame(() => {
          frame2 = requestAnimationFrame(() => {
            for (const el of moved) {
              el.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
              el.style.transform = 'translate(0px, 0px)';
            }
          });
        });

        cleanupTimer = window.setTimeout(() => {
          for (const el of moved) {
            el.style.transition = '';
            el.style.transform = '';
          }
        }, duration + 40);
      }
    }

    positionsRef.current = nextPositions;
    orderRef.current = [...itemIds];

    return () => {
      if (frame1 != null) cancelAnimationFrame(frame1);
      if (frame2 != null) cancelAnimationFrame(frame2);
      if (cleanupTimer != null) clearTimeout(cleanupTimer);
    };
  }, [containerRef, itemIds, duration]);
}

/* ── Tiny components ─────────────────────────────────────────────── */

function CfgField({ f, value, onChange }) {
  if (f.type === 'toggle') return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-[11px] text-gray-500">{f.label}</span>
      <button type="button" onClick={() => onChange(f.key, !value)}
        className={`relative h-4 w-7 rounded-full ${value ? 'bg-emerald-500' : 'bg-gray-200'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${value ? 'left-3.5' : 'left-0.5'}`} />
      </button>
    </label>
  );
  if (f.type === 'select') return (
    <div>
      <label className="mb-0.5 block text-[10px] text-gray-400">{f.label}</label>
      <select value={value || ''} onChange={e => onChange(f.key, e.target.value)}
        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none">{f.options.map(o => <option key={o}>{o}</option>)}</select>
    </div>
  );
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-gray-400">{f.label}</label>
      <div className="relative">
        <input type={f.type} value={value ?? ''} step={f.step}
          onChange={e => { let v = e.target.value; if (f.type === 'number' && v !== '') v = Number(v); onChange(f.key, v); }}
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 pr-7 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none" />
        {f.suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-300">{f.suffix}</span>}
      </div>
    </div>
  );
}

function MdRender({ content }) {
  if (!content) return null;
  const lines = content.split('\n'), out = []; let tbl = [], inTbl = false, k = 0;
  const flush = () => { if (!tbl.length) return; out.push(
    <div key={k++} className="my-2 overflow-x-auto"><table className="w-full text-[11px]">
      <thead><tr className="border-b border-gray-200">{tbl[0].map((c, i) => <th key={i} className="px-3 py-1.5 text-left text-[10px] text-gray-400">{c.trim()}</th>)}</tr></thead>
      <tbody>{tbl.slice(1).map((row, ri) => <tr key={ri} className="border-b border-gray-50">{row.map((c, ci) => <td key={ci} className="px-3 py-1.5 text-gray-500">{c.trim() || '--'}</td>)}</tr>)}</tbody>
    </table></div>); tbl = []; };
  for (const l of lines) {
    if (/^\|[\s:|-]+\|$/.test(l)) continue;
    if (l.startsWith('|') && l.endsWith('|')) { inTbl = true; tbl.push(l.slice(1, -1).split('|')); continue; }
    if (inTbl) { flush(); inTbl = false; }
    if (l.startsWith('# ')) out.push(<h1 key={k++} className="mb-2 mt-4 text-sm font-semibold text-gray-900">{l.slice(2)}</h1>);
    else if (l.startsWith('## ')) out.push(<h2 key={k++} className="mb-1 mt-3 text-xs font-semibold text-gray-700">{l.slice(3)}</h2>);
    else if (l.startsWith('- ')) out.push(<li key={k++} className="ml-4 list-disc text-[11px] text-gray-500">{l.slice(2)}</li>);
    else if (l.trim()) out.push(<p key={k++} className="mb-1 text-[11px] text-gray-500">{l}</p>);
  }
  if (inTbl) flush();
  return <div>{out}</div>;
}

/* ══════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════ */

export default function MacroRegimePage() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [results, setResults] = useState(null);
  const [predict, setPredict] = useState(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [runStatus, setRunStatus] = useState({ running: false });
  const [runLog, setRunLog] = useState('');
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [detailTab, setDetailTab] = useState('run');
  const [toast, setToast] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [historyLog, setHistoryLog] = useState(null);
  const logRef = useRef(null);
  const pollRef = useRef(null);

  /* ── Allocation state ─────────────────────────────────────────── */
  const [allocConfig, setAllocConfig] = useState(null);     // full allocation_config
  const [allocWeights, setAllocWeights] = useState({});      // { ticker: number } editable
  const [committedAllocWeights, setCommittedAllocWeights] = useState({}); // weights used for reorder/save
  const [allocLoaded, setAllocLoaded] = useState(false);     // guard for auto-save
  const [syncingWeights, setSyncingWeights] = useState(false);
  const allocBlurTimer = useRef(null);

  /* ── Derisk overlay config ─────────────────────────────────── */
  const [deriskCfg, setDeriskCfg] = useState(DERISK_DEFAULTS);
  const [showOverlayCfg, setShowOverlayCfg] = useState(false);

  /* ── Realized vol ────────────────────────────────────────────── */
  const [realizedVol, setRealizedVol] = useState(null);       // { ticker: annualized vol }

  /* ── Sandbox / dev mode ─────────────────────────────────────── */
  const [sandboxM, setSandboxM] = useState(0.5);
  const allocGridRef = useRef(null);
  const overlayGridRef = useRef(null);

  const loadResults = useCallback(async () => {
    try { const d = await fetch('/api/macro-regime/results').then(r => r.json()); if (d.backtest) setResults(d); } catch {}
  }, []);
  const loadPredict = useCallback(async (fresh = false) => {
    setPredictLoading(true);
    try {
      const r = fresh ? await fetch('/api/macro-regime/predict', { method: 'POST' }) : await fetch('/api/macro-regime/predict');
      const d = await r.json(); if (!d.error) setPredict(d); else if (d.needsBacktest) setPredict(null);
    } catch {} setPredictLoading(false);
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [cfgD, resD, predD, runD, allocD, wD] = await Promise.all([
          fetch('/api/macro-regime/config').then(r => r.json()),
          fetch('/api/macro-regime/results').then(r => r.json()),
          fetch('/api/macro-regime/predict').then(r => r.json()),
          fetch('/api/macro-regime/run').then(r => r.json()),
          fetch('/api/allocation').then(r => r.json()),
          fetch('/api/macro-regime/weights').then(r => r.json()),
        ]);
        if (off) return;
        if (cfgD.config) {
          setConfig({ ...DEFAULT_CONFIG, ...cfgD.config });
          if (cfgD.config.deriskOverlay) setDeriskCfg({ ...DERISK_DEFAULTS, ...cfgD.config.deriskOverlay });
        }
        if (resD.backtest) setResults(resD);
        if (!predD.error) setPredict(predD);
        if (runD.history) setRunHistory(runD.history);
        if (runD.running) { setRunStatus(runD); setRunLog(runD.log || ''); setShowLog(true); }
        if (allocD.config) setAllocConfig(allocD.config);
        // Load saved macro-regime weights, or fall back to allocation page's userWeights
        if (wD.weights) {
          setAllocWeights(wD.weights);
          setCommittedAllocWeights(wD.weights);
        } else if (allocD.config?.allocations) {
          const w = {};
          for (const a of allocD.config.allocations) {
            if (a.ticker) w[a.ticker] = Number(a.userWeight) || 0;
          }
          setAllocWeights(w);
          setCommittedAllocWeights(w);
        }
        setAllocLoaded(true);
      } finally { if (!off) setLoading(false); }
    })();
    return () => { off = true; };
  }, []);

  // Fetch realized vol when allocConfig tickers are known
  useEffect(() => {
    if (!allocConfig?.allocations) return;
    const tickers = allocConfig.allocations.filter(a => a.ticker && a.ticker !== 'CASH').map(a => a.ticker);
    if (tickers.length === 0) return;
    (async () => {
      try {
        const d = await fetch(`/api/realized-vol?tickers=${tickers.join(',')}`).then(r => r.json());
        if (d.vols) setRealizedVol(d.vols);
      } catch {}
    })();
  }, [allocConfig]);

  useEffect(() => {
    if (!runStatus.running) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      try {
        const d = await fetch('/api/macro-regime/run').then(r => r.json());
        setRunLog(d.log || '');
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        if (!d.running) {
          setRunStatus(d); if (d.history) setRunHistory(d.history);
          clearInterval(pollRef.current);
          await Promise.all([loadResults(), loadPredict(false)]);
          setToast({ message: d.exitCode === 0 ? 'Completed' : `Failed (exit ${d.exitCode})`, type: d.exitCode === 0 ? 'success' : 'error' });
        }
      } catch {}
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runStatus.running, loadResults, loadPredict]);

  const handleRun = async (cmd) => {
    try {
      const d = await fetch('/api/macro-regime/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }).then(r => r.json());
      if (d.error) { setToast({ message: d.error, type: 'error' }); return; }
      // On Vercel the run is handed off to GitHub Actions — there's no local
      // process to poll, so just confirm it was triggered.
      if (d.status === 'dispatched') {
        setToast({ message: `Run triggered on GitHub Actions (${cmd}). Results sync to Supabase and appear here in a few minutes.`, type: 'success' });
        return;
      }
      setRunStatus({ running: true, command: cmd }); setRunLog(''); setShowLog(true);
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const saveConfig = async () => {
    try {
      const merged = { ...config, deriskOverlay: deriskCfg };
      const d = await fetch('/api/macro-regime/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: merged }) }).then(r => r.json());
      setToast({ message: d.error || 'Saved', type: d.error ? 'error' : 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const viewLog = async (id) => {
    if (historyLog?.id === id) { setHistoryLog(null); return; }
    try { const d = await fetch(`/api/macro-regime/run?history=${id}`).then(r => r.json()); if (d.run) setHistoryLog(d.run); } catch {}
  };

  /* ── Allocation helpers ──────────────────────────────────────── */
  const stockRisks = useMemo(() => {
    if (!allocConfig) return {};
    return computePerStockRisk(allocConfig.allocations || [], allocConfig.riskFactorWeights || []);
  }, [allocConfig]);

  const allocTickers = useMemo(() => {
    if (!allocConfig?.allocations) return [];
    // Stocks first, then CASH at the end
    const stocks = allocConfig.allocations.filter(a => a.ticker && a.ticker !== 'CASH').map(a => a.ticker);
    const hasCash = allocConfig.allocations.some(a => a.ticker === 'CASH');
    return hasCash ? [...stocks, 'CASH'] : stocks;
  }, [allocConfig]);

  // Realized vol per stock (annualized), fallback to factor exposure if not yet loaded
  const volScores = useMemo(() => {
    if (!allocConfig?.allocations) return {};
    const m = {};
    for (const a of allocConfig.allocations) {
      if (!a.ticker) continue;
      if (realizedVol && realizedVol[a.ticker] != null) {
        m[a.ticker] = realizedVol[a.ticker]; // raw annualized vol (e.g. 0.32 = 32%)
      } else {
        m[a.ticker] = Number((a.factorExposures || [])[0]) || 0; // fallback
      }
    }
    return m;
  }, [allocConfig, realizedVol]);

  // Macro regime score M = equityWeight from predict signal (0-1, higher = risk-on)
  const macroM = predict?.equityWeight ?? null;

  // Compute overlay
  const overlay = useMemo(() => {
    if (macroM == null || allocTickers.length === 0) return null;
    return computeDeriskOverlay({
      baseWeights: allocWeights,
      volScores,
      compRisks: stockRisks,
      M: macroM,
      cfg: deriskCfg,
    });
  }, [allocWeights, volScores, stockRisks, macroM, deriskCfg, allocTickers]);

  // Sandbox overlay — uses sandboxM instead of live M
  const sandboxOverlay = useMemo(() => {
    if (allocTickers.length === 0) return null;
    return computeDeriskOverlay({
      baseWeights: allocWeights,
      volScores,
      compRisks: stockRisks,
      M: sandboxM,
      cfg: deriskCfg,
    });
  }, [allocWeights, volScores, stockRisks, sandboxM, deriskCfg, allocTickers]);

  const handleAllocChange = (ticker, val) => {
    const n = val === '' ? 0 : Number(val);
    setAllocWeights(p => ({ ...p, [ticker]: n }));
  };

  const saveAllocWeights = useCallback(async (weights) => {
    if (!allocLoaded) return;
    try {
      await fetch('/api/macro-regime/weights', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }),
      });
    } catch {}
  }, [allocLoaded]);

  const commitAllocWeights = useCallback((weights) => {
    setCommittedAllocWeights(weights);
    saveAllocWeights(weights);
  }, [saveAllocWeights]);

  const handleAllocBlur = useCallback(() => {
    if (allocBlurTimer.current) clearTimeout(allocBlurTimer.current);
    allocBlurTimer.current = setTimeout(() => {
      const active = document.activeElement;
      const stillInsideAllocGrid = allocGridRef.current?.contains(active);
      if (!stillInsideAllocGrid) commitAllocWeights(allocWeights);
    }, 0);
  }, [allocWeights, commitAllocWeights]);

  const syncWeightsFromPortfolio = async () => {
    setSyncingWeights(true);
    try {
      const [portfolioRes, allocRes] = await Promise.all([
        fetch('/api/portfolio').then(r => r.json()),
        !allocConfig ? fetch('/api/allocation').then(r => r.json()) : null,
      ]);
      if (allocRes?.config && !allocConfig) setAllocConfig(allocRes.config);
      const holdings = portfolioRes.holdings || [];
      const cashVal = portfolioRes.cash || 0;
      if (holdings.length === 0) { setSyncingWeights(false); return; }

      const tickers = holdings.map(h => h.ticker).join(',');
      const quotesData = await fetch(`/api/quotes?tickers=${tickers}`).then(r => r.json());
      const quotes = quotesData.quotes || quotesData;

      let totalAum = cashVal;
      const values = {};
      for (const h of holdings) {
        const price = quotes[h.ticker]?.price || h.cost_basis || 0;
        const val = h.shares * price;
        values[h.ticker] = val;
        totalAum += val;
      }
      if (totalAum <= 0) { setSyncingWeights(false); return; }

      const w = {};
      for (const [ticker, val] of Object.entries(values)) {
        w[ticker] = Number(((val / totalAum) * 100).toFixed(2));
      }
      w.CASH = Number(((cashVal / totalAum) * 100).toFixed(2));

      setAllocWeights(w);
      commitAllocWeights(w);
    } catch (e) {
      setToast({ message: e.message, type: 'error' });
    }
    setSyncingWeights(false);
  };

  const allocTotal = useMemo(() => Object.values(allocWeights).reduce((s, v) => s + (Number(v) || 0), 0), [allocWeights]);

  const sortedAllocTickers = useMemo(
    () => [...allocTickers].sort((a, b) => (Number(committedAllocWeights[b]) || 0) - (Number(committedAllocWeights[a]) || 0)),
    [allocTickers, committedAllocWeights],
  );

  const committedOverlay = useMemo(() => {
    if (macroM == null || allocTickers.length === 0) return null;
    return computeDeriskOverlay({
      baseWeights: committedAllocWeights,
      volScores,
      compRisks: stockRisks,
      M: macroM,
      cfg: deriskCfg,
    });
  }, [committedAllocWeights, volScores, stockRisks, macroM, deriskCfg, allocTickers]);

  const sortedOverlayTickers = useMemo(() => {
    if (!committedOverlay) return [];
    return Object.keys(committedOverlay.weights).sort((a, b) => {
      const aWeight = Number(committedOverlay.weights[a]) || 0;
      const bWeight = Number(committedOverlay.weights[b]) || 0;
      return bWeight - aWeight;
    });
  }, [committedOverlay]);

  useGridReorderAnimation(allocGridRef, sortedAllocTickers);
  useGridReorderAnimation(overlayGridRef, sortedOverlayTickers);

  /* Dedup backtest rows */
  const btMap = new Map();
  for (const row of (results?.backtest || [])) { const k = row.date; const ex = btMap.get(k); if (!ex || (row.rebalance_date || '') > (ex.rebalance_date || '')) btMap.set(k, row); }
  const bt = [...btMap.values()];
  const metrics = results?.metrics || [];
  const sig = predict;
  const mm = metrics.find(m => m.label === 'Model Portfolio');
  const em = metrics.find(m => m.label && m.label.includes('Equity'));
  const step = bt.length > 400 ? 2 : 1;
  const cr = bt.filter((_, i) => i % step === 0 || i === bt.length - 1);
  const lbl = cr.map(r => fd(r.date));

  if (loading) return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="h-5 w-36 rounded skeleton mb-8" />
      <div className="h-40 rounded-3xl skeleton" />
    </div>
  );

  const eq = Math.round((sig?.equityWeight || 0) * 100);
  const regime = sig?.regime === 'RISK ON' ? 'Risk On' : sig?.regime === 'RISK OFF' ? 'Risk Off' : sig ? 'Cautious' : null;
  const rDot = sig?.regime === 'RISK ON' ? 'bg-emerald-500' : sig?.regime === 'RISK OFF' ? 'bg-red-500' : 'bg-amber-500';

  /* ── Render ──────────────────────────────────────────────────── */

  const regimeColor = sig?.regime === 'RISK ON' ? '#10b981' : sig?.regime === 'RISK OFF' ? '#ef4444' : '#f59e0b';
  const regimeBg = sig?.regime === 'RISK ON' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : sig?.regime === 'RISK OFF' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Market Confidence</h1>
      </div>

      {/* ━━ TOP ROW: Signal + Chart (left) | Portfolio Allocation (right) ━━ */}
      <div className={`mb-10 grid gap-5 ${allocTickers.length > 0 ? 'lg:grid-cols-[5fr_7fr]' : ''}`}>

        {/* ── LEFT COLUMN ── */}
        <div className="space-y-5">
          {/* Regime Signal Card */}
          {sig ? (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-6 relative overflow-hidden">
              {/* Subtle accent bar */}
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: regimeColor }} />

              {/* Date tag */}
              <div className="text-[10px] text-gray-400 mb-5">
                {sig.allocationFor || '--'} · data thru {sig.dataAsOf || '--'}
              </div>

              {/* Doughnut centered */}
              <div className="relative mx-auto w-44 h-44 mb-5">
                <Doughnut
                  data={{
                    labels: ['Equity', 'T-Bills'],
                    datasets: [{
                      data: [eq, 100 - eq],
                      backgroundColor: [regimeColor, '#f0f0f0'],
                      borderWidth: 0,
                      cutout: '78%',
                    }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: true,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: '#fff', titleColor: '#111', bodyColor: '#6b7280',
                        borderColor: '#e5e7eb', borderWidth: 1, padding: 10,
                        callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}%` },
                      },
                    },
                  }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold tabular-nums text-gray-900 leading-none">{eq}%</span>
                  <span className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${regimeBg}`}>{regime}</span>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: regimeColor }} />
                  <span className="text-[11px] font-medium text-gray-600">Equity <span className="text-gray-900 tabular-nums">{eq}%</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-gray-200" />
                  <span className="text-[11px] font-medium text-gray-600">T-Bills <span className="text-gray-900 tabular-nums">{100 - eq}%</span></span>
                </div>
              </div>

              {sig.overlay && sig.overlay !== 'none' && (
                <div className="mt-4 flex items-center justify-center">
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-100 px-2.5 py-0.5 text-[10px] font-medium text-red-600">
                    <Shield size={9} /> Overlay: {sig.overlay}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-6">
              <p className="text-sm text-gray-400">
                {predictLoading ? <Loader2 size={14} className="inline animate-spin" /> : 'No signal yet. Run a backtest below.'}
              </p>
            </div>
          )}

          {/* Allocation Over Time Chart */}
          {cr.length > 0 && (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
              <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-4">Allocation Over Time</h3>
              <div className="h-52">
                <Line
                  data={{ labels: lbl, datasets: [
                    { label: 'Equity', data: cr.map(r => r.weight_equity), borderColor: regimeColor || '#111', backgroundColor: `${regimeColor || '#111'}10`, fill: true, stepped: 'before', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3 },
                    { label: 'T-Bills', data: cr.map(r => r.weight_equity != null ? 1 : null), borderColor: 'transparent', backgroundColor: 'rgba(0,0,0,0.02)', fill: true, stepped: 'before', borderWidth: 0, pointRadius: 0, pointHoverRadius: 0 },
                  ]}}
                  options={{
                    ...cOpts01(cOpts('pct')),
                    plugins: { ...cOpts01(cOpts('pct')).plugins, legend: { display: false },
                      tooltip: { ...cOpts01(cOpts('pct')).plugins.tooltip,
                        callbacks: { label: ctx => ctx.datasetIndex === 1 ? null : [`Eq ${(ctx.parsed.y * 100).toFixed(1)}%`, `TB ${((1 - ctx.parsed.y) * 100).toFixed(1)}%`] },
                        filter: item => item.datasetIndex === 0,
                      },
                    },
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Portfolio Allocation ── */}
        {allocTickers.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Portfolio Allocation</h2>
              <button onClick={syncWeightsFromPortfolio} disabled={syncingWeights}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 transition-colors"
                title="Sync weights from current portfolio holdings">
                <RefreshCw size={10} className={syncingWeights ? 'animate-spin' : ''} /> Sync
              </button>
            </div>

            {/* Total bar */}
            <div className="mb-4 flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${allocTotal > 100.005 ? 'bg-red-400' : allocTotal >= 99.995 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                  style={{ width: `${Math.min(allocTotal, 100)}%` }} />
              </div>
              <span className={`text-xs font-semibold font-mono tabular-nums ${allocTotal > 100.005 ? 'text-red-500' : allocTotal >= 99.995 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {allocTotal.toFixed(2)}%
              </span>
            </div>

            <div ref={allocGridRef} className="grid grid-cols-3 gap-2 flex-1 auto-rows-fr">
              {sortedAllocTickers.map((ticker) => {
                const risk = stockRisks[ticker];
                const w = Number(allocWeights[ticker]) || 0;
                const maxW = Number(allocConfig?.maxWeight) || 100;
                const barPct = Math.min((w / maxW) * 100, 100);
                return (
                  <div
                    key={ticker}
                    data-reorder-id={ticker}
                    className="group flex flex-col rounded-xl bg-gray-50/60 ring-1 ring-gray-100 px-3 py-2.5 hover:ring-gray-200 transition-[box-shadow,background-color] duration-300 will-change-transform"
                  >
                    <div className="flex items-center justify-between mb-auto">
                      <span className="text-sm font-semibold text-gray-900">{ticker}</span>
                      {risk != null && (
                        <span className="text-[11px] font-mono text-gray-400 opacity-60 group-hover:opacity-100 transition-opacity" title="Composite risk">
                          {(risk * 100).toFixed(0)}
                        </span>
                      )}
                    </div>
                    {/* Mini weight bar — max is Stock Max Weight */}
                    <div className="h-1.5 rounded-full bg-emerald-100 my-2 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${barPct >= 100 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${barPct}%` }} />
                    </div>
                    <div className="relative mt-auto">
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={allocWeights[ticker] ?? ''}
                        onChange={e => handleAllocChange(ticker, e.target.value)}
                        onBlur={handleAllocBlur}
                        className="w-full rounded-lg bg-white ring-1 ring-gray-200 px-2.5 py-2.5 pr-6 text-[12px] font-mono text-gray-800 tabular-nums focus:ring-gray-400 focus:outline-none transition-shadow"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ━━ MACRO-ADJUSTED WEIGHTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {committedOverlay && allocTickers.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Macro-Adjusted Weights</h2>
              {committedOverlay.trimmed ? (
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-semibold font-mono text-amber-700">
                  D = {committedOverlay.D.toFixed(2)}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  No derisking
                </span>
              )}
            </div>
            <button onClick={() => setShowOverlayCfg(v => !v)}
              className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${showOverlayCfg ? 'bg-gray-900 text-white' : 'bg-gray-50 ring-1 ring-gray-200 text-gray-400 hover:text-gray-600'}`}>
              <Settings size={12} />
            </button>
          </div>

          {/* Overlay config */}
          {showOverlayCfg && (
            <div className="mb-5 rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
              <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-4">Overlay Parameters</h3>
              <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { key: 'alpha', label: 'Alpha', step: 0.05, desc: 'Vol vs risk blend' },
                  { key: 'derisk_start', label: 'Derisk Start', step: 0.05, desc: 'Trim threshold' },
                  { key: 'max_trim', label: 'Max Trim', step: 0.05, desc: 'Max cut per stock' },
                  { key: 'max_boost', label: 'Max Boost', step: 0.05, desc: 'Max boost per stock' },
                  { key: 'cash_min', label: 'Cash Floor', step: 0.001, desc: 'Min cash allocation' },
                  { key: 'cash_max', label: 'Cash Ceiling', step: 0.005, desc: 'Max cash allocation' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="mb-1 block text-[10px] font-semibold text-gray-500">{f.label}</label>
                    <input type="number" step={f.step} value={deriskCfg[f.key] ?? ''}
                      onChange={e => setDeriskCfg(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                      className="w-full rounded-lg bg-gray-50 ring-1 ring-gray-200 px-2.5 py-1.5 text-[11px] font-mono text-gray-800 focus:ring-gray-400 focus:outline-none" />
                    <p className="mt-1 text-[9px] text-gray-400">{f.desc}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
                <button onClick={saveConfig}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[11px] font-medium text-white hover:bg-gray-800 transition-colors">
                  <Check size={10} /> Save Config
                </button>
              </div>
            </div>
          )}

          {/* Adjusted weights grid */}
          <div ref={overlayGridRef} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {sortedOverlayTickers.map(ticker => {
              const baseW = Number(committedAllocWeights[ticker]) || 0;
              const adjW = committedOverlay.weights[ticker] ?? baseW;
              const delta = adjW - baseW;
              const aggScore = committedOverlay.aggressiveness[ticker];
              return (
                <div
                  key={ticker}
                  data-reorder-id={ticker}
                  className={`rounded-xl px-3 py-2.5 ring-1 transition-[background-color,border-color] duration-300 will-change-transform ${
                  Math.abs(delta) < 0.01 ? 'bg-white ring-gray-100' : delta < 0 ? 'bg-red-50/40 ring-red-200/60' : 'bg-emerald-50/40 ring-emerald-200/60'
                }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-gray-900">{ticker}</span>
                    {ticker !== 'CASH' && aggScore != null && (
                      <span className="text-[9px] font-mono text-gray-400" title="Aggressiveness">
                        {(aggScore * 100).toFixed(0)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-bold tabular-nums text-gray-900">{adjW.toFixed(2)}%</span>
                    {Math.abs(delta) >= 0.01 && (
                      <span className={`text-[10px] font-mono font-semibold tabular-nums ${delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ━━ STRESS TEST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {allocTickers.length > 0 && sandboxOverlay && (
        <div className="mb-10 rounded-[28px] border border-gray-200 bg-[linear-gradient(180deg,rgba(249,250,251,0.92),rgba(255,255,255,1))] p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 ring-1 ring-gray-200">
                <FlaskConical size={12} className="text-gray-700" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Stress Test</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Stress-test the derisking overlay before you commit changes.</h3>
              <p className="mt-1 text-sm text-gray-500">Move the regime score and inspect how the overlay shifts cash, trims aggressive names, and redistributes weight across the book.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Regime Score', value: sandboxM.toFixed(2) },
                { label: 'Derisk Strength', value: sandboxOverlay.D.toFixed(3) },
                { label: 'Target Cash', value: `${(sandboxOverlay.cash * 100).toFixed(2)}%` },
                { label: 'Total Weight', value: `${Object.values(sandboxOverlay.weights).reduce((s, v) => s + v, 0).toFixed(1)}%` },
              ].map(s => (
                <div key={s.label} className="rounded-2xl bg-white px-4 py-3 ring-1 ring-gray-200">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-400">{s.label}</div>
                  <div className="mt-1 text-sm font-bold font-mono text-gray-900">{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-5 rounded-2xl bg-white p-5 ring-1 ring-gray-200">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Scenario Input</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">Macro regime score</div>
              </div>
              <div className="flex items-center gap-2">
                {sandboxOverlay.trimmed ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                    Derisking active
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                    No derisking
                  </span>
                )}
                <input type="number" min="0" max="1" step="0.01" value={sandboxM}
                  onChange={e => setSandboxM(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
                  className="w-20 rounded-xl bg-gray-50 px-3 py-2 text-[12px] font-mono text-right text-gray-900 ring-1 ring-gray-200 focus:outline-none focus:ring-gray-400" />
              </div>
            </div>
            <input type="range" min="0" max="1" step="0.01" value={sandboxM}
              onChange={e => setSandboxM(Number(e.target.value))}
              className="h-2 w-full cursor-pointer rounded-full bg-gray-200 accent-gray-900" />
            <div className="mt-2 flex justify-between text-[10px] font-medium text-gray-400">
              <span>0 Risk Off</span>
              <span>start {deriskCfg.derisk_start}</span>
              <span>1 Risk On</span>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 ring-1 ring-gray-200">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Preview</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">Adjusted weights by ticker</div>
              </div>
            </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="py-2.5 pl-4 text-left text-[10px] font-semibold text-gray-500">Ticker</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500">Base %</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500">Real Vol</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500">Comp</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500">Agg</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500">Adj %</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocTickers.filter(t => t !== 'CASH').map(ticker => {
                      const baseW = Number(allocWeights[ticker]) || 0;
                      const adjW = sandboxOverlay.weights[ticker] ?? baseW;
                      const delta = adjW - baseW;
                      const aggScore = sandboxOverlay.aggressiveness[ticker];
                      const vol = volScores[ticker] ?? 0;
                      const comp = stockRisks[ticker] ?? 0;
                      return (
                        <tr key={ticker} className="border-b border-gray-50 transition-colors hover:bg-gray-50/70">
                          <td className="py-2.5 pl-4 font-semibold text-gray-800">{ticker}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-gray-500">{baseW.toFixed(1)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-gray-400">{(vol * 100).toFixed(1)}%</td>
                          <td className="px-3 py-2.5 text-right font-mono text-gray-400">{(comp * 100).toFixed(0)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-gray-400">{aggScore != null ? (aggScore * 100).toFixed(0) : '--'}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-900">{adjW.toFixed(2)}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-medium ${Math.abs(delta) < 0.01 ? 'text-gray-300' : delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-50/80">
                      <td className="py-2.5 pl-4 font-semibold text-gray-500">CASH</td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-400">{(Number(allocWeights.CASH) || 0).toFixed(1)}</td>
                      <td className="px-3 py-2.5" colSpan={3} />
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-900">{(sandboxOverlay.weights.CASH ?? 0).toFixed(2)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-medium ${
                        ((sandboxOverlay.weights.CASH ?? 0) - (Number(allocWeights.CASH) || 0)) > 0.01 ? 'text-emerald-600' : 'text-gray-300'
                      }`}>
                        {(((sandboxOverlay.weights.CASH ?? 0) - (Number(allocWeights.CASH) || 0)) > 0 ? '+' : '')}
                        {((sandboxOverlay.weights.CASH ?? 0) - (Number(allocWeights.CASH) || 0)).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
          </div>
        </div>
      )}

      {/* ━━ TOOLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="border-t border-gray-200/60 pt-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-100 shadow-sm">
              <SlidersHorizontal size={15} className="text-gray-700" />
            </div>
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Tools</h2>
              <p className="mt-0.5 text-sm text-gray-500">Run jobs, inspect results, and tune the model from one place.</p>
            </div>
            {runStatus.running && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 ml-1">
                <Loader2 size={10} className="animate-spin" /> {runStatus.command}
              </span>
            )}
          </div>
        </div>

        {/* Tool tabs */}
        <div className="mb-5 inline-flex rounded-2xl border border-gray-200 bg-gray-50 p-1">
          {[
            { id: 'run', label: 'Run' },
            { id: 'backtest', label: 'Backtests' },
            { id: 'data', label: 'Data' },
            { id: 'charts', label: 'Charts' },
            { id: 'config', label: 'Config' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setDetailTab(id)}
              className={`rounded-xl px-4 py-2 text-[11px] font-medium transition-all ${detailTab === id ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Run Tab ── */}
        {detailTab === 'run' && (
          <div className="space-y-5">
            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { cmd: 'predict', icon: Zap, label: 'Predict', desc: 'Quick signal from latest backtest' },
                { cmd: 'fast', icon: RefreshCw, label: 'Fast Run', desc: 'Lightweight backtest' },
                { cmd: 'run', icon: Play, label: 'Full Run', desc: 'Complete backtest run', primary: true },
                { cmd: 'validate', icon: Shield, label: 'Validate', desc: 'Model validation checks' },
              ].map(({ cmd, icon: I, label, desc, primary }) => {
                const active = runStatus.running && runStatus.command === cmd;
                return (
                  <button key={cmd} onClick={() => handleRun(cmd)} disabled={runStatus.running}
                    className={`group flex flex-col items-start rounded-xl p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                      primary
                        ? 'bg-gray-900 text-white ring-1 ring-gray-900 hover:bg-black hover:shadow-md'
                        : 'bg-white ring-1 ring-gray-200 text-gray-900 hover:ring-gray-400 hover:shadow-sm'
                    }`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-6 w-6 flex items-center justify-center rounded-md transition-all ${
                        primary ? 'bg-white/15 text-white' : 'bg-gray-50 ring-1 ring-gray-200 group-hover:bg-gray-900 group-hover:text-white group-hover:ring-gray-900'
                      }`}>
                        {active ? <Loader2 size={11} className="animate-spin" /> : <I size={11} />}
                      </div>
                      <span className="text-[12px] font-semibold">{label}</span>
                    </div>
                    <span className={`text-[10px] leading-relaxed ${primary ? 'text-gray-300' : 'text-gray-400'}`}>{desc}</span>
                  </button>
                );
              })}
            </div>

            {/* Inline run status — makes it obvious a run is in flight or just finished */}
            {runStatus.running ? (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[11px] font-medium text-amber-700">
                <Loader2 size={12} className="animate-spin" />
                Running <span className="font-semibold">{runStatus.command}</span>… this can take a minute. Output appears below.
              </div>
            ) : runStatus.exitCode != null && (
              <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[11px] font-medium border ${
                runStatus.exitCode === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                {runStatus.exitCode === 0
                  ? <><Check size={12} /> Last run (<span className="font-semibold">{runStatus.command}</span>) completed.</>
                  : <><Shield size={12} /> Last run (<span className="font-semibold">{runStatus.command}</span>) failed (exit {runStatus.exitCode}). Check the output log below.</>}
              </div>
            )}

            {/* Log output */}
            <div>
              <button onClick={() => setShowLog(v => !v)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors mb-2">
                <Terminal size={11} /> Output Log
                <ChevronDown size={10} className={`transition-transform ${showLog ? 'rotate-180' : ''}`} />
              </button>
              {showLog && (
                <>
                  <div ref={logRef} className="max-h-48 overflow-y-auto rounded-xl bg-gray-950 px-4 py-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-gray-400">
                    {runLog || 'No output yet.'}
                  </div>
                  {runHistory.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="text-[10px] text-gray-400 font-medium mr-1">History:</span>
                      {runHistory.map(r => (
                        <button key={r.id} onClick={() => viewLog(r.id)}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            historyLog?.id === r.id ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600'
                          }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${r.status === 'completed' ? 'bg-emerald-400' : r.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                          {r.run_type}
                        </button>
                      ))}
                    </div>
                  )}
                  {historyLog && (
                    <div className="mt-2 max-h-32 overflow-y-auto rounded-xl bg-gray-950 p-3 font-mono text-[10px] whitespace-pre-wrap text-gray-400">
                      {historyLog.log_output || 'No log.'}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Signal summary */}
            {sig && (
              <div className="rounded-xl bg-white ring-1 ring-gray-100 p-4">
                <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Current Signal</h4>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { label: 'Equity', value: `${eq}%`, color: 'text-gray-900' },
                    { label: 'T-Bills', value: `${100 - eq}%`, color: 'text-gray-500' },
                    { label: 'P(Equity)', value: sig.probEquity != null ? `${Math.round(sig.probEquity * 100)}%` : '--', color: 'text-gray-700' },
                    { label: 'Regime', value: regime, color: sig?.regime === 'RISK ON' ? 'text-emerald-600' : sig?.regime === 'RISK OFF' ? 'text-red-500' : 'text-amber-600' },
                  ].map(s => (
                    <div key={s.label}>
                      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{s.label}</div>
                      <div className={`text-base font-bold ${s.color} mt-0.5`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Backtests Tab ── */}
        {detailTab === 'backtest' && results && (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
                <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Cumulative Returns</h3>
                <div className="h-56">
                  <Line data={{ labels: lbl, datasets: [
                    ds('Model', cr.map(r => r.cum_port), C.m),
                    ds('95/5', cr.map(r => r.cum_ew), C.b, false, [4, 2]),
                    ds('60/40', cr.map(r => r.cum_6040), C.s, false, [6, 3]),
                    ds('Equity', cr.map(r => r.cum_equity), C.e, false, [2, 2]),
                  ]}} options={cOpts('$')} />
                </div>
              </div>
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
                <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Drawdowns</h3>
                <div className="h-56">
                  <Line data={{ labels: lbl, datasets: [
                    { ...ds('Model', drawdowns(cr, 'cum_port'), C.m, true) },
                    { ...ds('Equity', drawdowns(cr, 'cum_equity'), C.e, true), backgroundColor: `${C.e}08` },
                  ]}} options={cOpts('pct')} />
                </div>
              </div>
            </div>

            {/* Key metrics */}
            {mm && em && (
              <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl ring-1 ring-gray-100 bg-gray-100">
                {[
                  { l: 'CAGR', v: fp(mm.cagr), c: fp(em.cagr), g: mm.cagr > em.cagr },
                  { l: 'Sharpe', v: fn(mm.sharpe), c: fn(em.sharpe), g: mm.sharpe > em.sharpe },
                  { l: 'Max DD', v: fp(mm.max_drawdown), c: fp(em.max_drawdown), g: mm.max_drawdown > em.max_drawdown },
                  { l: 'Sortino', v: fn(mm.sortino), c: fn(em.sortino), g: mm.sortino > em.sortino },
                ].map(({ l, v, c, g }) => (
                  <div key={l} className="bg-white p-4">
                    <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{l}</div>
                    <div className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{v}</div>
                    <div className={`text-[10px] font-medium mt-0.5 ${g ? 'text-emerald-600' : 'text-red-500'}`}>vs {c}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Additional charts */}
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
                <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Model Probabilities</h3>
                <div className="h-48">
                  <Line data={{ labels: lbl, datasets: [
                    ds('P(Eq > TB)', cr.map(r => r.prob_equity), C.m),
                    ds('P(TB Win)', cr.map(r => r.prob_tbills), C.r, false, [4, 2]),
                  ]}} options={cOpts01(cOpts('pct'))} />
                </div>
              </div>
              <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
                <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Rolling 24mo Sharpe</h3>
                <div className="h-48">
                  <Line data={{ labels: lbl, datasets: [
                    ds('Model', rollingSharpe(cr, 'port_return'), C.m),
                    ds('Equity', rollingSharpe(cr, 'ret_equity'), C.e, false, [4, 2]),
                  ]}} options={cOpts('num')} />
                </div>
              </div>
            </div>
          </div>
        )}
        {detailTab === 'backtest' && !results && (
          <p className="py-10 text-center text-sm text-gray-400">No backtest results yet. Run a full backtest first.</p>
        )}

        {/* ── Data Tab ── */}
        {detailTab === 'data' && (
          <div className="space-y-6">
            {/* Full metrics table */}
            {results && metrics.length > 0 && (
              <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                <table className="w-full text-[11px]">
                  <thead><tr className="border-b border-gray-100">
                    <th className="py-3 pl-4 text-left text-[10px] font-semibold text-gray-500">Metric</th>
                    {metrics.map(m => <th key={m.label} className={`px-3 py-3 text-right text-[10px] font-semibold ${m.label === 'Model Portfolio' ? 'text-emerald-600' : 'text-gray-500'}`}>{m.label.replace(' Portfolio', '').replace(' Only', '')}</th>)}
                  </tr></thead>
                  <tbody>{METRICS_KEYS.map(({ k, l, f }) => (
                    <tr key={k} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-2 pl-4 font-medium text-gray-700">{l}</td>
                      {metrics.map((m, j) => {
                        const v = m[k]; let d = '--';
                        if (v != null) { if (f === 'p') d = fp(v); else if (f === 'n') d = fn(v); else d = `${Math.round(v)} mo`; }
                        return <td key={m.label} className={`px-3 py-2 text-right font-mono ${j === 0 ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{d}</td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {/* Plots */}
            {results?.plots?.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Generated Plots</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  {results.plots.map(p => (
                    <div key={p} className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-3">
                      <div className="mb-2 text-[10px] font-medium text-gray-500">{p.replace(/_/g, ' ').replace('.png', '')}</div>
                      <Image src={`/api/macro-regime/plots?name=${p}`} alt={p} width={1600} height={900} className="w-full rounded-xl" unoptimized />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Validation */}
            {results?.validationReport && (
              <div>
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Validation Report</h3>
                <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
                  <MdRender content={results.validationReport} />
                </div>
                {Object.entries(results.validationData || {}).map(([name, rows]) => {
                  if (!rows?.length) return null;
                  const cols = Object.keys(rows[0]);
                  return (
                    <div key={name} className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                      <div className="border-b border-gray-100 px-4 py-2.5 text-[10px] font-semibold text-gray-500">{name.replace(/_/g, ' ')}</div>
                      <table className="w-full text-[11px]">
                        <thead><tr className="border-b border-gray-100">{cols.map(c => <th key={c} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
                        <tbody>{rows.map((row, i) => <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">{cols.map(c => {
                          const v = row[c]; const isN = typeof v === 'number' && isFinite(v);
                          return <td key={c} className={`px-3 py-2 ${isN ? 'font-mono text-gray-500' : 'text-gray-700'}`}>{v == null ? '--' : isN ? fn(v) : String(v)}</td>;
                        })}</tr>)}</tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}

            {!results && <p className="py-10 text-center text-sm text-gray-400">No data yet. Run a backtest to generate results.</p>}
          </div>
        )}

        {/* ── Charts Tab ── */}
        {detailTab === 'charts' && results && (() => {
          const MACRO_CHARTS = [
            { key: 'md_inflation_yoy', label: 'Inflation YoY (%)', color: '#ef4444' },
            { key: 'md_inflation_impulse', label: 'Inflation Impulse (%)', color: '#f97316' },
            { key: 'md_unemployment_rate', label: 'Unemployment Rate (%)', color: '#8b5cf6' },
            { key: 'md_credit_spread_level', label: 'Credit Spread OAS (%)', color: '#ec4899' },
            { key: 'md_credit_spread_3m_change', label: 'Credit Spread 3M Chg (%)', color: '#f43f5e' },
            { key: 'md_real_fed_funds', label: 'Real Fed Funds (%)', color: '#14b8a6' },
            { key: 'md_yield_curve_slope', label: 'Yield Curve 10Y-2Y (%)', color: '#3b82f6' },
            { key: 'md_vix_1m_change', label: 'VIX 1M Change', color: '#f59e0b' },
            { key: 'md_vix_term_structure', label: 'VIX Term Structure', color: '#d97706' },
            { key: 'md_equity_momentum_3m', label: 'Equity Momentum 3M (%)', color: '#10b981' },
            { key: 'md_equity_vol_3m', label: 'Equity Volatility 3M (%)', color: '#6366f1' },
            { key: 'md_equity_drawdown_from_high', label: 'Equity Drawdown from High (%)', color: '#dc2626' },
          ];
          const hasAny = cr.some(r => MACRO_CHARTS.some(c => r[c.key] != null));
          if (!hasAny) return (
            <p className="py-10 text-center text-sm text-gray-400">No macro indicator data found. Run a new backtest to generate charts.</p>
          );
          const available = MACRO_CHARTS.filter(c => cr.some(r => r[c.key] != null));
          return (
            <div className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-2">
                {available.map(({ key, label, color }) => (
                  <div key={key} className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
                    <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">{label}</h3>
                    <div className="h-48">
                      <Line data={{ labels: lbl, datasets: [ds(label, cr.map(r => r[key] ?? null), color)] }} options={cOpts('num')} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {detailTab === 'charts' && !results && (
          <p className="py-10 text-center text-sm text-gray-400">No backtest results yet. Run a full backtest first.</p>
        )}

        {/* ── Config Tab ── */}
        {detailTab === 'config' && (
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              {CFG.map(s => (
                <div key={s.label}>
                  <div className="mb-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{s.label}</div>
                  <div className="space-y-2">{s.fields.map(fi => <CfgField key={fi.key} f={fi} value={config[fi.key]} onChange={(k, v) => setConfig(p => ({ ...p, [k]: v }))} />)}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button onClick={() => setConfig(DEFAULT_CONFIG)} className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors">Reset</button>
              <button onClick={saveConfig} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[11px] font-medium text-white hover:bg-gray-800 transition-colors"><Check size={10} /> Save</button>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
