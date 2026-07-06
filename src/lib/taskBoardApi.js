const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson(res) {
  return res.json().catch(() => ({}));
}

export async function fetchTaskBoards() {
  const res = await fetch('/api/task-boards');
  return readJson(res);
}

export async function saveTaskBoardsMeta({ boards, activeBoardId }) {
  const payload = {};
  if (boards !== undefined) payload.boards = boards;
  if (activeBoardId !== undefined) payload.activeBoardId = activeBoardId;
  return fetch('/api/task-boards', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export async function fetchTasksForBoard(boardId) {
  const res = await fetch(`/api/tasks?board_id=${encodeURIComponent(boardId)}`);
  return readJson(res);
}

export async function createTask({ title, priority, boardId }) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title, priority, board_id: boardId }),
  });
  return { ok: res.ok, data: await readJson(res) };
}

export async function updateTask(taskId, updates) {
  const res = await fetch('/api/tasks', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id: taskId, ...updates }),
  });
  return { ok: res.ok, data: await readJson(res) };
}

export async function deleteTask(taskId) {
  return fetch(`/api/tasks?id=${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export async function reorderTasks(items) {
  return fetch('/api/tasks/reorder', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  });
}

export async function deleteTasksForBoard(boardId) {
  const tasksInBoard = await fetchTasksForBoard(boardId);
  if (!Array.isArray(tasksInBoard)) return;
  await Promise.all(tasksInBoard.map(task => deleteTask(task.id)));
}

export async function fetchAssigneesForBoard(boardId) {
  const res = await fetch(`/api/assignees?board_id=${encodeURIComponent(boardId)}`);
  return readJson(res);
}

export async function saveAssigneesForBoard(boardId, assignees) {
  return fetch('/api/assignees', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ assignees, board_id: boardId }),
  });
}
