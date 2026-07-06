import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComputedValuationModel,
  fetchQuote,
  saveThesis,
  stripTransientThesisFields,
} from '../src/lib/researchApi.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

test('stripTransientThesisFields removes UI-only draft state before saving', () => {
  assert.deepEqual(
    stripTransientThesisFields({ title: 'Thesis', _activeNewsIdx: 3 }),
    { title: 'Thesis' }
  );
});

test('saveThesis posts the cleaned thesis payload', async () => {
  let request = null;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { json: async () => ({ success: true }) };
  };

  const result = await saveThesis('ABC', { summary: 'keep', _activeNewsIdx: 2 });

  assert.deepEqual(result, { success: true });
  assert.equal(request.url, '/api/thesis/ABC');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { summary: 'keep' });
});

test('fetchQuote extracts the selected ticker quote from the quote map', async () => {
  let requestedUrl = '';
  global.fetch = async (url) => {
    requestedUrl = url;
    return { json: async () => ({ quotes: { XYZ: { price: 12.5 } } }) };
  };

  assert.deepEqual(await fetchQuote('XYZ'), { price: 12.5 });
  assert.equal(requestedUrl, '/api/quotes?tickers=XYZ');
});

test('buildComputedValuationModel returns null when no saved model exists', () => {
  assert.equal(buildComputedValuationModel({ exists: false }, 100), null);
});

test('buildComputedValuationModel uses live price when saved share price is blank', () => {
  const model = buildComputedValuationModel({
    exists: true,
    inputs: {
      sharePrice: '',
      startYear: 2026,
      revenue: '100',
      revenueGrowthRate: '0',
      netMargin: '10',
      sharesOutstanding: '10',
      terminalPE: '15',
    },
  }, 20);

  assert.equal(model.inputs.sharePrice, 20);
  assert.ok(model.computed);
});
