'use client';

import { useState, useEffect, useCallback, useMemo, useImperativeHandle, useRef, forwardRef } from 'react';
import { RefreshCw, Save, CheckCircle, Plus, Trash2, Settings2, ArrowUp, ArrowDown, Copy, TrendingUp, Percent, PencilLine, Sigma, Divide } from 'lucide-react';
import {
  DEFAULT_VALUATION_INPUTS,
  computeValuationModel,
  makeDefaultInputs,
  migrateInputs,
} from '@/lib/valuationModel';

function fmt(v, decimals = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(v, decimals = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toFixed(decimals) + '%';
}

function formatEditableNumber(value, decimals = 6) {
  if (value === '' || value === undefined || value === null) return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return typeof value === 'string' ? value : '';
  return num.toFixed(decimals).replace(/\.?0+$/, '');
}

const uid = () => 'r' + Math.random().toString(36).slice(2, 9);

// Presets used when adding a row, so it arrives ready to use.
const PRESETS = [
  { key: 'growth', label: 'Growth line', desc: 'Compounds at a fixed %', Icon: TrendingUp },
  { key: 'pctOf', label: '% of revenue', desc: 'Tracks revenue to a target %', Icon: Percent },
  { key: 'manual', label: 'Manual line', desc: 'Type each year directly', Icon: PencilLine },
  { key: 'subtotal', label: 'Subtotal', desc: 'Sum of the rows above', Icon: Sigma },
  { key: 'margin', label: 'Margin %', desc: 'A row as % of revenue', Icon: Divide },
];

function makePresetRow(key) {
  switch (key) {
    case 'pctOf': return { id: uid(), name: 'New Line', type: 'line', sign: -1, method: 'pctOf', refId: 'revenue', base: '', target: '', ramp: true, format: 'money', dec: 3 };
    case 'manual': return { id: uid(), name: 'New Line', type: 'line', sign: -1, method: 'manual', values: ['', '', '', '', '', ''], format: 'money', dec: 3 };
    case 'subtotal': return { id: uid(), name: 'Subtotal', type: 'subtotal', format: 'money', dec: 3, bold: true };
    case 'margin': return { id: uid(), name: 'Margin', type: 'margin', refId: 'revenue', format: 'pct', dec: 2 };
    case 'growth':
    default: return { id: uid(), name: 'New Line', type: 'line', sign: -1, method: 'growth', base: '', rate: '', format: 'money', dec: 3 };
  }
}

function InputCell({ value, onChange, onBlur, pct = false, dollar = false, suffix = '', placeholder, className = '' }) {
  const formattedValue = pct && value !== '' && value !== undefined
    ? formatEditableNumber(Number(value) * 100)
    : formatEditableNumber(value);
  const [draftValue, setDraftValue] = useState(formattedValue);

  useEffect(() => {
    setDraftValue(formattedValue);
  }, [formattedValue]);

  const hasSuffix = pct || suffix;
  return (
    <div className="relative flex items-center">
      {dollar && <span className="absolute left-2.5 text-[11px] font-medium text-gray-400 pointer-events-none">$</span>}
      <input
        type="text"
        inputMode="decimal"
        value={draftValue ?? ''}
        onChange={e => {
          const raw = e.target.value;
          if (!/^-?\d*\.?\d*$/.test(raw)) return;
          setDraftValue(raw);
          if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
            onChange(raw === '-' ? '-' : '');
            return;
          }
          if (raw.endsWith('.')) {
            onChange(pct ? Number(raw.slice(0, -1)) / 100 : Number(raw.slice(0, -1)));
            return;
          }
          onChange(pct ? Number(raw) / 100 : Number(raw));
        }}
        placeholder={placeholder}
        onBlur={() => {
          setDraftValue(formattedValue);
          onBlur?.();
        }}
        className={`w-full bg-sky-50/80 border border-sky-200/60 rounded-md py-1.5 text-[13px] font-medium text-gray-900 outline-none focus:ring-1.5 focus:ring-sky-400 focus:border-sky-400 focus:bg-white transition-all text-right tabular-nums placeholder:text-gray-300 ${dollar ? 'pl-6' : 'pl-2.5'} ${hasSuffix ? 'pr-6' : 'pr-2.5'} ${className}`}
      />
      {pct && <span className="absolute right-2.5 text-[11px] font-medium text-gray-400 pointer-events-none">%</span>}
      {!pct && suffix && <span className="absolute right-2.5 text-[11px] font-medium text-gray-400 pointer-events-none">{suffix}</span>}
    </div>
  );
}

