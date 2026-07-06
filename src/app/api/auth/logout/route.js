import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth';
import { revokeSessionsBefore } from '@/lib/users';

export async function POST(request) {
  // Invalidate this session server-side, not just in the browser: stamp a
  // revocation floor for the subject so a copy of the token made elsewhere
  // stops working too (migration 020). Best-effort — a failure must never
  // block the user from logging out, so we still clear the cookie regardless.
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (token) {
      const session = await verifySession(token);
      if (session?.userId) await revokeSessionsBefore(session.userId);
    }
  } catch {
    // ignore — clearing the cookie below is the guaranteed part
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
