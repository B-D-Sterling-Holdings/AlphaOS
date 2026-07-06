import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  patchAdminUser,
} from '../src/lib/adminClient.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

test('fetchAdminUsers returns API users payload', async () => {
  global.fetch = async (url) => {
    assert.equal(url, '/api/admin/users');
    return { ok: true, json: async () => ({ users: [{ username: 'cio' }] }) };
  };

  assert.deepEqual(await fetchAdminUsers(), { users: [{ username: 'cio' }] });
});

test('admin mutations send JSON payloads with the expected method', async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ ok: true, user: { username: 'avery' } }) };
  };

  await createAdminUser({ username: 'avery', password: 'secret' });
  await patchAdminUser({ id: 'u1', isActive: false });
  await deleteAdminUser({ id: 'u1' });

  assert.deepEqual(requests.map(request => request.options.method), ['POST', 'PATCH', 'DELETE']);
  assert.deepEqual(JSON.parse(requests[0].options.body), { username: 'avery', password: 'secret' });
  assert.deepEqual(JSON.parse(requests[1].options.body), { id: 'u1', isActive: false });
  assert.deepEqual(JSON.parse(requests[2].options.body), { id: 'u1' });
});

test('admin client throws API error messages', async () => {
  global.fetch = async () => ({
    ok: false,
    json: async () => ({ error: 'No access' }),
  });

  await assert.rejects(() => patchAdminUser({ id: 'u1' }), /No access/);
});
