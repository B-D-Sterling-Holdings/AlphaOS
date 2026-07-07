export const RISK_FACTORS = ['Volatility', 'Regulatory', 'Disruption', 'Valuation', 'Earnings Quality'];

export const DEFAULT_RISK_FACTOR_WEIGHTS = [0.9, 0.3, 0.7, 0.6, 0.8];

const createId = () => globalThis.crypto?.randomUUID?.() || `row-${Math.random().toString(36).slice(2)}`;

export const createAllocationRow = (overrides = {}) => ({
  id: createId(),
  ticker: '',
  expectedReturn: '',
  factorExposures: RISK_FACTORS.map(() => ''),
  userWeight: '',
  ...overrides,
});

// New tenants start with a blank optimizer: empty rows plus CASH for constraints.
export const createDefaultAllocations = () => [
  ...Array.from({ length: 6 }, () => createAllocationRow()),
  createAllocationRow({
    ticker: 'CASH',
    expectedReturn: '0',
    factorExposures: RISK_FACTORS.map(() => 0),
    userWeight: '',
  }),
];

export const parseNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatCurrency = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export const createRebalanceRow = (overrides = {}) => ({
  id: createId(),
  ticker: '',
  currentValue: '',
  targetWeight: '',
  ...overrides,
});

// Start the rebalancer empty when there is nothing to load.
export const createDefaultRebalanceHoldings = () => [createRebalanceRow()];

// --- Allocation schemes ---------------------------------------------------
// A "scheme" is the shared spine of the allocation workflow: the target weights
// the analyst types in the Optimizer, carried through Market Confidence (where a
// regime overlay may adjust them) into the Rebalancer, and surfaced as a dated,
// read-only history on the Strategic Hub.

// Pull the Weight column (userWeight) into a { TICKER: pct } map, incl CASH.
export const buildSchemeWeights = (allocations) => {
  const weights = {};
  for (const row of allocations || []) {
    const ticker = (row.ticker || '').trim().toUpperCase();
    if (!ticker) continue;
    weights[ticker] = parseNumber(row.userWeight);
  }
  return weights;
};

// Build a fresh scheme snapshot from the Optimizer's typed weights.
export const createAllocationScheme = (allocations, overrides = {}) => ({
  id: createId(),
  createdAt: new Date().toISOString(),
  baseWeights: buildSchemeWeights(allocations),
  adjustedWeights: null,
  regimeScore: null,
  stage: 'confidence',
  ...overrides,
});

// The weights to display / rebalance against: regime-adjusted if present, else base.
export const schemeEffectiveWeights = (scheme) =>
  (scheme && (scheme.adjustedWeights || scheme.baseWeights)) || {};

// Top-N weights (desc) for the minimal Strategic Hub card.
export const schemeTopWeights = (scheme, n = 5) =>
  Object.entries(schemeEffectiveWeights(scheme))
    .map(([ticker, weight]) => ({ ticker, weight: Number(weight) || 0 }))
    .filter((w) => w.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);

