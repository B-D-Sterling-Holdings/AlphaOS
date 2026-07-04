import { NextResponse } from 'next/server';
import { getSession } from '@/lib/db';
import { canManageUsers } from '@/lib/roles';
import {
  listUsers,
  createUser,
  getUserById,
  setUserActive,
  setUserFeatures,
  setUserPassword,
  deleteUser,
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
      // the payload claims.
      user = await createUser({
        username,
        password,
        role: 'user',
        tenantId: gate.session.tenantId,
        createdBy: gate.session.userId,
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
    const { id, isActive, disabledFeatures, password } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (!gate.isGlobalAdmin) {
      const scope = await requireOwnedSubUser(gate.session, id);
      if (scope.error) return NextResponse.json({ error: scope.error }, { status: scope.status });
    }

    // Password reset. Owners are already scoped above; admins may reset anyone.
    if (password !== undefined) {
      await setUserPassword(id, password);
      return NextResponse.json({ ok: true });
    }

    // Feature access update (the "guard" toggles). Separate from active/disabled.
    if (disabledFeatures !== undefined) {
      const stored = await setUserFeatures(id, disabledFeatures);
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
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
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
