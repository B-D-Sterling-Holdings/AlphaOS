'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [accountType, setAccountType] = useState('prod');
  const [role, setRole] = useState('user');
  const [loading, setLoading] = useState(true);

  // On mount, check for an existing session cookie
  useEffect(() => {
    async function restoreSession() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            setAuthenticated(true);
            setAccountType(data.accountType === 'demo' ? 'demo' : 'prod');
            setRole(data.role === 'admin' ? 'admin' : 'user');
          }
        }
      } catch {
        // No valid session — user will need to log in
      } finally {
        setLoading(false);
      }
    }
    restoreSession();
  }, []);

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
    setAccountType(data.accountType === 'demo' ? 'demo' : 'prod');
    setRole(data.role === 'admin' ? 'admin' : 'user');
    return true;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local state even if the server call fails
    }
    setAuthenticated(false);
    setAccountType('prod');
    setRole('user');
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, accountType, isDemo: accountType === 'demo', role, isAdmin: role === 'admin', loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