export const rebalanceExecutionPlan = ({
  currentValues,
  targetWeights,
  cash,
  transactionCostPct = 0,
  minInstructionThreshold = 1e-6,
}) => {
  const fee = Number(transactionCostPct);
  if (fee < 0 || fee >= 1) {
    throw new Error('transaction_cost_pct must be in [0, 1).');
  }

  const tickers = Array.from(
    new Set([...Object.keys(currentValues), ...Object.keys(targetWeights)])
  ).sort();
  const effectiveCash = Number.isFinite(cash) ? cash : Number(currentValues.CASH || 0);

  const current = {};
  tickers.forEach((ticker) => {
    if (ticker === 'CASH') return;
    current[ticker] = Number(currentValues[ticker] || 0);
  });

  const target = {};
  tickers.forEach((ticker) => {
    target[ticker] = Number(targetWeights[ticker] || 0);
  });

  const targetSum = Object.values(target).reduce((sum, value) => sum + value, 0);
  if (Math.abs(targetSum - 1) > 1e-6) {
    throw new Error(`Target weights must sum to 1.0; got ${targetSum.toFixed(6)}`);
  }

  const startingTotal = Object.values(current).reduce((sum, value) => sum + value, 0) + effectiveCash;
  const targetDollars = {};
  tickers.forEach((ticker) => {
    targetDollars[ticker] = target[ticker] * startingTotal;
  });
  const targetCash = targetDollars.CASH || 0;

  const deltas = {};
  tickers.forEach((ticker) => {
    if (ticker === 'CASH') return;
    deltas[ticker] = (targetDollars[ticker] || 0) - (current[ticker] || 0);
  });

  const toBuy = {};
  const toSell = {};
  Object.entries(deltas).forEach(([ticker, delta]) => {
    if (delta > minInstructionThreshold) toBuy[ticker] = delta;
    if (delta < -minInstructionThreshold) toSell[ticker] = -delta;
  });

  const steps = [];
  const buyUsed = {};
  const sellUsed = {};
  Object.keys(deltas).forEach((ticker) => {
    buyUsed[ticker] = 0;
    sellUsed[ticker] = 0;
  });

  const remainingBuyTotal = () => Object.values(toBuy).reduce((sum, value) => sum + value, 0);

  let cashOnHand = effectiveCash;

  if (remainingBuyTotal() > minInstructionThreshold && cashOnHand > minInstructionThreshold) {
    Object.keys(toBuy)
      .sort((a, b) => toBuy[b] - toBuy[a])
      .forEach((ticker) => {
        if (toBuy[ticker] <= minInstructionThreshold || cashOnHand <= minInstructionThreshold) return;
        const needed = toBuy[ticker] * (1 + fee);
        const useOutlay = Math.min(needed, cashOnHand);
        const netIncrease = useOutlay / (1 + fee);
        if (netIncrease <= minInstructionThreshold) return;
        toBuy[ticker] -= netIncrease;
        buyUsed[ticker] += netIncrease;
        cashOnHand -= useOutlay;
        steps.push({ type: 'buy', text: `Buy ${formatCurrency(netIncrease)} of ${ticker}.` });
      });
  }

  const deltaCash = targetCash - cashOnHand;
  let proceedsNeededForBuys = 0;
  if (remainingBuyTotal() > minInstructionThreshold) {
    const totalBuyNeeded = remainingBuyTotal();
    proceedsNeededForBuys = totalBuyNeeded * (1 + fee);
  }

  let totalCashProceedsNeeded = Math.max(0, proceedsNeededForBuys + Math.max(0, deltaCash));

  if (totalCashProceedsNeeded > minInstructionThreshold) {
    Object.keys(toSell)
      .sort((a, b) => toSell[b] - toSell[a])
      .forEach((ticker) => {
        if (totalCashProceedsNeeded <= minInstructionThreshold) return;
        if (toSell[ticker] <= minInstructionThreshold) return;
        const maxSellNotional = toSell[ticker];
        const maxCashFromTicker = maxSellNotional * (1 - fee);
        const sellCash = Math.min(maxCashFromTicker, totalCashProceedsNeeded);
        const sellNotional = sellCash / (1 - fee);

        toSell[ticker] -= sellNotional;
        sellUsed[ticker] += sellNotional;
        cashOnHand += sellCash;
        totalCashProceedsNeeded -= sellCash;
        steps.push({ type: 'sell', text: `Sell ${formatCurrency(sellNotional)} of ${ticker}.` });

        if (remainingBuyTotal() > minInstructionThreshold && cashOnHand > minInstructionThreshold) {
          Object.keys(toBuy)
            .sort((a, b) => toBuy[b] - toBuy[a])
            .forEach((buyTicker) => {
              if (toBuy[buyTicker] <= minInstructionThreshold || cashOnHand <= minInstructionThreshold) return;
              const neededOutlay = toBuy[buyTicker] * (1 + fee);
              const useOutlay = Math.min(neededOutlay, cashOnHand);
              const netIncrease = useOutlay / (1 + fee);
              if (netIncrease <= minInstructionThreshold) return;
              toBuy[buyTicker] -= netIncrease;
              buyUsed[buyTicker] += netIncrease;
              cashOnHand -= useOutlay;
              steps.push({ type: 'buy', text: `Buy ${formatCurrency(netIncrease)} of ${buyTicker}.` });
            });
        }
      });
  }

  if (remainingBuyTotal() > minInstructionThreshold) {
    steps.push({ type: 'note', text: 'Warning: Not enough funding from overweights or CASH to complete all buys.' });
  }

  const deltaCashFinal = targetCash - cashOnHand;
  if (deltaCashFinal < -minInstructionThreshold && remainingBuyTotal() <= minInstructionThreshold) {
    steps.push({
      type: 'note',
      text: `Note: Ending CASH ${formatCurrency(cashOnHand)} exceeds target by ${formatCurrency(-deltaCashFinal)}. (Small drift retained.)`,
    });
  }

  const finalValues = {};
  Object.keys(deltas).forEach((ticker) => {
    finalValues[ticker] = (current[ticker] || 0) + (buyUsed[ticker] || 0) - (sellUsed[ticker] || 0);
  });
  finalValues.CASH = cashOnHand;

  const finalTotal = Object.values(finalValues).reduce((sum, value) => sum + value, 0);
  const finalWeights = {};
  Object.entries(finalValues).forEach(([ticker, value]) => {
    finalWeights[ticker] = finalTotal > 0 ? value / finalTotal : 0;
  });

  const buySummary = {};
  const sellSummary = {};
  Object.entries(buyUsed).forEach(([ticker, value]) => {
    if (value > minInstructionThreshold) buySummary[ticker] = value;
  });
  Object.entries(sellUsed).forEach(([ticker, value]) => {
    if (value > minInstructionThreshold) sellSummary[ticker] = value;
  });

  const consolidatedSteps = [
    ...Object.entries(sellSummary)
      .sort(([, a], [, b]) => b - a)
      .map(([ticker, value]) => ({ type: 'sell', text: `Sell ${formatCurrency(value)} of ${ticker}.` })),
    ...Object.entries(buySummary)
      .sort(([, a], [, b]) => b - a)
      .map(([ticker, value]) => ({ type: 'buy', text: `Buy ${formatCurrency(value)} of ${ticker}.` })),
    ...steps.filter((step) => step.type === 'note'),
  ];

  return {
    steps: consolidatedSteps,
    buyDollars: buySummary,
    sellDollars: sellSummary,
    currentValues: current,
    startingTotal,
    finalValues,
    finalWeights,
  };
};

