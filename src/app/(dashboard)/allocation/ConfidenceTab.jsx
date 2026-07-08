'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  Shield, ArrowRight, Loader2, Settings, Check, RefreshCw,
  Play, Zap, Terminal, ChevronDown, SlidersHorizontal,
} from 'lucide-react';
import Toast from '@/components/Toast';
import {
  CFG,
  DEFAULT_CONFIG,
  DERISK_DEFAULTS,
  MACRO_CHART_COLORS as C,
  METRICS_KEYS,
  computeDeriskOverlay,
  computePerStockRisk,
  drawdowns,
  fd,
  fn,
  fp,
  rollingSharpe,
} from '@/lib/macroRegimeLogic';
import { RISK_FACTORS, schemeEffectiveWeights } from '@/lib/allocationEngine';
import { cOpts, ds, cOpts01, CfgField, MdRender } from '@/lib/macroRegimeUi';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Filler, Tooltip, Legend);

// Sort tickers by weight desc, CASH always last.
function sortTickers(weights) {
  const entries = Object.keys(weights || {});
  const stocks = entries.filter((t) => t !== 'CASH').sort((a, b) => (Number(weights[b]) || 0) - (Number(weights[a]) || 0));
  return entries.includes('CASH') ? [...stocks, 'CASH'] : stocks;
}

/**
 * Macro Risk step of the allocation workflow. Carries the full macro-regime model
 * surface — live regime signal, the derisking overlay, the backtest/data/charts/config
 * tools that drive the Python pipeline — and pre-fills the scheme's weights.
 *
 * The regime slider is the committed control: it starts at the live regime score but
 * is adjustable, and whatever it produces in "Adjusted weights by ticker" is exactly
 * what gets handed forward to the Rebalancer on "Save & continue".
 *
 * Props:
 *   scheme            — active allocation scheme (baseWeights / adjustedWeights)
 *   allocations       — optimizer rows (per-stock composite risk + vol fallback)
 *   riskFactorWeights — factor importance weights (computePerStockRisk)
 *   maxWeight         — optimizer stock max weight (bar scaling)
 *   onSaveContinue    — ({ baseWeights, adjustedWeights, regimeScore }) => void
 */