function CalcCell({ value, format = 'number', decimals = 2, bold = false }) {
  let display;
  if (format === 'pct') display = fmtPct(value, decimals);
  else if (format === 'money') display = value != null && !isNaN(value) ? `$${fmt(value, decimals)}` : '—';
  else display = fmt(value, decimals);
  return (
    <span className={`text-[13px] tabular-nums ${bold ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
      {display}
    </span>
  );
}

function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 ${size === 'sm' ? 'text-[10.5px] px-1.5 py-1' : 'text-[11px] px-2 py-1.5'} font-semibold rounded-md transition-all ${value === o.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      {label && <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">{label}</div>}
      {children}
    </div>
  );
}

const selectCls = 'w-full text-[12.5px] font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:border-sky-400 focus:bg-white transition-colors cursor-pointer';

const ValuationModel = forwardRef(function ValuationModel({ ticker, livePrice }, ref) {
  const [inputs, setInputs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // menu = { rowId | '__end__', kind: 'config' | 'insert', x, y }
  const [menu, setMenu] = useState(null);
  const [insertPos, setInsertPos] = useState('below');
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setDirty(false);
    setMenu(null);
    fetch(`/api/model/${ticker}`)
      .then(r => r.json())
      .then(result => {
        if (result.exists && result.inputs) {
          const migrated = migrateInputs(result.inputs);
          setInputs({ ...DEFAULT_VALUATION_INPUTS, ...migrated, ticker, ...(livePrice ? { sharePrice: livePrice } : {}) });
        } else {
          setInputs({ ...makeDefaultInputs(ticker), sharePrice: livePrice || '' });
        }
      })
      .catch(() => setInputs({ ...makeDefaultInputs(ticker), sharePrice: livePrice || '' }))
      .finally(() => setLoading(false));
  }, [ticker]);

  useEffect(() => {
    if (livePrice && inputs) {
      setInputs(prev => ({ ...prev, sharePrice: livePrice }));
    }
  }, [livePrice]);

  const update = useCallback((field, value) => {
    setInputs(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  }, []);

  const updateRow = useCallback((id, patch) => {
    setInputs(prev => ({ ...prev, rows: prev.rows.map(r => r.id === id ? { ...r, ...patch } : r) }));
    setDirty(true);
  }, []);

  const updateRowValue = useCallback((id, yearIdx, value) => {
    setInputs(prev => ({
      ...prev,
      rows: prev.rows.map(r => {
        if (r.id !== id) return r;
        const values = [...(r.values || ['', '', '', '', '', ''])];
        values[yearIdx] = value;
        return { ...r, values };
      }),
    }));
    setDirty(true);
  }, []);

  const insertPreset = useCallback((key) => {
    setInputs(prev => {
      const rows = [...prev.rows];
      let index;
      if (!menu || menu.rowId === '__end__') {
        const ni = rows.findIndex(r => r.role === 'netIncome');
        index = ni >= 0 ? ni : rows.length;
      } else {
        const i = rows.findIndex(r => r.id === menu.rowId);
        index = insertPos === 'above' ? i : i + 1;
      }
      rows.splice(Math.max(0, Math.min(index, rows.length)), 0, makePresetRow(key));
      return { ...prev, rows };
    });
    setDirty(true);
    setMenu(null);
  }, [menu, insertPos]);

  const duplicateRow = useCallback((id) => {
    setInputs(prev => {
      const rows = [...prev.rows];
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) return prev;
      const copy = { ...rows[i], id: uid(), name: `${rows[i].name} copy`, role: null };
      rows.splice(i + 1, 0, copy);
      return { ...prev, rows };
    });
    setDirty(true);
    setMenu(null);
  }, []);

  const deleteRow = useCallback((id) => {
    setInputs(prev => ({ ...prev, rows: prev.rows.filter(r => r.id !== id) }));
    setDirty(true);
    setMenu(null);
  }, []);

  const moveRow = useCallback((id, dir) => {
    setInputs(prev => {
      const rows = [...prev.rows];
      const i = rows.findIndex(r => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return prev;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { ...prev, rows };
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!ticker || !inputs || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/model/${ticker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      });
      const result = await res.json();
      if (result.success) setDirty(false);
    } catch {} finally { setSaving(false); }
  }, [ticker, inputs, dirty]);

  const model = useMemo(() => {
    if (!inputs) return null;
    return computeValuationModel(inputs);
  }, [inputs]);

  useImperativeHandle(ref, () => ({
    getModelData: () => ({ inputs, computed: model }),
  }), [inputs, model]);

  const placeFor = (el) => {
    const r = el.getBoundingClientRect();
    const width = 268;
    const x = Math.max(12, Math.min(r.right - width, (typeof window !== 'undefined' ? window.innerWidth : 1200) - width - 12));
    return { x, y: r.bottom + 6 };
  };

  const openMenu = (kind, rowId, e) => {
    const btn = e.currentTarget;
    if (menu && menu.rowId === rowId && menu.kind === kind) { setMenu(null); triggerRef.current = null; return; }
    triggerRef.current = btn;
    if (kind === 'insert') setInsertPos('below');
    setMenu({ kind, rowId, ...placeFor(btn) });
  };

  // Keep the popover stuck to its trigger button while the page scrolls/resizes.
  useEffect(() => {
    if (!menu) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const btn = triggerRef.current;
        if (!btn || !btn.isConnected) return;
        setMenu(prev => prev ? { ...prev, ...placeFor(btn) } : prev);
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.rowId, menu?.kind]);

  if (loading || !inputs || !model) {
    return <div className="skeleton h-80 rounded-2xl" />;
  }

  const years5 = [0, 1, 2, 3, 4, 5];
  const computedById = Object.fromEntries(model.rows.map(r => [r.id, r]));
  const protectedRow = (row) => row.role === 'revenue' || row.role === 'netIncome';
  // Growth-rate (CAGR) lines surface their rate up in the assumptions area.
  const growthRows = inputs.rows.filter(r => r.type === 'line' && r.method === 'growth' && r.role !== 'tax');

  const cellFor = (row, i) => {
    const cr = computedById[row.id];
    const isMoney = row.format !== 'pct';
    if (row.type === 'line' && row.method === 'manual') {
      return <InputCell value={(row.values || [])[i]} onChange={v => updateRowValue(row.id, i, v)} dollar={isMoney} />;
    }
    if (row.type === 'line' && i === 0 && (row.method === 'growth' || row.method === 'pctOf' || row.method === 'tax' || row.method === 'plug' || row.role === 'tax')) {
      return <InputCell value={row.base} onChange={v => updateRow(row.id, { base: v })} dollar={isMoney} />;
    }
    return <CalcCell value={cr?.values[i]} format={row.format} decimals={row.dec} bold={row.bold} />;
  };

  const highlightBg = (h) => h === 'emerald' ? 'bg-emerald-50/50'
    : h === 'violet' ? 'bg-violet-50/50'
    : h === 'sky' ? 'bg-sky-50/40' : '';

  const signDot = (row) => {
    if (row.type !== 'line' || row.method === 'plug') {
      return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-gray-200" />;
    }
    const expense = row.sign === -1;
    return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${expense ? 'bg-rose-400' : 'bg-emerald-400'}`} title={expense ? 'Subtracted in subtotals' : 'Added in subtotals'} />;
  };

  const tailRows = [
    { label: 'Outstanding Shares (bil)', kind: 'sharesBase', dec: 4, suffix: 'B' },
    { label: 'Earnings per Share', data: model.eps, format: 'money', dec: 2, bold: true, highlight: 'violet' },
    { label: 'Share Price (at Tgt P/E)', data: model.priceArr, format: 'money', dec: 2, bold: true, highlight: 'sky' },
    { label: 'Extra Shares w/ Div Reinvested', data: model.divShares, format: 'number', dec: 4 },
  ];

  const menuRow = menu && menu.rowId !== '__end__' ? inputs.rows.find(r => r.id === menu.rowId) : null;

  // ── Sleek config panel ───────────────────────────────────────────────────────
  const renderConfig = (row) => {
    const refOptions = inputs.rows.filter(r => r.id !== row.id);
    const u = (patch) => updateRow(row.id, patch);
    const setMethod = (method) => {
      const patch = { method, role: method === 'tax' ? 'tax' : (row.role === 'tax' ? null : row.role) };
      if (method === 'pctOf') { patch.refId = row.refId || 'revenue'; if (row.ramp === undefined) patch.ramp = true; }
      if (method === 'plug' && row.target === undefined) patch.target = '';
      if (method === 'tax') patch.refId = row.refId || 'revenue';
      u(patch);
    };
    const methodVal = row.role === 'tax' ? 'tax' : row.method;

    return (
      <div className="space-y-3.5">
        <Field label="Type">
          <Segmented size="sm" value={row.type} onChange={(type) => {
            const patch = { type };
            if (type === 'margin') { patch.format = 'pct'; patch.dec = 2; if (!row.refId) patch.refId = 'revenue'; }
            else { patch.format = 'money'; patch.dec = 3; }
            if (type === 'line' && !row.method) patch.method = 'growth';
            u(patch);
          }} options={[{ value: 'line', label: 'Line' }, { value: 'subtotal', label: 'Subtotal' }, { value: 'margin', label: 'Margin' }]} />
        </Field>

        {row.type === 'line' && (
          <>
            <Field label="Projects by">
              <select className={selectCls} value={methodVal} onChange={e => setMethod(e.target.value)}>
                <option value="growth">Growth rate (CAGR)</option>
                <option value="pctOf">% of another row</option>
                <option value="manual">Manual (per year)</option>
                <option value="tax">Tax (× tax rate)</option>
                <option value="plug">Back-solve to a target margin</option>
              </select>
            </Field>

            {row.method !== 'plug' && (
              <Field label="Counts as">
                <div className="flex gap-1.5">
                  <button onClick={() => u({ sign: 1 })} className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg border transition-all ${row.sign !== -1 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Income</button>
                  <button onClick={() => u({ sign: -1 })} className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg border transition-all ${row.sign === -1 ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Expense</button>
                </div>
              </Field>
            )}

            {row.method === 'growth' && (
              <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2">
                <TrendingUp size={14} className="text-gray-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-gray-500 leading-snug">Set this line&apos;s growth rate under <span className="font-semibold text-gray-600">Growth Rates</span> in the assumptions at the top.</p>
              </div>
            )}

            {row.method === 'pctOf' && (
              <>
                <Field label="% of which row">
                  <select className={selectCls} value={row.refId || 'revenue'} onChange={e => u({ refId: e.target.value })}>
                    {refOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Target % (yr 5)"><InputCell value={row.target} onChange={v => u({ target: v })} pct /></Field>
                  <Field label="From today"><Segmented size="sm" value={row.ramp === false ? 'flat' : 'ramp'} onChange={(v) => u({ ramp: v === 'ramp' })} options={[{ value: 'ramp', label: 'Ramp' }, { value: 'flat', label: 'Flat' }]} /></Field>
                </div>
              </>
            )}

            {(row.method === 'tax' || row.role === 'tax') && (
              <Field label="Applied to (× global tax rate)">
                <select className={selectCls} value={row.refId || 'revenue'} onChange={e => u({ refId: e.target.value })}>
                  {refOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}

            {row.method === 'plug' && (
              <Field label="Target operating margin (yr 5)">
                <InputCell value={row.target} onChange={v => u({ target: v })} pct />
                <p className="text-[10.5px] text-gray-400 mt-1.5 leading-snug">This line is back-solved each year so income ÷ revenue ramps to the target.</p>
              </Field>
            )}
          </>
        )}

        {row.type === 'subtotal' && (
          <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2">
            <Sigma size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-gray-500 leading-snug">Adds up every line between this row and the subtotal above it.</p>
          </div>
        )}

        {row.type === 'margin' && (
          <Field label="Shows this row ÷ revenue">
            <select className={selectCls} value={row.refId || 'revenue'} onChange={e => u({ refId: e.target.value })}>
              {refOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        )}

        <div className="flex items-center gap-1 pt-2.5 border-t border-gray-100">
          <button onClick={() => moveRow(row.id, -1)} title="Move up" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"><ArrowUp size={14} /></button>
          <button onClick={() => moveRow(row.id, 1)} title="Move down" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"><ArrowDown size={14} /></button>
          <button onClick={() => duplicateRow(row.id)} title="Duplicate" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"><Copy size={14} /></button>
          {!protectedRow(row) && (
            <button onClick={() => deleteRow(row.id)} title="Delete" className="ml-auto p-1.5 rounded-lg text-rose-400 hover:text-white hover:bg-rose-500 transition-colors"><Trash2 size={14} /></button>
          )}
        </div>
      </div>
    );
  };

  // ── Insert / add panel with presets ──────────────────────────────────────────
  const renderInsert = (showPos) => (
    <div className="space-y-2.5">
      {showPos && (
        <Segmented size="sm" value={insertPos} onChange={setInsertPos} options={[{ value: 'above', label: 'Insert above' }, { value: 'below', label: 'Insert below' }]} />
      )}
      <div className="flex flex-col gap-0.5">
        {PRESETS.map(({ key, label, desc, Icon }) => (
          <button key={key} onClick={() => insertPreset(key)}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-sky-50 transition-colors text-left group/p">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 text-gray-500 group-hover/p:bg-sky-100 group-hover/p:text-sky-600 transition-colors shrink-0"><Icon size={14} /></span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-gray-800 leading-tight">{label}</span>
              <span className="block text-[10.5px] text-gray-400 leading-tight">{desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden" onBlur={save}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Valuation Model</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="inline-block w-2.5 h-2.5 bg-sky-100 border border-sky-300 rounded-sm mr-1 align-middle" />
            blue cells are editable — hover a row for its <span className="inline-flex items-center"><Settings2 size={11} className="mx-0.5" /></span> settings &amp; <span className="inline-flex items-center"><Plus size={11} className="mx-0.5" /></span> insert
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={`flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-xl shadow-sm transition-all duration-200 ${
            dirty
              ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 hover:shadow-md'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saving ? <RefreshCw size={12} className="animate-spin" /> : dirty ? <Save size={12} /> : <CheckCircle size={12} />}
          {saving ? 'Saving...' : dirty ? 'Save Model' : 'Saved'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[900px]">

          {/* ── Global Assumptions ── */}
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/30">
            <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Ticker</label>
                <div className="px-2.5 py-1.5 text-[13px] font-bold text-gray-900 bg-white border border-gray-200 rounded-md text-center">{ticker}</div>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Share Price</label>
                <InputCell value={inputs.sharePrice} onChange={v => update('sharePrice', v)} placeholder="0.00" dollar />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Target P/E</label>
                <InputCell value={inputs.targetPE} onChange={v => update('targetPE', v)} suffix="x" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">EPS Growth</label>
                <div className="px-2.5 py-1.5 text-[13px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/50 rounded-md text-right tabular-nums">
                  {fmtPct(model.epsGrowth, 2)}
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Base Year</label>
                <InputCell value={inputs.baseYear} onChange={v => update('baseYear', v)} className="text-center" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Tax Rate</label>
                <InputCell value={inputs.taxRate} onChange={v => update('taxRate', v)} pct />
              </div>
            </div>

            <div className="border-t border-dashed border-gray-200 my-4" />

            <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Net Share Dilution</label>
                <InputCell value={inputs.netShareDilution} onChange={v => update('netShareDilution', v)} pct />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Dividend Growth</label>
                <InputCell value={inputs.dividendGrowth} onChange={v => update('dividendGrowth', v)} pct />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Current Dividend</label>
                <InputCell value={inputs.currentDividend} onChange={v => update('currentDividend', v)} dollar />
              </div>
            </div>

            {growthRows.length > 0 && (
              <>
                <div className="border-t border-dashed border-gray-200 my-4" />
                <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-3">Growth Rates (CAGR)</div>
                <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
                  {growthRows.map(r => (
                    <div key={r.id} className="col-span-2">
                      <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5 truncate" title={r.name}>{r.name || 'Line'}</label>
                      <InputCell value={r.rate} onChange={v => updateRow(r.id, { rate: v })} pct />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Projection Table ── */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-400 font-bold uppercase tracking-widest border-b border-gray-200 w-80">Income Statement</th>
                {model.yearLabels.map((y, i) => (
                  <th key={y} className="text-right px-4 py-2.5 border-b border-gray-200">
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${i === 0 ? 'text-gray-400' : 'text-gray-500'}`}>{i === 0 ? 'TTM' : y}</span>
                    {i > 0 && <span className="block text-[9px] text-gray-300 font-medium">Yr {i}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inputs.rows.map((row) => {
                const active = menu?.rowId === row.id;
                return (
                  <tr key={row.id} className={`group/row transition-colors ${highlightBg(row.highlight)} ${active ? 'bg-sky-50/40' : !row.highlight ? 'hover:bg-gray-50/60' : ''}`}>
                    <td className="px-4 py-1.5 border-b border-gray-50 w-80">
                      <div className="flex items-center gap-2">
                        {signDot(row)}
                        <input
                          type="text"
                          value={row.name}
                          onChange={e => updateRow(row.id, { name: e.target.value })}
                          className={`min-w-0 flex-1 bg-transparent text-[13px] outline-none focus:bg-sky-50/70 rounded px-1 -ml-1 py-0.5 ${row.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}
                        />
                        <button
                          onClick={(e) => openMenu('config', row.id, e)}
                          className={`shrink-0 rounded-md p-1 transition-all ${active && menu?.kind === 'config' ? 'bg-sky-100 text-sky-600' : 'text-gray-300 hover:text-gray-600 hover:bg-gray-100 opacity-40 group-hover/row:opacity-100'}`}
                          title="Row settings"
                        ><Settings2 size={14} /></button>
                        <button
                          onClick={(e) => openMenu('insert', row.id, e)}
                          className={`shrink-0 rounded-md p-1 transition-all ${active && menu?.kind === 'insert' ? 'bg-sky-100 text-sky-600' : 'text-gray-300 hover:text-sky-600 hover:bg-sky-50 opacity-0 group-hover/row:opacity-100'}`}
                          title="Insert row above / below"
                        ><Plus size={14} /></button>
                      </div>
                    </td>
                    {years5.map(i => (
                      <td key={i} className="px-3 py-1.5 text-right border-b border-gray-50">
                        {cellFor(row, i)}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {/* Bottom add */}
              <tr>
                <td colSpan={7} className="px-4 py-2 border-b border-gray-100">
                  <button
                    onClick={(e) => openMenu('insert', '__end__', e)}
                    className={`flex items-center gap-1.5 text-[11px] font-medium border border-dashed rounded-md px-2.5 py-1 transition-colors ${menu?.rowId === '__end__' ? 'text-sky-700 bg-sky-50 border-sky-300' : 'text-gray-500 border-gray-300 hover:text-sky-700 hover:bg-sky-50 hover:border-sky-300'}`}
                  ><Plus size={12} /> Add row</button>
                </td>
              </tr>

              {/* ── Fixed per-share & valuation tail ── */}
              <tr>
                <td colSpan={7} className="px-4 pt-4 pb-1.5">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Per-share &amp; valuation</span>
                </td>
              </tr>
              {tailRows.map((tr) => (
                <tr key={tr.label} className={`transition-colors ${highlightBg(tr.highlight)} ${!tr.highlight ? 'hover:bg-gray-50/60' : ''}`}>
                  <td className={`px-4 py-2 text-[13px] whitespace-nowrap border-b border-gray-50 ${tr.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                    {tr.label}
                  </td>
                  {years5.map(i => (
                    <td key={i} className="px-3 py-1.5 text-right border-b border-gray-50">
                      {tr.kind === 'sharesBase' && i === 0
                        ? <InputCell value={inputs.baseShares} onChange={v => update('baseShares', v)} suffix={tr.suffix} />
                        : <CalcCell value={(tr.kind === 'sharesBase' ? model.shares : tr.data)[i]} format={tr.format} decimals={tr.dec} bold={tr.bold} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Output Summary ── */}
          <div className="px-6 py-5 border-t border-gray-200 bg-gradient-to-b from-gray-50/60 to-white">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Expected CAGR', value: fmtPct(model.totalCAGRNoDivs, 2) },
                { label: 'Total CAGR (w/ Divs)', value: fmtPct(model.totalCAGR, 2) },
                { label: 'Price Target (2Y @ Expected CAGR)', value: `$${fmt(model.priceTarget, 2)}` },
                { label: '5-Year Target Price', value: `$${fmt(model.targetPrice5, 2)}` },
              ].map(item => (
                <div key={item.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3.5 shadow-sm">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">{item.label}</p>
                  <p className="text-xl font-extrabold gradient-text">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Floating popover ── */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
          <div
            className="fixed z-50 bg-white border border-gray-200/80 rounded-2xl shadow-xl ring-1 ring-black/5 p-4 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: menu.y, left: menu.x, width: 268 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 mb-3">
              {menu.kind === 'config' ? <Settings2 size={12} className="text-gray-400" /> : <Plus size={12} className="text-gray-400" />}
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 truncate">
                {menu.kind === 'config' ? (menuRow?.name || 'Row') : 'Add a row'}
              </span>
            </div>
            {menu.kind === 'config' && menuRow ? renderConfig(menuRow) : renderInsert(menu.rowId !== '__end__')}
          </div>
        </>
      )}
    </div>
  );
});

export default ValuationModel;
