export const DEFAULT_VALUATION_INPUTS = {
  ticker: '',
  sharePrice: '',
  targetPE: '',
  revenueGrowth: '',
  targetOpMargin: '',
  netShareDilution: '',
  dividendGrowth: '',
  currentDividend: '',
  taxRate: 0.21,
  baseRevenue: '',
  baseOpex: '',
  baseNonOpIncome: '',
  baseTaxExpense: '',
  baseShares: '',
  baseYear: 2026,
};

const p = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v))) ? 0 : Number(v);

const hasValue = (v) => v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v));

export function computeValuationModel(inputs) {
  const sharePrice = p(inputs?.sharePrice);
  const targetPE = p(inputs?.targetPE);
  const revG = p(inputs?.revenueGrowth);
  const targetMargin = p(inputs?.targetOpMargin);
  const dilution = p(inputs?.netShareDilution);
  const divG = p(inputs?.dividendGrowth);
  const curDiv = p(inputs?.currentDividend);
  const taxRate = p(inputs?.taxRate);
  const baseYear = p(inputs?.baseYear);
  const baseRev = p(inputs?.baseRevenue);
  const baseOpex = p(inputs?.baseOpex);
  const baseNonOp = p(inputs?.baseNonOpIncome);
  const baseTax = p(inputs?.baseTaxExpense);
  const baseShares = p(inputs?.baseShares);

  const years = [0, 1, 2, 3, 4, 5];
  const yearLabels = years.map(i => baseYear + i);

  const revenue = [baseRev];
  for (let i = 1; i <= 5; i++) revenue.push(revenue[i - 1] * (1 + revG));
  // TTM (year 0) operating margin is implied by base revenue and base opex;
  // each forecast year ramps linearly from that toward the target margin.
  const baseMargin = baseRev !== 0 ? (baseRev - baseOpex) / baseRev : 0;
  const opMargin = years.map(i => i === 0 ? baseMargin : baseMargin + (i / 5) * (targetMargin - baseMargin));
  const opIncome = years.map(i => i === 0 ? (baseRev - baseOpex) : revenue[i] * opMargin[i]);
  const opex = years.map(i => i === 0 ? baseOpex : revenue[i] - opIncome[i]);
  const nonOpIncome = [baseNonOp, 0, 0, 0, 0, 0];
  const taxExpense = [baseTax];
  for (let i = 1; i <= 5; i++) taxExpense.push(opIncome[i] * taxRate);
  const netIncome = years.map(i => opIncome[i] - taxExpense[i] + nonOpIncome[i]);
  const shares = [baseShares];
  for (let i = 1; i <= 5; i++) shares.push(shares[i - 1] * (1 + dilution));
  const eps = years.map(i => shares[i] !== 0 ? netIncome[i] / shares[i] : 0);
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
    yearLabels, revenue, opex, opIncome, opMargin, nonOpIncome,
    taxExpense, netIncome, shares, eps, epsGrowth, priceArr, divShares,
    totalCAGRNoDivs, totalCAGR, priceTarget, targetPrice5, priceCAGR,
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