export function buildRebalancePlanFromRows({
  holdings,
  cash,
  targetCashPercent,
  transactionCostPct = 0,
  totalTargetPercent,
}) {
  const filtered = holdings.filter((row) => row.ticker.trim() || row.currentValue || row.targetWeight);
  if (filtered.length === 0) {
    return { error: 'Add at least one holding to generate a plan.' };
  }

  const currentValues = {};
  const targetWeights = {};
  const problems = [];

  filtered.forEach((row, index) => {
    const ticker = row.ticker.trim().toUpperCase();
    const currentValue = parseNumber(row.currentValue);
    const targetPercent = parseNumber(row.targetWeight);
    if (!ticker) problems.push(`Row ${index + 1}: add a ticker.`);
    if (currentValue < 0) problems.push(`Row ${index + 1}: current value must be positive.`);
    if (targetPercent < 0) problems.push(`Row ${index + 1}: target percent must be positive.`);
    if (ticker) {
      currentValues[ticker] = (currentValues[ticker] || 0) + currentValue;
      targetWeights[ticker] = (targetWeights[ticker] || 0) + targetPercent / 100;
    }
  });

  const cashValue = parseNumber(cash);
  const cashTarget = parseNumber(targetCashPercent) / 100;
  if (cashValue < 0) problems.push('Cash balance must be positive.');
  if (cashTarget < 0) problems.push('Target cash percent must be positive.');
  if (cashTarget > 0) targetWeights.CASH = cashTarget;
  if (problems.length > 0) return { error: problems.join(' ') };

  if (Math.abs(totalTargetPercent - 100) > 0.01) {
    return { error: `Target percentages must sum to 100%. Current total: ${totalTargetPercent.toFixed(2)}%.` };
  }

  try {
    return {
      plan: rebalanceExecutionPlan({
        currentValues,
        targetWeights,
        cash: cashValue,
        transactionCostPct: parseNumber(transactionCostPct) / 100,
      }),
    };
  } catch (err) {
    return { error: err.message };
  }
}

