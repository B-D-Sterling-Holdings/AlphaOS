/*
  Document section types ("categories") — the list down the left of the
  Documents page. Historically these were hard-coded; they are now editable per
  tenant. The full list is persisted in app_settings under the `document_categories`
  key (see src/app/api/documents/categories/route.js) and seeded from the defaults
  below on first read.

  This module is intentionally PURE DATA (no React / lucide imports) so the API
  route can import it server-side without pulling in client components. The page
  maps `icon` (a whitelisted string name) to an actual lucide component via
  CATEGORY_ICON_NAMES, and `color` to Tailwind classes via COLOR_MAP.

  A category is `{ value, label, icon, color, subs?, builtin? }`:
    - value   stable id stored on each document row (never renamed once created).
    - label   display name (editable).
    - icon    one of CATEGORY_ICON_NAMES.
    - color   one of COLOR_MAP's keys.
    - subs    optional [{ value, label }] — only the built-in Equity Research
              group uses these; custom categories are flat.
    - builtin true for the seeded defaults. Built-ins may be renamed / recolored
              but not deleted, so core documents are never orphaned.
*/

export const COLOR_MAP = {
  blue:    { badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', hover: 'hover:bg-blue-50', active: 'bg-blue-50 border-blue-200 text-blue-700' },
  emerald: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', hover: 'hover:bg-emerald-50', active: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  violet:  { badge: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500', hover: 'hover:bg-violet-50', active: 'bg-violet-50 border-violet-200 text-violet-700' },
  amber:   { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', hover: 'hover:bg-amber-50', active: 'bg-amber-50 border-amber-200 text-amber-700' },
  indigo:  { badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500', hover: 'hover:bg-indigo-50', active: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  rose:    { badge: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500', hover: 'hover:bg-rose-50', active: 'bg-rose-50 border-rose-200 text-rose-700' },
  teal:    { badge: 'bg-teal-50 text-teal-700 border-teal-200', dot: 'bg-teal-500', hover: 'hover:bg-teal-50', active: 'bg-teal-50 border-teal-200 text-teal-700' },
  sky:     { badge: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500', hover: 'hover:bg-sky-50', active: 'bg-sky-50 border-sky-200 text-sky-700' },
  pink:    { badge: 'bg-pink-50 text-pink-700 border-pink-200', dot: 'bg-pink-500', hover: 'hover:bg-pink-50', active: 'bg-pink-50 border-pink-200 text-pink-700' },
  gray:    { badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400', hover: 'hover:bg-gray-50', active: 'bg-gray-100 border-gray-300 text-gray-700' },
};

export const COLOR_OPTIONS = Object.keys(COLOR_MAP);
export const DEFAULT_COLOR = 'gray';

// Whitelist of lucide icon names the page knows how to render (CATEGORY_ICONS in
// the page maps each of these to a component). Keep the two lists in sync.
export const CATEGORY_ICON_NAMES = [
  'FileText', 'Mail', 'BookOpen', 'FileSpreadsheet', 'Scale', 'Archive',
  'Briefcase', 'Landmark', 'Building2', 'BarChart3', 'DollarSign', 'PieChart',
  'Newspaper', 'ClipboardList', 'Shield', 'Folder',
];
export const DEFAULT_ICON = 'FileText';

export const EQUITY_RESEARCH_SUBS = [
  { value: 'equity_research_report', label: 'Research Reports' },
  { value: 'equity_primer', label: 'Equity Primers' },
  { value: 'position_review_report', label: 'Position Review Reports' },
  { value: 'equity_research_other', label: 'Other Research' },
];

// Every value that counts toward the Equity Research group (the parent + subs).
export const EQUITY_RESEARCH_VALUES = new Set(
  EQUITY_RESEARCH_SUBS.map(s => s.value).concat('equity_research')
);

export const DEFAULT_CATEGORIES = [
  { value: 'shareholder_letter', label: 'Shareholder Letters', icon: 'Mail', color: 'blue', builtin: true },
  { value: 'equity_research', label: 'Equity Research', icon: 'BookOpen', color: 'emerald', subs: EQUITY_RESEARCH_SUBS, builtin: true },
  { value: 'investor_memo', label: 'Investor Memos', icon: 'FileText', color: 'violet', builtin: true },
  { value: 'financial_model', label: 'Financial Models', icon: 'FileSpreadsheet', color: 'amber', builtin: true },
  { value: 'legal', label: 'Legal', icon: 'Scale', color: 'indigo', builtin: true },
  { value: 'tax', label: 'Tax', icon: 'FileText', color: 'rose', builtin: true },
  { value: 'other', label: 'Other', icon: 'Archive', color: 'gray', builtin: true },
];

// The set of built-in ids — used to protect them from deletion and to preserve
// their fixed structure (icon whitelist, subs) even if a stored row is stale.
const BUILTIN_BY_VALUE = new Map(DEFAULT_CATEGORIES.map(c => [c.value, c]));

/** Turn a free-text label into a stable, unique slug for a new category value. */
export function slugify(label, taken = []) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'section';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function cleanSubs(subs) {
  if (!Array.isArray(subs)) return undefined;
  const out = subs
    .filter(s => s && typeof s.value === 'string' && s.value)
    .map(s => ({ value: s.value, label: String(s.label || s.value).slice(0, 60) }));
  return out.length ? out : undefined;
}

// Sanitize a single stored category into the canonical shape. Built-ins keep
// their fixed subs/builtin flag regardless of what was persisted.
function cleanCategory(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.value !== 'string' || !raw.value) return null;
  const builtinDef = BUILTIN_BY_VALUE.get(raw.value);
  const label = String(raw.label ?? builtinDef?.label ?? raw.value).trim().slice(0, 60) || raw.value;
  const icon = CATEGORY_ICON_NAMES.includes(raw.icon) ? raw.icon : (builtinDef?.icon || DEFAULT_ICON);
  const color = COLOR_MAP[raw.color] ? raw.color : (builtinDef?.color || DEFAULT_COLOR);
  const category = { value: raw.value, label, icon, color };
  const subs = builtinDef?.subs || cleanSubs(raw.subs);
  if (subs) category.subs = subs;
  if (builtinDef) category.builtin = true;
  return category;
}

/**
 * Normalize a persisted list into a valid category array. `null`/empty → the
 * seeded defaults. Otherwise: sanitize every entry, drop malformed/duplicate
 * ones, and re-append any built-in the tenant somehow dropped (so core
 * categories — especially `other`, the upload default — always exist).
 */
export function normalizeCategories(stored) {
  if (!Array.isArray(stored) || stored.length === 0) {
    return DEFAULT_CATEGORIES.map(c => ({ ...c }));
  }
  const seen = new Set();
  const out = [];
  for (const raw of stored) {
    const c = cleanCategory(raw);
    if (c && !seen.has(c.value)) {
      seen.add(c.value);
      out.push(c);
    }
  }
  for (const b of DEFAULT_CATEGORIES) {
    if (!seen.has(b.value)) out.push({ ...b });
  }
  return out;
}

/** Flat { value, label } options for the upload/edit <select> (subs expanded). */
export function categoryOptions(categories) {
  return categories.flatMap(c =>
    c.subs
      ? c.subs.map(s => ({ value: s.value, label: `${c.label} — ${s.label}` }))
      : [{ value: c.value, label: c.label }]
  );
}
