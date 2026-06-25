// ─────────────────────────────────────────────────────────────────────────────
// Valuation model
//
// The income statement (Revenue → … → Net Income) is a fully editable list of
// `rows`. Everything below Net Income — Outstanding Shares, EPS, Share Price,
// dividend reinvestment and the CAGR outputs — is a fixed engine driven by the
// row tagged role:'netIncome'. This keeps the expected-return math correct no
// matter how the statement above is reshaped per company.
//
// Row shapes:
//   line     { type:'line', sign:1|-1, method, base, rate, target, ramp, values, refId, role, format, dec, bold, highlight }
//   subtotal { type:'subtotal', mode:'additive'|'margin', target, refId, role, format, dec, bold, highlight }
//   margin   { type:'margin', refId, format:'pct', dec }   (display-only ratio of refId / revenue)
//
// Line methods:
//   growth  base × (1+rate)^year
//   pctOf   refRow × pct, where pct ramps from the implied year-0 ratio to `target`
//           (or is flat at `target` when ramp === false)
//   manual  values[year]
//   plug    back-solved so the linked margin subtotal hits its target margin
//   tax     refRow × global taxRate (year-0 may be overridden with `base`)
// ─────────────────────────────────────────────────────────────────────────────

const p = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v))) ? 0 : Number(v);
const hasValue = (v) => v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v));

const YEARS = [0, 1, 2, 3, 4, 5];
const rampSeries = (start, end) => YEARS.map(i => start + (i / 5) * (end - start));

// Global (non-row) assumptions and their defaults.
export const DEFAULT_VALUATION_INPUTS = {
  ticker: '',
  sharePrice: '',
  targetPE: '',
  taxRate: 0.21,
  baseYear: 2026,
  baseShares: '',
  netShareDilution: '',
  dividendGrowth: '',
  currentDividend: '',
};

// The default income-statement template — reproduces the classic
// Revenue / Operating Expense (plug) / Operating Income layout. The target
// operating margin lives on the Operating Expense line: it is back-solved each
// year so the running margin ramps to that target; Operating Income is then a
// plain sum of the rows above.
export function makeDefaultRows() {
  return [
    { id: 'revenue', name: 'Revenue (bil)', type: 'line', sign: 1, method: 'growth', base: '', rate: '', role: 'revenue', format: 'money', dec: 3, bold: true },
    { id: 'opex', name: 'Operating Expense', type: 'line', sign: -1, method: 'plug', base: '', target: '', format: 'money', dec: 3 },
    { id: 'opinc', name: 'Operating Income (bil)', type: 'subtotal', role: 'opIncome', format: 'money', dec: 3, bold: true, highlight: 'emerald' },
    { id: 'opmargin', name: 'Operating Margin', type: 'margin', refId: 'opinc', format: 'pct', dec: 2 },
    { id: 'nonop', name: 'Non-operating Income', type: 'line', sign: 1, method: 'manual', values: ['', '', '', '', '', ''], format: 'money', dec: 3 },
    { id: 'tax', name: 'Tax Expense', type: 'line', sign: -1, method: 'tax', role: 'tax', base: '', refId: 'opinc', format: 'money', dec: 3 },
    { id: 'netinc', name: 'Net Income (bil)', type: 'subtotal', role: 'netIncome', format: 'money', dec: 3, bold: true, highlight: 'emerald' },
  ];
}

export function makeDefaultInputs(ticker = '') {
  return { ...DEFAULT_VALUATION_INPUTS, ticker, rows: makeDefaultRows() };
}

// Convert a legacy flat-field model (baseRevenue/targetOpMargin/…) into the
// row-based format, and normalise older row-format models (where the target
// margin used to live on a margin-mode subtotal) onto the plug line.
export function migrateInputs(inputs) {
  if (!inputs) return makeDefaultInputs();

  if (Array.isArray(inputs.rows)) {
    let changed = false;
    const rows = inputs.rows.map(r => ({ ...r }));
    for (const r of rows) {
      if (r.type === 'subtotal' && r.mode === 'margin') {
        const plug = rows.find(x => x.method === 'plug' && x.refId === r.id);
        if (plug && (plug.target === undefined || plug.target === '')) plug.target = r.target ?? '';
        delete r.mode;
        delete r.target;
        changed = true;
      }
    }
    return changed ? { ...inputs, rows } : inputs;
  }

  const rows = makeDefaultRows();
  const set = (id, patch) => { const r = rows.find(x => x.id === id); if (r) Object.assign(r, patch); };
  set('revenue', { base: inputs.baseRevenue ?? '', rate: inputs.revenueGrowth ?? '' });
  set('opex', { base: inputs.baseOpex ?? '', target: inputs.targetOpMargin ?? '' });
  set('nonop', { values: [inputs.baseNonOpIncome ?? '', '', '', '', '', ''] });
  set('tax', { base: inputs.baseTaxExpense ?? '' });
  return { ...inputs, rows };
}

const refVals = (refId, valuesById, revenue) => {
  if (refId && valuesById[refId]) return valuesById[refId];
  return revenue;
};

const projectRevenue = (r) => {
  if (!r) return YEARS.map(() => 0);
  if (r.method === 'manual') return YEARS.map(i => p((r.values || [])[i]));
  const base = p(r.base), rate = p(r.rate);
  return YEARS.map(i => base * Math.pow(1 + rate, i));
};

