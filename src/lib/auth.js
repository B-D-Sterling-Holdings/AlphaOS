import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'session_token';

// Single source of truth for how long a session lives. Drives BOTH the JWT
// `exp` claim (in createSession) and the cookie `maxAge` (setSessionCookie),
// so the token and the cookie carrying it can never drift out of sync.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Attributes shared by every write of the session cookie. `secure` is only set
// in production so local http dev still receives the cookie. `sameSite: 'lax'`
// blocks cross-site POSTs (CSRF mitigation).
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * Write the session cookie onto a NextResponse (login, or a mid-session
 * reissue when the access list drifts). Centralized so cookie attributes and
 * lifetime live in exactly one place.
 */
export function setSessionCookie(response, token) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

/** Clear the session cookie (logout, or a denied /api/auth/me probe). */
export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...baseCookieOptions(),
    maxAge: 0,
  });
  return response;
}

// Well-known tenant UUID for the bootstrap CIO login (must match
// scripts/migrations/005_multitenancy.sql).
export const CIO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

function getSecret() {
  const secret = process.env.AUTH_JWT_SECRET
    || (process.env.NODE_ENV !== 'production' ? 'alphaos-local-preview-secret' : '');
  if (!secret) throw new Error('AUTH_JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Issue the app's own session cookie (NOT a Supabase token — that's minted
 * per-request from this session in src/lib/supabaseTenant.js).
 *
 * @param {object} claims
 * @param {string} claims.userId    stable id for the user (uuid, or a bootstrap id)
 * @param {string} claims.username
 * @param {string} claims.tenantId  the data partition this session may touch
 * @param {string} [claims.role]    'admin' (global) | 'owner' (workspace main account) | 'user'
 * @param {string[]} [claims.disabledFeatures] feature keys switched off for this user
 */
export async function createSession({ userId, username, tenantId, role = 'user', disabledFeatures = [] }) {
  // Pin iat/exp to the same instant so the JWT expiry matches the cookie
  // maxAge (both derived from SESSION_TTL_SECONDS) to the second.
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId, username, tenantId, role, disabledFeatures })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + SESSION_TTL_SECONDS)
    .sign(getSecret());
}

export async function verifySession(token) {
  try {
    // Pin the algorithm so a token signed any other way is never accepted.
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}
