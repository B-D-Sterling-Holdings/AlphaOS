// Client-side fetch helpers for the per-company Research Task panel.
// Edits are plain last-write-wins (the server does a direct UPDATE), so there's
// no version token to carry and no 409 to reconcile — a PUT just returns the
// saved row.

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

export async function updateResearchTask(id, updates) {
  const res = await fetch('/api/research-tasks', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, ...updates }),
  });
  return { ok: res.ok, data: await readJson(res) };
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