export function calculateRebalanceTaxBreakdown(plan, taxInputs) {
  if (!plan) return { rows: [], totalTax: 0, totalGains: 0 };

  const rows = Object.entries(plan.sellDollars).map(([ticker, plannedSold]) => {
    const inputs = taxInputs[ticker] || {};
    const initialValue = parseNumber(inputs.initialValue);
    const finalValue = parseNumber(inputs.finalValue);
    const amountSoldInput = inputs.amountSold === '' || inputs.amountSold === undefined ? plannedSold : inputs.amountSold;
    const amountSold = parseNumber(amountSoldInput);
    const taxRate = parseNumber(inputs.taxRate);
    const gainFraction = finalValue ? (finalValue - initialValue) / finalValue : 0;
    const gainRealized = amountSold * gainFraction;
    const taxOwed = gainRealized * (taxRate / 100);
    return { ticker, initialValue, finalValue, amountSold, taxRate, gainRealized, taxOwed };
  });

  const totalTax = rows.reduce((sum, row) => sum + row.taxOwed, 0);
  const totalGains = rows.reduce((sum, row) => sum + row.gainRealized, 0);
  return { rows, totalTax, totalGains };
}

export function createRebalanceTaxInputs(plan, previousInputs, costBasisByTicker) {
  if (!plan) return {};
  const next = {};
  Object.entries(plan.sellDollars).forEach(([ticker, value]) => {
    const existing = previousInputs[ticker] || {};
    const currentValue = plan.currentValues?.[ticker];
    const costBasis = costBasisByTicker[ticker];
    next[ticker] = {
      initialValue: existing.initialValue ?? (Number.isFinite(costBasis) ? costBasis.toFixed(2) : ''),
      finalValue: existing.finalValue ?? (Number.isFinite(currentValue) ? currentValue.toFixed(2) : ''),
      amountSold: existing.amountSold ?? value.toFixed(2),
      taxRate: existing.taxRate ?? '20',
    };
  });
  return next;
}

export function updateRebalanceTaxInputValue(taxInputs, ticker, field, value) {
  const current = taxInputs[ticker] || {};
  const updated = { ...current, [field]: value };
  const finalValue = parseNumber(field === 'finalValue' ? value : updated.finalValue);
  const amountSold = parseNumber(field === 'amountSold' ? value : updated.amountSold);
  if (finalValue > 0 && amountSold > finalValue) updated.amountSold = `${finalValue}`;
  return { ...taxInputs, [ticker]: updated };
}

// Standard normal CDF via Abramowitz & Stegun rational approximation.
export const normalCDF = (x) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
};

export function calculateVolatilityScores(vols, { stdFloor = 0.05, compression = 0.5 } = {}) {
  const entries = Object.entries(vols || {});
  if (entries.length === 0) return {};
  if (entries.length < 2) {
    return Object.fromEntries(entries.map(([ticker]) => [ticker, 0.5]));
  }

  const volValues = entries.map(([, vol]) => vol);
  const mean = volValues.reduce((sum, value) => sum + value, 0) / volValues.length;
  const variance = volValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (volValues.length - 1);
  const std = Math.max(Math.sqrt(variance), stdFloor);

  const scores = {};
  for (const [ticker, vol] of entries) {
    const z = std > 0 ? (vol - mean) / std : 0;
    scores[ticker] = normalCDF(z * compression);
  }
  return scores;
}

const colorScale = [
  [215, 25, 28],
  [253, 174, 97],
  [255, 255, 191],
  [171, 221, 164],
  [43, 131, 186],
];

const lerp = (start, end, t) => start + (end - start) * t;

export const getColorFromScale = (value) => {
  const clamped = Math.min(1, Math.max(0, value));
  const segment = (colorScale.length - 1) * clamped;
  const index = Math.floor(segment);
  const ratio = segment - index;
  const [r1, g1, b1] = colorScale[index];
  const [r2, g2, b2] = colorScale[Math.min(index + 1, colorScale.length - 1)];
  return `rgb(${Math.round(lerp(r1, r2, ratio))}, ${Math.round(lerp(g1, g2, ratio))}, ${Math.round(lerp(b1, b2, ratio))})`;
};

const zeroMatrix = (size) => Array.from({ length: size }, () => Array.from({ length: size }, () => 0));

export const traceOf = (mat) => {
  let tr = 0;
  for (let i = 0; i < mat.length; i++) tr += mat[i][i];
  return tr;
};

const traceNormalize = (mat, label, logger = console) => {
  const traceEpsilon = 1e-12;
  const tr = traceOf(mat);
  if (tr <= traceEpsilon) {
    logger.warn?.(`Trace of ${label} is near-zero (${tr}); skipping normalization.`);
    return mat.map(row => [...row]);
  }
  return mat.map(row => row.map(v => v / tr));
};

