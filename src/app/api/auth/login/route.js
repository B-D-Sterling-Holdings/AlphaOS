import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import {
  createSession,
  SESSION_COOKIE_NAME,
  CIO_TENANT_ID,
} from '@/lib/auth';
import { findUserByUsername } from '@/lib/users';
import { sanitizeFeatureKeys } from '@/lib/features';
import {
  clientIp,
  isLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
} from '@/lib/loginRateLimit';

// Attach the session cookie to a JSON response.
function withSession(body, token) {
  const response = NextResponse.json(body);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days, matches JWT expiry
  });
  return response;
}

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Brute-force guard: repeated failures for this ip/username are refused
    // before any password check runs. Successful logins clear the counter.
    const ip = clientIp(request);
    if (isLoginBlocked(ip, username)) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Try again in a few minutes.' },
        { status: 429 }
      );
    }

    // ── 1. Admin-created users (the users table). Each has its own tenant. ──
    let user = null;
    try {
      user = await findUserByUsername(username);
    } catch {
      // users table not migrated yet — fall through to the bootstrap logins
    }
    if (user) {
      if (!user.is_active) {
        return NextResponse.json({ error: 'Account is disabled' }, { status: 403 });
      }
      if (!bcrypt.compareSync(password, user.password_hash)) {
        recordLoginFailure(ip, username);
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
      clearLoginFailures(ip, username);
      const token = await createSession({
        userId: user.id,
        username: user.username,
        tenantId: user.tenant_id,
        role: user.role,
        // Admins are never feature-restricted; for users this seeds the hard
        // middleware gate so deep-links are blocked from the very first request.
        disabledFeatures: user.role === 'admin' ? [] : sanitizeFeatureKeys(user.disabled_features),
      });
      return withSession(
        {
          ok: true,
          role: user.role,
          disabledFeatures: user.role === 'admin' ? [] : sanitizeFeatureKeys(user.disabled_features),
        },
        token
      );
    }

    // ── 2. Bootstrap CIO admin from env — owns the CIO tenant (existing data). ──
    const cioUsername = process.env.AUTH_USERNAME;
    const cioHash = process.env.AUTH_PASSWORD_HASH;
    if (cioUsername && cioHash && username === cioUsername && bcrypt.compareSync(password, cioHash)) {
      clearLoginFailures(ip, username);
      const token = await createSession({
        userId: 'cio-admin',
        username: cioUsername,
        tenantId: CIO_TENANT_ID,
        role: 'admin',
      });
      return withSession({ ok: true, role: 'admin' }, token);
    }

    recordLoginFailure(ip, username);
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
}
