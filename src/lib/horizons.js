// Shared constants + pure helpers for the Horizons view of /tasks — a long-term
// planning suite for firm-level strategic priorities (distinct from the day-to-day
// Board/Week task lists). One plan per tenant, stored as a single app_settings
// blob: { vision, priorities: [...] }. Pure/side-effect-free like taskBoard.js.

// Time horizons a priority can sit under (the planner's columns).
export const HORIZONS = [
  { key: 'quarter',  label: 'This Quarter', hint: 'Next ~90 days' },
  { key: 'year',     label: 'This Year',    hint: 'Next ~12 months' },
  { key: 'longterm', label: 'Long-Term',    hint: 'Multi-year / vision' },
];

export const HORIZON_KEYS = HORIZONS.map(h => h.key);
export const DEFAULT_HORIZON = 'quarter';

// Progress state of a priority. `cls` styles the badge in light/dark-neutral tones.
export const STATUSES = [
  { key: 'idea',     label: 'Idea',     cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  { key: 'on_track', label: 'On Track', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'at_risk',  label: 'At Risk',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'on_hold',  label: 'On Hold',  cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  { key: 'achieved', label: 'Achieved', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
];

export const DEFAULT_STATUS = 'idea';

export function statusMeta(key) {
  return STATUSES.find(s => s.key === key) || STATUSES[0];
}

export function horizonMeta(key) {
  return HORIZONS.find(h => h.key === key) || HORIZONS[0];
}

// Normalise whatever the API returns into a well-formed plan object.
export function normalizePlan(raw) {
  const priorities = Array.isArray(raw?.priorities) ? raw.priorities : [];
  return {
    vision: typeof raw?.vision === 'string' ? raw.vision : '',
    priorities: priorities.map(normalizePriority),
  };
}

export function normalizePriority(p = {}) {
  return {
    id: p.id,
    title: p.title || '',
    detail: p.detail || '',
    horizon: HORIZON_KEYS.includes(p.horizon) ? p.horizon : DEFAULT_HORIZON,
    status: STATUSES.some(s => s.key === p.status) ? p.status : DEFAULT_STATUS,
    owner: p.owner || '',
    target: p.target || '',
    position: typeof p.position === 'number' ? p.position : 0,
    created_at: p.created_at || null,
    updated_at: p.updated_at || null,
  };
}

// Priorities for one horizon column, in display order.
export function prioritiesFor(priorities, horizonKey) {
  return (priorities || [])
    .filter(p => (p.horizon || DEFAULT_HORIZON) === horizonKey)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

// A blank priority ready to insert at the end of a horizon column.
export function makePriority(horizonKey, existing = []) {
  const inColumn = prioritiesFor(existing, horizonKey);
  const nextPos = inColumn.length ? (inColumn[inColumn.length - 1].position ?? 0) + 1 : 0;
  const now = new Date().toISOString();
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pri_${Date.now()}`,
    title: '',
    detail: '',
    horizon: HORIZON_KEYS.includes(horizonKey) ? horizonKey : DEFAULT_HORIZON,
    status: DEFAULT_STATUS,
    owner: '',
    target: '',
    position: nextPos,
    created_at: now,
    updated_at: now,
  };
}

// Merge a partial edit into a priority list (upsert by id).
export function upsertPriority(priorities, priority) {
  const list = Array.isArray(priorities) ? priorities : [];
  const idx = list.findIndex(p => p?.id === priority.id);
  if (idx === -1) return [...list, normalizePriority(priority)];
  const next = [...list];
  next[idx] = normalizePriority({ ...next[idx], ...priority, updated_at: new Date().toISOString() });
  return next;
}

export function removePriority(priorities, id) {
  return (Array.isArray(priorities) ? priorities : []).filter(p => p?.id !== id);
}

// Simple stats for the header ("N priorities · M at risk").
export function planStats(priorities) {
  const list = Array.isArray(priorities) ? priorities : [];
  return {
    total: list.length,
    atRisk: list.filter(p => p.status === 'at_risk').length,
    achieved: list.filter(p => p.status === 'achieved').length,
  };
}
