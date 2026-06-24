// Per-name research progress, derived purely from a saved thesis object.
//
// The Workflow page (/workflow) renders a sub-step strip for every research-stage
// name; each step maps 1:1 to a tab on the Research page (/research). Keeping this
// thesis-only (no /api/ticker or /api/model fetch) lets the overview compute every
// name's progress from a single /api/thesis call per ticker.
//
// Content checks mirror the ones used inside research/page.jsx (`hasTextValue` /
// `overviewHasContent`) so a step lights up exactly when that section reads as
// "filled" on the Research page.

// Rich value: either an array of { type:'text'|'image', value, url } blocks (new
// rich-text/RichTextArea format) or a legacy HTML/plain string. True when there is
// any visible text or an image.
function richHasContent(val) {
  if (Array.isArray(val)) {
    return val.some(block => block?.type === 'image'
      ? Boolean(block.url || block.value)
      : Boolean(block?.value && block.value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()));
  }
  if (typeof val === 'string') return val.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim().length > 0;
  return false;
}

// Plain-string box (the Thesis Structure / fundamentals boxes are plain text).
function strHasContent(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

const VALUATION_FIELDS = ['revenueCAGR', 'operatingMargin', 'buybackRate', 'exitPE', 'exitFCFYield', 'terminalGrowthRate'];

const STATE_WEIGHT = { done: 1, partial: 0.5, todo: 0 };

/**
 * Compute the ordered research progress for one name.
 * @param {object} thesis - the object returned by GET /api/thesis/{ticker}
 * @returns {{ steps: Array<{key,label,tab,state,detail}>, percent: number, doneCount: number, total: number }}
 */
export function computeResearchProgress(thesis) {
  const uw = thesis?.underwriting || {};
  const ws = uw.researchWorkspace || {};
  const dr = uw.draftReview || {};
  const fundamentals = ws.fundamentals || {};
  const dd = ws.dueDiligenceItems || [];
  const dis = ws.dislocationItems || [];
  const news = thesis?.newsUpdates || [];

  // 1 — Fundamentals: the analyst's "Why this name is here" note (lives on the
  // Fundamentals tab alongside the auto-generated charts).
  const noteFilled = strHasContent(ws.note) || richHasContent(ws.note);
  const fundamentals_ = noteFilled ? 'done' : 'todo';

  // 2 — Thesis: company overview + the four Thesis Structure boxes + the narrative.
  const anyBox = Object.values(fundamentals).some(strHasContent);
  const thesisParts = [richHasContent(uw.companyOverview), anyBox, richHasContent(thesis?.assumptions)];
  const thesisFilled = thesisParts.filter(Boolean).length;
  const thesis_ = thesisFilled === 0 ? 'todo' : thesisFilled === thesisParts.length ? 'done' : 'partial';

  // 3 — Diligence: due-diligence + dislocation questions; partial while any are open.
  const items = [...dd, ...dis];
  const answered = items.filter(i => i?.done).length;
  const diligence_ = items.length === 0 ? 'todo' : answered === items.length ? 'done' : 'partial';

  // 4 — Valuation: any underwriting valuation input or the legacy valuation note.
  const valuationFilled = richHasContent(thesis?.valuation) || VALUATION_FIELDS.some(f => strHasContent(uw[f]));
  const valuation_ = valuationFilled ? 'done' : 'todo';

  // 5 — Draft & Review: the paper plus the back-and-forth review threads.
  const paperFilled = richHasContent(dr.paper);
  const threads = dr.threads || [];
  const allResolved = threads.length > 0 && threads.every(t => t?.resolved);
  let review_ = 'todo';
  if (paperFilled || threads.length) {
    review_ = (paperFilled && allResolved) ? 'done' : 'partial';
  }

  // 6 — News & updates.
  const news_ = news.length > 0 ? 'done' : 'todo';

  // 7 — Decision: an equity rating has been set.
  const decision_ = (uw.equityRating || 0) > 0 ? 'done' : 'todo';

  const steps = [
    { key: 'fundamentals', label: 'Fundamentals', tab: 'fundamentals', state: fundamentals_ },
    { key: 'thesis', label: 'Thesis', tab: 'thesis', state: thesis_, detail: `${thesisFilled}/${thesisParts.length}` },
    { key: 'diligence', label: 'Diligence', tab: 'diligence', state: diligence_, detail: items.length ? `${answered}/${items.length}` : '' },
    { key: 'valuation', label: 'Valuation', tab: 'valuation', state: valuation_ },
    { key: 'review', label: 'Draft & Review', tab: 'review', target: 'draftReview', state: review_, detail: threads.length ? `${threads.length} pts` : '' },
    { key: 'news', label: 'News', tab: 'news', state: news_, detail: news.length ? `${news.length}` : '' },
    { key: 'decision', label: 'Decision', tab: 'decision', state: decision_, detail: (uw.equityRating || 0) > 0 ? `${uw.equityRating}/5` : '' },
  ];

  const score = steps.reduce((sum, s) => sum + (STATE_WEIGHT[s.state] || 0), 0);
  const doneCount = steps.filter(s => s.state === 'done').length;
  const percent = Math.round((score / steps.length) * 100);

  return { steps, percent, doneCount, total: steps.length };
}

// Compact draft/review status for the Workflow pipeline's Draft & Review stage.
export function draftReviewStatus(thesis) {
  const dr = thesis?.underwriting?.draftReview || {};
  const threads = dr.threads || [];
  const open = threads.filter(t => !t?.resolved).length;
  return {
    hasPaper: richHasContent(dr.paper),
    total: threads.length,
    open,
    resolved: threads.length - open,
  };
}

// Diligence checklist tally (due-diligence + dislocation questions) for the
// Workflow pipeline. The checklist is seeded into the research workspace, so a
// draft-stage name only has counts once it has touched Research; callers should
// treat `total === 0` as "no checklist yet" rather than "0% done".
export function checklistStatus(thesis) {
  const ws = thesis?.underwriting?.researchWorkspace || {};
  const items = [...(ws.dueDiligenceItems || []), ...(ws.dislocationItems || [])];
  const done = items.filter(i => i?.done).length;
  return { done, total: items.length };
}

// Valid Research-page tab keys a deep link (?tab=) may target. Draft & Review is
// its own top-level page (/draft-review), so it is intentionally not in this list.
export const RESEARCH_TABS = ['fundamentals', 'thesis', 'diligence', 'valuation', 'news', 'decision'];
