// Client-side fetch helpers for the per-company Research Task panel.
// Mirrors src/lib/taskBoardApi.js: PUTs carry the optimistic-concurrency
// `baseVersion` and surface a 409 as { ok:false, conflict:true, current } so the
// caller can adopt the fresh row instead of clobbering a concurrent edit.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson(res) {
  return res.json().catch(() => ({}));
}

export async function fetchResearchTasks(ticker) {
  if (!ticker) return [];
  const res = await fetch(`/api/research-tasks?ticker=${encodeURIComponent(ticker)}`);
  const data = await readJson(res);
  return Array.isArray(data) ? data : [];
}

export async function createResearchTask(ticker, { title, status, assignee, tags } = {}) {
  const res = await fetch('/api/research-tasks', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ticker, title, status, assignee, tags }),
  });
  return { ok: res.ok, data: await readJson(res) };
}

export async function updateResearchTask(id, updates, baseVersion) {
  const res = await fetch('/api/research-tasks', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, ...updates, baseVersion }),
  });
  const data = await readJson(res);
  if (res.status === 409 && data.conflict) {
    return { ok: false, conflict: true, current: data.current, data };
  }
  return { ok: res.ok, data };
}

export async function deleteResearchTask(id) {
  const res = await fetch(`/api/research-tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { ok: res.ok };
}

// Persist a drag-and-drop reorder. `items` is [{ id, position }] for the tasks
// whose position changed.
export async function reorderResearchTasks(items) {
  const res = await fetch('/api/research-tasks/reorder', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  });
  return { ok: res.ok };
}
