'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useSearchParams } from 'next/navigation';
import React, { useState, useEffect, useRef } from 'react';
import {
  Briefcase, Search, Eye, FolderOpen, LogOut, ClipboardList,
  ChevronDown, Shield, BarChart3, PieChart, FileText, DollarSign, Link2, Users, Activity, Target, Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const NAV_GROUPS = [
  {
    label: 'CIO Suite',
    icon: Briefcase,
    items: [
      { href: '/holdings', label: 'Holdings', icon: Briefcase },
      { href: '/allocation', label: 'Allocation', icon: PieChart },
      { href: '/macro-regime', label: 'Market Confidence', icon: Activity },
      { href: '/relationships', label: 'Relationships', icon: Users },
    ],
    // Active if any child route is active
    matchPaths: ['/holdings', '/allocation', '/macro-regime', '/relationships'],
  },
  {
    label: 'Equity Research',
    icon: Search,
    items: [
      { href: '/watchlist', label: 'Watchlist', icon: Eye },
      { href: '/research', label: 'Research', icon: Search },
      { href: '/position-review', label: 'Position Review', icon: ClipboardList },
    ],
    matchPaths: ['/watchlist', '/research', '/position-review'],
  },
  {
    label: 'Admin',
    icon: FolderOpen,
    items: [
      { href: '/documents', label: 'Documents', icon: FolderOpen },
      { href: '/link-database', label: 'Link Database', icon: Link2 },
      { href: '/financials', label: 'Financials', icon: DollarSign },
      { href: '/workspace', label: 'Workspace', icon: Sparkles },
    ],
    matchPaths: ['/documents', '/link-database', '/financials', '/workspace'],
  },
];

function NavDropdown({ group, pathname, searchParams, isDark }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timeoutRef = useRef(null);

  const currentFullPath = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');

  const isGroupActive = group.matchPaths.some(
    p => pathname === p || pathname.startsWith(p + '/')
  );

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  const Icon = group.icon;

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className={`
          flex items-center gap-1.5 px-4 py-2 rounded-xl text-[15px] font-semibold transition-all duration-200
          ${isGroupActive
            ? isDark ? 'text-emerald-400 bg-emerald-500/15' : 'text-emerald-700 bg-emerald-50'
            : isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
          }
        `}
      >
        <Icon size={16} />
        {group.label}
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        {isGroupActive && (
          <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
        )}
      </button>

      {open && (
        <div
          className={`absolute top-full left-0 mt-1.5 w-52 rounded-2xl py-1.5 z-50 ${isDark ? 'border border-white/10 shadow-xl shadow-black/30' : 'border border-gray-200/60 shadow-xl shadow-gray-300/30'}`}
          style={{
            background: isDark
              ? 'linear-gradient(160deg, rgba(15,23,42,0.97) 0%, rgba(10,15,30,0.98) 100%)'
              : 'linear-gradient(160deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.97) 100%)',
            backdropFilter: 'blur(24px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
          }}
        >
          {group.items.map(({ href, label, icon: ItemIcon }) => {
            const isItemActive = href.includes('?')
              ? currentFullPath === href
              : currentFullPath === href;

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`
                  flex items-center gap-2.5 px-4 py-2.5 text-[15px] font-medium no-underline transition-all duration-150
                  ${isItemActive
                    ? isDark ? 'text-emerald-400 bg-emerald-500/15' : 'text-emerald-700 bg-emerald-50'
                    : isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }
                `}
              >
                <ItemIcon size={16} className={isItemActive ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : (isDark ? 'text-gray-500' : 'text-gray-400')} />
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { logout, isDemo } = useAuth();
  const isDark = false;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[9999] transition-all duration-500 ${
        isDark
          ? scrolled ? 'shadow-lg shadow-black/20' : ''
          : scrolled ? 'shadow-lg shadow-gray-200/50' : ''
      }`}
      style={{
        background: isDark
          ? scrolled
            ? 'linear-gradient(135deg, rgba(3,7,18,0.85) 0%, rgba(10,20,35,0.82) 50%, rgba(3,7,18,0.85) 100%)'
            : 'linear-gradient(135deg, rgba(3,7,18,0.4) 0%, rgba(10,20,35,0.3) 100%)'
          : scrolled
            ? 'linear-gradient(160deg, rgba(255,255,255,0.6) 0%, rgba(240,245,255,0.55) 30%, rgba(255,255,255,0.62) 60%, rgba(245,250,255,0.55) 100%)'
            : 'linear-gradient(160deg, rgba(255,255,255,0.38) 0%, rgba(240,248,255,0.32) 50%, rgba(255,255,255,0.38) 100%)',
        backdropFilter: scrolled ? 'blur(24px) saturate(2.0) brightness(1.08)' : 'blur(14px) saturate(1.6) brightness(1.05)',
        WebkitBackdropFilter: scrolled ? 'blur(24px) saturate(2.0) brightness(1.08)' : 'blur(14px) saturate(1.6) brightness(1.05)',
        borderBottom: isDark
          ? '1px solid rgba(255,255,255,0.06)'
          : scrolled ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.3)',
        boxShadow: isDark
          ? ''
          : scrolled
            ? '0 4px 30px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)'
            : 'inset 0 1px 0 rgba(255,255,255,0.4)',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3.5 no-underline group">
          <Image
            src="/images/wow.png"
            alt="AlphaOS"
            width={205}
            height={72}
            className="h-9 w-auto object-contain"
            unoptimized
            priority
          />
          <span className={`text-lg font-medium ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>|</span>
          <span className={`font-semibold text-[17px] tracking-tight transition-colors ${isDark ? 'text-gray-400 group-hover:text-emerald-400' : 'text-gray-700 group-hover:text-emerald-700'}`}>
            Dashboard
          </span>
        </Link>
        {isDemo && (
          <span
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200"
            title="You are in the isolated demo environment — no production data is used."
          >
            <Sparkles size={12} /> Demo
          </span>
        )}
        </div>

        <div className="flex items-center gap-1">
          {NAV_GROUPS.map((group, i) => (
            <React.Fragment key={group.label}>
              <NavDropdown group={group} pathname={pathname} searchParams={searchParams} isDark={isDark} />
              {i === 0 && (
                <Link
                  href="/strategic-hub"
                  className={`
                    relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-[15px] font-semibold transition-all duration-200 no-underline
                    ${pathname === '/strategic-hub' || pathname.startsWith('/strategic-hub/')
                      ? isDark ? 'text-emerald-400 bg-emerald-500/15' : 'text-emerald-700 bg-emerald-50'
                      : isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                    }
                  `}
                >
                  <Target size={16} />
                  Strategic Hub
                  {(pathname === '/strategic-hub' || pathname.startsWith('/strategic-hub/')) && (
                    <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}`} />
                  )}
                </Link>
              )}
            </React.Fragment>
          ))}

          <button
            onClick={async () => {
              await logout();
              window.location.href = '/login';
            }}
            className={`ml-4 p-2.5 rounded-lg transition-all duration-200 ${isDark ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </nav>
  );
}