export function computeValuationModel(rawInputs) {
  const inputs = migrateInputs(rawInputs);
  const rows = Array.isArray(inputs.rows) ? inputs.rows : [];

  const sharePrice = p(inputs.sharePrice);
  const targetPE = p(inputs.targetPE);
  const taxRate = p(inputs.taxRate);
  const baseYear = p(inputs.baseYear) || 2026;
  const baseShares = p(inputs.baseShares);
  const dilution = p(inputs.netShareDilution);
  const divG = p(inputs.dividendGrowth);
  const curDiv = p(inputs.currentDividend);

  const yearLabels = YEARS.map(i => baseYear + i);

  // Revenue series — the reference for % of revenue lines and margin rows.
  const revRow = rows.find(r => r.role === 'revenue') || rows.find(r => r.type === 'line');
  const revenue = projectRevenue(revRow);

  // Single top-down pass, carrying a running accumulator (the income statement).
  const valuesById = {};
  const acc = YEARS.map(() => 0);
  const computedRows = [];

  for (const r of rows) {
    let vals = YEARS.map(() => 0);

    if (r.type === 'line') {
      if (r === revRow) {
        vals = revenue.slice();
      } else if (r.method === 'plug') {
        // Back-solve this line so the running margin (acc ÷ revenue) ramps from
        // its implied year-0 level to the target by year 5.
        const rev0 = revenue[0] || 0;
        const marginStart = rev0 ? (acc[0] - p(r.base)) / rev0 : 0;
        const m = rampSeries(marginStart, p(r.target));
        vals = YEARS.map(i => acc[i] - revenue[i] * m[i]);
      } else if (r.method === 'tax' || r.role === 'tax') {
        const ref = refVals(r.refId, valuesById, revenue);
        vals = YEARS.map(i => (i === 0 && hasValue(r.base)) ? p(r.base) : ref[i] * taxRate);
      } else if (r.method === 'manual') {
        vals = YEARS.map(i => p((r.values || [])[i]));
      } else if (r.method === 'pctOf') {
        const ref = refVals(r.refId, valuesById, revenue);
        const target = p(r.target);
        if (r.ramp === false) {
          vals = YEARS.map(i => ref[i] * target);
        } else {
          const ref0 = ref[0] || 0;
          const start = ref0 ? p(r.base) / ref0 : 0;
          const pct = rampSeries(start, target);
          vals = YEARS.map(i => ref[i] * pct[i]);
        }
      } else { // growth
        const base = p(r.base), rate = p(r.rate);
        vals = YEARS.map(i => base * Math.pow(1 + rate, i));
      }
      const sign = r.sign === -1 ? -1 : 1;
      for (const i of YEARS) acc[i] += sign * vals[i];
    } else if (r.type === 'subtotal') {
      vals = acc.slice();
    } else if (r.type === 'margin') {
      const ref = refVals(r.refId, valuesById, revenue);
      vals = YEARS.map(i => revenue[i] ? ref[i] / revenue[i] : 0);
    }

    valuesById[r.id] = vals;
    computedRows.push({
      id: r.id, name: r.name, type: r.type,
      format: r.format || 'money', dec: r.dec ?? 2,
      bold: !!r.bold, highlight: r.highlight || null,
      values: vals,
    });
  }

  // Net Income drives the fixed EPS → price → CAGR tail.
  const niRow = rows.find(r => r.role === 'netIncome') || [...rows].reverse().find(r => r.type === 'subtotal');
  const netIncome = niRow ? (valuesById[niRow.id] || YEARS.map(() => 0)) : acc.slice();
  const revenueOut = revRow ? (valuesById[revRow.id] || revenue) : revenue;

  const shares = [baseShares];
  for (let i = 1; i <= 5; i++) shares.push(shares[i - 1] * (1 + dilution));
  const eps = YEARS.map(i => shares[i] ? netIncome[i] / shares[i] : 0);
  const epsGrowth = (eps[0] !== 0 && eps[5] !== 0) ? Math.pow(eps[5] / eps[0], 1 / 5) - 1 : 0;
  const targetPrice5 = targetPE * eps[5];
  const priceCAGR = (sharePrice > 0 && targetPrice5 > 0) ? Math.pow(targetPrice5 / sharePrice, 1 / 5) - 1 : 0;
  const priceArr = [sharePrice];
  for (let i = 1; i <= 5; i++) priceArr.push(priceArr[i - 1] * (1 + priceCAGR));
  const divShares = [1];
  for (let i = 1; i <= 5; i++) {
    const divFactor = sharePrice > 0 ? (curDiv / sharePrice) * Math.pow((1 + divG) / (1 + priceCAGR), i - 1) : 0;
    divShares.push((1 + divFactor) * divShares[i - 1]);
  }
  const totalCAGRNoDivs = priceCAGR;
  const totalCAGR = (sharePrice > 0 && divShares[5] * priceArr[5] > 0)
    ? Math.pow((divShares[5] * priceArr[5]) / sharePrice, 1 / 5) - 1 : 0;
  const priceTarget = priceArr[2];

  return {
    yearLabels, rows: computedRows, valuesById,
    revenue: revenueOut, netIncome, shares, eps,
    epsGrowth, targetPrice5, priceCAGR, priceArr, divShares,
    totalCAGRNoDivs, totalCAGR, priceTarget,
  };
}

export function getValuationExpectedReturn(inputs, livePrice) {
  if (!inputs) return null;

  const sharePrice = hasValue(livePrice) && Number(livePrice) > 0 ? Number(livePrice) : inputs.sharePrice;
  if (!hasValue(sharePrice) || Number(sharePrice) <= 0) return null;
  if (!hasValue(inputs.targetPE) || Number(inputs.targetPE) <= 0) return null;
  if (!hasValue(inputs.baseShares) || Number(inputs.baseShares) <= 0) return null;

  const model = computeValuationModel({ ...inputs, sharePrice });
  if (!Number.isFinite(model.targetPrice5) || model.targetPrice5 <= 0) return null;
  if (!Number.isFinite(model.totalCAGR)) return null;

  return model.totalCAGR;
}
