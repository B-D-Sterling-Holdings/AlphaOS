import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeQuarterForState,
  backfillBenchmarkData,
  calculateLiveAUM,
} from '../src/lib/accountingState.js';

test('activeQuarterForState selects the latest quarter safely', () => {
  assert.equal(activeQuarterForState(null), 0);
  assert.equal(activeQuarterForState({ quarters: [{}] }), 0);
  assert.equal(activeQuarterForState({ quarters: [{}, {}, {}] }), 2);
});

test('backfillBenchmarkData copies seed S&P period values without mutating input', () => {
  const parsed = {
    inceptionSP: 0,
    quarters: [{
      events: [
        { type: 'contribution', spEnd: 1 },
        { type: 'period', spEnd: 0 },
        { type: 'period', spEnd: 0 },
      ],
    }],
  };
  const seed = {
    inceptionSP: 100,
    quarters: [{
      events: [
        { type: 'period', spEnd: 4200 },
        { type: 'contribution', spEnd: 10 },
        { type: 'period', spEnd: 4300 },
      ],
    }],
  };

  const backfilled = backfillBenchmarkData(parsed, seed);

  assert.equal(parsed.inceptionSP, 0);
  assert.equal(backfilled.inceptionSP, 100);
  assert.deepEqual(backfilled.quarters[0].events.map(event => event.spEnd), [1, 4200, 4300]);
});

test('calculateLiveAUM values holdings from quotes with cost-basis fallback', () => {
  const aum = calculateLiveAUM({
    cash: 50,
    holdings: [
      { ticker: 'AAA', shares: 2, cost_basis: 10 },
      { ticker: 'BBB', shares: 3, cost_basis: 5 },
    ],
  }, {
    quotes: { AAA: { price: 12 } },
  });

  assert.equal(aum, 89);
});
