import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blocksToHtml,
  countArchivedIssues,
  countClosedIssues,
  countOpenIssues,
  filterIssues,
  findIssueSortSwap,
  getVisibleIssues,
  isArchived,
  isBodyEmpty,
  timeAgo,
} from '../src/lib/issues.js';

const issues = [
  {
    id: 'a',
    title: 'Broken chart',
    author: 'Alex',
    number: 1,
    labels: ['bug'],
    status: 'open',
    priority: 2,
    sort_order: 2,
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    body: [{ type: 'text', value: 'Chart fails on mobile' }],
    comments: [{ id: 'c1' }, { id: 'c2' }],
  },
  {
    id: 'b',
    title: 'Add export',
    author: 'Blair',
    number: 2,
    labels: ['enhancement'],
    status: 'open',
    priority: 2,
    sort_order: 1,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-04T00:00:00Z',
    body: 'Need CSV export',
    comments: [],
  },
  {
    id: 'c',
    title: 'Old resolved item',
    author: 'Casey',
    number: 3,
    labels: ['bug'],
    status: 'resolved',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
    comments: [{ id: 'c3' }],
  },
];

test('blocksToHtml and isBodyEmpty normalize issue rich text blocks', () => {
  assert.equal(
    blocksToHtml([
      { type: 'text', value: '<b>Hello</b>' },
      { type: 'image', url: 'https://example.com/a"b.png' },
    ]),
    '<b>Hello</b><br><img src="https://example.com/a&quot;b.png" class="rt-inline-img" />'
  );

  assert.equal(isBodyEmpty([{ type: 'text', value: '<p>&nbsp;</p>' }]), true);
  assert.equal(isBodyEmpty([{ type: 'image', url: 'x' }]), false);
});

test('filterIssues searches title, author, number, labels, and rich-text body', () => {
  assert.deepEqual(filterIssues(issues, { query: 'mobile' }).map(issue => issue.id), ['a']);
  assert.deepEqual(filterIssues(issues, { query: '#2' }).map(issue => issue.id), ['b']);
  assert.deepEqual(filterIssues(issues, { labelFilter: ['bug'] }).map(issue => issue.id), ['a', 'c']);
});

test('getVisibleIssues applies open, closed, sort, and dev-tab ordering rules', () => {
  assert.deepEqual(getVisibleIssues(issues, { tab: 'open', sort: 'newest' }).map(issue => issue.id), ['a', 'b']);
  assert.deepEqual(getVisibleIssues(issues, { tab: 'closed' }).map(issue => issue.id), ['c']);
  assert.deepEqual(getVisibleIssues(issues, { tab: 'open', sort: 'least-commented' }).map(issue => issue.id), ['b', 'a']);
  assert.deepEqual(getVisibleIssues(issues, { tab: 'dev' }).map(issue => issue.id), ['b', 'a']);
});

test('Closed tab is ordered by close time (most recently closed first), ignoring the sort control', () => {
  const closed = [
    { id: 'r1', status: 'resolved', created_at: '2026-01-01T00:00:00Z', resolved_at: '2026-03-01T00:00:00Z' },
    { id: 'r2', status: 'resolved', created_at: '2026-02-01T00:00:00Z', resolved_at: '2026-05-01T00:00:00Z' },
    { id: 'r3', status: 'resolved', created_at: '2026-01-15T00:00:00Z', resolved_at: '2026-04-01T00:00:00Z' },
    // Legacy row with no resolved_at falls back to updated_at.
    { id: 'r4', status: 'resolved', created_at: '2026-01-20T00:00:00Z', updated_at: '2026-02-15T00:00:00Z' },
  ];
  // newest close first regardless of the requested sort:
  assert.deepEqual(getVisibleIssues(closed, { tab: 'closed', sort: 'oldest' }).map(i => i.id), ['r2', 'r3', 'r1', 'r4']);
});

test('findIssueSortSwap swaps within the same priority band only', () => {
  const visible = getVisibleIssues(issues, { tab: 'dev' });
  assert.deepEqual(findIssueSortSwap(visible, issues[0], 'up'), {
    other: issues[1],
    issueSortOrder: 1,
    otherSortOrder: 2,
  });
  assert.equal(findIssueSortSwap(visible, issues[1], 'up'), null);
});

test('archived issues leave the Open/Closed/Dev tabs and surface in Archived (newest first)', () => {
  const withArchived = [
    ...issues,
    { id: 'x', title: 'Archived open', status: 'open', archived_at: '2026-02-01T00:00:00Z', created_at: '2026-01-06T00:00:00Z' },
    { id: 'y', title: 'Archived resolved', status: 'resolved', archived_at: '2026-02-03T00:00:00Z', created_at: '2026-01-07T00:00:00Z' },
  ];

  // Active tabs ignore archived rows entirely.
  assert.deepEqual(getVisibleIssues(withArchived, { tab: 'open' }).map(i => i.id), ['a', 'b']);
  assert.deepEqual(getVisibleIssues(withArchived, { tab: 'closed' }).map(i => i.id), ['c']);
  assert.deepEqual(getVisibleIssues(withArchived, { tab: 'dev' }).map(i => i.id), ['b', 'a']);

  // Archived tab shows both (regardless of status), most-recently-archived first.
  assert.deepEqual(getVisibleIssues(withArchived, { tab: 'archived' }).map(i => i.id), ['y', 'x']);

  assert.equal(isArchived(withArchived[3]), true);
  assert.equal(isArchived(issues[0]), false);
  assert.equal(countOpenIssues(withArchived), 2);
  assert.equal(countClosedIssues(withArchived), 1);
  assert.equal(countArchivedIssues(withArchived), 2);
});

test('timeAgo formats short relative times with an injectable clock', () => {
  const now = new Date('2026-01-01T01:00:00Z').getTime();
  assert.equal(timeAgo('2026-01-01T00:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-01-01T00:30:00Z', now), '30m ago');
  assert.equal(timeAgo('2025-12-31T22:00:00Z', now), '3h ago');
});
