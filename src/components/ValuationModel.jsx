'use client';

import { useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { RefreshCw, Save, CheckCircle } from 'lucide-react';
import { DEFAULT_VALUATION_INPUTS, computeValuationModel } from '@/lib/valuationModel';

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
        className={`w-full bg-sky-50/80 border border-sky-200/60 rounded py-1.5 text-[13px] font-medium text-gray-900 outline-none focus:ring-1.5 focus:ring-sky-400 focus:border-sky-400 focus:bg-sky-50 transition-all text-right tabular-nums placeholder:text-gray-300 ${dollar ? 'pl-6' : 'pl-2.5'} ${hasSuffix ? 'pr-6' : 'pr-2.5'} ${className}`}
      />
      {pct && <span className="absolute right-2.5 text-[11px] font-medium text-gray-400 pointer-events-none">%</span>}
      {!pct && suffix && <span className="absolute right-2.5 text-[11px] font-medium text-gray-400 pointer-events-none">{suffix}</span>}
    </div>
  );
}

function CalcCell({ value, format = 'number', decimals = 2, bold = false, prefix = '' }) {
  let display;
  if (format === 'pct') display = fmtPct(value, decimals);
  else if (format === 'money') display = value != null && !isNaN(value) ? `$${fmt(value, decimals)}` : '—';
  else display = (prefix && value != null && !isNaN(value) ? prefix : '') + fmt(value, decimals);
  return (
    <span className={`text-[13px] text-gray-800 tabular-nums ${bold ? 'font-semibold' : 'font-medium'}`}>
      {display}
    </span>
  );
}

