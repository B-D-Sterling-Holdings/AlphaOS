import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeThesis } from '../src/lib/thesisMerge.js';

const draftReview = (threads) => ({ underwriting: { draftReview: { paper: [], threads } } });

test('mergeThesis keeps threads added by both sides (no comment is lost)', () => {
  const local = draftReview([{ id: 'A', title: 'local point', messages: [] }]);
  local.version = 3;
  const server = draftReview([{ id: 'B', title: 'teammate point', messages: [] }]);
  server.version = 4;

  const merged = mergeThesis(local, server);
  const ids = merged.underwriting.draftReview.threads.map((t) => t.id).sort();
  assert.deepEqual(ids, ['A', 'B']);
  assert.equal(merged.version, 4, 'saves against the server version');
});

test('mergeThesis unions messages within a shared thread, sorted by time', () => {
  const local = draftReview([{
    id: 'A', title: 't', resolved: false,
    messages: [
      { id: 'm1', role: 'reviewer', body: 'q', createdAt: '2026-07-06T10:00:00Z' },
      { id: 'm2', role: 'author', body: 'my answer', createdAt: '2026-07-06T10:05:00Z' },
    ],
  }]);
  const server = draftReview([{
    id: 'A', title: 't', resolved: false,
    messages: [
      { id: 'm1', role: 'reviewer', body: 'q', createdAt: '2026-07-06T10:00:00Z' },
      { id: 'm3', role: 'reviewer', body: 'teammate follow-up', createdAt: '2026-07-06T10:03:00Z' },
    ],
  }]);

  const merged = mergeThesis(local, server);
  const msgs = merged.underwriting.draftReview.threads[0].messages;
  assert.deepEqual(msgs.map((m) => m.id), ['m1', 'm3', 'm2'], 'both sides survive, ordered by createdAt');
});

test('mergeThesis keeps the local scalar fields on a shared thread (saver intent) but the teammate resolve is not silently dropped from other threads', () => {
  const local = draftReview([{ id: 'A', title: 'renamed by me', resolved: false, messages: [] }]);
  const server = draftReview([
    { id: 'A', title: 'old title', resolved: false, messages: [] },
    { id: 'B', title: 'teammate resolved this', resolved: true, messages: [] },
  ]);

  const merged = mergeThesis(local, server);
  const byId = Object.fromEntries(merged.underwriting.draftReview.threads.map((t) => [t.id, t]));
  assert.equal(byId.A.title, 'renamed by me');   // local intent wins on the field it edited
  assert.equal(byId.B.resolved, true);            // teammate's separate thread preserved
});

test('mergeThesis prefers the local value on a genuinely conflicting scalar (last-write-wins, but visible)', () => {
  const local = { valuation: 'mine', underwriting: {}, version: 2 };
  const server = { valuation: 'theirs', underwriting: {}, version: 3 };
  const merged = mergeThesis(local, server);
  assert.equal(merged.valuation, 'mine');
  assert.equal(merged.version, 3);
});

test('mergeThesis unions todos/newsUpdates by id, keeping items added on either side', () => {
  const local = { underwriting: {}, todos: [{ id: 't1', text: 'mine' }], newsUpdates: [], version: 1 };
  const server = {
    underwriting: {},
    todos: [{ id: 't1', text: 'mine' }, { id: 't2', text: 'teammate' }],
    newsUpdates: [{ id: 'n1', text: 'teammate news' }],
    version: 2,
  };
  const merged = mergeThesis(local, server);
  assert.deepEqual(merged.todos.map((t) => t.id).sort(), ['t1', 't2']);
  assert.deepEqual(merged.newsUpdates.map((n) => n.id), ['n1']);
});

test('mergeThesis is null-safe', () => {
  assert.deepEqual(mergeThesis({ a: 1 }, null), { a: 1 });
  assert.deepEqual(mergeThesis(null, { b: 2 }), { b: 2 });
});
