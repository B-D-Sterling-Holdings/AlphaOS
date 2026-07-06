const jsonHeaders = { 'Content-Type': 'application/json' };

async function readJsonResponse(res, fallbackMessage) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

export async function fetchAdminUsers() {
  const res = await fetch('/api/admin/users');
  return readJsonResponse(res, 'Failed to load users');
}

export async function createAdminUser(payload) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return readJsonResponse(res, 'Failed to create user');
}

export async function patchAdminUser(payload, fallbackMessage = 'Failed to update user') {
  const res = await fetch('/api/admin/users', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return readJsonResponse(res, fallbackMessage);
}

export async function deleteAdminUser(payload, fallbackMessage = 'Failed to delete user') {
  const res = await fetch('/api/admin/users', {
    method: 'DELETE',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return readJsonResponse(res, fallbackMessage);
}