const ValuationModel = forwardRef(function ValuationModel({ ticker, livePrice }, ref) {
  const [inputs, setInputs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setDirty(false);
    fetch(`/api/model/${ticker}`)
      .then(r => r.json())
      .then(result => {
        if (result.exists && result.inputs) {
          setInputs({ ...DEFAULT_VALUATION_INPUTS, ticker, ...result.inputs, ...(livePrice ? { sharePrice: livePrice } : {}) });
        } else {
          setInputs({ ...DEFAULT_VALUATION_INPUTS, ticker, sharePrice: livePrice || '' });
        }
      })
      .catch(() => setInputs({ ...DEFAULT_VALUATION_INPUTS, ticker, sharePrice: livePrice || '' }))
      .finally(() => setLoading(false));
  }, [ticker]);

  // Always sync live price into model — share price should reflect the current quote
  useEffect(() => {
    if (livePrice && inputs) {
      setInputs(prev => ({ ...prev, sharePrice: livePrice }));
    }
  }, [livePrice]);

  const update = useCallback((field, value) => {
    setInputs(prev => ({ ...prev, [field]: value }));
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

  // Expose model data for export
  useImperativeHandle(ref, () => ({
    getModelData: () => ({ inputs, computed: model }),
  }), [inputs, model]);

  if (loading || !inputs || !model) {
    return <div className="skeleton h-80 rounded-2xl" />;
  }

  const years5 = [0, 1, 2, 3, 4, 5];

  // Row definition for the projection table
  const rows = [
    { label: 'Revenue (bil)', key: 'revenue', inputKey: 'baseRevenue', dec: 3, bold: true, inputDollar: true },
    { label: 'Operating Expense', key: 'opex', inputKey: 'baseOpex', dec: 3, inputDollar: true },
    { type: 'divider' },
    { label: 'Operating Income (bil)', key: 'opIncome', dec: 3, bold: true, highlight: 'emerald', calcPrefix: '$' },
    { label: 'Operating Margin', key: 'opMargin', format: 'pct', dec: 2 },
    { type: 'divider' },
    { label: 'Non-operating Income', key: 'nonOpIncome', inputKey: 'baseNonOpIncome', dec: 3, inputDollar: true },
    { label: 'Tax Expense', key: 'taxExpense', inputKey: 'baseTaxExpense', dec: 3, inputDollar: true },
    { label: 'Net Income (bil)', key: 'netIncome', dec: 3, bold: true, highlight: 'emerald', calcPrefix: '$' },
    { type: 'divider' },
    { label: 'Outstanding Shares (bil)', key: 'shares', inputKey: 'baseShares', dec: 4, inputSuffix: 'B' },
    { type: 'divider' },
    { label: 'Earnings per Share', key: 'eps', dec: 2, bold: true, highlight: 'violet', calcPrefix: '$' },
    { type: 'spacer' },
    { label: 'Share Price (at Tgt P/E)', key: 'priceArr', format: 'money', dec: 2, bold: true, highlight: 'sky' },
    { label: 'Extra Shares w/ Div Reinvested', key: 'divShares', dec: 4 },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden" onBlur={save}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Valuation Model</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            <span className="inline-block w-2.5 h-2.5 bg-sky-100 border border-sky-300 rounded-sm mr-1 align-middle" />
            cells are editable inputs — everything else auto-calculates
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
        <div className="min-w-[920px]">

          {/* ── Assumption Inputs ── */}
          <div className="px-6 py-5 border-b border-gray-100">
            {/* Row 1: Core */}
            <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
              {/* Ticker */}
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Ticker</label>
                <div className="px-2.5 py-1.5 text-[13px] font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded text-center">{ticker}</div>
              </div>
              {/* Share Price */}
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Share Price</label>
                <InputCell value={inputs.sharePrice} onChange={v => update('sharePrice', v)} placeholder="0.00" dollar />
              </div>
              {/* Target P/E */}
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Target P/E</label>
                <InputCell value={inputs.targetPE} onChange={v => update('targetPE', v)} suffix="x" />
              </div>
              {/* EPS Growth (computed) */}
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">EPS Growth</label>
                <div className="px-2.5 py-1.5 text-[13px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/50 rounded text-right tabular-nums">
                  {fmtPct(model.epsGrowth, 2)}
                </div>
              </div>
              {/* Base Year */}
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Base Year</label>
                <InputCell value={inputs.baseYear} onChange={v => update('baseYear', v)} className="text-center" />
              </div>
              {/* Tax Rate */}
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Tax Rate</label>
                <InputCell value={inputs.taxRate} onChange={v => update('taxRate', v)} pct />
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-dashed border-gray-200 my-4" />

            {/* Row 2: Growth assumptions */}
            <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Revenue Growth</label>
                <InputCell value={inputs.revenueGrowth} onChange={v => update('revenueGrowth', v)} pct />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1.5">Target Op. Margin</label>
                <InputCell value={inputs.targetOpMargin} onChange={v => update('targetOpMargin', v)} pct />
              </div>
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
          </div>

          {/* ── Projection Table ── */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50/80">
                <th className="text-left px-4 py-2.5 text-[10px] text-gray-400 font-bold uppercase tracking-widest border-b border-gray-200 w-52">Factors</th>
                {model.yearLabels.map((y, i) => (
                  <th key={y} className="text-right px-4 py-2.5 border-b border-gray-200">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{y}</span>
                    {i > 0 && <span className="block text-[9px] text-gray-300 font-medium">Yr {i}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                if (row.type === 'divider') {
                  return <tr key={`d-${idx}`}><td colSpan={7} className="h-0"><div className="border-t border-gray-100" /></td></tr>;
                }
                if (row.type === 'spacer') {
                  return <tr key={`s-${idx}`} className="h-3" />;
                }

                const bg = row.highlight === 'emerald' ? 'bg-emerald-50/40'
                  : row.highlight === 'violet' ? 'bg-violet-50/40'
                  : row.highlight === 'sky' ? 'bg-sky-50/30'
                  : '';

                return (
                  <tr key={row.label} className={`group transition-colors ${bg} ${!row.highlight ? 'hover:bg-gray-50/60' : ''}`}>
                    <td className={`px-4 py-2 text-[13px] whitespace-nowrap border-b border-gray-50 ${row.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                      {row.label}
                    </td>
                    {years5.map(i => {
                      const isBaseInput = i === 0 && row.inputKey;
                      return (
                        <td key={i} className="px-3 py-1.5 text-right border-b border-gray-50">
                          {isBaseInput ? (
                            <InputCell value={inputs[row.inputKey]} onChange={v => update(row.inputKey, v)} dollar={row.inputDollar} suffix={row.inputSuffix} />
                          ) : (
                            <CalcCell value={model[row.key][i]} format={row.format} decimals={row.dec} bold={row.bold} prefix={row.calcPrefix} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
    </div>
  );
});

export default ValuationModel;
