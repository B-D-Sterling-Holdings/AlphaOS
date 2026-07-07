import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { saveWithOCC, saveRow } from '../src/lib/occClient.js';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

// Canonical conflict body the server sends: 409 { conflict:true, current, version }.
const conflict = (current) => ({
  status: 409, ok: false, json: async () => ({ conflict: true, current, version: current?.version ?? 0 }),
});
const okJson = (body) => ({ status: 200, ok: true, json: async () => body });

test('saveWithOCC: clean save returns ok + the sent payload, not reconciled', async () => {
  let sentBody = null;
  global.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return okJson({ version: 5 }); };

  const res = await saveWithOCC({
    url: '/x', local: { a: 1, version: 4 },
    buildBody: (r) => ({ a: r.a, baseVersion: r.version }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.reconciled, false);
  assert.equal(sentBody.baseVersion, 4);
  assert.equal(res.data.version, 5);
});

test('saveWithOCC: with a merge fn, a conflict merges + retries and succeeds', async () => {
  let call = 0;
  global.fetch = async (url, opts) => {
    call += 1;
    if (call === 1) return conflict({ id: 1, items: ['server'], version: 7 });
    const body = JSON.parse(opts.body);
    assert.equal(body.baseVersion, 7, 'retry guards on the server version');
    assert.deepEqual(body.items, ['local', 'server'], 'merged payload sent on retry');
    return okJson({ version: 8 });
  };

  const res = await saveWithOCC({
    url: '/x',
    local: { id: 1, items: ['local'], version: 6 },
    buildBody: (r) => ({ items: r.items, baseVersion: r.version }),
    merge: (local, server) => ({ ...server, items: [...local.items, ...server.items], version: server.version }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.reconciled, true);
  assert.equal(call, 2);
});

test('saveWithOCC: without a merge fn, the first conflict is returned to the caller (reload policy)', async () => {
  const server = { id: 1, title: 'theirs', version: 9 };
  let calls = 0;
  global.fetch = async () => { calls += 1; return conflict(server); };

  const res = await saveWithOCC({
    url: '/x', local: { id: 1, title: 'mine', version: 8 },
    buildBody: (r) => ({ title: r.title, baseVersion: r.version }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.conflict, true);
  assert.equal(res.server.version, 9);
  assert.equal(res.merged, null);
  assert.equal(calls, 1, 'no retry without a merge policy');
});

test('saveRow: sends baseVersion from the row and returns the server row on success', async () => {
  let sent = null;
  global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return okJson({ id: 1, title: 't', version: 3 }); };

  const res = await saveRow('/api/ideas', { id: 1, title: 't', version: 2 });
  assert.equal(sent.baseVersion, 2);
  assert.equal(res.ok, true);
  assert.equal(res.row.version, 3);
});

test('saveRow: surfaces a conflict with the fresh server row (reload-and-redo)', async () => {
  const server = { id: 1, title: 'theirs', version: 5 };
  global.fetch = async () => conflict(server);

  const res = await saveRow('/api/ideas', { id: 1, title: 'mine', version: 4 });
  assert.equal(res.ok, false);
  assert.equal(res.conflict, true);
  assert.equal(res.server.version, 5);
});

test('saveWithOCC: a non-conflict error is reported, not thrown', async () => {
  global.fetch = async () => ({ status: 500, ok: false, json: async () => ({ error: 'boom' }) });
  const res = await saveWithOCC({ url: '/x', local: { version: 1 }, buildBody: (r) => r });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'boom');
});
