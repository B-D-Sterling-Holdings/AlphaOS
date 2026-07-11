'use client';

import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { featureForPath } from '@/lib/features';

/*
  Live, in-page companion to the middleware gate.

  Middleware blocks gated routes server-side using the session JWT. This guard
  uses the LIVE access list from AuthContext (refreshed via /api/auth/me) so that
  if an admin revokes a feature while the user is mid-session, the page content is
  replaced with a "restricted" notice immediately — even before their JWT-backed
  middleware view catches up. It also covers the brief window before the JWT is
  reissued on next login.
*/
function RestrictedNotice() {
  return (
    <div className="max-w-md mx-auto mt-24 text-center text-gray-500 px-4">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-4">
        <Lock size={26} />
      </div>
      <p className="font-semibold text-gray-700">This area is unavailable</p>
      <p className="text-sm mt-1.5 leading-relaxed">
        Your account doesn’t have access to this feature. Contact your administrator
        if you think this is a mistake.
      </p>
    </div>
  );
}

export default function FeatureRouteGuard({ children }) {
  const pathname = usePathname();
  // Workspace admins (the CIO login + every admin-workspace member) are never
  // feature-restricted, matching the middleware gate and /api/auth/me.
  const { isWorkspaceAdmin, disabledFeatures } = useAuth();

  const feature = featureForPath(pathname);
  const blocked = !isWorkspaceAdmin && feature && disabledFeatures.includes(feature.key);

  if (blocked) return <RestrictedNotice />;
  return children;
}
