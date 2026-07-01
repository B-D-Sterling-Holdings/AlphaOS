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
//   subtotal { type:'subtotal', role, format, dec, bold, highlight }
//   margin   { type:'margin', refId, format:'pct', dec, driverId?, target?, ramp? }
//
// Coupling — a margin row can "hold an expense to a target". When it has a
// `driverId` (a line id) and a `target`, that line is back-solved each year so the
// running income after it ÷ revenue ramps to the target (flat when ramp === false).
// The target lives on the MARGIN row it describes — not on the expense — and the
// expense just shows its year-0 value (its `base`) while later years are solved.
//
// Line methods (the line's own behaviour when it is NOT being driven by a margin):
//   growth  base × (1+rate)^year
//   pctOf   refRow × pct, where pct ramps from the implied year-0 ratio to `target`
//           (or is flat at `target` when ramp === false)
//   manual  values[year]
//   tax     refRow × global taxRate (year-0 may be overridden with `base`)
//   plug    LEGACY back-solve with the target stored on the line itself; new models
//           use margin-driven coupling above. Still honoured for old saved models.
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

// The default income-statement template — the classic Revenue / Operating Expense /
// Operating Income layout. Nothing is coupled by default: Revenue and Operating Expense
// are plain CAGR lines (their rates live in the Growth Rates assumptions) and Operating
// Margin is a display-only ratio. To make the Operating Margin drive the Operating
// Expense to a target, turn that on explicitly in the margin row's settings.
export function makeDefaultRows() {
  return [
    { id: 'revenue', name: 'Revenue', type: 'line', sign: 1, method: 'growth', base: '', rate: '', role: 'revenue', format: 'money', dec: 3, bold: true },
    { id: 'opex', name: 'Operating Expense', type: 'line', sign: -1, method: 'growth', base: '', rate: '', format: 'money', dec: 3 },
    { id: 'opinc', name: 'Operating Income', type: 'subtotal', role: 'opIncome', format: 'money', dec: 3, bold: true, highlight: 'emerald' },
    { id: 'opmargin', name: 'Operating Margin', type: 'margin', refId: 'opinc', format: 'pct', dec: 2 },
    { id: 'nonop', name: 'Non-operating Income', type: 'line', sign: 1, method: 'manual', values: ['', '', '', '', '', ''], format: 'money', dec: 3 },
    { id: 'tax', name: 'Tax Expense', type: 'line', sign: -1, method: 'tax', role: 'tax', base: '', refId: 'opinc', format: 'money', dec: 3 },
    { id: 'netinc', name: 'Net Income', type: 'subtotal', role: 'netIncome', format: 'money', dec: 3, bold: true, highlight: 'emerald' },
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
    // Drop the "(bil)" unit hint that older templates baked into row names.
    for (const r of rows) {
      if (typeof r.name === 'string' && /\s*\(bil\)\s*$/i.test(r.name)) {
        r.name = r.name.replace(/\s*\(bil\)\s*$/i, '');
        changed = true;
      }
    }
    // Legacy: a margin-mode subtotal that held the target → move it onto its plug line.
    for (const r of rows) {
      if (r.type === 'subtotal' && r.mode === 'margin') {
        const plug = rows.find(x => x.method === 'plug' && x.refId === r.id);
        if (plug && (plug.target === undefined || plug.target === '')) plug.target = r.target ?? '';
        delete r.mode;
        delete r.target;
        changed = true;
      }
    }
    // Legacy → new: a plug line stored its own target. Move the target onto the margin
    // row that measures the subtotal right below it, and turn the line into a normal
    // (manual) line that the margin drives. Couplings now live on the margin row.
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type === 'line' && r.method === 'plug' && hasValue(r.target)) {
        const sub = rows.slice(i + 1).find(x => x.type === 'subtotal');
        const margin = sub ? rows.find(x => x.type === 'margin' && x.refId === sub.id) : null;
        if (margin && !margin.driverId) {
          margin.driverId = r.id;
          if (!hasValue(margin.target)) margin.target = r.target;
          if (margin.ramp === undefined) margin.ramp = true;
          r.method = 'manual';
          delete r.target;
          changed = true;
        }
      }
    }
    return changed ? { ...inputs, rows } : inputs;
  }

  const rows = makeDefaultRows();
  const set = (id, patch) => { const r = rows.find(x => x.id === id); if (r) Object.assign(r, patch); };
  set('revenue', { base: inputs.baseRevenue ?? '', rate: inputs.revenueGrowth ?? '' });
  // These legacy models drove opex to a target operating margin, so re-create that
  // explicit coupling on the margin row (the new default leaves it uncoupled).
  if (hasValue(inputs.targetOpMargin)) {
    set('opex', { method: 'manual', base: inputs.baseOpex ?? '', rate: '' });
    set('opmargin', { driverId: 'opex', target: inputs.targetOpMargin, ramp: true });
  } else {
    set('opex', { base: inputs.baseOpex ?? '' });
  }
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

  // Margin-driven coupling: a margin row with a driverId + target back-solves that
  // line so the running income after it ÷ revenue hits the target. lineId → {target,ramp}.
  const drivenTargets = {};
  for (const r of rows) {
    if (r.type === 'margin' && r.driverId && hasValue(r.target)) {
      drivenTargets[r.driverId] = { target: p(r.target), ramp: r.ramp !== false };
    }
  }

  // Single top-down pass, carrying a running accumulator (the income statement).
  const valuesById = {};
  const acc = YEARS.map(() => 0);
  const computedRows = [];

  for (const r of rows) {
    let vals = YEARS.map(() => 0);

    if (r.type === 'line') {
      if (r === revRow) {
        vals = revenue.slice();
      } else if (drivenTargets[r.id] || r.method === 'plug') {
        // Back-solve this line so the running margin (acc ÷ revenue) ramps from its
        // implied year-0 level (set by the line's year-0 value) to the target by year
        // 5. The target comes from the driving margin row, or — for legacy models —
        // from the line's own `target`.
        const d = drivenTargets[r.id];
        const target = d ? d.target : p(r.target);
        const ramp = d ? d.ramp : true;
        const rev0 = revenue[0] || 0;
        const marginStart = rev0 ? (acc[0] - p(r.base)) / rev0 : 0;
        const m = ramp ? rampSeries(marginStart, target) : YEARS.map(() => target);
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
