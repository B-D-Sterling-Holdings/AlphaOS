export const PRIORITY_SECTIONS = [
  { key: 'highest', label: 'HIGH PRIORITY',   color: 'bg-red-500',     maxTasks: 3 },
  { key: 'medium',  label: 'MEDIUM PRIORITY', color: 'bg-yellow-400',  maxTasks: 5 },
  { key: 'low',     label: 'LOW PRIORITY',    color: 'bg-emerald-500', maxTasks: null },
];

export const COLOR_PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#c026d3',
  '#4f46e5',
];

export const DEFAULT_BOARDS = [{ id: 'default', name: 'Main Board' }];

// A stable colour for a name, hashed into COLOR_PALETTE. Used to give each
// workspace user a consistent assignee-tag colour without storing a roster —
// the same name always lands on the same palette entry.
export function colorForName(name) {
  const s = String(name || '');
  if (!s) return COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

export function getColorForAssignee(assignee, savedAssignees) {
  if (!assignee) return null;
  const found = savedAssignees.find(a => a.name.toLowerCase() === assignee.toLowerCase());
  return found ? found.color : '#6b7280';
}

export function getAssigneeInlineStyle(assignee, savedAssignees) {
  const color = getColorForAssignee(assignee, savedAssignees);
  if (!color) return {};
  return { backgroundColor: color, borderColor: color, color: '#fff' };
}

export function getMaxForPriority(priority) {
  return PRIORITY_SECTIONS.find(section => section.key === priority)?.maxTasks ?? null;
}

export function tasksByPriority(tasks, priority) {
  return tasks.filter(task => task.priority === priority && !task.done);
}

export function completedTasks(tasks) {
  return tasks.filter(task => task.done);
}

export function openTaskCount(tasks) {
  return tasks.filter(task => !task.done).length;
}

export function isPriorityAtCapacity(tasks, priority) {
  const max = getMaxForPriority(priority);
  return !!max && tasksByPriority(tasks, priority).length >= max;
}

export function resolveBoardsPayload(payload) {
  const boards = Array.isArray(payload?.boards) && payload.boards.length > 0
    ? payload.boards
    : DEFAULT_BOARDS;
  return {
    boards,
    activeBoardId: payload?.activeBoardId || boards[0].id,
  };
}

export function createBoard(boards, name, now = Date.now) {
  const id = `board_${now()}`;
  return {
    boards: [...boards, { id, name }],
    activeBoardId: id,
  };
}

export function renameBoard(boards, id, name) {
  return boards.map(board => board.id === id ? { ...board, name } : board);
}

export function removeBoard(boards, activeBoardId, id) {
  const remaining = boards.filter(board => board.id !== id);
  if (remaining.length === 0) return null;
  return {
    boards: remaining,
    activeBoardId: activeBoardId === id ? remaining[0].id : activeBoardId,
  };
}

export function addAssignee(savedAssignees, name, color) {
  const exists = savedAssignees.find(assignee => assignee.name.toLowerCase() === name.toLowerCase());
  return exists ? savedAssignees : [...savedAssignees, { name, color }];
}

export function removeAssignee(savedAssignees, name) {
  return savedAssignees.filter(assignee => assignee.name.toLowerCase() !== name.toLowerCase());
}

export function updateTask(tasks, taskId, updates) {
  return tasks.map(task => task.id === taskId ? { ...task, ...updates } : task);
}

export function createSubtask(title, now = Date.now) {
  return { id: now(), title, done: false, assignee: '' };
}

export function updateSubtasks(tasks, taskId, subtasks) {
  return updateTask(tasks, taskId, { subtasks });
}

export function addSubtask(tasks, taskId, title, now = Date.now) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return tasks;
  return updateSubtasks(tasks, taskId, [
    ...(task.subtasks || []),
    createSubtask(title, now),
  ]);
}

export function toggleSubtask(tasks, taskId, subtaskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return tasks;
  return updateSubtasks(
    tasks,
    taskId,
    (task.subtasks || []).map(subtask =>
      subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
    )
  );
}

export function removeSubtask(tasks, taskId, subtaskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return tasks;
  return updateSubtasks(tasks, taskId, (task.subtasks || []).filter(subtask => subtask.id !== subtaskId));
}

export function updateSubtask(tasks, taskId, subtaskId, updates) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return tasks;
  return updateSubtasks(
    tasks,
    taskId,
    (task.subtasks || []).map(subtask =>
      subtask.id === subtaskId ? { ...subtask, ...updates } : subtask
    )
  );
}

export function renameSubtask(tasks, taskId, subtaskId, title) {
  return updateSubtask(tasks, taskId, subtaskId, { title });
}

export function removeEmptySubtask(tasks, taskId, subtaskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return tasks;
  const cleaned = (task.subtasks || []).filter(subtask => subtask.id !== subtaskId || subtask.title.trim());
  return cleaned.length === (task.subtasks || []).length ? tasks : updateSubtasks(tasks, taskId, cleaned);
}

