// Structural guard for the API feature gate (src/lib/features.js).
//
// The gate in src/proxy.js fails CLOSED: any /api route that is neither
// feature-owned (API_FEATURES) nor common (COMMON_API_ROUTES) is refused. The
// most important test here walks the actual route tree and asserts EVERY route
// is classified — so adding a new API route without registering it breaks the
// build instead of silently leaking a hidden feature's data through the API.
//
// Run with: npm test   (node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isApiAllowed,
  classifyApiRoute,
  API_FEATURES,
  COMMON_API_ROUTES,
  FEATURE_KEYS,
} from '../src/lib/features.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(repoRoot, 'src', 'app', 'api');

// Every route.js under src/app/api, as the pathname the proxy sees. Dynamic
// segments ([ticker]) are replaced with a placeholder so prefix matching works.
function discoverApiRoutes(dir = API_DIR, prefix = '/api') {
  const routes = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const seg = entry.name.startsWith('[') ? 'x' : entry.name;
      routes.push(...discoverApiRoutes(join(dir, entry.name), `${prefix}/${seg}`));
    } else if (entry.name === 'route.js' || entry.name === 'route.jsx') {
      routes.push(prefix);
    }
  }
  return routes;
}

test('every API route is classified (no default-deny surprises, no leaks)', () => {
  const routes = discoverApiRoutes();
  assert.ok(routes.length > 30, `expected to discover the API tree, found ${routes.length}`);

  const unclassified = routes.filter((r) => classifyApiRoute(r).type === 'unclassified');
  assert.deepEqual(
    unclassified,
    [],
    `Unclassified API route(s): ${unclassified.join(', ')}\n` +
      'Add each to API_FEATURES (feature-gated) or COMMON_API_ROUTES ' +
      '(open to any authenticated user) in src/lib/features.js. ' +
      'Leaving a route unregistered makes the proxy fail closed (403).'
  );
});

test('every API_FEATURES owner is a real feature key', () => {
  for (const [route, owners] of Object.entries(API_FEATURES)) {
    for (const key of owners) {
      assert.ok(FEATURE_KEYS.includes(key), `${route} → unknown feature "${key}"`);
    }
  }
});

test('the historically leaking routes are now gated', () => {
  // These all served tenant data while their feature's page was blocked.
  assert.equal(isApiAllowed('/api/macro-regime/results', ['macro-regime']), false);
  assert.equal(isApiAllowed('/api/macro-regime/weights', ['macro-regime']), false);
  assert.equal(isApiAllowed('/api/allocation', ['allocation']), false);
  assert.equal(isApiAllowed('/api/tasks', ['tasks']), false);
  assert.equal(isApiAllowed('/api/tasks/reorder', ['tasks']), false); // sub-path
  assert.equal(isApiAllowed('/api/task-boards', ['tasks']), false);
  assert.equal(isApiAllowed('/api/strategic-candidates', ['strategic-hub']), false);
  assert.equal(isApiAllowed('/api/fund-nav', ['financials']), false);
});

test('default-deny: an unregistered route is refused', () => {
  assert.equal(isApiAllowed('/api/something-brand-new', []), false);
  assert.equal(classifyApiRoute('/api/something-brand-new').type, 'unclassified');
});

test('common routes stay open regardless of disabled features', () => {
  const everything = [...FEATURE_KEYS];
  assert.equal(isApiAllowed('/api/quotes', everything), true);
  assert.equal(isApiAllowed('/api/quotes?tickers=AAPL', everything), false, 'query strings are not paths');
  assert.equal(isApiAllowed('/api/issues', everything), true);
  assert.equal(isApiAllowed('/api/upload', everything), true);
  assert.equal(isApiAllowed('/api/storage/object', everything), true);
});

test('admin is role-gated, not feature-gated or common', () => {
  // The feature layer passes it (role is a separate axis, enforced at the edge
  // in proxy.js and in-handler via requireManager) — but it is classified as
  // its own 'role' type, NOT 'common', so the model stays honest.
  assert.equal(classifyApiRoute('/api/admin/users').type, 'role');
  assert.equal(isApiAllowed('/api/admin/users', [...FEATURE_KEYS]), true);
});

test('multi-owner routes block only when ALL owners are disabled', () => {
  // /api/realized-vol → ['allocation','macro-regime']
  assert.equal(isApiAllowed('/api/realized-vol', ['allocation']), true);
  assert.equal(isApiAllowed('/api/realized-vol', ['allocation', 'macro-regime']), false);
  // /api/portfolio → all four holdings-derived features
  assert.equal(isApiAllowed('/api/portfolio', ['holdings']), true);
  assert.equal(
    isApiAllowed('/api/portfolio', ['holdings', 'allocation', 'macro-regime', 'research']),
    false
  );
});

test('a user with no restrictions reaches everything gated', () => {
  for (const route of discoverApiRoutes()) {
    assert.equal(isApiAllowed(route, []), true, `${route} blocked for an unrestricted user`);
  }
});
