import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'session_token';

// Well-known tenant UUIDs for the bootstrap logins (must match
// scripts/migrations/005_multitenancy.sql).
export const CIO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
export const DEMO_TENANT_ID = '22222222-2222-2222-2222-222222222222';

function getSecret() {
  const secret = process.env.AUTH_JWT_SECRET;
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
 * @param {string} [claims.role]    'admin' | 'user'
 * @param {boolean} [claims.isDemo]
 * @param {string[]} [claims.disabledFeatures] feature keys switched off for this user
 */
export async function createSession({ userId, username, tenantId, role = 'user', isDemo = false, disabledFeatures = [] }) {
  return new SignJWT({ userId, username, tenantId, role, isDemo, disabledFeatures })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}