export function insertBlankSubtaskAfter(tasks, taskId, subtaskId, now = Date.now) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return { tasks, subtask: null };
  const current = task.subtasks || [];
  const idx = current.findIndex(subtask => subtask.id === subtaskId);
  const subtask = createSubtask('', now);
  const subtasks = idx === -1
    ? [...current, subtask]
    : [...current.slice(0, idx + 1), subtask, ...current.slice(idx + 1)];
  return { tasks: updateSubtasks(tasks, taskId, subtasks), subtask };
}

function arrayMoveLocal(items, oldIndex, newIndex) {
  const next = [...items];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}

export function isSectionId(id) {
  return typeof id === 'string' && id.startsWith('section-');
}

export function priorityFromSectionId(id) {
  return isSectionId(id) ? id.replace('section-', '') : null;
}

export function findPriority(tasks, id) {
  return priorityFromSectionId(id) || tasks.find(task => task.id === id)?.priority || null;
}

export function moveTaskAcrossPriority(tasks, activeId, overId) {
  const activePriority = findPriority(tasks, activeId);
  const overPriority = findPriority(tasks, overId);
  if (!activePriority || !overPriority || activePriority === overPriority) {
    return { tasks };
  }

  const activeTask = tasks.find(task => task.id === activeId);
  if (!activeTask) return { tasks };

  const section = PRIORITY_SECTIONS.find(item => item.key === overPriority);
  const targetCount = tasks.filter(task =>
    task.priority === overPriority && !task.done && task.id !== activeId
  ).length;
  if (section?.maxTasks && targetCount >= section.maxTasks) {
    return { tasks, rejectedPriority: overPriority };
  }

  const overIsSection = isSectionId(overId);
  const targetTasks = tasks.filter(task => task.priority === overPriority);
  let insertIdx = targetTasks.length;
  if (!overIsSection) {
    const idx = targetTasks.findIndex(task => task.id === overId);
    if (idx !== -1) insertIdx = idx;
  }

  const next = tasks.filter(task => task.id !== activeId).map(task => ({ ...task }));
  const movedTask = { ...activeTask, priority: overPriority };

  if (insertIdx >= targetTasks.length) {
    const lastTarget = targetTasks[targetTasks.length - 1];
    const globalIdx = lastTarget ? next.findIndex(task => task.id === lastTarget.id) + 1 : next.length;
    next.splice(globalIdx, 0, movedTask);
  } else {
    const globalIdx = next.findIndex(task => task.id === targetTasks[insertIdx].id);
    next.splice(globalIdx, 0, movedTask);
  }

  const affected = new Set([activePriority, overPriority]);
  const counters = {};
  const reindexed = next.map(task => {
    if (!affected.has(task.priority)) return task;
    counters[task.priority] = counters[task.priority] ?? 0;
    return { ...task, position: counters[task.priority]++ };
  });

  return { tasks: reindexed };
}

function taskOrderSort(a, b) {
  const pa = PRIORITY_SECTIONS.findIndex(section => section.key === a.priority);
  const pb = PRIORITY_SECTIONS.findIndex(section => section.key === b.priority);
  if (pa !== pb) return pa - pb;
  return a.position - b.position;
}

export function finalizeTaskDrag(currentTasks, snapshot, activeId, overId) {
  if (!overId || !snapshot) {
    return { tasks: snapshot || currentTasks, itemsToSave: [], shouldRevert: !!snapshot };
  }

  const activePriority = currentTasks.find(task => task.id === activeId)?.priority;
  if (!activePriority) return { tasks: currentTasks, itemsToSave: [] };

  const origTask = snapshot.find(task => task.id === activeId);
  const crossContainerMove = origTask && origTask.priority !== activePriority;

  if (isSectionId(overId) || crossContainerMove) {
    const itemsToSave = currentTasks
      .filter(task => {
        const orig = snapshot.find(item => item.id === task.id);
        return !orig || orig.position !== task.position || orig.priority !== task.priority;
      })
      .map(task => {
        const orig = snapshot.find(item => item.id === task.id);
        const item = { id: task.id, position: task.position };
        if (orig && orig.priority !== task.priority) item.priority = task.priority;
        return item;
      });
    return { tasks: currentTasks, itemsToSave };
  }

  const overTask = currentTasks.find(task => task.id === overId);
  if (!overTask || overTask.priority !== activePriority) {
    return { tasks: currentTasks, itemsToSave: [] };
  }

  const sectionTasks = currentTasks.filter(task => task.priority === activePriority);
  const oldIdx = sectionTasks.findIndex(task => task.id === activeId);
  const newIdx = sectionTasks.findIndex(task => task.id === overId);
  if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) {
    return { tasks: currentTasks, itemsToSave: [] };
  }

  const reorderedWithPos = arrayMoveLocal(sectionTasks, oldIdx, newIdx)
    .map((task, index) => ({ ...task, position: index }));
  const otherTasks = currentTasks.filter(task => task.priority !== activePriority);
  const tasks = [...otherTasks, ...reorderedWithPos].sort(taskOrderSort);
  const itemsToSave = reorderedWithPos
    .filter(task => {
      const orig = snapshot.find(item => item.id === task.id);
      return !orig || orig.position !== task.position;
    })
    .map(task => ({ id: task.id, position: task.position }));

  return { tasks, itemsToSave };
}
