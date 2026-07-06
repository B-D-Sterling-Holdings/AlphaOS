import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addAssignee,
  addSubtask,
  createBoard,
  finalizeTaskDrag,
  moveTaskAcrossPriority,
  removeBoard,
  renameBoard,
  resolveBoardsPayload,
  updateSubtask,
} from '../src/lib/taskBoard.js';

const sampleTasks = () => [
  { id: 'a', title: 'A', priority: 'highest', position: 0, done: false, subtasks: [] },
  { id: 'b', title: 'B', priority: 'highest', position: 1, done: false, subtasks: [] },
  { id: 'c', title: 'C', priority: 'medium', position: 0, done: false, subtasks: [] },
  { id: 'd', title: 'D', priority: 'medium', position: 1, done: false, subtasks: [] },
];

test('board helpers resolve, create, rename, and remove boards', () => {
  assert.deepEqual(resolveBoardsPayload({}), {
    boards: [{ id: 'default', name: 'Main Board' }],
    activeBoardId: 'default',
  });

  const created = createBoard([{ id: 'default', name: 'Main Board' }], 'Ops', () => 42);
  assert.equal(created.activeBoardId, 'board_42');
  assert.deepEqual(created.boards.at(-1), { id: 'board_42', name: 'Ops' });

  const renamed = renameBoard(created.boards, 'board_42', 'Research');
  assert.equal(renamed.at(-1).name, 'Research');

  const removed = removeBoard(renamed, 'board_42', 'board_42');
  assert.equal(removed.activeBoardId, 'default');
  assert.deepEqual(removed.boards, [{ id: 'default', name: 'Main Board' }]);
});

test('assignee helper avoids duplicate names case-insensitively', () => {
  const first = addAssignee([], 'Avery', '#2563eb');
  const second = addAssignee(first, 'avery', '#dc2626');
  assert.equal(second, first);
  assert.deepEqual(first, [{ name: 'Avery', color: '#2563eb' }]);
});

test('subtask helpers update a task without mutating the original list', () => {
  const original = [{ id: 't1', subtasks: [] }];
  const withSubtask = addSubtask(original, 't1', 'Read filing', () => 100);
  assert.deepEqual(original[0].subtasks, []);
  assert.deepEqual(withSubtask[0].subtasks, [
    { id: 100, title: 'Read filing', done: false, assignee: '' },
  ]);

  const assigned = updateSubtask(withSubtask, 't1', 100, { assignee: 'Avery' });
  assert.equal(assigned[0].subtasks[0].assignee, 'Avery');
});

test('moveTaskAcrossPriority moves between sections and reindexes affected priorities', () => {
  const moved = moveTaskAcrossPriority(sampleTasks(), 'a', 'd').tasks;
  assert.deepEqual(
    moved.map(task => [task.id, task.priority, task.position]),
    [
      ['b', 'highest', 0],
      ['c', 'medium', 0],
      ['a', 'medium', 1],
      ['d', 'medium', 2],
    ]
  );
});

test('moveTaskAcrossPriority rejects moves into full capped sections', () => {
  const fullHighest = [
    { id: 'a', priority: 'highest', position: 0, done: false },
    { id: 'b', priority: 'highest', position: 1, done: false },
    { id: 'c', priority: 'highest', position: 2, done: false },
    { id: 'd', priority: 'medium', position: 0, done: false },
  ];
  const moved = moveTaskAcrossPriority(fullHighest, 'd', 'a');
  assert.equal(moved.rejectedPriority, 'highest');
  assert.equal(moved.tasks, fullHighest);
});

test('finalizeTaskDrag computes same-section reorder payloads', () => {
  const snapshot = sampleTasks();
  const current = sampleTasks();
  const finalized = finalizeTaskDrag(current, snapshot, 'a', 'b');

  assert.deepEqual(finalized.tasks.map(task => task.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(finalized.itemsToSave, [
    { id: 'b', position: 0 },
    { id: 'a', position: 1 },
  ]);
});

test('finalizeTaskDrag persists cross-section priority changes', () => {
  const snapshot = sampleTasks();
  const current = moveTaskAcrossPriority(snapshot, 'a', 'd').tasks;
  const finalized = finalizeTaskDrag(current, snapshot, 'a', 'd');

  assert.deepEqual(finalized.itemsToSave, [
    { id: 'b', position: 0 },
    { id: 'a', position: 1, priority: 'medium' },
    { id: 'd', position: 2 },
  ]);
});
