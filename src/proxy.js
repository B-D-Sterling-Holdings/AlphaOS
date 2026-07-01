import { NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { featureForPath, sanitizeFeatureKeys } from '@/lib/features';

// Next.js proxy (formerly "middleware"). Runs on the edge for both API routes
// and the gated page routes listed in `config.matcher` below.
export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // ── Page routes: hard feature gate ──────────────────────────────────────
  // The nav bar and command palette hide destinations a user can't reach, but
  // hiding a button is not access control — a user could still type the route
  // or deep-link to it. This runs on every navigation to a gated page (and on
  // the RSC fetch the command palette triggers via router.push), so a suppressed
  // feature is blocked server-side before the page is ever served. Admins are
  // never restricted. The disabled-feature list rides in the signed session JWT
  // (set at login from the DB), so this stays edge-fast with no DB call.
  if (!pathname.startsWith('/api/')) {
    const feature = featureForPath(pathname);
    if (!feature) return NextResponse.next();

    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    // No/invalid session: let the client-side AuthGate handle login redirects.
    if (!token) return NextResponse.next();
    const session = await verifySession(token);
    if (!session) return NextResponse.next();
    if (session.role === 'admin') return NextResponse.next();

    if (sanitizeFeatureKeys(session.disabledFeatures).includes(feature.key)) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = `?restricted=${encodeURIComponent(feature.key)}`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── API routes: require a valid session ─────────────────────────────────
  // Allow auth endpoints (they manage their own session).
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
  matcher: [
    '/api/:path*',
    // Gated page routes (feature suppression). `:path*` also matches the bare
    // route. Keep in sync with the feature hrefs in src/lib/features.js.
    '/holdings/:path*',
    '/allocation/:path*',
    '/macro-regime/:path*',
    '/relationships/:path*',
    '/strategic-hub/:path*',
    '/tasks/:path*',
    '/workspace/:path*',
    '/lessons/:path*',
    '/watchlist/:path*',
    '/draft-review/:path*',
    '/research/:path*',
    '/position-review/:path*',
    '/documents/:path*',
    '/link-database/:path*',
    '/financials/:path*',
  ],
};
