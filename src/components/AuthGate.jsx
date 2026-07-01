'use client';

import { useAuth } from '@/lib/AuthContext';
import { useEffect } from 'react';
import { LogIn } from 'lucide-react';

// Shown when a gated API call 401s mid-session (cookie expired / secret rotated).
// The page underneath is intentionally left mounted but blocked, so the user keeps
// their place; re-logging in lands them right back here with a fresh cookie.
function SessionExpiredOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-gray-100 p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto mb-4">
          <LogIn size={22} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Session expired</h2>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
          Your session is no longer valid. Please log in again to continue — your work is saved.
        </p>
        <button
          onClick={() => { window.location.href = '/login'; }}
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-sm hover:from-emerald-700 hover:to-emerald-600 transition-all"
        >
          <LogIn size={15} /> Log in
        </button>
      </div>
    </div>
  );
}

export default function AuthGate({ children }) {
  const { authenticated, loading, sessionExpired } = useAuth();

  useEffect(() => {
    if (!loading && !authenticated) {
      window.location.href = '/login';
    }
  }, [authenticated, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <>
      {children}
      {sessionExpired && <SessionExpiredOverlay />}
    </>
  );
}