const symmetrize = (matrix) => {
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      const avg = 0.5 * (matrix[i][j] + matrix[j][i]);
      matrix[i][j] = avg;
      matrix[j][i] = avg;
    }
  }
  return matrix;
};

function mapReturnCovariance({ assets, nonCashTickers, covarianceData, logger = console }) {
  const sigmaReturn = zeroMatrix(assets.length);
  if (!covarianceData?.matrix || !covarianceData?.tickers) return sigmaReturn;

  const retTickers = covarianceData.tickers;
  const retMatrix = covarianceData.matrix;
  const retIdx = {};
  retTickers.forEach((ticker, index) => { retIdx[ticker] = index; });

  const missing = nonCashTickers.filter(ticker => retIdx[ticker] === undefined);
  if (missing.length > 0) {
    logger.warn?.('Return covariance: Yahoo did not return data for:', missing.join(', '));
  }
  logger.log?.(
    'Return covariance: received data for',
    retTickers.length,
    'of',
    nonCashTickers.length,
    'tickers:',
    retTickers.join(', ')
  );

  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      const ri = retIdx[assets[i]];
      const rj = retIdx[assets[j]];
      if (ri !== undefined && rj !== undefined) {
        sigmaReturn[i][j] = retMatrix[ri][rj];
      }
    }
  }

  return symmetrize(sigmaReturn);
}

function buildCompositeCovariance({ assets, factorMatrix, factorWeights }) {
  const factorCount = RISK_FACTORS.length;
  const exposureMatrix = factorMatrix.map((row, rowIndex) => {
    if (assets[rowIndex] === 'CASH') return Array.from({ length: factorCount }, () => 0);
    return [...row];
  });

  const factorMeans = Array.from({ length: factorCount }, (_, idx) =>
    exposureMatrix.reduce((sum, row) => sum + row[idx], 0) / exposureMatrix.length
  );

  const centeredFactors = exposureMatrix.map((row) =>
    row.map((value, idx) => value - factorMeans[idx])
  );

  const covarianceFactors = zeroMatrix(factorCount);
  const denominator = Math.max(exposureMatrix.length - 1, 1);
  for (let i = 0; i < factorCount; i += 1) {
    for (let j = 0; j < factorCount; j += 1) {
      covarianceFactors[i][j] =
        centeredFactors.reduce((sum, row) => sum + row[i] * row[j], 0) / denominator;
    }
  }

  const weightedFactors = covarianceFactors.map((row, i) =>
    row.map((value, j) => value * factorWeights[i] * factorWeights[j])
  );

  const compositeOnlyMatrix = zeroMatrix(assets.length);
  for (let i = 0; i < assets.length; i += 1) {
    for (let j = 0; j < assets.length; j += 1) {
      let sum = 0;
      for (let k = 0; k < factorCount; k += 1) {
        for (let l = 0; l < factorCount; l += 1) {
          sum += exposureMatrix[i][k] * weightedFactors[k][l] * exposureMatrix[j][l];
        }
      }
      compositeOnlyMatrix[i][j] = sum;
    }
  }

  return {
    factorCount,
    exposureMatrix,
    covarianceFactors,
    weightedFactors,
    compositeOnlyMatrix,
  };
}

function blendCovariance({ sigmaReturn, compositeOnlyMatrix, lambda, logger }) {
  const sigmaReturnTilde = traceNormalize(sigmaReturn, 'Sigma_return', logger);
  const sigmaCompositeTilde = traceNormalize(compositeOnlyMatrix, 'Sigma_composite', logger);

  const compositeMatrix = zeroMatrix(sigmaReturn.length);
  for (let i = 0; i < sigmaReturn.length; i += 1) {
    for (let j = 0; j < sigmaReturn.length; j += 1) {
      compositeMatrix[i][j] = lambda * sigmaReturnTilde[i][j] + (1 - lambda) * sigmaCompositeTilde[i][j];
    }
  }

  return {
    sigmaReturnTilde,
    sigmaCompositeTilde,
    sigmaHybrid: symmetrize(compositeMatrix),
  };
}

function formatWeightsForAssets(assets, weights) {
  return weights
    .map((weight, idx) => ({ ticker: assets[idx], weight }))
    .sort((a, b) => b.weight - a.weight);
}

