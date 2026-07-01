import { NextResponse } from 'next/server';
import { getSession } from '@/lib/db';
import { listUsers, createUser, setUserActive, setUserFeatures } from '@/lib/users';

// Every handler here is admin-only. Authz is enforced server-side from the
// verified session — never trust a client-supplied role.
async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated', status: 401 };
  if (session.role !== 'admin') return { error: 'Admin access required', status: 403 };
  return { session };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    return NextResponse.json({ users: await listUsers() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const { username, password, role } = await request.json();
    const user = await createUser({ username, password, role: role === 'admin' ? 'admin' : 'user' });
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PATCH(request) {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const { id, isActive, disabledFeatures } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

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
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (id === gate.session.userId) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
