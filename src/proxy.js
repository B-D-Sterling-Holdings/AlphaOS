import { NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Only protect API routes (pages are protected client-side)
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow auth endpoints
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Cron endpoints authenticate with their own shared secret (CRON_SECRET), not a
  // user session — a scheduler has no cookie. Let them through; each route enforces
  // the secret itself and fails closed (see src/app/api/cron/auto-notify/route.js).
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next();
  }

  // Check Authorization header first, then fall back to cookie
  const authHeader = request.headers.get('Authorization');
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    token = request.cookies.get(SESSION_COOKIE_NAME)?.value || null;
  }

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
