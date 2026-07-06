import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDeriskOverlay,
  computePerStockRisk,
  drawdowns,
  rollingSharpe,
} from '../src/lib/macroRegimeLogic.js';

test('computePerStockRisk returns weighted average factor exposure by ticker', () => {
  const risks = computePerStockRisk([
    { ticker: 'AAA', factorExposures: [1, 0, 0.5] },
    { ticker: 'BBB', factorExposures: [0, 1, 0.5] },
  ], [0.5, 0.25, 0.25]);

  assert.equal(risks.AAA, 0.625);
  assert.equal(risks.BBB, 0.375);
});

test('computeDeriskOverlay returns base weights when no macro signal exists', () => {
  const baseWeights = { AAA: 60, BBB: 35, CASH: 5 };
  const overlay = computeDeriskOverlay({
    baseWeights,
    volScores: { AAA: 0.4, BBB: 0.2 },
    compRisks: { AAA: 0.8, BBB: 0.1 },
    M: null,
  });

  assert.deepEqual(overlay.weights, baseWeights);
  assert.equal(overlay.trimmed, false);
  assert.equal(overlay.D, 0);
});

test('computeDeriskOverlay leaves weights unchanged above derisk threshold', () => {
  const overlay = computeDeriskOverlay({
    baseWeights: { AAA: 60, BBB: 35, CASH: 5 },
    volScores: { AAA: 0.4, BBB: 0.2 },
    compRisks: { AAA: 0.8, BBB: 0.1 },
    M: 0.9,
  });

  assert.deepEqual(overlay.weights, { AAA: 60, BBB: 35, CASH: 5 });
  assert.equal(overlay.trimmed, false);
  assert.equal(overlay.D, 0);
});

test('computeDeriskOverlay trims aggressive names in risk-off regimes', () => {
  const overlay = computeDeriskOverlay({
    baseWeights: { AGG: 60, DEF: 35, CASH: 5 },
    volScores: { AGG: 0.5, DEF: 0.1 },
    compRisks: { AGG: 0.9, DEF: 0.1 },
    M: 0.2,
  });

  assert.equal(overlay.trimmed, true);
  assert.ok(overlay.D > 0);
  assert.ok(overlay.weights.AGG < 60);
  assert.ok(overlay.weights.DEF > 35);
  assert.equal(
    Number((overlay.weights.AGG + overlay.weights.DEF + overlay.weights.CASH).toFixed(2)),
    100
  );
});

test('drawdowns and rollingSharpe keep chart calculations outside the page', () => {
  const rows = [
    { equity: 100, ret: 0.01 },
    { equity: 120, ret: 0.02 },
    { equity: 90, ret: -0.01 },
    { equity: 135, ret: 0.03 },
  ];

  assert.deepEqual(drawdowns(rows, 'equity'), [0, 0, -0.25, 0]);

  const sharpe = rollingSharpe(rows, 'ret', 2);
  assert.equal(sharpe[0], null);
  assert.equal(sharpe[1], null);
  assert.ok(Number.isFinite(sharpe[2]));
});
