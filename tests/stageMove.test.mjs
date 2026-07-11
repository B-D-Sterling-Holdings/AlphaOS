import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVersions, withStageChange, routeForStage } from '../src/lib/stageMove.js';

// applyVersions folds the server's freshly-bumped version tokens back into a payload
// so a page that saves a stage move then caches its copy leaves CURRENT tokens in the
// shared cache — the fix for false "please redo" conflicts after cross-page moves.

test('applyVersions stamps each list with its returned version', () => {
  const payload = {
    watchlists: [
      { id: 'a', name: 'A', version: 1, stocks: [] },
      { id: 'b', name: 'B', version: 4, stocks: [] },
    ],
    activeWatchlistId: 'a',
  };
  const next = applyVersions(payload, [{ id: 'a', version: 2 }, { id: 'b', version: 5 }]);
  assert.equal(next.watchlists[0].version, 2);
  assert.equal(next.watchlists[1].version, 5);
  // Non-version fields and the pointer are untouched.
  assert.equal(next.activeWatchlistId, 'a');
  assert.equal(next.watchlists[0].name, 'A');
});

test('applyVersions leaves lists with no returned version unchanged', () => {
  const payload = { watchlists: [{ id: 'a', version: 1 }, { id: 'b', version: 4 }] };
  const next = applyVersions(payload, [{ id: 'a', version: 2 }]);
  assert.equal(next.watchlists[0].version, 2);
  assert.equal(next.watchlists[1].version, 4); // untouched — no token returned for 'b'
});

test('applyVersions is a no-op when there are no versions to apply', () => {
  const payload = { watchlists: [{ id: 'a', version: 1 }] };
  assert.equal(applyVersions(payload, null), payload);
  assert.equal(applyVersions(payload, []), payload);
  assert.equal(applyVersions(null, [{ id: 'a', version: 2 }]), null);
});

test('applyVersions ignores malformed version entries', () => {
  const payload = { watchlists: [{ id: 'a', version: 1 }] };
  const next = applyVersions(payload, [{ id: 'a' }, { version: 9 }, { id: 'a', version: 3 }]);
  assert.equal(next.watchlists[0].version, 3);
});

// withStageChange flips one stock's stage without touching anything else — EXCEPT a
// demote back to the Watchlist, which also floats the name to the top-left.

test('withStageChange floats a name demoted to watching below every other position', () => {
  const data = {
    watchlists: [{
      id: 'w', stocks: [
        { ticker: 'AAA', stage: 'watching', position: 0 },
        { ticker: 'BBB', stage: 'watching', position: 1 },
        { ticker: 'CCC', stage: 'research', position: 2 },
      ],
    }],
  };
  const next = withStageChange(data, 'w', 'CCC', 'watching');
  const ccc = next.watchlists[0].stocks.find(s => s.ticker === 'CCC');
  assert.equal(ccc.stage, 'watching');
  assert.equal(ccc.position, -1); // min(0,1,2) - 1 → sorts first
  // Others are untouched.
  assert.equal(next.watchlists[0].stocks.find(s => s.ticker === 'AAA').position, 0);
});

test('withStageChange keeps floating each successive demote above the last', () => {
  const data = { watchlists: [{ id: 'w', stocks: [
    { ticker: 'AAA', stage: 'watching', position: -1 },
    { ticker: 'DDD', stage: 'draft', position: 5 },
  ] }] };
  const next = withStageChange(data, 'w', 'DDD', 'watching');
  assert.equal(next.watchlists[0].stocks.find(s => s.ticker === 'DDD').position, -2); // above the prior demote
});

test('withStageChange does NOT reposition a promote (non-watching stage)', () => {
  const data = { watchlists: [{ id: 'w', stocks: [
    { ticker: 'AAA', stage: 'watching', position: 0 },
    { ticker: 'BBB', stage: 'watching', position: 1 },
  ] }] };
  const next = withStageChange(data, 'w', 'BBB', 'draft');
  const bbb = next.watchlists[0].stocks.find(s => s.ticker === 'BBB');
  assert.equal(bbb.stage, 'draft');
  assert.equal(bbb.position, 1); // preserved — only the stage changed
});

test('withStageChange leaves other watchlists alone', () => {
  const data = { watchlists: [
    { id: 'w1', stocks: [{ ticker: 'AAA', stage: 'draft', position: 3 }] },
    { id: 'w2', stocks: [{ ticker: 'ZZZ', stage: 'watching', position: 0 }] },
  ] };
  const next = withStageChange(data, 'w1', 'AAA', 'watching');
  assert.equal(next.watchlists[0].stocks[0].position, 2); // min(3)-1
  assert.deepEqual(next.watchlists[1], data.watchlists[1]); // untouched
});

// routeForStage deep-links the ticker only on the detail pages that can focus it. The
// Watchlist is a grid, so demoting there must NOT leave a stale ?ticker= in the URL.

test('routeForStage omits ?ticker= when demoting to the watchlist grid', () => {
  assert.equal(routeForStage('watching', 'MSFT'), '/watchlist');
});

test('routeForStage keeps ?ticker= for the detail pages', () => {
  assert.equal(routeForStage('draft', 'MSFT'), '/draft-review?ticker=MSFT');
  assert.equal(routeForStage('research', 'MSFT'), '/research?ticker=MSFT');
  assert.equal(routeForStage('position', 'MSFT'), '/position-review?ticker=MSFT');
});
