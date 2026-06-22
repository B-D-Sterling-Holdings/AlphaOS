'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { UserPlus, ShieldCheck, Loader2, Users, Trash2 } from 'lucide-react';

export default function AdminPage() {
  const { isAdmin, loading: authLoading } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin, loadUsers]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      setNotice(`Created "${data.user.username}" with an isolated workspace.`);
      setForm({ username: '', password: '', role: 'user' });
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(u) {
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, isActive: !u.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user');
      loadUsers();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(u) {
    if (!window.confirm(
      `Permanently delete "${u.username}" and its entire workspace?\n\nThis erases all of this user's data and cannot be undone.`
    )) return;
    setError('');
    setNotice('');
    setDeletingId(u.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');
      setNotice(`Deleted "${u.username}" and its workspace.`);
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-24 text-center text-gray-500">
        <ShieldCheck className="mx-auto mb-3 text-gray-300" size={40} />
        <p className="font-semibold text-gray-700">Admin access required</p>
        <p className="text-sm mt-1">Your account doesn’t have permission to manage users.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2.5 mb-6">
        <Users className="text-emerald-600" size={22} />
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">User Management</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 text-sm">{notice}</div>
      )}

      {/* Create user */}
      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 mb-8">
        <div className="flex items-center gap-2 mb-4 text-gray-700 font-semibold">
          <UserPlus size={17} /> Add a user
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="Username"
            required
            className="sm:col-span-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
          />
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="Password (min 6 chars)"
            required
            className="sm:col-span-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
          />
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <p className="text-[12px] text-gray-400 mt-3">
          A new user gets a completely isolated workspace (its own tenant). No data is shared with existing users.
        </p>
        <button
          type="submit"
          disabled={creating}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
        >
          {creating ? <Loader2 className="animate-spin" size={15} /> : <UserPlus size={15} />} Create user
        </button>
      </form>

      {/* User list */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-5 py-3 font-semibold">User</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 font-semibold">Workspace</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                No admin-created users yet. The CIO and demo logins are built-in and not listed here.
              </td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-b border-gray-50 last:border-0">
                <td className="px-5 py-3 font-medium text-gray-800">{u.username}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${u.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-500">{u.tenantName || '—'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {u.isActive ? 'active' : 'disabled'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={deletingId === u.id}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {u.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={deletingId === u.id}
                      title="Delete user and workspace"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deletingId === u.id ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />} Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
