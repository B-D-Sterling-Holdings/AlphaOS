import { NextResponse } from 'next/server';
import { getSession } from '@/lib/db';
import { canManageUsers } from '@/lib/roles';
import {
  listUsers,
  createUser,
  getUserById,
  getDisabledFeaturesForUser,
  setUserActive,
  setUserFeatures,
  setUserPassword,
  setUserRole,
  deleteUser,
  deleteWorkspace,
  getBuiltinCioUser,
} from '@/lib/users';

/*
  User management, two tiers of access — authz is enforced server-side from the
  verified session, never from a client-supplied role:

    admin  (global)  — sees and manages every user in every workspace.
    owner  (scoped)  — sees and manages ONLY the sub-users (role 'user') of its
                       own workspace. Owners cannot touch admins, other owners,
                       themselves-via-this-API, or anyone outside their tenant,
                       and everything they create is forced to a sub-user in
                       their own tenant.
*/
async function requireManager() {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated', status: 401 };
  if (!canManageUsers(session.role)) return { error: 'Admin access required', status: 403 };
  return { session, isGlobalAdmin: session.role === 'admin' };
}

// For owner sessions: resolve the target user and verify it is a sub-user of
// the owner's OWN workspace. Everything else is out of bounds — including
// other owners and admins, so an owner can never escalate sideways.
async function requireOwnedSubUser(session, id) {
  const target = await getUserById(id);
  if (!target) return { error: 'user not found', status: 404 };
  if (target.tenant_id !== session.tenantId || target.role !== 'user') {
    return { error: 'You can only manage members of your own workspace', status: 403 };
  }
  return { target };
}

export async function GET() {
  const gate = await requireManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const users = gate.isGlobalAdmin
      ? await listUsers()
      : await listUsers({ tenantId: gate.session.tenantId });
    // Admins also see the built-in CIO login, presented as the owner of the
    // CIO Alpha workspace so members can be added under it like any other.
    if (gate.isGlobalAdmin) {
      const cio = await getBuiltinCioUser();
      if (cio) users.push(cio);
    }
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = await requireManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const { username, password, role, tenantId } = await request.json();
    let user;
    if (gate.isGlobalAdmin) {
      // Admin: create an isolated workspace (role 'owner'/'admin'/'user'), or —
      // when a tenantId is supplied — add a member to that existing workspace.
      const cleanRole = ['admin', 'owner', 'user'].includes(role) ? role : 'user';
      user = await createUser({
        username,
        password,
        role: cleanRole,
        tenantId: tenantId || null,
        createdBy: gate.session.userId,
      });
    } else {
      // Owner: always a sub-user inside the owner's own workspace, whatever
      // the payload claims. The new member starts with the owner's own
      // restrictions — an owner can never hand out more than it has.
      const inherited = await getDisabledFeaturesForUser(gate.session.userId);
      user = await createUser({
        username,
        password,
        role: 'user',
        tenantId: gate.session.tenantId,
        createdBy: gate.session.userId,
        disabledFeatures: inherited,
      });
    }
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PATCH(request) {
  const gate = await requireManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const { id, isActive, disabledFeatures, password, role } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (id === 'cio-admin') {
      return NextResponse.json(
        { error: 'The built-in CIO login is managed via environment variables' },
        { status: 400 }
      );
    }

    if (!gate.isGlobalAdmin) {
      const scope = await requireOwnedSubUser(gate.session, id);
      if (scope.error) return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    // Promote to / demote from workspace owner. Admin-only — owners cannot
    // mint other owners.
    if (role !== undefined) {
      if (!gate.isGlobalAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      await setUserRole(id, role);
      return NextResponse.json({ ok: true });
    }

    // Password reset. Owners are already scoped above; admins may reset anyone.
    if (password !== undefined) {
      await setUserPassword(id, password);
      return NextResponse.json({ ok: true });
    }

    // Feature access update (the "guard" toggles). Separate from active/disabled.
    // An owner can only grant features from its OWN enabled set: whatever the
    // admin has switched off for the owner is forced off for the member too.
    if (disabledFeatures !== undefined) {
      let requested = Array.isArray(disabledFeatures) ? disabledFeatures : [];
      if (!gate.isGlobalAdmin) {
        const ownerDisabled = await getDisabledFeaturesForUser(gate.session.userId);
        requested = [...new Set([...requested, ...ownerDisabled])];
      }
      const stored = await setUserFeatures(id, requested);
      return NextResponse.json({ ok: true, disabledFeatures: stored });
    }

    if (id === gate.session.userId && isActive === false) {
      return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
    }
    await setUserActive(id, isActive);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const gate = await requireManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const { id, tenantId } = await request.json();

    // Whole-workspace cleanse: erases the tenant's data, files, and every
    // login in it. Global-admin only, and never the admin's own tenant.
    if (tenantId) {
      if (!gate.isGlobalAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      if (tenantId === gate.session.tenantId) {
        return NextResponse.json({ error: 'You cannot delete your own workspace' }, { status: 400 });
      }
      await deleteWorkspace(tenantId);
      return NextResponse.json({ ok: true, workspaceDeleted: true });
    }

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (id === 'cio-admin') {
      return NextResponse.json(
        { error: 'The built-in CIO login is managed via environment variables' },
        { status: 400 }
      );
    }
    if (id === gate.session.userId) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }
    if (!gate.isGlobalAdmin) {
      const scope = await requireOwnedSubUser(gate.session, id);
      if (scope.error) return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const { workspaceDeleted } = await deleteUser(id);
    return NextResponse.json({ ok: true, workspaceDeleted });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
