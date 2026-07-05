'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  UserPlus, ShieldCheck, Loader2, Users, SlidersHorizontal, Lock, Check,
  Trash2, KeyRound, Building2, Plus, X, Crown, MoreHorizontal, Power,
  Eye, EyeOff, Pencil,
} from 'lucide-react';
import { FEATURES } from '@/lib/features';

/*
  User management, two audiences sharing one page:

    admin — sees every workspace grouped as a card (owner first, members
            inside), plus a separate Administrators section. Creates new
            workspaces from the top form and adds members inline per workspace.
    owner — sees ONLY their own team and adds members to it. The API enforces
            this scoping server-side; the UI just matches it.
*/

// What a login IS, in words a human would use. `shared` = other logins exist
// in the same workspace (a lone role-'user' login is a legacy solo account,
// not somebody's team member). The built-in CIO login is shown as the owner
// of its workspace, whatever its global role.
function roleLabel(u, shared) {
  if (u.builtin) return 'Owner';
  if (u.role === 'admin') return 'Admin';
  if (u.role === 'owner') return 'Owner';
  return shared ? 'Member' : 'Solo user';
}

const CHIP_STYLES = {
  Admin: 'bg-violet-100 text-violet-700',
  Owner: 'bg-sky-100 text-sky-700',
  Member: 'bg-gray-100 text-gray-600',
  'Solo user': 'bg-amber-50 text-amber-700',
};

