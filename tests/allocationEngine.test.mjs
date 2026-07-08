import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRebalancePlanFromRows,
  calculateVolatilityScores,
  rebalanceExecutionPlan,
  rebalanceSharesPlan,
  runAllocationSimulation,
} from '../src/lib/allocationEngine.js';

test('calculateVolatilityScores handles sparse and cross-sectional inputs', () => {
  assert.deepEqual(calculateVolatilityScores({ AAA: 0.2 }), { AAA: 0.5 });

  const scores = calculateVolatilityScores({ LOW: 0.1, MID: 0.2, HIGH: 0.3 });
  assert.ok(scores.LOW < scores.MID);
  assert.ok(scores.MID < scores.HIGH);
  assert.ok(scores.MID > 0.45 && scores.MID < 0.55);
});

test('rebalanceExecutionPlan consolidates sells and buys while preserving total value', () => {
  const plan = rebalanceExecutionPlan({
    currentValues: { AAA: 1000, BBB: 1000 },
    targetWeights: { AAA: 0.25, BBB: 0.75 },
    cash: 0,
  });

  assert.deepEqual(plan.sellDollars, { AAA: 500 });
  assert.deepEqual(plan.buyDollars, { BBB: 500 });
  assert.equal(plan.steps.map((step) => step.type).join(','), 'sell,buy');
  assert.equal(plan.startingTotal, 2000);
  assert.equal(plan.finalValues.AAA, 500);
  assert.equal(plan.finalValues.BBB, 1500);
  assert.equal(plan.finalWeights.AAA, 0.25);
  assert.equal(plan.finalWeights.BBB, 0.75);
});

test('rebalanceSharesPlan floors then greedily fills leftover cash into underweight names', () => {
  const plan = rebalanceSharesPlan({
    currentValues: { AAA: 1000 },
    targetWeights: { AAA: 0.6, BBB: 0.4, CASH: 0 },
    prices: { AAA: 100, BBB: 30 },
    cash: 1000,
  });

  assert.equal(plan.mode, 'shares');
  // Total 2000. Naive rounding wants AAA=12, BBB=27 ($2010 — overspends).
  // Floor + greedy fill lands AAA=12, BBB=26 (feasible), remainder is $20 of cash.
  assert.deepEqual(plan.finalShares, { AAA: 12, BBB: 26 });
  assert.deepEqual(plan.buyShares, { AAA: 2, BBB: 26 });
  assert.equal(plan.buyDollars.AAA, 200);
  assert.equal(plan.buyDollars.BBB, 780);
  assert.equal(plan.endingCash, 20);
  assert.equal(plan.finalValues.AAA, 1200);
  assert.equal(plan.finalValues.BBB, 780);
});

test('rebalanceSharesPlan lets cash dip below target when it lowers overall tracking error', () => {
  const plan = rebalanceSharesPlan({
    currentValues: { AAA: 1000 },
    targetWeights: { AAA: 0.55, BBB: 0.4, CASH: 0.05 },
    prices: { AAA: 100, BBB: 30 },
    cash: 1000,
  });

  // Target cash 5% of 2000 = $100. Buying a 27th BBB share drops cash to $90
  // (below target) but lands BBB at 0.405 vs 0.39 — closer overall — so it's taken.
  assert.equal(plan.targetCash, 100);
  assert.deepEqual(plan.finalShares, { AAA: 11, BBB: 27 });
  assert.equal(plan.endingCash, 90);
  assert.ok(plan.finalWeights.CASH < 0.05);
});

test('rebalanceSharesPlan flags a missing share price', () => {
  assert.throws(
    () => rebalanceSharesPlan({
      currentValues: { AAA: 1000 },
      targetWeights: { AAA: 1 },
      prices: {},
      cash: 0,
    }),
    /Enter a share price for: AAA/
  );
});

test('buildRebalancePlanFromRows routes to the whole-share plan when enabled', () => {
  const result = buildRebalancePlanFromRows({
    holdings: [
      { ticker: 'AAA', currentValue: '1000', targetWeight: '60', price: '100' },
      { ticker: 'BBB', currentValue: '0', targetWeight: '40', price: '30' },
    ],
    cash: '1000',
    targetCashPercent: '0',
    transactionCostPct: '0',
    totalTargetPercent: 100,
    roundedShares: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.plan.mode, 'shares');
  assert.deepEqual(result.plan.buyShares, { AAA: 2, BBB: 26 });
});

test('buildRebalancePlanFromRows keeps row validation outside the UI component', () => {
  const missingTicker = buildRebalancePlanFromRows({
    holdings: [{ ticker: '', currentValue: '100', targetWeight: '100' }],
    cash: '0',
    targetCashPercent: '0',
    transactionCostPct: '0',
    totalTargetPercent: 100,
  });
  assert.match(missingTicker.error, /Row 1: add a ticker/);

  const valid = buildRebalancePlanFromRows({
    holdings: [{ ticker: 'AAA', currentValue: '100', targetWeight: '100' }],
    cash: '0',
    targetCashPercent: '0',
    transactionCostPct: '0',
    totalTargetPercent: 100,
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.plan.finalValues.AAA, 100);
});

test('runAllocationSimulation returns the same page-facing result and chart shapes', async () => {
  const randomValues = [0.2, 0.3, 0.5, 0.4, 0.4, 0.2, 0.6, 0.2, 0.2];
  let randomIndex = 0;
  const random = () => {
    const value = randomValues[randomIndex % randomValues.length];
    randomIndex += 1;
    return value;
  };

  let requestedTickers = null;
  const { error, result, chartData } = await runAllocationSimulation({
    allocations: [
      {
        ticker: 'AAA',
        expectedReturn: '10',
        userWeight: '50',
        factorExposures: ['0.2', '0.1', '0.3', '0.4', '0.2'],
      },
      {
        ticker: 'BBB',
        expectedReturn: '8',
        userWeight: '30',
        factorExposures: ['0.7', '0.4', '0.5', '0.2', '0.8'],
      },
      {
        ticker: 'CASH',
        expectedReturn: '0',
        userWeight: '20',
        factorExposures: [0, 0, 0, 0, 0],
      },
    ],
    riskFactorWeights: [0.9, 0.3, 0.7, 0.6, 0.8],
    riskFreeRate: '4',
    minWeight: '0',
    maxWeight: '100',
    cashMinWeight: '0',
    cashMaxWeight: '100',
    numPortfolios: '100',
    covLambda: '0.3',
    fetchReturnCovariance: async (tickers) => {
      requestedTickers = tickers;
      return {
        tickers: ['AAA', 'BBB'],
        matrix: [
          [0.04, 0.01],
          [0.01, 0.09],
        ],
      };
    },
    random,
    logger: { log() {}, warn() {}, error() {} },
  });

  assert.equal(error, undefined);
  assert.deepEqual(requestedTickers, ['AAA', 'BBB']);
  assert.equal(result.totalSamples, 100);
  assert.equal(result.maxSharpe.weights.length, 3);
  assert.equal(result.minVol.weights.length, 3);
  assert.equal(result.userDefined.weights.length, 3);
  assert.equal(result.mathDiagnostics.factorNames.length, 5);
  assert.equal(chartData.datasets.length, 4);
  assert.equal(chartData.datasets[0].data.length, 100);
});
