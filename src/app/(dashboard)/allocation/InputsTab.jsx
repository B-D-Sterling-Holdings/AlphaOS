'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, History, Check, Save, ChevronDown, Trash2, Clock, Sparkles, SlidersHorizontal } from 'lucide-react';
import {
  RISK_FACTORS,
  RISK_DISPLAY_SCALE,
  buildRiskSnapshot,
  fromDisplayScore,
  getFactorReasons,
  getFactorScores,
  riskInputsDiffer,
  toDisplayScore,
} from '@/lib/allocationEngine';

// Score entry on the 0–10 scale. Keeps a local text buffer so typing decimals
// ("4.5") isn't clobbered by the round-trip through the stored 0–1 value; commits
// the converted 0–1 value on every keystroke and re-normalizes the display on blur
// (and when the stored value changes externally, e.g. the vol auto-compute).
function ScoreInput({ stored, onCommit, className = '', ...rest }) {
  const [text, setText] = useState(() => toDisplayScore(stored));
  const [lastStored, setLastStored] = useState(stored);
  const [isFocused, setIsFocused] = useState(false);
  // Adjust the local buffer when the stored value changes from the outside (e.g. the
  // vol auto-compute) — but never while the user is mid-edit. Done during render (the
  // React-recommended way to derive state from a prop), not in an effect.
  if (stored !== lastStored) {
    setLastStored(stored);
    if (!isFocused) setText(toDisplayScore(stored));
  }
  return (
    <input
      type="number" min="0" max={RISK_DISPLAY_SCALE} step="0.5"
      value={text}
      onFocus={() => setIsFocused(true)}
      onBlur={() => { setIsFocused(false); setText(toDisplayScore(stored)); }}
      onChange={(e) => { setText(e.target.value); onCommit(fromDisplayScore(e.target.value)); }}
      className={className}
      {...rest}
    />
  );
}

const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const fmtRelative = (iso) => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDateTime(iso);
};

