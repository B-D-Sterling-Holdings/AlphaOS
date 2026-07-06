export const EMPTY_ISSUE_BODY = [{ type: 'text', value: '' }];

export const ISSUE_LABELS = [
  { name: 'bug', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  { name: 'enhancement', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  { name: 'question', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  { name: 'documentation', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 ring-blue-200' },
  { name: 'ui/ux', dot: 'bg-pink-500', chip: 'bg-pink-50 text-pink-700 ring-pink-200' },
  { name: 'performance', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
];

export const ISSUE_PRIORITIES = [
  { value: 1, label: 'Urgent', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  { value: 2, label: 'High', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
  { value: 3, label: 'Medium', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { value: 4, label: 'Low', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
];

export const ISSUE_COMPLEXITIES = [
  { value: 5, label: 'Very hard', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  { value: 4, label: 'Hard', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 ring-orange-200' },
  { value: 3, label: 'Moderate', dot: 'bg-yellow-400', chip: 'bg-yellow-50 text-yellow-800 ring-yellow-200' },
  { value: 2, label: 'Easy', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  { value: 1, label: 'Trivial', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
];

export const ISSUE_SORTS = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'most-commented', label: 'Most commented' },
  { key: 'least-commented', label: 'Least commented' },
  { key: 'recently-updated', label: 'Recently updated' },
];

export function labelDef(name) {
  return ISSUE_LABELS.find(label => label.name === name)
    || { name, dot: 'bg-gray-400', chip: 'bg-gray-100 text-gray-600 ring-gray-300' };
}

export function blocksToHtml(value) {
  const blocks = Array.isArray(value) ? value : [{ type: 'text', value: value || '' }];
  return blocks
    .map(block => (block?.type === 'image'
      ? `<img src="${String(block.url || '').replace(/"/g, '&quot;')}" class="rt-inline-img" />`
      : (block?.value || '')))
    .filter(fragment => fragment && fragment.trim())
    .join('<br>');
}

export function isBodyEmpty(value) {
  if (Array.isArray(value)) {
    return !value.some(block => block?.type === 'image'
      || (block?.value && block.value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()));
  }
  return !(typeof value === 'string' && value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const secs = Math.max(0, (now - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 30 * 86400) return `${Math.floor(secs / 86400)}d ago`;
  const opts = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return `on ${date.toLocaleDateString(undefined, opts)}`;
}

export function filterIssues(issues, { query = '', labelFilter = [] } = {}) {
  const q = query.trim().toLowerCase();
  return issues.filter(issue => {
    if (labelFilter.length && !labelFilter.every(label => (issue.labels || []).includes(label))) return false;
    if (!q) return true;
    const haystack = [
      issue.title || '',
      issue.author || '',
      issue.number ? `#${issue.number}` : '',
      blocksToHtml(issue.body).replace(/<[^>]+>/g, ' '),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

export function countOpenIssues(issues) {
  return issues.filter(issue => issue.status !== 'resolved').length;
}

const byDate = (key, direction) => (a, b) => direction * (new Date(a[key] || 0) - new Date(b[key] || 0));
const byComments = (direction) => (a, b) => direction * ((a.comments || []).length - (b.comments || []).length);

export function getVisibleIssues(issues, { tab = 'open', sort = 'newest' } = {}) {
  if (tab === 'dev') {
    const priority = issue => issue.priority || 99;
    const sortOrder = issue => issue.sort_order ?? 0;
    return [...issues]
      .filter(issue => issue.status !== 'resolved')
      .sort((a, b) => priority(a) - priority(b)
        || sortOrder(a) - sortOrder(b)
        || (new Date(b.created_at || 0) - new Date(a.created_at || 0)));
  }

  const list = issues.filter(issue => (tab === 'closed' ? issue.status === 'resolved' : issue.status !== 'resolved'));
  const cmp = {
    newest: byDate('created_at', -1),
    oldest: byDate('created_at', 1),
    'most-commented': byComments(-1),
    'least-commented': byComments(1),
    'recently-updated': byDate('updated_at', -1),
  }[sort] || (() => 0);
  return [...list].sort(cmp);
}

export function findIssueSortSwap(visibleIssues, issue, direction) {
  const priority = item => item.priority || 99;
  const index = visibleIssues.findIndex(item => item.id === issue.id);
  if (index < 0) return null;

  let swapIndex = -1;
  if (direction === 'up') {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (priority(visibleIssues[i]) === priority(issue)) {
        swapIndex = i;
        break;
      }
    }
  } else {
    for (let i = index + 1; i < visibleIssues.length; i += 1) {
      if (priority(visibleIssues[i]) === priority(issue)) {
        swapIndex = i;
        break;
      }
    }
  }

  if (swapIndex < 0) return null;
  const other = visibleIssues[swapIndex];
  const currentSort = issue.sort_order ?? 0;
  const otherSort = other.sort_order ?? 0;
  return {
    other,
    issueSortOrder: otherSort === currentSort ? (direction === 'up' ? currentSort - 1 : currentSort + 1) : otherSort,
    otherSortOrder: currentSort,
  };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return body.error || fallback;
}

export async function fetchIssues() {
  const res = await fetch('/api/issues');
  if (!res.ok) throw new Error(await readError(res, 'Failed to load issues'));
  return res.json();
}

export async function mutateIssue(payload) {
  const res = await fetch('/api/issues', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res, 'Action failed'));
  return res.json();
}

export async function createIssueRecord({ title, body, labels }) {
  const res = await fetch('/api/issues', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Failed to create issue'));
  return res.json();
}

export async function deleteIssueById(id) {
  const res = await fetch(`/api/issues?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, 'Failed to delete'));
  return true;
}

export async function deleteIssueCommentById(issueId, commentId) {
  const res = await fetch(`/api/issues?id=${encodeURIComponent(issueId)}&commentId=${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, 'Failed to delete comment'));
  return res.json();
}
