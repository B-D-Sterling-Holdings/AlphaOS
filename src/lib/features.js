/*
  Feature access registry — the single source of truth for which app areas an
  admin can switch on/off per user.

  This module is deliberately framework-neutral (no 'use client', no
  'server-only', no node/edge-only imports) so the SAME definitions can be used
  by:
    - the edge middleware (hard server-side route gate),
    - server API routes + user management,
    - client components (Navbar, Command Palette, the in-page guard).

  A "feature" owns one or more route prefixes (`hrefs`). Disabling a feature for
  a user blocks every route it owns — at the nav level, the page level, AND in
  middleware — so there is no "type `/research` in the palette to sneak in" gap.

  Equity Research is intentionally a SINGLE coupled feature: the watchlist,
  draft/review, research and position-review flows share state and only make
  sense together, so it is all-or-nothing.
*/

export const FEATURES = [
  { key: 'holdings', label: 'Holdings', hrefs: ['/holdings'] },
  { key: 'allocation', label: 'Allocation', hrefs: ['/allocation'] },
  { key: 'relationships', label: 'Relationships', hrefs: ['/relationships'] },
  { key: 'strategic-hub', label: 'Strategic Hub', hrefs: ['/strategic-hub'] },
  { key: 'tasks', label: 'Tasks', hrefs: ['/tasks'] },
  { key: 'workspace', label: 'Workspace', hrefs: ['/workspace'] },
  { key: 'lessons', label: 'Lessons Learned', hrefs: ['/lessons'] },
  {
    key: 'research',
    label: 'Equity Research',
    note: 'Watchlist, Draft & Review, Research and Position Review are coupled — all on or all off.',
    hrefs: ['/watchlist', '/draft-review', '/research', '/position-review'],
  },
  { key: 'documents', label: 'Documents', hrefs: ['/documents'] },
  { key: 'link-database', label: 'Link Database', hrefs: ['/link-database'] },
  { key: 'financials', label: 'Financials', hrefs: ['/financials'] },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

/** Keep only keys that correspond to a real feature (drops typos/stale data). */
export function sanitizeFeatureKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const seen = new Set();
  for (const k of keys) {
    if (FEATURE_BY_KEY.has(k)) seen.add(k);
  }
  return [...seen];
}

/**
 * Which feature governs a given pathname, or null if the path is ungated
 * (e.g. the dashboard home `/`, `/admin`, `/login`). Longest matching href
 * wins so e.g. nested routes resolve to their owner feature.
 */
export function featureForPath(pathname) {
  if (!pathname) return null;
  let best = null;
  let bestLen = -1;
  for (const feature of FEATURES) {
    for (const href of feature.hrefs) {
      if ((pathname === href || pathname.startsWith(href + '/')) && href.length > bestLen) {
        best = feature;
        bestLen = href.length;
      }
    }
  }
  return best;
}

/**
 * Is `href` reachable for a user with this set of disabled feature keys?
 * Ungated destinations are always allowed. `disabled` may be an array or Set.
 */
export function isHrefAllowed(href, disabled) {
  const feature = featureForPath(href);
  if (!feature) return true;
  const set = disabled instanceof Set ? disabled : new Set(disabled || []);
  return !set.has(feature.key);
}

/*
  API access model — DEFAULT DENY.

  The proxy's `/api/*` branch runs every non-admin request through
  `isApiAllowed`. Unlike the page gate, this side fails CLOSED: a route must be
  explicitly classified as either feature-owned (`API_FEATURES`) or common
  (`COMMON_API_ROUTES`). Anything else is refused with a 403. This is what
  stops a hidden feature's data from leaking through the API when someone adds
  a route and forgets to gate it — the omission denies access instead of
  granting it, and `tests/apiAccess.test.mjs` fails CI until the route is
  classified. Adding a route is therefore a deliberate, reviewed decision.

  `API_FEATURES`: the data-side twin of `hrefs`. An API maps to EVERY feature
  whose pages consume it and is blocked only when ALL of them are disabled
  (e.g. /api/thesis serves both Equity Research and Strategic Hub — losing one
  must not break the other; /api/portfolio feeds several holdings-derived
  pages). Keys are route prefixes; sub-paths match like `hrefs` do, so
  `/api/macro-regime` covers `/api/macro-regime/results` and `/api/tasks`
  covers `/api/tasks/reorder`.
*/
export const API_FEATURES = {
  // Holdings
  '/api/holdings': ['holdings'],
  '/api/cash': ['holdings'],
  '/api/risk': ['holdings'],
  '/api/fundamentals': ['holdings'],
  '/api/sector-labels': ['holdings'],
  '/api/factor-config': ['holdings'],
  // Allocation
  '/api/allocation': ['allocation'],
  '/api/return-covariance': ['allocation'],
  '/api/realized-vol': ['allocation'],
  // Macro Risk model — lives inside the Allocation tab (prefix covers
  // config/plots/predict/results/run).
  '/api/macro-regime': ['allocation'],
  // Relationships
  '/api/contacts': ['relationships'],
  '/api/contact-files': ['relationships'],
  '/api/interactions': ['relationships'],
  // Strategic Hub
  '/api/strategic-hub': ['strategic-hub'],
  '/api/strategic-notes': ['strategic-hub'],
  '/api/strategic-candidates': ['strategic-hub'],
  // Tasks (prefix covers /api/tasks/reorder)
  '/api/tasks': ['tasks'],
  '/api/task-boards': ['tasks'],
  // Roster is shared by the Tasks board AND the per-company Research Task panel,
  // so it stays reachable whenever EITHER feature is on.
  '/api/assignees': ['tasks', 'research'],
  // Workspace
  '/api/ideas': ['workspace'],
  // Lessons
  '/api/lessons': ['lessons'],
  '/api/lesson-patterns': ['lessons'],
  // Equity Research (watchlist/draft-review/research/position-review coupled)
  '/api/watchlist': ['research', 'strategic-hub'],
  '/api/thesis': ['research', 'strategic-hub'],
  '/api/model': ['research'],
  '/api/research': ['research'],
  '/api/notify-review': ['research'],
  '/api/review-summary': ['research', 'strategic-hub'],
  '/api/period-changes': ['research'],
  '/api/saved-emails': ['research'],
  '/api/validate-ticker': ['research'],
  '/api/ticker': ['research'],
  '/api/generate-data': ['research'],
  // Per-company research to-do list (Research Task panel on the workflow pages).
  '/api/research-tasks': ['research'],
  // Documents / Link Database / Financials
  '/api/documents': ['documents'],
  '/api/links': ['link-database'],
  '/api/accounting-state': ['financials'],
  '/api/fund-nav': ['financials'],
  // Portfolio positions feed — consumed by every holdings-derived surface, so
  // it is blocked only when ALL of those features are off.
  '/api/portfolio': ['holdings', 'allocation', 'research'],
};

