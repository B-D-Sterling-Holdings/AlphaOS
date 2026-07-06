import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRebalancePlanFromRows,
  calculateVolatilityScores,
  rebalanceExecutionPlan,
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
