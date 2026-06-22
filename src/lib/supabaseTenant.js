import 'server-only';
import { SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';

/*
  Per-request, RLS-scoped Supabase access.

  Unlike supabaseAdmin (service role, BYPASSRLS), this talks to PostgREST as the
  `authenticated` role using a short-lived JWT signed with the project's
  SUPABASE_JWT_SECRET. The JWT carries a `tenant_id` claim that the RLS policies
  in scripts/migrations/005_multitenancy.sql key off — so the database itself
  guarantees a session can only ever read or write its own tenant's rows. Even a
  query that forgets to filter by tenant cannot leak across tenants.

  We mint a fresh client per request (cheap — it's just headers over the shared
  PostgREST endpoint) rather than caching, so the tenant claim can never be stale.
*/

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

function getJwtSecret() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'SUPABASE_JWT_SECRET is not set. Copy it from Supabase → Project Settings → API → JWT Settings.'
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a Supabase-compatible `authenticated` JWT for a tenant. Also used to hand
 * the Python pipeline a scoped token. Short-lived by design.
 */
export async function mintTenantJwt(tenantId, { ttlSeconds = 3600 } = {}) {
  if (!tenantId) throw new Error('mintTenantJwt: tenantId is required');
  return new SignJWT({ role: 'authenticated', tenant_id: tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(tenantId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(getJwtSecret());
}

/** A Supabase client whose every request is RLS-scoped to `tenantId`. */
export async function getTenantClient(tenantId) {
  const token = await mintTenantJwt(tenantId);
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