/*
  Routes gated by ROLE at the edge, not by feature toggles. The proxy checks
  `canManageUsers(role)` for these before the feature gate runs and 403s a
  plain user; the handler re-checks (requireManager) and additionally scopes
  owners to their own workspace. Separated from COMMON so the model is honest:
  these are NOT open to any authenticated user — a plain `user` is refused.
  There is no feature key for user management, so a feature toggle can't
  express this; role is the right axis.
*/
export const ROLE_GATED_API_ROUTES = [
  '/api/admin',
];

/*
  Routes intentionally available to ANY authenticated user, regardless of
  feature toggles. Keep this list short and justified — every entry is a
  deliberate hole in the default-deny gate:
    - /api/auth, /api/cron : the proxy short-circuits these before the feature
      gate ever runs (auth manages its own session; cron uses CRON_SECRET).
      Listed here so the classification is total and client-side callers of
      isApiAllowed agree with the edge.
    - /api/quotes          : public market quotes — no tenant data; consumed
      app-wide (valuation, accounting, every ticker page).
    - /api/upload          : rich-text image upload, session-tenant scoped;
      embedded editors exist under many features.
    - /api/storage         : object proxy that enforces its OWN tenant-path
      check (isPathAllowedForTenant) before serving.
    - /api/issues          : the bug-reporter widget, offered on every page.
  Prefixes match sub-paths, exactly like API_FEATURES.
*/
export const COMMON_API_ROUTES = [
  '/api/auth',
  '/api/cron',
  '/api/quotes',
  '/api/upload',
  '/api/storage',
  '/api/issues',
];

/** Longest prefix in `prefixes` that owns `pathname` (or null). */
function longestApiPrefix(pathname, prefixes) {
  let best = null;
  let bestLen = -1;
  for (const prefix of prefixes) {
    if ((pathname === prefix || pathname.startsWith(prefix + '/')) && prefix.length > bestLen) {
      best = prefix;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * Classify an /api path so both the runtime gate and the completeness test
 * agree on how a route is treated:
 *   { type: 'feature', owners, prefix } — gated by one or more features
 *   { type: 'role', prefix }            — role-gated at the edge (not features)
 *   { type: 'common', prefix }          — open to any authenticated user
 *   { type: 'unclassified' }            — NOT registered → gate fails closed
 *   { type: 'non-api' }                 — not an /api path
 * When a path matches more than one list the longest (most specific) wins.
 */
export function classifyApiRoute(pathname) {
  if (!pathname || !pathname.startsWith('/api/')) return { type: 'non-api' };
  const featurePrefix = longestApiPrefix(pathname, Object.keys(API_FEATURES));
  const rolePrefix = longestApiPrefix(pathname, ROLE_GATED_API_ROUTES);
  const commonPrefix = longestApiPrefix(pathname, COMMON_API_ROUTES);
  const featureLen = featurePrefix ? featurePrefix.length : -1;
  const roleLen = rolePrefix ? rolePrefix.length : -1;
  const commonLen = commonPrefix ? commonPrefix.length : -1;
  if (featurePrefix && featureLen >= roleLen && featureLen >= commonLen) {
    return { type: 'feature', owners: API_FEATURES[featurePrefix], prefix: featurePrefix };
  }
  if (rolePrefix && roleLen >= commonLen) return { type: 'role', prefix: rolePrefix };
  if (commonPrefix) return { type: 'common', prefix: commonPrefix };
  return { type: 'unclassified' };
}

/**
 * Is this API path callable for a user with these disabled feature keys?
 * DEFAULT DENY: common routes are always allowed; feature routes are allowed
 * only while at least one owning feature is enabled; UNCLASSIFIED routes are
 * refused (fail closed). `disabled` may be an array or Set.
 *
 * NOTE: role-gated routes return `true` here — this function answers only the
 * FEATURE question. Their role check lives at the edge (proxy.js) and in the
 * handler (requireManager); it is deliberately not folded in, since this same
 * function runs client-side where role is enforced separately.
 */
export function isApiAllowed(pathname, disabled) {
  const route = classifyApiRoute(pathname);
  if (route.type === 'non-api' || route.type === 'common' || route.type === 'role') return true;
  if (route.type === 'unclassified') return false;
  const set = disabled instanceof Set ? disabled : new Set(disabled || []);
  return !route.owners.every((key) => set.has(key));
}
