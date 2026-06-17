import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: { username: session.username },
    accountType: session.accountType === 'demo' ? 'demo' : 'prod',
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });
}
