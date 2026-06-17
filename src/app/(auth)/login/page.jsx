'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import ShowcaseWidgets from './ShowcaseWidgets';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      router.push('/');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-8 animate-fade-in-up">
      {/* ── Left: Login form ── */}
      <div className="w-[380px] flex-shrink-0 bg-white rounded-2xl border border-gray-200/80 shadow-xl shadow-gray-200/50 p-10 flex flex-col justify-center relative overflow-hidden">
        {/* Top accent */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 opacity-50" />

        {/* Logo */}
        <div className="flex justify-center mb-10">
          <Image
            src="/images/wow.png"
            alt="AlphaOS"
            width={220}
            height={77}
            className="h-12 w-auto object-contain"
            unoptimized
            priority
          />
        </div>

        {/* Heading */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Welcome back
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Sign in to continue
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-100 rounded-xl text-red-500 text-sm text-center animate-fade-in">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-[11px] font-semibold text-gray-400 uppercase tracking-[0.12em] mb-2">
              Username
            </label>
            <div className={`rounded-xl transition-shadow duration-300 ${focused === 'username' ? 'shadow-md shadow-emerald-100' : ''}`}>
              <input
                id="username"
                type="text" spellCheck={true}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocused('username')}
                onBlur={() => setFocused(null)}
                required
                autoFocus
                className="w-full px-4 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 focus:bg-white transition-all duration-300"
                placeholder="Enter username"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-[11px] font-semibold text-gray-400 uppercase tracking-[0.12em] mb-2">
              Password
            </label>
            <div className={`rounded-xl transition-shadow duration-300 ${focused === 'password' ? 'shadow-md shadow-emerald-100' : ''}`}>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                required
                className="w-full px-4 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 focus:bg-white transition-all duration-300"
                placeholder="Enter password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-2 text-white text-sm font-semibold rounded-xl active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-emerald-200/50 hover:shadow-emerald-300/60 group btn-gradient-animate"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                Sign in
                <svg className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            )}
          </button>
        </form>

        {/* Demo hint */}
        <p className="text-center text-[11px] text-gray-400 mt-6">
          Just exploring? Sign in with{' '}
          <span className="font-semibold text-emerald-600">demo</span>
          {' / '}
          <span className="font-semibold text-emerald-600">demo</span>
        </p>

        {/* Footer */}
        <p className="text-center text-[10px] text-gray-300 mt-4">
          B.D. Sterling Capital &middot; Fund Management System
        </p>
      </div>

      {/* ── Right: Showcase widgets ── */}
      <div className="hidden lg:flex flex-col w-[460px] h-[480px]">
        <ShowcaseWidgets />
      </div>
    </div>
  );
}
