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

test('saveThesis posts the cleaned thesis payload and reports the new version', async () => {
  let request = null;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ success: true, version: 2 }) };
  };

  const result = await saveThesis('ABC', { summary: 'keep', _activeNewsIdx: 2 });

  assert.equal(result.success, true);
  assert.equal(result.version, 2);
  assert.equal(request.url, '/api/thesis/ABC');
  assert.equal(request.options.method, 'POST');
  // Transient UI fields are stripped; a missing version sends baseVersion:undefined,
  // which JSON.stringify drops — so the wire payload is just the cleaned thesis.
  assert.deepEqual(JSON.parse(request.options.body), { summary: 'keep' });
});

test('saveThesisReconciled merges and retries on a version conflict', async () => {
  const { saveThesisReconciled } = await import('../src/lib/researchApi.js');
  const serverThesis = {
    ticker: 'ABC',
    underwriting: { draftReview: { paper: [], threads: [{ id: 'B', title: 'teammate', messages: [] }] } },
    version: 7,
  };
  let calls = 0;
  global.fetch = async (url, options) => {
    calls += 1;
    if (calls === 1) {
      // First attempt loses the race.
      return { ok: false, status: 409, json: async () => ({ conflict: true, current: serverThesis, version: 7 }) };
    }
    // Retry against the fresh version succeeds; echo the payload's threads back.
    const body = JSON.parse(options.body);
    assert.equal(body.baseVersion, 7, 'retry guards against the server version');
    const ids = body.underwriting.draftReview.threads.map((t) => t.id).sort();
    assert.deepEqual(ids, ['A', 'B'], 'local + teammate threads both present on retry');
    return { ok: true, status: 200, json: async () => ({ success: true, version: 8 }) };
  };

  const local = {
    ticker: 'ABC',
    underwriting: { draftReview: { paper: [], threads: [{ id: 'A', title: 'mine', messages: [] }] } },
    version: 6,
  };
  const result = await saveThesisReconciled('ABC', local);
  assert.equal(result.ok, true);
  assert.equal(result.reloaded, true);
  assert.equal(result.thesis.version, 8);
  assert.equal(calls, 2);
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