function RoleChip({ label }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${CHIP_STYLES[label] || CHIP_STYLES.Member}`}>
      {label}
    </span>
  );
}

// Active is the norm, so only the exception is flagged.
function StatusChip({ active }) {
  if (active) return null;
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-600">
      disabled
    </span>
  );
}

// Kebab dropdown holding the rare per-login actions, so a row shows one
// quiet button instead of a strip of them. Items: { icon, label, danger?, onClick }.
function ActionMenu({ items, ariaLabel }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
          open ? 'border-gray-300 bg-gray-100 text-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
        }`}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => { setOpen(false); it.onClick(); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] font-medium ${
                  it.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <it.icon size={13} /> {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// One login row: identity on the left, access + actions on the right.
// `onSetRole` is admin-only: promote a member/solo login to workspace owner
// or demote an owner back to member.
function UserRow({ u, label, editing, deleting, onEditAccess, onResetPassword, onToggleActive, onDelete, onSetRole, onRename }) {
  const restrictable = u.role !== 'admin' && !u.builtin;
  const enabledCount = FEATURES.length - (u.disabledFeatures?.length || 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {label === 'Owner' && <Crown size={14} className="text-sky-500 shrink-0" />}
        <span className="font-medium text-gray-800 truncate">{u.username}</span>
        <RoleChip label={label} />
        <StatusChip active={u.isActive} />
      </div>
      {u.builtin ? (
        <span className="text-[11px] text-gray-400 px-1" title="Credentials come from the server's environment variables — this login cannot be edited or deleted here">
          Built-in login · full access
        </span>
      ) : (
      <div className="flex items-center gap-2">
        {restrictable ? (
          <button
            onClick={() => onEditAccess(u)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors ${
              editing
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            title="Choose which features this user can access"
          >
            <SlidersHorizontal size={12} />
            {enabledCount}/{FEATURES.length} features
          </button>
        ) : (
          <span className="text-[11px] text-gray-400 px-1">Full access</span>
        )}
        {deleting ? (
          <span className="inline-flex items-center justify-center w-8 h-8 text-gray-400">
            <Loader2 className="animate-spin" size={14} />
          </span>
        ) : (
          <ActionMenu
            ariaLabel={`Actions for ${u.username}`}
            items={[
              ...(onRename
                ? [{ icon: Pencil, label: 'Rename login', onClick: () => onRename(u) }]
                : []),
              ...(onSetRole && u.role !== 'admin'
                ? [{
                    icon: Crown,
                    label: u.role === 'owner' ? 'Make member' : 'Make owner',
                    onClick: () => onSetRole(u),
                  }]
                : []),
              { icon: KeyRound, label: 'Reset password', onClick: () => onResetPassword(u) },
              { icon: Power, label: u.isActive ? 'Disable login' : 'Enable login', onClick: () => onToggleActive(u) },
              {
                icon: Trash2,
                label: label === 'Member' ? 'Remove from workspace' : 'Delete login & workspace',
                danger: true,
                onClick: () => onDelete(u),
              },
            ]}
          />
        )}
      </div>
      )}
    </div>
  );
}

// Expanding panel under a member row: toggle which features stay visible.
// `features` is the grantable set: everything for admins; for owners, only
// the features the admin left enabled for THEM (the server enforces the same
// ceiling, this just keeps the UI honest).
function FeatureAccessEditor({ username, features, draftDisabled, onToggle, onSave, onCancel, saving }) {
  return (
    <div className="px-5 py-4 bg-gray-50/60 border-t border-gray-100 rounded-b-2xl">
      <div className="flex items-center gap-2 mb-3 text-[12px] font-semibold text-gray-600">
        <Lock size={13} /> Feature access for {username}
        <span className="font-normal text-gray-400">— switch off the areas this user should not see.</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {features.map((f) => {
          const on = !draftDisabled.includes(f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onToggle(f.key)}
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-colors ${
                on
                  ? 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span className={`mt-0.5 flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-transparent'
              }`}>
                <Check size={12} strokeWidth={3} />
              </span>
              <span className="flex flex-col min-w-0">
                <span className={`text-[13px] font-semibold leading-tight ${on ? 'text-emerald-800' : 'text-gray-500'}`}>{f.label}</span>
                {f.note && <span className="text-[11px] leading-snug text-gray-400 mt-0.5">{f.note}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-3.5">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />} Save access
        </button>
        <button
          onClick={onCancel}
          className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Password field with the usual eye toggle to reveal what was typed.
// `className` styles the wrapper (grid/flex sizing), `inputClassName` the
// input itself, so it can match either form's look.
function PasswordInput({ className = '', inputClassName, value, onChange, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={`w-full pr-9 ${inputClassName}`}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-600"
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

// Compact inline username/password form ("Add member" inside a workspace card).
function InlineMemberForm({ onSubmit, onCancel, busy }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit({ username, password }); }}
      className="flex flex-wrap items-center gap-2 px-5 py-3 bg-emerald-50/40 border-t border-emerald-100/60"
    >
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        required
        autoFocus
        className="flex-1 min-w-[140px] px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
      />
      <PasswordInput
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (min 6 chars)"
        required
        className="flex-1 min-w-[180px]"
        inputClassName="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
      >
        {busy ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />} Add member
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100"
        aria-label="Cancel"
      >
        <X size={15} />
      </button>
    </form>
  );
}

export default function AdminPage() {
  const { canManageUsers, isAdmin, disabledFeatures: myDisabled, loading: authLoading } = useAuth();

  // What the caller may grant: admins hand out anything; owners only the
  // features the admin left enabled for them (server enforces this too).
  const grantableFeatures = useMemo(
    () => (isAdmin ? FEATURES : FEATURES.filter((f) => !(myDisabled || []).includes(f.key))),
    [isAdmin, myDisabled]
  );

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Top form — admins create whole workspaces here; owners add team members.
  const [form, setForm] = useState({ username: '', password: '', role: 'owner' });
  const [creating, setCreating] = useState(false);

  // Which workspace's inline "Add member" form is open (admin view).
  const [addingTenantId, setAddingTenantId] = useState(null);
  const [addingMember, setAddingMember] = useState(false);

  const [deletingId, setDeletingId] = useState(null);
  const [deletingTenantId, setDeletingTenantId] = useState(null);

  // Per-user feature-access editor.
  const [editingId, setEditingId] = useState(null);
  const [draftDisabled, setDraftDisabled] = useState([]);
  const [savingFeatures, setSavingFeatures] = useState(false);

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
    if (canManageUsers) loadUsers();
  }, [canManageUsers, loadUsers]);

  // Admin view: group logins into workspaces (owner first, then members) and a
  // separate Administrators list. Admins are global, so their personal tenant
  // is an implementation detail we don't surface as a "workspace" — except the
  // built-in CIO login, which IS the owner of the CIO Alpha workspace. That
  // one is split out as `adminWorkspace` and pinned at the top of the page,
  // visually set apart to show it sits above the ordinary workspaces.
  const { adminWorkspace, workspaces, admins } = useMemo(() => {
    const admins = users.filter((u) => u.role === 'admin' && !u.builtin);
    const byTenant = new Map();
    for (const u of users) {
      if (u.role === 'admin' && !u.builtin) continue;
      if (!byTenant.has(u.tenantId)) {
        byTenant.set(u.tenantId, { id: u.tenantId, name: u.tenantName || u.username, users: [] });
      }
      byTenant.get(u.tenantId).users.push(u);
    }
    const rank = { owner: 0, user: 1 };
    const userRank = (u) => (u.builtin ? 0 : (rank[u.role] ?? 2));
    const all = [...byTenant.values()].map((ws) => ({
      ...ws,
      builtin: ws.users.some((u) => u.builtin),
      users: [...ws.users].sort((a, b) => userRank(a) - userRank(b)),
    }));
    all.sort((a, b) => a.name.localeCompare(b.name));
    return {
      adminWorkspace: all.find((ws) => ws.builtin) || null,
      workspaces: all.filter((ws) => !ws.builtin),
      admins,
    };
  }, [users]);

  // Owner view: just their members; their own login is the admin's to manage.
  const team = useMemo(() => users.filter((u) => u.role === 'user'), [users]);
  const workspaceName = useMemo(
    () => users.find((u) => u.tenantName)?.tenantName || null,
    [users]
  );

  function openAccessEditor(u) {
    if (editingId === u.id) { setEditingId(null); return; }
    setEditingId(u.id);
    setDraftDisabled(u.disabledFeatures || []);
  }

  function toggleFeature(key) {
    setDraftDisabled((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    );
  }

  async function saveFeatures(u) {
    setSavingFeatures(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, disabledFeatures: draftDisabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update access');
      setNotice(`Updated feature access for "${u.username}".`);
      setEditingId(null);
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingFeatures(false);
    }
  }

  // Top form: admin → new workspace (role from the select); owner → the server
  // forces a member in their own workspace whatever we send.
  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const body = { username: form.username, password: form.password };
      if (isAdmin) body.role = form.role;
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      setNotice(
        isAdmin
          ? `Created workspace "${data.user.username}".`
          : `Added "${data.user.username}" to your team. Use the feature toggles to choose what they can see.`
      );
      setForm({ username: '', password: '', role: 'owner' });
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  // Inline per-workspace "Add member" (admin view).
  async function handleAddMember(tenantId, { username, password }) {
    setAddingMember(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'user', tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add member');
      setNotice(`Added "${data.user.username}" to the workspace.`);
      setAddingTenantId(null);
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingMember(false);
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

  async function resetPassword(u) {
    const password = window.prompt(`New password for "${u.username}" (min 6 characters):`);
    if (password === null) return;
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setNotice(`Password updated for "${u.username}".`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(u) {
    // A member sharing a workspace only loses their login; deleting an
    // owner/solo login erases the whole workspace (and its team).
    const isSharedMember =
      u.role === 'user' && users.some((o) => o.id !== u.id && o.tenantId === u.tenantId);
    const warning = isSharedMember
      ? `Remove "${u.username}" from the workspace?\n\nOnly their login is deleted — the workspace's data stays with the rest of the team. To erase everything, use the workspace's "Delete workspace" button.`
      : `Permanently delete "${u.username}" and its entire workspace?\n\nThis erases all workspace data${u.role === 'owner' ? ' and every member\'s login' : ''} and cannot be undone.`;
    if (!window.confirm(warning)) return;
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
      setNotice(
        data.workspaceDeleted
          ? `Deleted "${u.username}" and its workspace.`
          : `Removed "${u.username}" from the workspace.`
      );
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  // Admin: rename a login. Display-only elsewhere, but it IS the credential
  // people type at login, so the prompt spells that out.
  async function handleRenameUser(u) {
    const username = window.prompt(
      `New username for "${u.username}":\n\nThey'll use this to log in from now on.`,
      u.username
    );
    if (username === null || username.trim() === '' || username.trim() === u.username) return;
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rename login');
      setNotice(`Renamed "${u.username}" to "${data.username}".`);
      loadUsers();
    } catch (e) {
      setError(e.message);
    }
  }

  // Admin: rename a workspace (its display name).
  async function handleRenameWorkspace(ws) {
    const name = window.prompt(`New name for workspace "${ws.name}":`, ws.name);
    if (name === null || name.trim() === '' || name.trim() === ws.name) return;
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: ws.id, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rename workspace');
      setNotice(`Renamed workspace "${ws.name}" to "${data.name}".`);
      loadUsers();
    } catch (e) {
      setError(e.message);
    }
  }

  // Admin: promote a login to workspace owner, or demote an owner to member.
  async function handleSetRole(u) {
    const promote = u.role !== 'owner';
    const warning = promote
      ? `Make "${u.username}" an owner of this workspace?\n\nOwners can add members and manage the team's feature access — limited to the access you've granted them.`
      : `Make "${u.username}" a regular member?\n\nThey lose the ability to add or manage team members.`;
    if (!window.confirm(warning)) return;
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: u.id, role: promote ? 'owner' : 'user' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change role');
      setNotice(promote ? `"${u.username}" is now a workspace owner.` : `"${u.username}" is now a regular member.`);
      loadUsers();
    } catch (e) {
      setError(e.message);
    }
  }

  // Admin: erase a whole workspace — data, files, and every login in it.
  async function handleDeleteWorkspace(ws) {
    const logins = ws.users.length === 1 ? '1 login' : `${ws.users.length} logins`;
    const warning = `Permanently delete workspace "${ws.name}"?\n\nThis erases all of its data, its files, and ${logins}, and cannot be undone.`;
    if (!window.confirm(warning)) return;
    setError('');
    setNotice('');
    setDeletingTenantId(ws.id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: ws.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete workspace');
      setNotice(`Deleted workspace "${ws.name}" and all of its data.`);
      loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingTenantId(null);
    }
  }

  if (authLoading) return null;

  if (!canManageUsers) {
    return (
      <div className="max-w-md mx-auto mt-24 text-center text-gray-500">
        <ShieldCheck className="mx-auto mb-3 text-gray-300" size={40} />
        <p className="font-semibold text-gray-700">Admin access required</p>
        <p className="text-sm mt-1">Your account doesn’t have permission to manage users.</p>
      </div>
    );
  }

  const rowHandlers = {
    onEditAccess: openAccessEditor,
    onResetPassword: resetPassword,
    onToggleActive: toggleActive,
    onDelete: handleDelete,
    onSetRole: isAdmin ? handleSetRole : null,
    onRename: isAdmin ? handleRenameUser : null,
  };

  const CREATE_ROLE_HINTS = {
    owner: 'A workspace owner gets a fresh, isolated workspace and can add and manage their own team members.',
    user: 'A solo user gets a fresh, isolated workspace just for themselves — no team.',
    admin: 'An admin has full access to every workspace and manages all users. Use sparingly.',
  };

  // One workspace card (admin view). The built-in CIO workspace gets violet
  // accents to mark it as the admin tier, and can never be deleted.
  const renderWorkspaceCard = (ws) => {
    const shared = ws.users.length > 1;
    // No overflow-hidden on the card — the row action menus must be able to
    // escape it; corners are rounded explicitly instead.
    return (
      <div
        key={ws.id}
        className={`bg-white rounded-2xl border shadow-sm ${
          ws.builtin ? 'border-violet-200' : 'border-gray-200/80'
        }`}
      >
        <div
          className={`flex items-center justify-between px-5 py-3 border-b rounded-t-2xl ${
            ws.builtin ? 'bg-violet-50/60 border-violet-100' : 'bg-gray-50/70 border-gray-100'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {ws.builtin
              ? <ShieldCheck size={15} className="text-violet-500 shrink-0" />
              : <Building2 size={15} className="text-gray-400 shrink-0" />}
            <span className="font-semibold text-gray-800 truncate">{ws.name}</span>
            {ws.builtin && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-100 text-violet-700">
                Admin
              </span>
            )}
            <span className="text-[11px] text-gray-400">
              {ws.users.length} {ws.users.length === 1 ? 'login' : 'logins'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleRenameWorkspace(ws)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white"
              title="Rename workspace"
              aria-label={`Rename workspace ${ws.name}`}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => setAddingTenantId(addingTenantId === ws.id ? null : ws.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-white"
            >
              <Plus size={12} /> Add member
            </button>
            {!ws.builtin && (
              <button
                onClick={() => handleDeleteWorkspace(ws)}
                disabled={deletingTenantId === ws.id}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                title="Delete workspace — erases all of its data, files, and every login"
                aria-label={`Delete workspace ${ws.name}`}
              >
                {deletingTenantId === ws.id
                  ? <Loader2 className="animate-spin" size={13} />
                  : <Trash2 size={13} />}
              </button>
            )}
          </div>
        </div>
        {addingTenantId === ws.id && (
          <InlineMemberForm
            busy={addingMember}
            onSubmit={(fields) => handleAddMember(ws.id, fields)}
            onCancel={() => setAddingTenantId(null)}
          />
        )}
        <div className="divide-y divide-gray-50">
          {ws.users.map((u) => (
            <div key={u.id}>
              <UserRow
                u={u}
                label={roleLabel(u, shared)}
                editing={editingId === u.id}
                deleting={deletingId === u.id}
                {...rowHandlers}
              />
              {editingId === u.id && (
                <FeatureAccessEditor
                  username={u.username}
                  features={grantableFeatures}
                  draftDisabled={draftDisabled}
                  onToggle={toggleFeature}
                  onSave={() => saveFeatures(u)}
                  onCancel={() => setEditingId(null)}
                  saving={savingFeatures}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2.5 mb-6">
        <Users className="text-emerald-600" size={22} />
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          {isAdmin ? 'User Management' : 'Team Management'}
        </h1>
        {!isAdmin && workspaceName && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-[12px] font-semibold">
            <Building2 size={13} /> {workspaceName}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 text-sm">{notice}</div>
      )}

      {/* Top form: admin → create a workspace; owner → add a team member */}
      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 mb-8">
        <div className="flex items-center gap-2 mb-4 text-gray-700 font-semibold">
          {isAdmin ? <Building2 size={17} /> : <UserPlus size={17} />}
          {isAdmin ? 'Create a workspace' : 'Add a team member'}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            placeholder="Username"
            required
            className="sm:col-span-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
          />
          <PasswordInput
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="Password (min 6 chars)"
            required
            className="sm:col-span-2"
            inputClassName="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
          />
          {isAdmin && (
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
            >
              <option value="owner">Workspace owner</option>
              <option value="user">Solo user</option>
              <option value="admin">Admin</option>
            </select>
          )}
        </div>
        <p className="text-[12px] text-gray-400 mt-3">
          {isAdmin
            ? CREATE_ROLE_HINTS[form.role]
            : 'New members share your workspace’s data and see only the features you enable. They can never see any other workspace.'}
        </p>
        <button
          type="submit"
          disabled={creating}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
        >
          {creating ? <Loader2 className="animate-spin" size={15} /> : <UserPlus size={15} />}
          {isAdmin ? 'Create workspace' : 'Add member'}
        </button>
      </form>

      {loading ? (
        <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
      ) : isAdmin ? (
        <>
          {/* ── Admin workspace: the CIO's own, pinned on top of the hierarchy ── */}
          {adminWorkspace && (
            <>
              <div className="flex items-center gap-2 mb-3 text-[11px] font-bold uppercase tracking-wide text-violet-500">
                <ShieldCheck size={13} /> Admin workspace
              </div>
              <div className="flex flex-col gap-4 mb-8">
                {renderWorkspaceCard(adminWorkspace)}
              </div>
            </>
          )}

          {/* ── Workspaces, one card each ── */}
          <div className="flex items-center gap-2 mb-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">
            <Building2 size={13} /> Workspaces
          </div>
          {workspaces.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm px-5 py-8 text-center text-gray-400 text-sm mb-8">
              No workspaces yet. Create one above.
            </div>
          ) : (
            <div className="flex flex-col gap-4 mb-8">
              {workspaces.map(renderWorkspaceCard)}
            </div>
          )}

          {/* ── Administrators ── */}
          {admins.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <ShieldCheck size={13} /> Administrators
              </div>
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm divide-y divide-gray-50">
                {admins.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    label="Admin"
                    editing={false}
                    deleting={deletingId === u.id}
                    {...rowHandlers}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        /* ── Owner view: just their team ── */
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm">
          <div className="flex items-center gap-2 px-5 py-3 bg-gray-50/70 border-b border-gray-100 rounded-t-2xl">
            <Users size={15} className="text-gray-400" />
            <span className="font-semibold text-gray-800">Your team</span>
            <span className="text-[11px] text-gray-400">
              {team.length} {team.length === 1 ? 'member' : 'members'}
            </span>
          </div>
          {team.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">
              No team members yet. Add one above — they’ll share your workspace’s data and see only the features you enable.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {team.map((u) => (
                <div key={u.id}>
                  <UserRow
                    u={u}
                    label="Member"
                    editing={editingId === u.id}
                    deleting={deletingId === u.id}
                    {...rowHandlers}
                  />
                  {editingId === u.id && (
                    <FeatureAccessEditor
                      username={u.username}
                      features={grantableFeatures}
                      draftDisabled={draftDisabled}
                      onToggle={toggleFeature}
                      onSave={() => saveFeatures(u)}
                      onCancel={() => setEditingId(null)}
                      saving={savingFeatures}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
