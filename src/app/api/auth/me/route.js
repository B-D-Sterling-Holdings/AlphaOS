import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session?.tenantId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const isDemo = !!session.isDemo;
  const role = session.role === 'admin' ? 'admin' : 'user';

  return NextResponse.json({
    authenticated: true,
    user: { username: session.username },
    role,
    accountType: isDemo ? 'demo' : 'prod',
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });
}