export default function ConfidenceTab({ scheme, allocations, riskFactorWeights, maxWeight, onSaveContinue }) {
  /* ── Scheme weights (editable base) ───────────────────────────── */
  const [weights, setWeights] = useState({});
  const hydratedFor = useRef(null);

  /* ── Regime signal + overlay ─────────────────────────────────── */
  const [predict, setPredict] = useState(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [realizedVol, setRealizedVol] = useState(null);
  const [deriskCfg, setDeriskCfg] = useState(() => ({ ...DERISK_DEFAULTS, max_weight: Number(maxWeight) || 15 }));
  const [showOverlayCfg, setShowOverlayCfg] = useState(false);
  const [overlaySaveState, setOverlaySaveState] = useState('idle'); // idle | saving | saved

  /* ── The committed regime knob (starts live, adjustable) ──────── */
  const [sliderM, setSliderM] = useState(0.5);
  const sliderInit = useRef(false);

  /* ── Model tools (Python pipeline) ───────────────────────────── */
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [results, setResults] = useState(null);
  const [runStatus, setRunStatus] = useState({ running: false });
  const [runLog, setRunLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [detailTab, setDetailTab] = useState('run');
  const [showTools, setShowTools] = useState(false);
  const [runHistory, setRunHistory] = useState([]);
  const [historyLog, setHistoryLog] = useState(null);
  const [toast, setToast] = useState(null);
  const logRef = useRef(null);
  const pollRef = useRef(null);

  const [loading, setLoading] = useState(true);

  /* ── Base weights = the saved scheme's base allocation (the optimizer targets),
     not the previously-adjusted set, so the "Base %" column is always the scheme. ── */
  useEffect(() => {
    if (!scheme) return;
    if (hydratedFor.current === scheme.id) return;
    hydratedFor.current = scheme.id;
    setWeights({ ...(scheme.baseWeights || schemeEffectiveWeights(scheme)) });
  }, [scheme]);

  const loadResults = useCallback(async () => {
    try { const d = await fetch('/api/macro-regime/results').then(r => r.json()); if (d.backtest) setResults(d); } catch {}
  }, []);
  const loadPredict = useCallback(async (fresh = false) => {
    setPredictLoading(true);
    try {
      const r = fresh ? await fetch('/api/macro-regime/predict', { method: 'POST' }) : await fetch('/api/macro-regime/predict');
      const d = await r.json(); if (!d.error) setPredict(d);
    } catch {} setPredictLoading(false);
  }, []);

  /* ── Mount load: signal, config, results, run status, realized vol ── */
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const tickers = Object.keys(schemeEffectiveWeights(scheme)).filter((t) => t !== 'CASH');
        const [cfgD, resD, predD, runD, volD] = await Promise.all([
          fetch('/api/macro-regime/config').then(r => r.json()).catch(() => null),
          fetch('/api/macro-regime/results').then(r => r.json()).catch(() => null),
          fetch('/api/macro-regime/predict').then(r => r.json()).catch(() => null),
          fetch('/api/macro-regime/run').then(r => r.json()).catch(() => null),
          tickers.length ? fetch(`/api/realized-vol?tickers=${tickers.join(',')}`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
        ]);
        if (off) return;
        if (cfgD?.config) {
          setConfig({ ...DEFAULT_CONFIG, ...cfgD.config });
          setDeriskCfg({ ...DERISK_DEFAULTS, max_weight: Number(maxWeight) || 15, ...(cfgD.config.deriskOverlay || {}) });
        }
        if (resD?.backtest) setResults(resD);
        if (predD && !predD.error) setPredict(predD);
        if (runD?.history) setRunHistory(runD.history);
        if (runD?.running) { setRunStatus(runD); setRunLog(runD.log || ''); setShowLog(true); }
        if (volD?.vols) setRealizedVol(volD.vols);
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme?.id]);

  /* ── Poll a running job ──────────────────────────────────────── */
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

  const macroM = predict?.equityWeight ?? null;

  // Seed the slider from the live regime the first time it's known. After that the
  // user owns it — moving it changes the committed adjusted weights.
  useEffect(() => {
    if (macroM != null && !sliderInit.current) { sliderInit.current = true; setSliderM(macroM); }
  }, [macroM]);

  const stockRisks = useMemo(
    () => computePerStockRisk(allocations || [], riskFactorWeights || []),
    [allocations, riskFactorWeights]
  );

  // Per-stock factor breakdown that feeds the composite risk score, so a row can be
  // expanded to show exactly which risk factors drove its total.
  const riskBreakdown = useMemo(() => {
    const wts = RISK_FACTORS.map((_, i) => Number((riskFactorWeights || [])[i]) || 0);
    const wSum = wts.reduce((s, w) => s + w, 0) || 1;
    const map = {};
    for (const row of allocations || []) {
      const t = (row.ticker || '').trim().toUpperCase();
      if (!t || t === 'CASH') continue;
      const exps = (row.factorExposures || []).map((v) => Number(v) || 0);
      map[t] = RISK_FACTORS.map((name, i) => ({
        name,
        exposure: exps[i] ?? 0,
        weight: wts[i],
        contribution: ((exps[i] ?? 0) * wts[i]) / wSum,
      }));
    }
    return map;
  }, [allocations, riskFactorWeights]);

  // Realized annualized vol per stock, fall back to the optimizer's vol factor exposure.
  const volScores = useMemo(() => {
    const m = {};
    for (const row of allocations || []) {
      const t = (row.ticker || '').trim().toUpperCase();
      if (!t || t === 'CASH') continue;
      m[t] = realizedVol?.[t] != null ? Number(realizedVol[t]) : Number((row.factorExposures || [])[0]) || 0;
    }
    return m;
  }, [allocations, realizedVol]);

  // THE committed overlay — driven by the slider, so the adjusted weights it produces
  // are exactly what's saved forward to the Rebalancer.
  const overlay = useMemo(
    () => computeDeriskOverlay({ baseWeights: weights, volScores, compRisks: stockRisks, M: sliderM, cfg: deriskCfg }),
    [weights, volScores, stockRisks, sliderM, deriskCfg]
  );

  const sortedTickers = useMemo(() => sortTickers(weights), [weights]);

  /* ── Tools handlers ──────────────────────────────────────────── */
  const handleRun = async (cmd) => {
    try {
      const d = await fetch('/api/macro-regime/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }).then(r => r.json());
      if (d.error) { setToast({ message: d.error, type: 'error' }); return; }
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

  const savedTimer = useRef(null);
  // Overlay save gives inline button feedback (spinner → "Saved") instead of a toast.
  const saveOverlay = async () => {
    if (overlaySaveState === 'saving') return;
    setOverlaySaveState('saving');
    try {
      const merged = { ...config, deriskOverlay: deriskCfg };
      const d = await fetch('/api/macro-regime/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: merged }) }).then(r => r.json());
      if (d.error) { setOverlaySaveState('idle'); setToast({ message: d.error, type: 'error' }); return; }
      setOverlaySaveState('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setOverlaySaveState('idle'), 2000);
    } catch (e) {
      setOverlaySaveState('idle');
      setToast({ message: e.message, type: 'error' });
    }
  };
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const viewLog = async (id) => {
    if (historyLog?.id === id) { setHistoryLog(null); return; }
    try { const d = await fetch(`/api/macro-regime/run?history=${id}`).then(r => r.json()); if (d.run) setHistoryLog(d.run); } catch {}
  };

  const handleSaveContinue = () => {
    const baseWeights = {};
    for (const [t, v] of Object.entries(weights)) baseWeights[t] = Number(v) || 0;
    const adjustedWeights = {};
    for (const [t, v] of Object.entries(overlay.weights)) adjustedWeights[t] = Number(v) || 0;
    onSaveContinue({ baseWeights, adjustedWeights, regimeScore: sliderM });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={16} className="animate-spin text-emerald-500 mr-2" />
        <span className="text-sm text-gray-400">Loading regime signal…</span>
      </div>
    );
  }

  /* ── Signal display ──────────────────────────────────────────── */
  const sig = predict;
  const eq = Math.round((sig?.equityWeight || 0) * 100);
  const regime = sig?.regime === 'RISK ON' ? 'Risk On' : sig?.regime === 'RISK OFF' ? 'Risk Off' : sig ? 'Cautious' : null;
  const regimeColor = sig?.regime === 'RISK ON' ? '#10b981' : sig?.regime === 'RISK OFF' ? '#ef4444' : '#f59e0b';
  const regimeBg = sig?.regime === 'RISK ON' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : sig?.regime === 'RISK OFF' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200';

  /* ── Backtest series (for tools + allocation-over-time) ──────── */
  const btMap = new Map();
  for (const row of (results?.backtest || [])) { const k = row.date; const ex = btMap.get(k); if (!ex || (row.rebalance_date || '') > (ex.rebalance_date || '')) btMap.set(k, row); }
  const bt = [...btMap.values()];
  const metrics = results?.metrics || [];
  const mm = metrics.find(m => m.label === 'Model Portfolio');
  const em = metrics.find(m => m.label && m.label.includes('Equity'));
  const step = bt.length > 400 ? 2 : 1;
  const cr = bt.filter((_, i) => i % step === 0 || i === bt.length - 1);
  const lbl = cr.map(r => fd(r.date));

  const allocRows = (() => {
    const rows = cr.map(r => ({ date: fd(r.date), weight_equity: r.weight_equity, live: false }));
    if (predict && predict.equityWeight != null && predict.allocationFor) {
      const livePoint = { date: predict.allocationFor, weight_equity: predict.equityWeight, live: true };
      if (rows.length && rows[rows.length - 1].date === predict.allocationFor) {
        rows[rows.length - 1] = livePoint;
      } else if (!rows.length || predict.allocationFor > rows[rows.length - 1].date) {
        rows.push(livePoint);
      }
    }
    return rows;
  })();
  const allocLbl = allocRows.map(r => r.date);
  const allocPointRadius = allocRows.map(r => (r.live ? 4 : 0));

  return (
    <div className="animate-fade-in-up">
      {/* ━━ TOP ROW: Regime signal (left) | Allocation Over Time (right) ━━ */}
      <div className="mb-8 grid gap-5 lg:grid-cols-[5fr_7fr]">
        {/* ── LEFT: Regime Signal ── */}
          {sig ? (
            <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 p-6 relative overflow-hidden h-full">
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: regimeColor }} />
              <div className="text-[10px] text-gray-400 mb-5 flex items-center gap-1.5 flex-wrap">
                <span>{sig.allocationFor || '--'} · data thru {sig.dataAsOf || '--'}</span>
                {sig.source === 'backtest' && (
                  <span title="The last full run did not produce a live prediction (the latest month's data was incomplete), so this is derived from the most recent backtest row. Re-run once the data is available."
                    className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-200">
                    backtest fallback
                  </span>
                )}
              </div>
              <div className="relative mx-auto w-44 h-44 mb-5">
                <Doughnut
                  data={{
                    labels: ['Equity', 'T-Bills'],
                    datasets: [{ data: [eq, 100 - eq], backgroundColor: [regimeColor, '#f0f0f0'], borderWidth: 0, cutout: '78%' }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: true,
                    plugins: {
                      legend: { display: false },
                      tooltip: { backgroundColor: '#fff', titleColor: '#111', bodyColor: '#6b7280', borderColor: '#e5e7eb', borderWidth: 1, padding: 10, callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}%` } },
                    },
                  }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold tabular-nums text-gray-900 leading-none">{eq}%</span>
                  <span className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${regimeBg}`}>{regime}</span>
                </div>
              </div>
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
                {predictLoading ? <Loader2 size={14} className="inline animate-spin" /> : 'No signal yet. Run a backtest in Tools below.'}
              </p>
            </div>
          )}

        {/* ── RIGHT: Allocation Over Time ── */}
        <div className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
          <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Allocation Over Time</h3>
          {allocRows.length > 0 ? (
            <div className="min-h-[18rem] flex-1">
              <Line
                data={{ labels: allocLbl, datasets: [
                  { label: 'Equity', data: allocRows.map(r => r.weight_equity), borderColor: regimeColor || '#111', backgroundColor: `${regimeColor || '#111'}10`, fill: true, stepped: 'before', borderWidth: 1.5, pointRadius: allocPointRadius, pointHoverRadius: 3, pointBackgroundColor: regimeColor || '#111', pointBorderColor: '#fff', pointBorderWidth: 1 },
                  { label: 'T-Bills', data: allocRows.map(r => r.weight_equity != null ? 1 : null), borderColor: 'transparent', backgroundColor: 'rgba(0,0,0,0.02)', fill: true, stepped: 'before', borderWidth: 0, pointRadius: 0, pointHoverRadius: 0 },
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
          ) : (
            <div className="flex flex-1 items-center justify-center py-16 text-center text-sm text-gray-400">
              No allocation history yet — run a backtest in the model engine below.
            </div>
          )}
        </div>
      </div>

      {/* ━━ MACRO ADJUSTMENT: slider drives the committed adjusted weights ━━ */}
      <div className="mb-8 rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 overflow-hidden">
        {/* Header */}
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-bold text-gray-900">Final adjusted weights</h2>
        </div>

        {/* Regime slider */}
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Regime score</span>
            {macroM != null && (
              <button onClick={() => setSliderM(macroM)}
                className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title="Reset to the live regime score">
                Live {macroM.toFixed(2)}
              </button>
            )}
            <button onClick={() => setShowOverlayCfg(v => !v)}
              className={`ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${showOverlayCfg ? 'bg-gray-900 text-white' : 'bg-gray-50 ring-1 ring-gray-200 text-gray-400 hover:text-gray-600'}`}
              title="Overlay parameters">
              <Settings size={12} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <input type="range" min="0" max="1" step="0.01" value={sliderM}
              onChange={e => setSliderM(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer rounded-full bg-gray-200 accent-emerald-600" />
            <input type="number" min="0" max="1" step="0.01" value={sliderM}
              onChange={e => setSliderM(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
              className="w-16 rounded-lg bg-gray-50 px-2.5 py-1.5 text-right text-sm font-mono text-gray-900 ring-1 ring-gray-200 focus:outline-none focus:ring-emerald-400" />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] font-medium text-gray-400">
            <span>Risk Off</span>
            <span>trim starts at {deriskCfg.derisk_start}</span>
            <span>Risk On</span>
          </div>

          {/* Overlay parameters (advanced) */}
          {showOverlayCfg && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="mb-3 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { key: 'max_weight', label: 'Max Weight', step: 1, desc: 'Hard cap per stock (%)' },
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
                      className="w-full rounded-lg bg-gray-50 ring-1 ring-gray-200 px-2.5 py-1.5 text-[11px] font-mono text-gray-800 focus:ring-emerald-400 focus:outline-none" />
                    <p className="mt-1 text-[10px] text-gray-400">{f.desc}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2.5">
                {overlaySaveState === 'saved' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 animate-fade-in-up">
                    <Check size={12} /> Saved
                  </span>
                )}
                <button onClick={saveOverlay} disabled={overlaySaveState === 'saving'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[11px] font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-70">
                  {overlaySaveState === 'saving'
                    ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                    : <><Check size={10} /> Save overlay</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Adjusted weights — with the metrics that drive each name's shift */}
        <div className="px-2 py-2 sm:px-4 sm:py-3">
          <div className="flex items-end gap-10 px-4 pb-3 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <span className="min-w-[52px] flex-1">Ticker</span>
            <div className="hidden items-end gap-9 sm:flex" title="Risk factor exposures that make up the composite risk score (0–100), with each factor's weight beneath">
              {['Vol', 'Reg', 'Disr', 'Val', 'Qual'].map(h => (
                <span key={h} className="w-12 text-center">{h}</span>
              ))}
            </div>
            <span className="w-64 text-center">Base&nbsp;→&nbsp;Adjusted</span>
            <span className="w-12 text-right">Δ</span>
          </div>
          {sortedTickers.map(ticker => {
            const baseW = Number(weights[ticker]) || 0;
            const adjW = Number(overlay.weights[ticker] ?? baseW) || 0;
            const delta = adjW - baseW;
            const isCash = ticker === 'CASH';
            // Bars scale to the configured hard cap so a name at the cap reads as full.
            const scaleMax = Number(deriskCfg.max_weight) || Number(maxWeight) || Math.max(baseW, adjW, 1);
            const adjPct = Math.min((adjW / scaleMax) * 100, 100);
            const factors = riskBreakdown[ticker];
            return (
              <div key={ticker} className="flex items-center gap-10 rounded-lg px-4 py-4 transition-colors hover:bg-gray-50/70">
                <span className={`min-w-[52px] flex-1 text-[15px] font-semibold ${isCash ? 'text-gray-400' : 'text-gray-900'}`}>{ticker}</span>

                {/* Risk factor exposures inline — score on top, factor weight beneath */}
                <div className="hidden items-start gap-9 sm:flex">
                  {RISK_FACTORS.map((name, i) => {
                    const f = factors?.[i];
                    if (isCash || !f) {
                      return <span key={name} className="w-12 pt-0.5 text-center font-mono text-[11px] text-gray-300">—</span>;
                    }
                    const ex = Math.max(0, Math.min(f.exposure, 1));
                    const col = ex > 0.66 ? 'text-red-500' : ex > 0.33 ? 'text-amber-500' : 'text-emerald-600';
                    return (
                      <div key={name} className="flex w-12 flex-col items-center" title={`${name}: ${(f.exposure * 100).toFixed(0)} × weight ${f.weight.toFixed(2)}`}>
                        <span className={`font-mono text-[15px] font-semibold tabular-nums ${col}`}>{(f.exposure * 100).toFixed(0)}</span>
                        <span className="mt-0.5 font-mono text-[10px] text-gray-500 tabular-nums">×{f.weight.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex w-64 items-center justify-center gap-3">
                  <span className="font-mono text-sm text-gray-400 tabular-nums">{baseW.toFixed(1)}</span>
                  <div className="h-2.5 w-32 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full ${isCash ? 'bg-gray-300' : delta < -0.01 ? 'bg-red-400' : delta > 0.01 ? 'bg-emerald-500' : 'bg-gray-300'}`} style={{ width: `${adjPct}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-base font-bold text-gray-900 tabular-nums">{adjW.toFixed(1)}</span>
                </div>
                <span className={`w-12 text-right font-mono text-[11px] font-medium tabular-nums ${Math.abs(delta) < 0.01 ? 'text-gray-300' : delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Save & continue — anchored to the bottom of the final weights */}
        <div className="flex justify-end border-t border-gray-100 px-5 py-4">
          <button onClick={handleSaveContinue}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700">
            Save &amp; continue <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* ━━ MODEL ENGINE (advanced, collapsed by default) ━━━━━━━━━━━ */}
      <div className="border-t border-gray-200/60 pt-6 mb-8">
        <button onClick={() => setShowTools(v => !v)}
          className="flex w-full items-center gap-2.5 text-left group">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-100 shadow-sm">
            <SlidersHorizontal size={15} className="text-gray-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Model engine</h2>
            <p className="mt-0.5 text-xs text-gray-500">Run backtests, inspect data &amp; charts, and tune the model.</p>
          </div>
          {runStatus.running && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 ml-1">
              <Loader2 size={10} className="animate-spin" /> {runStatus.command}
            </span>
          )}
          <ChevronDown size={16} className={`ml-auto text-gray-400 transition-transform ${showTools ? 'rotate-180' : ''}`} />
        </button>

        {showTools && (<div className="mt-5">
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
                      primary ? 'bg-gray-900 text-white ring-1 ring-gray-900 hover:bg-black hover:shadow-md' : 'bg-white ring-1 ring-gray-200 text-gray-900 hover:ring-gray-400 hover:shadow-sm'
                    }`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`h-6 w-6 flex items-center justify-center rounded-md transition-all ${
                        primary ? 'bg-white/15 text-white' : 'bg-gray-50 ring-1 ring-gray-200 group-hover:bg-gray-900 group-hover:text-white group-hover:ring-gray-900'
                      }`}>
                        {active ? <Loader2 size={11} className="animate-spin" /> : <I size={11} />}
                      </div>
                      <span className="text-sm font-semibold">{label}</span>
                    </div>
                    <span className={`text-[10px] leading-relaxed ${primary ? 'text-gray-300' : 'text-gray-400'}`}>{desc}</span>
                  </button>
                );
              })}
            </div>

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
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{s.label}</div>
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

            {mm && em && (
              <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl ring-1 ring-gray-100 bg-gray-100">
                {[
                  { l: 'CAGR', v: fp(mm.cagr), c: fp(em.cagr), g: mm.cagr > em.cagr },
                  { l: 'Sharpe', v: fn(mm.sharpe), c: fn(em.sharpe), g: mm.sharpe > em.sharpe },
                  { l: 'Max DD', v: fp(mm.max_drawdown), c: fp(em.max_drawdown), g: mm.max_drawdown > em.max_drawdown },
                  { l: 'Sortino', v: fn(mm.sortino), c: fn(em.sortino), g: mm.sortino > em.sortino },
                ].map(({ l, v, c, g }) => (
                  <div key={l} className="bg-white p-4">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{l}</div>
                    <div className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{v}</div>
                    <div className={`text-[10px] font-medium mt-0.5 ${g ? 'text-emerald-600' : 'text-red-500'}`}>vs {c}</div>
                  </div>
                ))}
              </div>
            )}

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
            {(() => {
              const asOf = String(config.end_date || '').slice(0, 7);
              const lag = Number(config.macro_lag_months) || 0;
              let allocFor = '--';
              if (/^\d{4}-\d{2}$/.test(asOf)) {
                const [y, m] = asOf.split('-').map(Number);
                const d = new Date(Date.UTC(y, m - 1 + lag, 1));
                allocFor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
              }
              return (
                <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Data as of</div>
                    <div className="text-sm font-semibold text-gray-800">{asOf || '--'}</div>
                  </div>
                  <div className="text-gray-300">→</div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400">Allocation for</div>
                    <div className="text-sm font-semibold text-gray-800">{allocFor}</div>
                  </div>
                  <p className="ml-auto max-w-sm text-[10px] leading-tight text-gray-400">
                    Set “Data through” to your latest complete data month. The model allocates for the following month. If a series for that month isn’t published yet, it uses the latest month that is.
                  </p>
                </div>
              );
            })()}
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
        </div>)}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
