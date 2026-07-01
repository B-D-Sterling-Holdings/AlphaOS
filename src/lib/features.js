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
  { key: 'macro-regime', label: 'Market Confidence', hrefs: ['/macro-regime'] },
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
