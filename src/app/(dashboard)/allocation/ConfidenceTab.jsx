'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Shield, FlaskConical, ArrowRight, Loader2, Settings, Check, RefreshCw, ExternalLink } from 'lucide-react';
import {
  DERISK_DEFAULTS,
  computeDeriskOverlay,
  computePerStockRisk,
} from '@/lib/macroRegimeLogic';
import { schemeEffectiveWeights } from '@/lib/allocationEngine';

// Sort tickers by weight desc, CASH always last (mirrors the deep model page).
function sortTickers(weights) {
  const entries = Object.keys(weights || {});
  const stocks = entries.filter((t) => t !== 'CASH').sort((a, b) => (Number(weights[b]) || 0) - (Number(weights[a]) || 0));
  return entries.includes('CASH') ? [...stocks, 'CASH'] : stocks;
}

/**
 * Market Confidence step of the allocation workflow. Pre-fills the scheme's weights,
 * pulls the live regime score, applies the derisk overlay, and hands the regime-adjusted
 * weights forward to the Rebalancer on "Save & continue".
 *
 * Props:
 *   scheme            — the active allocation scheme (has baseWeights / adjustedWeights)
 *   allocations       — optimizer rows (for per-stock composite risk + vol fallback)
 *   riskFactorWeights — factor importance weights (for computePerStockRisk)
 *   maxWeight         — optimizer stock max weight (bar scaling)
 *   onSaveContinue    — ({ baseWeights, adjustedWeights, regimeScore }) => void
 */
