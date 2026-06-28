// Single source of truth for the Lessons Learned feature: enums, human labels,
// badge styling, the post-mortem template structure, and quick-add presets.
// Consumed by the Lessons page and (for labels) anywhere lessons surface.
//
// Lessons turn investment outcomes into repeatable process improvements:
// research -> decision -> outcome -> post-mortem -> extracted lesson -> better process.

/* ── Enums (value -> label + badge classes) ────────────────────── */
// Badge classes intentionally mirror the app's pill language: soft tinted bg,
// matching text, subtle ring.

export const LESSON_TYPES = {
  post_mortem:        { label: 'Post-mortem',        badge: 'bg-rose-50 text-rose-700 ring-rose-200' },
  missed_opportunity: { label: 'Missed opportunity', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  good_decision:      { label: 'Good decision',      badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  research_lesson:    { label: 'Research lesson',    badge: 'bg-blue-50 text-blue-700 ring-blue-200' },
  process_mistake:    { label: 'Process mistake',    badge: 'bg-violet-50 text-violet-700 ring-violet-200' },
};

export const OUTCOMES = {
  correct_thesis:             { label: 'Correct thesis',            badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  wrong_thesis:               { label: 'Wrong thesis',              badge: 'bg-rose-50 text-rose-700 ring-rose-200' },
  early:                      { label: 'Early',                     badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  right_business_wrong_price: { label: 'Right business, wrong price', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  good_pass:                  { label: 'Good pass',                 badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  missed_upside:              { label: 'Missed upside',             badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  uncertain:                  { label: 'Still uncertain',           badge: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

export const CATEGORIES = {
  business:          { label: 'Business analysis' },
  financial:         { label: 'Financial analysis' },
  valuation:         { label: 'Valuation' },
  risk:              { label: 'Risk' },
  behavioral:        { label: 'Behavioral' },
  process:           { label: 'Process' },
  capital_allocation:{ label: 'Capital allocation' },
  management:        { label: 'Management' },
  regulation:        { label: 'Regulation' },
  other:             { label: 'Other' },
};

export const SEVERITY = {
  low:    { label: 'Low',    badge: 'bg-gray-100 text-gray-600 ring-gray-200',   dot: 'bg-gray-400' },
  medium: { label: 'Medium', badge: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  high:   { label: 'High',   badge: 'bg-rose-50 text-rose-700 ring-rose-200',    dot: 'bg-rose-500' },
};

// Repeat risk reuses the severity scale (low/medium/high) but with its own label.
export const REPEAT_RISK = SEVERITY;

export const STATUSES = {
  not_reviewed: { label: 'Not reviewed', badge: 'bg-gray-100 text-gray-600 ring-gray-200' },
  watch_item:   { label: 'Watch item',   badge: 'bg-blue-50 text-blue-700 ring-blue-200' },
  one_off:      { label: 'One-off',       badge: 'bg-violet-50 text-violet-700 ring-violet-200' },
  archived:     { label: 'Archived',      badge: 'bg-gray-100 text-gray-500 ring-gray-200' },
};

export const POSITION_TYPES = {
  owned:     { label: 'Owned' },
  passed:    { label: 'Passed' },
  sold:      { label: 'Sold' },
  watchlist: { label: 'Watchlist' },
  missed:    { label: 'Missed' },
};

/* ── Detail template ───────────────────────────────────────────── */
// The post-mortem long-form lives in `lesson.detail` (a JSONB blob). Each section
// is ONE large rich-text editor (same component + copy/paste / table / inline
// image support as Draft & Review). `guide` lists example subheadings/prompts
// shown above the editor so it never feels like a blank form. Order tells the
// story: setup -> outcome -> analysis -> the payoff (the lesson).

export const DETAIL_SECTIONS = [
  {
    id: 'setup',
    title: 'The Setup',
    subtitle: 'What we believed going in',
    desc: 'Reconstruct the decision honestly — the thesis as it actually was at the time, not with hindsight.',
    guide: ['Original thesis', 'What we believed at the time', 'Expected drivers', 'What needed to go right'],
  },
  {
    id: 'outcome',
    title: 'What Happened',
    subtitle: 'The actual outcome',
    desc: 'How it actually played out and where reality diverged from the thesis.',
    guide: ['Actual outcome — price, fundamentals, time', 'What happened instead', 'Thesis result: right / wrong / early'],
  },
  {
    id: 'analysis',
    title: 'The Analysis',
    subtitle: 'Right, wrong, and the root cause',
    desc: 'Separate process from outcome — a good decision can have a bad result, and vice-versa.',
    guide: ['What we got right', 'What we missed', 'Main error category / root cause'],
  },
  {
    id: 'lesson',
    title: 'The Lesson',
    subtitle: 'Turn this into process',
    accent: true, // visually emphasized — this is the payoff
    desc: 'Write the reusable principle so it applies beyond this one stock — and note where it should fire next time.',
    guide: ['Key lesson', 'Why this lesson matters', 'Where this lesson applies in the future', 'How this changes future research'],
  },
];

// Flat list of every detail key (one per section editor).
export const DETAIL_FIELD_KEYS = DETAIL_SECTIONS.map(s => s.id);

// Flatten a detail value (rich-text blocks OR a legacy string) to plain text —
// for list previews and search.
export function blocksToPlain(value) {
  if (!value) return '';
  const raw = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map(b => (b?.type === 'image' ? '' : (b?.value || ''))).join(' ')
      : '';
  return raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/* ── Quick-add templates ───────────────────────────────────────── */
// Pre-seed type/outcome/category so a new lesson never starts as a blank form.

export const LESSON_TEMPLATES = [
  {
    id: 'post_mortem_loss',
    label: 'Post-mortem — loss',
    icon: 'AlertTriangle',
    description: 'A position that went wrong. Find the root cause.',
    defaults: {
      type: 'post_mortem',
      outcome: 'wrong_thesis',
      category: 'business',
      severity: 'high',
      repeat_risk: 'medium',
      position_type: 'sold',
    },
  },
  {
    id: 'good_decision',
    label: 'Good decision',
    icon: 'CheckCircle2',
    description: 'Capture what worked, so you repeat it.',
    defaults: {
      type: 'good_decision',
      outcome: 'correct_thesis',
      category: 'process',
      severity: 'low',
      repeat_risk: 'low',
      position_type: 'owned',
    },
  },
  {
    id: 'missed_opportunity',
    label: 'Missed opportunity',
    icon: 'TrendingUp',
    description: 'Something you passed on that ran. Why did you miss it?',
    defaults: {
      type: 'missed_opportunity',
      outcome: 'missed_upside',
      category: 'valuation',
      severity: 'medium',
      repeat_risk: 'medium',
      position_type: 'missed',
    },
  },
  {
    id: 'research_lesson',
    label: 'Research lesson',
    icon: 'BookOpen',
    description: 'A reusable insight about the research process itself.',
    defaults: {
      type: 'research_lesson',
      outcome: 'uncertain',
      category: 'process',
      severity: 'low',
      repeat_risk: 'low',
      position_type: 'watchlist',
    },
  },
];

/* ── Helpers ───────────────────────────────────────────────────── */

// Build the dropdown option list `[{ value, label }]` from an enum map.
export function optionsFrom(enumMap) {
  return Object.entries(enumMap).map(([value, v]) => ({ value, label: v.label }));
}

// Safe label lookup (falls back to the raw value).
export function labelOf(enumMap, value) {
  return enumMap[value]?.label || value || '';
}

// Empty detail object with every template key present.
export function emptyDetail() {
  return Object.fromEntries(DETAIL_FIELD_KEYS.map(k => [k, '']));
}