// A single past revision, expandable to its per-factor scores + reasoning.
function HistoryEntry({ snapshot, onDelete }) {
  const [open, setOpen] = useState(false);
  const factors = Array.isArray(snapshot.factors) && snapshot.factors.length ? snapshot.factors : RISK_FACTORS;
  const scores = snapshot.scores || [];
  const reasons = snapshot.reasons || [];

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        <Clock className="w-3.5 h-3.5 text-gray-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-gray-700">{fmtDateTime(snapshot.created_at)}</span>
            {snapshot.author && <span className="text-[11px] text-gray-400">· {snapshot.author}</span>}
          </div>
          {snapshot.note ? (
            <p className="text-[12px] text-gray-500 truncate">{snapshot.note}</p>
          ) : (
            <p className="text-[12px] text-gray-300 italic">No note</p>
          )}
        </div>
        {/* Compact score chips */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {factors.map((f, i) => (
            <span key={f + i} className="text-[10px] font-mono text-gray-400 tabular-nums">
              {scores[i] == null ? '—' : (Number(scores[i]) * RISK_DISPLAY_SCALE).toFixed(1)}
            </span>
          )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`s${i}`} className="text-gray-200">·</span>, el], [])}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-gray-50 space-y-2">
          {factors.map((f, i) => (
            <div key={f + i} className="flex items-start gap-3">
              <span className="text-[11px] font-medium text-gray-400 w-24 shrink-0 pt-0.5">{f}</span>
              <span className="text-[13px] font-mono tabular-nums text-gray-700 w-10 shrink-0">
                {scores[i] == null ? '—' : (Number(scores[i]) * RISK_DISPLAY_SCALE).toFixed(1)}
              </span>
              <p className="text-[12px] text-gray-500 flex-1 whitespace-pre-wrap">
                {(reasons[i] || '').trim() || <span className="text-gray-300 italic">No reasoning recorded</span>}
              </p>
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => onDelete(snapshot.id)}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete revision
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InputsTab({
  allocations,
  updateAllocationExposure,
  updateAllocationReason,
  riskFactorWeights,
  updateRiskFactorWeight,
  volScoresLoading = {},
}) {
  // Editable stocks = non-CASH rows with a ticker. CASH has no discretionary risk inputs.
  const stocks = useMemo(
    () => allocations.filter((r) => {
      const t = (r.ticker || '').trim().toUpperCase();
      return t && t !== 'CASH';
    }),
    [allocations]
  );

  const [selectedId, setSelectedId] = useState(null);
  const [snapshotsByTicker, setSnapshotsByTicker] = useState({}); // { TICKER: [snap, ...] }
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [noteDrafts, setNoteDrafts] = useState({}); // { rowId: 'draft note' }
  const [savingId, setSavingId] = useState(null);
  const [justSavedId, setJustSavedId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const savedTimer = useRef(null);

  // Keep a valid selection as rows come and go.
  useEffect(() => {
    if (stocks.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !stocks.some((s) => s.id === selectedId)) {
      setSelectedId(stocks[0].id);
    }
  }, [stocks, selectedId]);

  // Load the whole tenant's revision history once, grouped by ticker.
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/allocation/risk-snapshots');
      const { snapshots } = await res.json();
      const grouped = {};
      (snapshots || []).forEach((s) => {
        const t = (s.ticker || '').toUpperCase();
        (grouped[t] ||= []).push(s);
      });
      // API returns newest-first already; keep that order per ticker.
      setSnapshotsByTicker(grouped);
    } catch {
      setSnapshotsByTicker({});
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const selected = stocks.find((s) => s.id === selectedId) || null;
  const selectedTicker = (selected?.ticker || '').trim().toUpperCase();
  const selectedHistory = snapshotsByTicker[selectedTicker] || [];
  const latestSnapshot = selectedHistory[0] || null;
  const dirty = selected ? riskInputsDiffer(selected, latestSnapshot) : false;

  const saveRevision = async () => {
    if (!selected || !selectedTicker || savingId) return;
    const note = noteDrafts[selected.id] || '';
    const payload = buildRiskSnapshot(selected, riskFactorWeights, note);
    setSavingId(selected.id);
    try {
      const res = await fetch('/api/allocation/risk-snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const { snapshot, error } = await res.json();
      if (error || !snapshot) throw new Error(error || 'save failed');
      setSnapshotsByTicker((prev) => ({
        ...prev,
        [selectedTicker]: [snapshot, ...(prev[selectedTicker] || [])],
      }));
      setNoteDrafts((prev) => ({ ...prev, [selected.id]: '' }));
      setJustSavedId(selected.id);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSavedId(null), 2200);
    } catch (err) {
      console.error('Failed to save risk revision:', err);
    } finally {
      setSavingId(null);
    }
  };

  const deleteRevision = async (id) => {
    // Optimistic remove.
    setSnapshotsByTicker((prev) => {
      const next = {};
      Object.entries(prev).forEach(([t, list]) => { next[t] = list.filter((s) => s.id !== id); });
      return next;
    });
    try {
      await fetch(`/api/allocation/risk-snapshots?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete risk revision:', err);
      loadHistory(); // resync on failure
    }
  };

  const totalWeight = riskFactorWeights.reduce((s, w) => s + (Number(w) || 0), 0);

  return (
    <div className="animate-fade-in-up">
      {stocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-600">No stocks to score yet.</p>
          <p className="mt-1 text-xs text-gray-400">Add tickers in the Optimizer tab and they&apos;ll appear here for risk scoring.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
          {/* Stock rail */}
          <div className="space-y-1.5">
            {stocks.map((row) => {
              const t = (row.ticker || '').trim().toUpperCase();
              const rowDirty = riskInputsDiffer(row, (snapshotsByTicker[t] || [])[0] || null);
              const hist = snapshotsByTicker[t] || [];
              const active = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={`w-full text-left rounded-xl px-3.5 py-2.5 border transition-all ${
                    active
                      ? 'border-emerald-300 bg-emerald-50/50 shadow-sm'
                      : 'border-gray-100 bg-white hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-gray-900">{t}</span>
                    {rowDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
                    <span className="ml-auto text-[11px] text-gray-400">
                      {hist.length ? `${hist.length} rev${hist.length > 1 ? 's' : ''}` : 'new'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[10px] font-mono tabular-nums text-gray-400">
                    {getFactorScores(row).map((v, i) => (
                      <span key={i} className={v === '' ? 'text-gray-200' : ''}>
                        {v === '' ? '—' : (Number(v) * RISK_DISPLAY_SCALE).toFixed(1)}
                      </span>
                    )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`d${i}`} className="text-gray-200">·</span>, el], [])}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail editor */}
          {selected && (
            <div className="min-w-0">
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">{selectedTicker}</h2>
                {dirty ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    Unsaved changes
                  </span>
                ) : latestSnapshot ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400">
                    <Check className="w-3.5 h-3.5" /> Saved {fmtRelative(latestSnapshot.created_at)}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-gray-400">No revisions yet</span>
                )}
                <button
                  type="button"
                  onClick={() => setWeightsOpen((o) => !o)}
                  aria-pressed={weightsOpen}
                  className={`ml-auto inline-flex items-center justify-center w-9 h-9 rounded-xl border transition-colors ${
                    weightsOpen ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700'
                  }`}
                  title="Factor weights — how much each factor counts toward composite risk (applies to every holding)"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={saveRevision}
                  disabled={savingId === selected.id || !dirty}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700"
                  title={dirty ? 'Commit these scores and reasoning to the history log' : 'No changes since the last saved revision'}
                >
                  {savingId === selected.id ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  ) : justSavedId === selected.id ? (
                    <><Check className="w-4 h-4" /> Saved</>
                  ) : (
                    <><Save className="w-4 h-4" /> Save revision</>
                  )}
                </button>
              </div>

              {weightsOpen && (
                <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 mb-4 animate-fade-in-up">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Factor weights</span>
                    {RISK_FACTORS.map((factor, index) => (
                      <div key={factor} className="flex items-center gap-1.5">
                        <label className="text-[12px] text-gray-500">{factor}</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={riskFactorWeights[index]}
                          onChange={(e) => updateRiskFactorWeight(index, e.target.value)}
                          className="w-14 text-[13px] text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all"
                        />
                      </div>
                    ))}
                    <span className="ml-auto text-[11px] text-gray-400 tabular-nums">Σ {totalWeight.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Per-factor score + reasoning — one card, quiet dividers between factors */}
              <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50">
                {RISK_FACTORS.map((factor, index) => {
                  const isVol = index === 0;
                  const isVolLoading = isVol && volScoresLoading[selectedTicker];
                  const scoreVal = selected.factorExposures?.[index] ?? '';
                  const reasonVal = getFactorReasons(selected)[index];
                  const w = Number(riskFactorWeights[index]) || 0;
                  return (
                    <div key={factor} className="px-4 py-3">
                      <div className="flex items-start gap-4">
                        {/* Label + weight + score */}
                        <div className="w-28 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-gray-800">{factor}</span>
                            {isVol && (
                              <span className="inline-flex items-center text-emerald-500" title="Auto-computed from realized volatility (CDF of the cross-sectional distribution). You can still override it.">
                                <Sparkles className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-300">weight ×{w.toFixed(2)}</span>
                          <div className="mt-1.5">
                            {isVolLoading ? (
                              <div className="w-20 h-[30px] flex items-center gap-1.5 text-[11px] text-emerald-600">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> computing
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <ScoreInput
                                  stored={scoreVal}
                                  onCommit={(v) => updateAllocationExposure(selected.id, index, v)}
                                  className={`w-16 text-[15px] text-gray-800 bg-gray-50 border rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all ${isVol ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}
                                  placeholder="0"
                                />
                                <span className="text-[11px] text-gray-300">/10</span>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Reasoning */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">
                            Why this score?
                          </label>
                          <textarea
                            rows={2}
                            value={reasonVal}
                            onChange={(e) => updateAllocationReason(selected.id, index, e.target.value)}
                            placeholder={`What about ${selectedTicker} drives its ${factor.toLowerCase()} risk?`}
                            className="w-full resize-y text-[13px] leading-relaxed text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all placeholder:text-gray-300"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Revision note */}
              <div className="mt-4 bg-white border border-gray-100 rounded-2xl px-4 py-3.5">
                <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  Revision note <span className="normal-case text-gray-300">(optional — summarize what changed & why)</span>
                </label>
                <textarea
                  rows={2}
                  value={noteDrafts[selected.id] || ''}
                  onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [selected.id]: e.target.value }))}
                  placeholder="e.g. Bumped disruption risk after the new entrant's Q2 launch."
                  className="w-full resize-y text-[13px] leading-relaxed text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all placeholder:text-gray-300"
                />
              </div>

              {/* History */}
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((o) => !o)}
                  className="flex items-center gap-2 mb-3 group"
                >
                  <History className="w-4 h-4 text-gray-400" />
                  <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">
                    History — {selectedTicker}
                  </h3>
                  <span className="text-[11px] text-gray-400">{selectedHistory.length} revision{selectedHistory.length === 1 ? '' : 's'}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
                </button>
                {historyOpen && (
                  loadingHistory ? (
                    <div className="flex items-center gap-2 text-[13px] text-gray-400 py-4">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
                    </div>
                  ) : selectedHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-8 text-center">
                      <p className="text-[13px] text-gray-500">No saved revisions for {selectedTicker} yet.</p>
                      <p className="text-[12px] text-gray-400 mt-0.5">Set the scores and reasoning above, then hit <span className="font-medium">Save revision</span> to start the record.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedHistory.map((snap) => (
                        <HistoryEntry key={snap.id} snapshot={snap} onDelete={deleteRevision} />
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
