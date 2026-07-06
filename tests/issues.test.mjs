import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blocksToHtml,
  filterIssues,
  findIssueSortSwap,
  getVisibleIssues,
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

test('findIssueSortSwap swaps within the same priority band only', () => {
  const visible = getVisibleIssues(issues, { tab: 'dev' });
  assert.deepEqual(findIssueSortSwap(visible, issues[0], 'up'), {
    other: issues[1],
    issueSortOrder: 1,
    otherSortOrder: 2,
  });
  assert.equal(findIssueSortSwap(visible, issues[1], 'up'), null);
});

test('timeAgo formats short relative times with an injectable clock', () => {
  const now = new Date('2026-01-01T01:00:00Z').getTime();
  assert.equal(timeAgo('2026-01-01T00:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-01-01T00:30:00Z', now), '30m ago');
  assert.equal(timeAgo('2025-12-31T22:00:00Z', now), '3h ago');
});
