import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    // ── Demo account ── fully isolated from production (see src/lib/db.js).
    // Credentials default to demo/demo and can be overridden via env.
    const demoUsername = process.env.DEMO_USERNAME || 'demo';
    const demoPassword = process.env.DEMO_PASSWORD || 'demo';
    if (username === demoUsername && password === demoPassword) {
      const token = await createSession(demoUsername, 'demo');
      const response = NextResponse.json({ ok: true, accountType: 'demo' });
      response.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
      return response;
    }

    const validUsername = process.env.AUTH_USERNAME;
    const passwordHash = process.env.AUTH_PASSWORD_HASH;

    if (!validUsername || !passwordHash) {
      return NextResponse.json(
        { error: 'Auth not configured' },
        { status: 500 }
      );
    }

    if (username !== validUsername || !bcrypt.compareSync(password, passwordHash)) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const token = await createSession(username, 'prod');

    const response = NextResponse.json({ ok: true, accountType: 'prod' });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days, matches JWT expiry
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Invalid credentials' },
      { status: 401 }
    );
  }
}