export async function runAllocationSimulation({
  allocations,
  riskFactorWeights,
  riskFreeRate,
  minWeight,
  maxWeight,
  cashMinWeight,
  cashMaxWeight,
  numPortfolios,
  covLambda,
  fetchReturnCovariance,
  random = Math.random,
  logger = console,
}) {
  const filtered = allocations.filter(
    (row) =>
      row.ticker.trim() ||
      row.expectedReturn ||
      row.userWeight ||
      row.factorExposures.some((value) => value)
  );

  if (filtered.length === 0) {
    return { error: 'Add at least one asset to run the simulation.' };
  }

  const assets = [];
  const expectedReturns = [];
  const factorMatrix = [];
  const userWeights = [];
  const problems = [];

  filtered.forEach((row, index) => {
    const ticker = row.ticker.trim().toUpperCase();
    const expectedReturn = parseNumber(row.expectedReturn) / 100;
    const exposures = row.factorExposures.map((entry) => parseNumber(entry));
    const userWeight = parseNumber(row.userWeight) / 100;

    if (!ticker) problems.push(`Row ${index + 1}: add a ticker.`);
    if (expectedReturn < 0) problems.push(`Row ${index + 1}: expected return must be positive.`);
    if (exposures.some((value) => value < 0)) problems.push(`Row ${index + 1}: factor exposures must be positive.`);
    if (userWeight < 0) problems.push(`Row ${index + 1}: user weight must be positive.`);

    if (ticker) {
      assets.push(ticker);
      expectedReturns.push(expectedReturn);
      factorMatrix.push(exposures);
      userWeights.push(userWeight);
    }
  });

  const riskFree = parseNumber(riskFreeRate) / 100;
  const minW = parseNumber(minWeight) / 100;
  const maxW = parseNumber(maxWeight) / 100;
  const cashMinW = parseNumber(cashMinWeight) / 100;
  const cashMaxW = parseNumber(cashMaxWeight) / 100;
  const portfoliosTarget = Math.max(100, Math.round(parseNumber(numPortfolios)));

  if (!assets.includes('CASH')) problems.push('Include a CASH row to apply cash weight constraints.');
  if (minW < 0 || maxW <= 0 || minW > maxW) problems.push('Stock weight limits are invalid.');
  if (cashMinW < 0 || cashMaxW < 0 || cashMinW > cashMaxW) problems.push('Cash weight limits are invalid.');

  const factorWeights = riskFactorWeights.map((value) => parseNumber(value));
  if (factorWeights.length !== RISK_FACTORS.length || factorWeights.some((value) => value < 0)) {
    problems.push('Risk factor weights must be non-negative for each factor.');
  }

  const userWeightTotal = userWeights.reduce((sum, value) => sum + value, 0);
  if (userWeightTotal > 0 && Math.abs(userWeightTotal - 1) > 0.001) {
    problems.push(`User-defined weights must sum to 100%. Current total: ${(userWeightTotal * 100).toFixed(2)}%.`);
  }

  if (problems.length > 0) {
    return { error: problems.join(' ') };
  }

  const cashIndex = assets.indexOf('CASH');
  if (cashIndex === -1) {
    return { error: 'Include a CASH row to apply cash weight constraints.' };
  }

  const {
    factorCount,
    exposureMatrix,
    covarianceFactors,
    weightedFactors,
    compositeOnlyMatrix,
  } = buildCompositeCovariance({ assets, factorMatrix, factorWeights });

  const nonCashTickers = assets.filter((ticker) => ticker !== 'CASH');
  let sigmaReturn = zeroMatrix(assets.length);

  if (nonCashTickers.length >= 2 && fetchReturnCovariance) {
    try {
      const covarianceData = await fetchReturnCovariance(nonCashTickers);
      sigmaReturn = mapReturnCovariance({ assets, nonCashTickers, covarianceData, logger });
    } catch (err) {
      logger.error?.('Failed to fetch return covariance; Sigma_return will be zero:', err);
    }
  }

  const lam = Math.min(1, Math.max(0, parseNumber(covLambda)));
  const { sigmaReturnTilde, sigmaCompositeTilde, sigmaHybrid } = blendCovariance({
    sigmaReturn,
    compositeOnlyMatrix,
    lambda: lam,
    logger,
  });

  const standaloneRisk = {};
  const fwSum = factorWeights.reduce((sum, weight) => sum + weight, 0);
  assets.forEach((ticker, idx) => {
    const exposures = factorMatrix[idx];
    let score = 0;
    for (let k = 0; k < factorCount; k += 1) {
      score += exposures[k] * factorWeights[k];
    }
    standaloneRisk[ticker] = fwSum > 0 ? score / fwSum : 0;
  });

  const simulations = [];
  let samplesGenerated = 0;
  let attempts = 0;
  const maxAttempts = portfoliosTarget * 50;

  while (samplesGenerated < portfoliosTarget && attempts < maxAttempts) {
    attempts += 1;
    const rawWeights = assets.map(() => random());
    const total = rawWeights.reduce((sum, value) => sum + value, 0);
    const weights = rawWeights.map((value) => value / total);

    const cashWeight = weights[cashIndex];
    const otherWeights = weights.filter((_, idx) => idx !== cashIndex);

    const stockConstraintsMet =
      otherWeights.every((value) => value >= minW && value <= maxW) &&
      cashWeight >= cashMinW &&
      cashWeight <= cashMaxW;

    if (!stockConstraintsMet) continue;

    const expectedReturn = weights.reduce(
      (sum, weight, idx) => sum + weight * expectedReturns[idx],
      0
    );

    let variance = 0;
    for (let i = 0; i < weights.length; i += 1) {
      for (let j = 0; j < weights.length; j += 1) {
        variance += weights[i] * sigmaHybrid[i][j] * weights[j];
      }
    }
    const volatility = Math.sqrt(Math.max(variance, 0));
    const sharpe = volatility > 0 ? (expectedReturn - riskFree) / volatility : 0;

    simulations.push({ weights, expectedReturn, volatility, sharpe });
    samplesGenerated += 1;
  }

  if (simulations.length === 0) {
    return { error: 'Unable to generate portfolios with the provided constraints.' };
  }

  const maxSharpe = simulations.reduce((best, current) =>
    current.sharpe > best.sharpe ? current : best
  );
  const minVol = simulations.reduce((best, current) =>
    current.volatility < best.volatility ? current : best
  );

  let minSharpeValue = Infinity, maxSharpeValue = -Infinity;
  let minVolValue = Infinity, maxVolValue = -Infinity;
  for (let i = 0; i < simulations.length; i++) {
    const s = simulations[i].sharpe, v = simulations[i].volatility;
    if (s < minSharpeValue) minSharpeValue = s;
    if (s > maxSharpeValue) maxSharpeValue = s;
    if (v < minVolValue) minVolValue = v;
    if (v > maxVolValue) maxVolValue = v;
  }

  const getCompositeRatio = (sharpe) =>
    maxSharpeValue === minSharpeValue ? 0 : (sharpe - minSharpeValue) / (maxSharpeValue - minSharpeValue);
  const getCompositeRisk = (volatility) =>
    maxVolValue === minVolValue ? 0 : (volatility - minVolValue) / (maxVolValue - minVolValue);

  const buildHoverLines = (weights, expectedReturn, volatility, sharpe) => [
    `Composite Ratio: ${getCompositeRatio(sharpe).toFixed(3)}`,
    `Return: ${(expectedReturn * 100).toFixed(2)}%`,
    `Volatility: ${(volatility * 100).toFixed(2)}%`,
    '',
    ...weights.map((weight, idx) => `${assets[idx]}: ${(weight * 100).toFixed(2)}%`),
  ];

  const simulationPoints = simulations.map((item) => {
    const compositeRatio = getCompositeRatio(item.sharpe);
    return {
      x: getCompositeRisk(item.volatility),
      y: item.expectedReturn,
      hoverLines: buildHoverLines(item.weights, item.expectedReturn, item.volatility, item.sharpe),
      color: getColorFromScale(compositeRatio),
    };
  });

  const buildStarPoint = (item, label) => ({
    x: getCompositeRisk(item.volatility),
    y: item.expectedReturn,
    hoverLines: buildHoverLines(item.weights, item.expectedReturn, item.volatility, item.sharpe),
    label,
    compositeRatio: getCompositeRatio(item.sharpe),
  });

  const computeUserMetrics = () => {
    if (userWeightTotal <= 0) return null;
    let userVariance = 0;
    for (let i = 0; i < userWeights.length; i += 1) {
      for (let j = 0; j < userWeights.length; j += 1) {
        userVariance += userWeights[i] * sigmaHybrid[i][j] * userWeights[j];
      }
    }
    const userReturn = userWeights.reduce(
      (sum, weight, idx) => sum + weight * expectedReturns[idx],
      0
    );
    const userVolatility = Math.sqrt(Math.max(userVariance, 0));
    const userSharpe = userVolatility > 0 ? (userReturn - riskFree) / userVolatility : 0;
    return {
      expectedReturn: userReturn,
      volatility: userVolatility,
      sharpe: userSharpe,
      weights: formatWeightsForAssets(assets, userWeights),
      rawWeights: userWeights,
    };
  };

  const userMetrics = computeUserMetrics();
  if (userMetrics) {
    userMetrics.compositeRatio = getCompositeRatio(userMetrics.sharpe);
  }

  const starRadius = 22;
  const starBorderWidth = 4;
  const chartData = {
    datasets: [
      {
        label: 'Portfolio Simulations',
        data: simulationPoints.map((point) => ({ x: point.x, y: point.y, hoverLines: point.hoverLines })),
        backgroundColor: simulationPoints.map((point) => point.color),
        pointRadius: 4,
        order: 3,
      },
      {
        label: 'Max Composite Ratio',
        data: [buildStarPoint(maxSharpe, 'Max Composite Ratio')],
        backgroundColor: '#dc2626',
        pointRadius: starRadius,
        pointStyle: 'star',
        pointBorderWidth: starBorderWidth,
        pointBorderColor: '#dc2626',
        pointHoverRadius: starRadius + 4,
        order: 1,
      },
      {
        label: 'Min Volatility',
        data: [buildStarPoint(minVol, 'Min Volatility')],
        backgroundColor: '#2563eb',
        pointRadius: starRadius,
        pointStyle: 'star',
        pointBorderWidth: starBorderWidth,
        pointBorderColor: '#2563eb',
        pointHoverRadius: starRadius + 4,
        order: 1,
      },
    ],
  };

  if (userMetrics) {
    chartData.datasets.push({
      label: 'User-Defined Portfolio',
      data: [
        {
          x: getCompositeRisk(userMetrics.volatility),
          y: userMetrics.expectedReturn,
          hoverLines: buildHoverLines(
            userMetrics.rawWeights,
            userMetrics.expectedReturn,
            userMetrics.volatility,
            userMetrics.sharpe
          ),
          compositeRatio: getCompositeRatio(userMetrics.sharpe),
        },
      ],
      backgroundColor: '#16a34a',
      pointRadius: starRadius,
      pointStyle: 'star',
      pointBorderWidth: starBorderWidth,
      pointBorderColor: '#16a34a',
      pointHoverRadius: starRadius + 4,
      order: 1,
    });
  }

  const result = {
    totalSamples: simulations.length,
    maxSharpe: {
      ...maxSharpe,
      weights: formatWeightsForAssets(assets, maxSharpe.weights),
      compositeRatio: getCompositeRatio(maxSharpe.sharpe),
    },
    minVol: {
      ...minVol,
      weights: formatWeightsForAssets(assets, minVol.weights),
      compositeRatio: getCompositeRatio(minVol.sharpe),
    },
    userDefined: userMetrics,
    standaloneRisk,
    lambda: lam,
    marketCov: {
      assets,
      sigmaReturn,
      vols: assets.map((_, i) => Math.sqrt(Math.max(sigmaReturn[i][i], 0))),
      correlations: assets.map((_, i) =>
        assets.map((_, j) => {
          const vi = Math.sqrt(Math.max(sigmaReturn[i][i], 0));
          const vj = Math.sqrt(Math.max(sigmaReturn[j][j], 0));
          return vi > 0 && vj > 0 ? sigmaReturn[i][j] / (vi * vj) : 0;
        })
      ),
    },
    mathDiagnostics: {
      assets,
      factorCount,
      factorNames: RISK_FACTORS,
      factorWeights,
      exposureMatrix,
      covarianceFactors,
      weightedFactors,
      compositeOnlyMatrix,
      sigmaReturn,
      traceReturn: traceOf(sigmaReturn),
      traceComposite: traceOf(compositeOnlyMatrix),
      sigmaReturnTilde,
      sigmaCompositeTilde,
      lambda: lam,
      sigmaHybrid,
      traceHybrid: traceOf(sigmaHybrid),
      bestPortfolio: maxSharpe,
      expectedReturns,
      riskFree,
    },
  };

  return { result, chartData };
}
