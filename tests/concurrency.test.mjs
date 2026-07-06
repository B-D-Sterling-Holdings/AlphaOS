import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionedWrite, versionOf, VersionConflictError } from '../src/lib/concurrency.js';

// Minimal chainable stand-in for a supabase-js query builder. Each `.from()` call
// starts a fresh context; the terminal `.maybeSingle()`/`.single()` resolves the
// handler for whichever operation was invoked (upsert/insert/update/select).
function makeClient(handlers) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const ctx = { table, op: null, payload: null, opts: null, eqs: [] };
      calls.push(ctx);
      const builder = {
        upsert(payload, opts) { ctx.op = 'upsert'; ctx.payload = payload; ctx.opts = opts; return builder; },
        insert(payload) { ctx.op = 'insert'; ctx.payload = payload; return builder; },
        update(payload) { ctx.op = 'update'; ctx.payload = payload; return builder; },
        select() { if (!ctx.op) ctx.op = 'select'; return builder; },
        eq(k, v) { ctx.eqs.push([k, v]); return builder; },
        maybeSingle() { return Promise.resolve(handlers[ctx.op](ctx)); },
        single() { return Promise.resolve(handlers[ctx.op](ctx)); },
      };
      return builder;
    },
  };
  return client;
}

test('versionOf: absent row → 0, numeric version passes through, pre-migration row → undefined', () => {
  assert.equal(versionOf(null), 0);
  assert.equal(versionOf(undefined), 0);
  assert.equal(versionOf({ version: 5 }), 5);
  assert.equal(versionOf({ ticker: 'AAPL' }), undefined); // column not present yet
});

test('baseVersion undefined → legacy unguarded upsert (pre-migration compatibility)', async () => {
  const client = makeClient({
    upsert: (ctx) => ({ data: { ...ctx.payload, version: 2 }, error: null }),
  });
  const row = await versionedWrite(client, 'theses', {
    match: { ticker: 'AAPL' },
    values: { valuation: '10' },
    baseVersion: undefined,
    onConflict: 'tenant_id,ticker',
  });
  assert.equal(client.calls[0].op, 'upsert');
  assert.deepEqual(client.calls[0].opts, { onConflict: 'tenant_id,ticker' });
  assert.equal(row.version, 2);
});

test('baseVersion 0 inserts a brand-new row', async () => {
  const client = makeClient({
    insert: (ctx) => ({ data: { ...ctx.payload, version: 1 }, error: null }),
  });
  const row = await versionedWrite(client, 'theses', {
    match: { ticker: 'NEW' },
    values: { valuation: 'x' },
    baseVersion: 0,
  });
  assert.equal(client.calls[0].op, 'insert');
  assert.equal(row.version, 1);
  assert.equal(row.ticker, 'NEW');
});

test('baseVersion 0 losing the insert race → VersionConflictError carrying the current row', async () => {
  const current = { ticker: 'NEW', version: 1, valuation: 'theirs' };
  const client = makeClient({
    insert: () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    select: () => ({ data: current }), // fetchCurrent
  });
  await assert.rejects(
    () => versionedWrite(client, 'theses', { match: { ticker: 'NEW' }, values: {}, baseVersion: 0 }),
    (err) => {
      assert.ok(err instanceof VersionConflictError);
      assert.deepEqual(err.current, current);
      return true;
    }
  );
});

test('guarded UPDATE at the right version succeeds and returns the bumped row', async () => {
  const client = makeClient({
    update: (ctx) => {
      // The compare-and-swap guard must be present.
      assert.ok(ctx.eqs.some(([k, v]) => k === 'version' && v === 3));
      assert.ok(ctx.eqs.some(([k, v]) => k === 'ticker' && v === 'AAPL'));
      return { data: { ticker: 'AAPL', version: 4, valuation: 'mine' }, error: null };
    },
  });
  const row = await versionedWrite(client, 'theses', {
    match: { ticker: 'AAPL' },
    values: { valuation: 'mine' },
    baseVersion: 3,
  });
  assert.equal(row.version, 4);
});

test('guarded UPDATE that matches zero rows (stale base) → VersionConflictError with fresh row', async () => {
  const fresh = { ticker: 'AAPL', version: 9, valuation: 'teammate' };
  const client = makeClient({
    update: () => ({ data: null, error: null }), // 0 rows matched: base was stale
    select: () => ({ data: fresh }),            // fetchCurrent returns the advanced row
  });
  await assert.rejects(
    () => versionedWrite(client, 'theses', { match: { ticker: 'AAPL' }, values: {}, baseVersion: 3 }),
    (err) => {
      assert.ok(err instanceof VersionConflictError);
      assert.equal(err.current.version, 9);
      return true;
    }
  );
});
