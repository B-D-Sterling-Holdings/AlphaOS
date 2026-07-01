import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth';
import { getDisabledFeaturesForUser } from '@/lib/users';
import { sanitizeFeatureKeys } from '@/lib/features';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session?.tenantId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const isDemo = !!session.isDemo;
  const role = session.role === 'admin' ? 'admin' : 'user';

  // Read the live access list from the DB (falling back to the JWT claim if the
  // lookup fails) so an admin's change shows up on the user's next page load —
  // not only after their week-long session JWT is reissued. Admins are never
  // restricted.
  let disabledFeatures = [];
  if (role !== 'admin') {
    try {
      disabledFeatures = await getDisabledFeaturesForUser(session.userId);
    } catch {
      disabledFeatures = sanitizeFeatureKeys(session.disabledFeatures);
    }
  }

  return NextResponse.json({
    authenticated: true,
    user: { username: session.username },
    role,
    accountType: isDemo ? 'demo' : 'prod',
    disabledFeatures,
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });
}
