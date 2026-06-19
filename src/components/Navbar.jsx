'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useSearchParams } from 'next/navigation';
import React, { useState, useEffect, useRef } from 'react';
import {
  Briefcase, Search, Eye, FolderOpen, LogOut, ClipboardList,
  ChevronDown, PieChart, DollarSign, Link2, Users, Activity, Target, Sparkles, Workflow,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const NAV_GROUPS = [
  {
    label: 'CIO Suite',
    icon: Briefcase,
    items: [
      { href: '/holdings', label: 'Holdings', icon: Briefcase, desc: 'Positions & P&L' },
      { href: '/allocation', label: 'Allocation', icon: PieChart, desc: 'Asset & sector weights' },
      { href: '/macro-regime', label: 'Market Confidence', icon: Activity, desc: 'Macro regime signals' },
      { href: '/relationships', label: 'Relationships', icon: Users, desc: 'Contacts & interactions' },
    ],
    matchPaths: ['/holdings', '/allocation', '/macro-regime', '/relationships'],
  },
  {
    label: 'Equity Research',
    icon: Search,
    items: [
      { href: '/watchlist', label: 'Watchlist', icon: Eye, desc: 'Tracked tickers' },
      { href: '/research', label: 'Research', icon: Search, desc: 'Deep-dive analysis' },
      { href: '/position-review', label: 'Position Review', icon: ClipboardList, desc: 'Active position checks' },
    ],
    matchPaths: ['/watchlist', '/research', '/position-review'],
  },
  {
    label: 'Admin',
    icon: FolderOpen,
    items: [
      { href: '/documents', label: 'Documents', icon: FolderOpen, desc: 'Files & uploads' },
      { href: '/link-database', label: 'Link Database', icon: Link2, desc: 'Saved links' },
      { href: '/financials', label: 'Financials', icon: DollarSign, desc: 'Accounting & NAV' },
    ],
    matchPaths: ['/documents', '/link-database', '/financials'],
  },
];

const STANDALONE = [
  { href: '/strategic-hub', label: 'Strategic Hub', icon: Target },
  { href: '/workspace', label: 'Workspace', icon: Sparkles },
  { href: '/ai-pipeline', label: 'AI Pipeline', icon: Workflow },
];

// Shared classes for a top-level nav pill (dropdown trigger or standalone link).
function pillClasses(active, isDark) {
  return `relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[14px] font-semibold transition-all duration-200 no-underline outline-none
    ${active
      ? isDark ? 'text-emerald-300 bg-emerald-400/15' : 'text-emerald-700 bg-white shadow-sm shadow-emerald-900/5 ring-1 ring-emerald-500/20'
      : isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-white/70'
    }`;
}

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
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={pillClasses(isGroupActive, isDark)}
      >
        <Icon size={15} className={isGroupActive ? '' : 'opacity-70'} />
        {group.label}
        <ChevronDown size={13} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''} ${isGroupActive ? '' : 'opacity-60'}`} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute top-full left-0 mt-2 w-64 rounded-2xl p-1.5 z-50 animate-scale-in ${isDark ? 'border border-white/10 shadow-xl shadow-black/40' : 'border border-gray-200/70 shadow-2xl shadow-gray-400/20'}`}
          style={{
            transformOrigin: 'top left',
            background: isDark
              ? 'linear-gradient(160deg, rgba(15,23,42,0.98) 0%, rgba(10,15,30,0.99) 100%)'
              : 'linear-gradient(160deg, rgba(255,255,255,0.97) 0%, rgba(248,250,252,0.98) 100%)',
            backdropFilter: 'blur(24px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
          }}
        >
          <div className={`px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {group.label}
          </div>
          {group.items.map(({ href, label, icon: ItemIcon, desc }) => {
            const isItemActive = currentFullPath === href;

            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`group/item flex items-center gap-3 px-2.5 py-2 rounded-xl no-underline transition-all duration-150
                  ${isItemActive
                    ? isDark ? 'bg-emerald-400/15' : 'bg-emerald-50'
                    : isDark ? 'hover:bg-white/[0.06]' : 'hover:bg-gray-50'
                  }`}
              >
                <span
                  className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 transition-colors duration-150
                    ${isItemActive
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-500/30'
                      : isDark ? 'bg-white/[0.06] text-gray-400 group-hover/item:text-white' : 'bg-gray-100 text-gray-500 group-hover/item:bg-gray-200 group-hover/item:text-gray-700'
                    }`}
                >
                  <ItemIcon size={17} />
                </span>
                <span className="flex flex-col min-w-0">
                  <span className={`text-[14px] font-semibold leading-tight ${isItemActive ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : (isDark ? 'text-gray-200' : 'text-gray-800')}`}>
                    {label}
                  </span>
                  <span className={`text-[11.5px] leading-tight truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {desc}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StandaloneLink({ href, label, icon: Icon, pathname, isDark }) {
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link href={href} className={pillClasses(active, isDark)}>
      <Icon size={15} className={active ? '' : 'opacity-70'} />
      {label}
    </Link>
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

  // Interleave: CIO Suite · Strategic Hub · Workspace · Equity Research · Admin
  const cioSuite = NAV_GROUPS[0];
  const rest = NAV_GROUPS.slice(1);

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
            ? 'linear-gradient(160deg, rgba(255,255,255,0.7) 0%, rgba(240,245,255,0.62) 30%, rgba(255,255,255,0.7) 60%, rgba(245,250,255,0.62) 100%)'
            : 'linear-gradient(160deg, rgba(255,255,255,0.45) 0%, rgba(240,248,255,0.38) 50%, rgba(255,255,255,0.45) 100%)',
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
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <Link href="/" className="flex items-center gap-3.5 no-underline group">
            <Image
              src="/images/wow.png"
              alt="AlphaOS"
              width={205}
              height={72}
              className="h-9 w-auto object-contain transition-transform duration-200 group-hover:scale-[1.03]"
              unoptimized
              priority
            />
            <span className={`hidden md:block w-px h-6 ${isDark ? 'bg-white/15' : 'bg-gray-300/80'}`} />
            <span className={`hidden md:block font-semibold text-[16px] tracking-tight transition-colors ${isDark ? 'text-gray-400 group-hover:text-emerald-400' : 'text-gray-700 group-hover:text-emerald-700'}`}>
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

        {/* Nav pill bar */}
        <div className="flex items-center gap-1.5">
          <div
            className={`flex items-center gap-0.5 p-1 rounded-2xl ${isDark ? 'bg-white/[0.04] border border-white/10' : 'bg-gray-100/50 border border-white/60'}`}
          >
            <NavDropdown group={cioSuite} pathname={pathname} searchParams={searchParams} isDark={isDark} />
            {STANDALONE.map(s => (
              <StandaloneLink key={s.href} {...s} pathname={pathname} isDark={isDark} />
            ))}
            {rest.map(group => (
              <NavDropdown key={group.label} group={group} pathname={pathname} searchParams={searchParams} isDark={isDark} />
            ))}
          </div>

          <button
            onClick={async () => {
              await logout();
              window.location.href = '/login';
            }}
            className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200 ${isDark ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </nav>
  );
}
