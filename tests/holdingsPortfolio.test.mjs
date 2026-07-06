import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPositions,
  filterPositions,
  holdingsQuoteTickers,
  portfolioTotals,
  quoteErrorMessage,
  treemapPositions,
  withAddedFactor,
  withFactorExposure,
  withImportanceWeight,
  withoutFactor,
} from '../src/lib/holdingsPortfolio.js';

const holdings = [
  { ticker: 'AAA', shares: 2, cost_basis: 10 },
  { ticker: 'BBB', shares: 3, cost_basis: 5 },
];

test('holdingsQuoteTickers includes unique holdings plus benchmark', () => {
  assert.equal(holdingsQuoteTickers([...holdings, holdings[0]]), 'AAA,BBB,SPY');
});

test('quoteErrorMessage distinguishes missing prices from provider throttling', () => {
  assert.equal(quoteErrorMessage(holdings, { AAA: { price: 12 }, BBB: { price: 6 } }), null);
  assert.equal(
    quoteErrorMessage(holdings, { AAA: { error: 'fetch failed' }, BBB: { error: '429' } }),
    'Live prices are temporarily rate-limited by the market-data provider (Yahoo Finance). Wait a minute, then hit Reload — refreshing immediately will stay throttled.'
  );
  assert.equal(
    quoteErrorMessage(holdings, { AAA: { price: 12 }, BBB: {} }),
    'Failed to load live prices for: BBB. Try Reload.'
  );
});

test('portfolioTotals derives positions and summary metrics', () => {
  const totals = portfolioTotals({
    portfolio: { holdings, cash: 25 },
    quotes: {
      AAA: { price: 12, dayChange: 1, dayChangePct: 8 },
      BBB: { price: 4, dayChange: -0.5, dayChangePct: -10 },
      SPY: { dayChangePct: 0.5 },
    },
    quotesLoading: false,
  });

  assert.equal(totals.nav, 36);
  assert.equal(totals.totalAum, 61);
  assert.equal(totals.totalCost, 35);
  assert.equal(totals.totalUnrealizedPnl, 1);
  assert.equal(totals.totalDailyChange, 0.5);
  assert.equal(totals.benchmarkDayChangePct, 0.5);
  assert.equal(totals.quotesLoaded, true);
});

test('position helpers shape treemap and filtered holdings lists', () => {
  const positions = buildPositions(holdings, { AAA: { price: 12 }, BBB: { price: 4 } });
  assert.deepEqual(treemapPositions(positions), [
    { ticker: 'AAA', value: 24, pnlPct: 20, dayChangePct: 0 },
    { ticker: 'BBB', value: 12, pnlPct: -20, dayChangePct: 0 },
  ]);
  assert.deepEqual(filterPositions(positions, 'bb').map(position => position.ticker), ['BBB']);
});

test('factor config helpers return API update payloads', () => {
  const config = {
    factors: ['Volatility', 'Regulatory'],
    importanceWeights: { Volatility: 0.4, Regulatory: 0.6 },
    exposures: { AAA: { Volatility: 0.3, Regulatory: 0.2 } },
  };

  assert.deepEqual(withFactorExposure(config, 'AAA', 'Volatility', '2'), {
    exposures: { AAA: { Volatility: 1, Regulatory: 0.2 } },
  });
  assert.deepEqual(withAddedFactor(config, 'Disruption'), {
    factors: ['Volatility', 'Regulatory', 'Disruption'],
    importanceWeights: { Volatility: 0.4, Regulatory: 0.6, Disruption: 0.5 },
  });
  assert.deepEqual(withoutFactor(config, 'Regulatory'), {
    factors: ['Volatility'],
    importanceWeights: { Volatility: 0.4 },
    exposures: { AAA: { Volatility: 0.3 } },
  });
  assert.deepEqual(withImportanceWeight(config, 'Volatility', '-1'), {
    importanceWeights: { Volatility: 0, Regulatory: 0.6 },
  });
});