export default function ConfidenceTab({ scheme, allocations, riskFactorWeights, maxWeight, onSaveContinue }) {
  const [weights, setWeights] = useState({});
  const [predict, setPredict] = useState(null);
  const [realizedVol, setRealizedVol] = useState(null);
  const [deriskCfg, setDeriskCfg] = useState(DERISK_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [showOverlayCfg, setShowOverlayCfg] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [sandboxM, setSandboxM] = useState(0.5);
  const [syncing, setSyncing] = useState(false);
  const hydratedFor = useRef(null);

  // Hydrate the editable grid from the scheme's weights (once per scheme).
  useEffect(() => {
    if (!scheme) return;
    if (hydratedFor.current === scheme.id) return;
    hydratedFor.current = scheme.id;
    setWeights({ ...schemeEffectiveWeights(scheme) });
  }, [scheme]);

  // Load regime signal + realized vol + saved overlay params on mount.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const tickers = Object.keys(schemeEffectiveWeights(scheme)).filter((t) => t !== 'CASH');
        const [predD, cfgD, volD] = await Promise.all([
          fetch('/api/macro-regime/predict').then((r) => r.json()).catch(() => null),
          fetch('/api/macro-regime/config').then((r) => r.json()).catch(() => null),
          tickers.length
            ? fetch(`/api/realized-vol?tickers=${tickers.join(',')}`).then((r) => r.json()).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (off) return;
        if (predD && !predD.error) setPredict(predD);
        if (cfgD?.config?.deriskOverlay) setDeriskCfg({ ...DERISK_DEFAULTS, ...cfgD.config.deriskOverlay });
        if (volD?.vols) setRealizedVol(volD.vols);
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme?.id]);

  const macroM = predict?.equityWeight ?? null;
  useEffect(() => { if (macroM != null) setSandboxM(macroM); }, [macroM]);

  const stockRisks = useMemo(
    () => computePerStockRisk(allocations || [], riskFactorWeights || []),
    [allocations, riskFactorWeights]
  );

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

  const overlay = useMemo(
    () => computeDeriskOverlay({ baseWeights: weights, volScores, compRisks: stockRisks, M: macroM, cfg: deriskCfg }),
    [weights, volScores, stockRisks, macroM, deriskCfg]
  );
  const sandboxOverlay = useMemo(
    () => computeDeriskOverlay({ baseWeights: weights, volScores, compRisks: stockRisks, M: sandboxM, cfg: deriskCfg }),
    [weights, volScores, stockRisks, sandboxM, deriskCfg]
  );

  const sortedTickers = useMemo(() => sortTickers(weights), [weights]);
  const total = useMemo(() => Object.values(weights).reduce((s, v) => s + (Number(v) || 0), 0), [weights]);

  const setWeight = (ticker, val) => {
    setWeights((prev) => ({ ...prev, [ticker]: val === '' ? '' : Number(val) }));
  };

  const syncFromPortfolio = useCallback(async () => {
    setSyncing(true);
    try {
      const portfolio = await fetch('/api/portfolio').then((r) => r.json());
      const holdings = portfolio.holdings || [];
      const cashVal = portfolio.cash || 0;
      if (holdings.length === 0) return;
      const tickers = holdings.map((h) => h.ticker).join(',');
      const quotesData = await fetch(`/api/quotes?tickers=${tickers}`).then((r) => r.json());
      const quotes = quotesData.quotes || quotesData;
      let aum = cashVal;
      const vals = {};
      for (const h of holdings) {
        const price = quotes[h.ticker]?.price || h.cost_basis || 0;
        vals[h.ticker] = h.shares * price;
        aum += vals[h.ticker];
      }
      if (aum <= 0) return;
      const next = {};
      for (const [t, v] of Object.entries(vals)) next[t] = Number(((v / aum) * 100).toFixed(2));
      next.CASH = Number(((cashVal / aum) * 100).toFixed(2));
      setWeights((prev) => {
        const merged = { ...prev };
        for (const t of Object.keys(merged)) if (next[t] !== undefined) merged[t] = next[t];
        return merged;
      });
    } catch (err) {
      console.error('Sync from portfolio failed:', err);
    } finally {
      setSyncing(false);
    }
  }, []);

  const saveOverlayConfig = async () => {
    setSavingCfg(true);
    try {
      const cfgD = await fetch('/api/macro-regime/config').then((r) => r.json()).catch(() => null);
      const merged = { ...(cfgD?.config || {}), deriskOverlay: deriskCfg };
      await fetch('/api/macro-regime/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: merged }),
      });
    } catch (err) {
      console.error('Save overlay config failed:', err);
    } finally {
      setSavingCfg(false);
    }
  };

  const handleSaveContinue = () => {
    const baseWeights = {};
    for (const [t, v] of Object.entries(weights)) baseWeights[t] = Number(v) || 0;
    const adjustedWeights = {};
    for (const [t, v] of Object.entries(overlay.weights)) adjustedWeights[t] = Number(v) || 0;
    onSaveContinue({ baseWeights, adjustedWeights, regimeScore: macroM });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={16} className="animate-spin text-emerald-500 mr-2" />
        <span className="text-sm text-gray-400">Loading regime signal…</span>
      </div>
    );
  }

  const eqPct = macroM != null ? Math.round(macroM * 100) : null;
  const regimeTone = macroM == null ? 'gray'
    : macroM >= 0.75 ? 'emerald'
    : macroM >= 0.5 ? 'amber'
    : 'red';
  const toneChip = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    gray: 'bg-gray-50 text-gray-500 ring-gray-200',
  }[regimeTone];

  return (
    <div className="animate-fade-in-up">
      {/* ── Regime score banner ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white border border-gray-100 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${toneChip}`}>
            <Shield size={12} />
            {predict?.regime || (macroM == null ? 'No regime signal' : 'Regime')}
          </span>
          {eqPct != null ? (
            <span className="text-sm text-gray-600">
              Equity <span className="font-bold text-gray-900 tabular-nums">{eqPct}%</span>
              {predict?.dataAsOf && <span className="text-gray-400"> · data thru {predict.dataAsOf}</span>}
            </span>
          ) : (
            <span className="text-sm text-gray-400">Run the model to derisk with the live regime.</span>
          )}
        </div>
        <Link href="/macro-regime" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-emerald-600 transition-colors">
          Deep model <ExternalLink size={12} />
        </Link>
      </div>

      {/* ── Editable weight grid ── */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Portfolio Weights</h2>
          <button onClick={syncFromPortfolio} disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 transition-colors"
            title="Sync weights from current portfolio holdings">
            <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} /> Sync
          </button>
        </div>

        {/* Total bar */}
        <div className="mb-4 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${total > 100.005 ? 'bg-red-400' : total >= 99.995 ? 'bg-emerald-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(total, 100)}%` }} />
          </div>
          <span className={`text-xs font-semibold font-mono tabular-nums ${total > 100.005 ? 'text-red-500' : total >= 99.995 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {total.toFixed(2)}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {sortedTickers.map((ticker) => {
            const risk = stockRisks[ticker];
            const w = Number(weights[ticker]) || 0;
            const maxW = Number(maxWeight) || 100;
            const barPct = Math.min((w / maxW) * 100, 100);
            return (
              <div key={ticker} className="group flex flex-col rounded-xl bg-gray-50/60 ring-1 ring-gray-100 px-3 py-2.5 hover:ring-gray-200 transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-900">{ticker}</span>
                  {risk != null && ticker !== 'CASH' && (
                    <span className="text-[11px] font-mono text-gray-400 opacity-60 group-hover:opacity-100 transition-opacity" title="Composite risk">
                      {(risk * 100).toFixed(0)}
                    </span>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-emerald-100 mb-2 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${barPct >= 100 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${barPct}%` }} />
                </div>
                <div className="relative">
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={weights[ticker] ?? ''}
                    onChange={(e) => setWeight(ticker, e.target.value)}
                    className="w-full rounded-lg bg-white ring-1 ring-gray-200 px-2.5 py-2 pr-6 text-[12px] font-mono text-gray-800 tabular-nums focus:ring-emerald-400 focus:outline-none transition-shadow"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Macro-adjusted weights ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Macro-Adjusted Weights</h2>
            {overlay.trimmed ? (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-semibold font-mono text-amber-700">
                D = {overlay.D.toFixed(2)}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                No derisking
              </span>
            )}
          </div>
          <button onClick={() => setShowOverlayCfg((v) => !v)}
            className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${showOverlayCfg ? 'bg-gray-900 text-white' : 'bg-gray-50 ring-1 ring-gray-200 text-gray-400 hover:text-gray-600'}`}>
            <Settings size={12} />
          </button>
        </div>

        {showOverlayCfg && (
          <div className="mb-4 rounded-2xl bg-white shadow-sm border border-gray-100 p-5">
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-4">Overlay Parameters</h3>
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { key: 'alpha', label: 'Alpha', step: 0.05, desc: 'Vol vs risk blend' },
                { key: 'derisk_start', label: 'Derisk Start', step: 0.05, desc: 'Trim threshold' },
                { key: 'max_trim', label: 'Max Trim', step: 0.05, desc: 'Max cut per stock' },
                { key: 'max_boost', label: 'Max Boost', step: 0.05, desc: 'Max boost per stock' },
                { key: 'cash_min', label: 'Cash Floor', step: 0.001, desc: 'Min cash allocation' },
                { key: 'cash_max', label: 'Cash Ceiling', step: 0.005, desc: 'Max cash allocation' },
              ].map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-[10px] font-semibold text-gray-500">{f.label}</label>
                  <input type="number" step={f.step} value={deriskCfg[f.key] ?? ''}
                    onChange={(e) => setDeriskCfg((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
                    className="w-full rounded-lg bg-gray-50 ring-1 ring-gray-200 px-2.5 py-1.5 text-[11px] font-mono text-gray-800 focus:ring-emerald-400 focus:outline-none" />
                  <p className="mt-1 text-[9px] text-gray-400">{f.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
              <button onClick={saveOverlayConfig} disabled={savingCfg}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-[11px] font-medium text-white hover:bg-gray-800 disabled:opacity-50 transition-colors">
                <Check size={10} /> {savingCfg ? 'Saving…' : 'Save Config'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {sortTickers(overlay.weights).map((ticker) => {
            const baseW = Number(weights[ticker]) || 0;
            const adjW = Number(overlay.weights[ticker] ?? baseW) || 0;
            const delta = adjW - baseW;
            return (
              <div key={ticker}
                className={`rounded-xl px-3 py-2.5 ring-1 transition-colors duration-300 ${
                  Math.abs(delta) < 0.01 ? 'bg-white ring-gray-100' : delta < 0 ? 'bg-red-50/40 ring-red-200/60' : 'bg-emerald-50/40 ring-emerald-200/60'
                }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-gray-900">{ticker}</span>
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

      {/* ── Stress test ── */}
      <div className="mb-8 rounded-2xl border border-gray-200 bg-gradient-to-b from-gray-50/80 to-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 ring-1 ring-gray-200">
            <FlaskConical size={12} className="text-gray-700" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Stress Test</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: 'Regime', value: sandboxM.toFixed(2) },
              { label: 'Derisk', value: sandboxOverlay.D.toFixed(2) },
              { label: 'Cash', value: `${(sandboxOverlay.cash * 100).toFixed(1)}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-white px-3 py-1.5 ring-1 ring-gray-200">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</span>
                <span className="ml-1.5 text-xs font-bold font-mono text-gray-900">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
        <input type="range" min="0" max="1" step="0.01" value={sandboxM}
          onChange={(e) => setSandboxM(Number(e.target.value))}
          className="h-2 w-full cursor-pointer rounded-full bg-gray-200 accent-emerald-600" />
        <div className="mt-2 flex justify-between text-[10px] font-medium text-gray-400">
          <span>0 · Risk Off</span>
          <span>start {deriskCfg.derisk_start}</span>
          <span>Risk On · 1</span>
        </div>
      </div>

      {/* ── Save & continue ── */}
      <div className="flex items-center justify-end">
        <button onClick={handleSaveContinue}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm">
          Save &amp; continue <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
