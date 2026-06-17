import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'session_token';

function getSecret() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error('AUTH_JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function createSession(username, accountType = 'prod') {
  return new SignJWT({ username, accountType })
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
