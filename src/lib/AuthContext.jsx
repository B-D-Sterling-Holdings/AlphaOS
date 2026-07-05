'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { sanitizeFeatureKeys } from '@/lib/features';
import { normalizeRole, isUnrestrictedRole, canManageUsers } from '@/lib/roles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState('user');
  // Feature keys an admin has switched OFF for this user (empty = full access).
  // This is the LIVE list (refreshed from /api/auth/me), used to hide nav items
  // and block in-page rendering; the hard server gate lives in middleware.
  const [disabledFeatures, setDisabledFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  // Flipped on when a gated API call comes back 401 — i.e. the session died after
  // we last checked (cookie expired, or the JWT secret was rotated under us). The
  // mount check below only runs once, so without this a mid-session expiry just
  // makes every page silently empty; the overlay in AuthGate turns it into a clear
  // "please log in again" prompt.
  const [sessionExpired, setSessionExpired] = useState(false);

  // Watch every fetch for a 401 from a gated API route (the proxy in src/proxy.js
  // returns `{ error: 'Unauthorized' }` 401 once the session can't be verified).
  // Auth endpoints handle their own 401s (e.g. the mount check below), so they're
  // excluded. We only read the status and pass the untouched response straight
  // through, so existing callers still get to read the body.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      try {
        if (res.status === 401) {
          const input = args[0];
          const rawUrl = typeof input === 'string' ? input : (input?.url || '');
          const path = rawUrl.startsWith('http')
            ? new URL(rawUrl, window.location.origin).pathname
            : rawUrl;
          if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
            setSessionExpired(true);
          }
        }
      } catch {
        // URL parsing/edge cases shouldn't ever break the underlying fetch.
      }
      return res;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  // Pull the current session + live feature-access list from the server.
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          setAuthenticated(true);
          setRole(normalizeRole(data.role));
          setDisabledFeatures(sanitizeFeatureKeys(data.disabledFeatures));
        }
      }
    } catch {
      // No valid session — user will need to log in
    }
  }, []);

  // On mount, check for an existing session cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshSession();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshSession]);

  // Re-check on tab focus so an admin's access change reaches an already-open
  // session without a full reload.
  useEffect(() => {
    const onFocus = () => { if (authenticated) refreshSession(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [authenticated, refreshSession]);

  const login = useCallback(async (username, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Invalid credentials');
    }

    const data = await res.json().catch(() => ({}));
    setAuthenticated(true);
    setSessionExpired(false);
    setRole(normalizeRole(data.role));
    setDisabledFeatures(sanitizeFeatureKeys(data.disabledFeatures));
    return true;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local state even if the server call fails
    }
    setAuthenticated(false);
    setRole('user');
    setDisabledFeatures([]);
  }, []);

  // Admins and workspace owners are never feature-restricted, whatever the
  // stored list says.
  const effectiveDisabled = isUnrestrictedRole(role) ? [] : disabledFeatures;

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        role,
        isAdmin: role === 'admin',
        // Workspace owners manage their own team; admins manage everyone.
        canManageUsers: canManageUsers(role),
        disabledFeatures: effectiveDisabled,
        refreshSession,
        loading,
        sessionExpired,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
