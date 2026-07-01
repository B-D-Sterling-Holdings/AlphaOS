import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, createSession, verifySession } from '@/lib/auth';
import { getUserAuthState } from '@/lib/users';
import { sanitizeFeatureKeys } from '@/lib/features';

const USERS_TABLE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session?.tenantId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  let role = session.role === 'admin' ? 'admin' : 'user';

  // Read the live access list from the DB (falling back to the JWT claim if the
  // lookup fails) so an admin's change shows up on the user's next page load —
  // not only after their week-long session JWT is reissued. Admins are never
  // restricted. The same lookup enforces disable/delete mid-session: a revoked
  // account is logged out here rather than riding out its 7-day token.
  let disabledFeatures = role === 'admin' ? [] : sanitizeFeatureKeys(session.disabledFeatures);
  let claimsStale = false;
  if (USERS_TABLE_ID_RE.test(session.userId || '')) {
    try {
      const state = await getUserAuthState(session.userId);
      if (!state || !state.isActive) {
        const denied = NextResponse.json({ authenticated: false }, { status: 401 });
        denied.cookies.set(SESSION_COOKIE_NAME, '', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 0,
        });
        return denied;
      }
      role = state.role;
      const live = state.disabledFeatures;
      const claimed = sanitizeFeatureKeys(session.disabledFeatures);
      claimsStale =
        live.length !== claimed.length || live.some((k) => !claimed.includes(k));
      disabledFeatures = live;
    } catch {
      // Transient lookup failure — fall back to the JWT claims read above.
    }
  }

  const response = NextResponse.json({
    authenticated: true,
    user: { username: session.username },
    role,
    disabledFeatures,
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });

  // The hard route gate in src/proxy.js reads disabledFeatures from the signed
  // JWT (edge-fast, no DB). When the live list has drifted from the claim,
  // reissue the cookie so the gate picks up the change on the next navigation.
  if (claimsStale) {
    try {
      const fresh = await createSession({
        userId: session.userId,
        username: session.username,
        tenantId: session.tenantId,
        role,
        disabledFeatures,
      });
      response.cookies.set(SESSION_COOKIE_NAME, fresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // matches JWT expiry
      });
    } catch {
      // Couldn't mint a replacement — keep the existing cookie.
    }
  }

  return response;
}
