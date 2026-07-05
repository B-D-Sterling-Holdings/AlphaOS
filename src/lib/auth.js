import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'session_token';

// Well-known tenant UUID for the bootstrap CIO login (must match
// scripts/migrations/005_multitenancy.sql).
export const CIO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

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
 * @param {string} [claims.role]    'admin' (global) | 'owner' (workspace main account) | 'user'
 * @param {string[]} [claims.disabledFeatures] feature keys switched off for this user
 */
export async function createSession({ userId, username, tenantId, role = 'user', disabledFeatures = [] }) {
  return new SignJWT({ userId, username, tenantId, role, disabledFeatures })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
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
