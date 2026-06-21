'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogOut, ChevronDown, Sparkles, Menu, X, Search } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import {
  NAV_GROUPS, isGroupActive, isItemActive,
} from '@/lib/navigation';

// Open the global command palette (handled by CommandPalette.jsx).
function openCommandPalette() {
  window.dispatchEvent(new CustomEvent('open-command-palette'));
}

// Shared classes for a top-level nav pill (dropdown trigger).
function pillClasses(active) {
  return `relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[14px] font-semibold transition-all duration-200 no-underline outline-none
    ${active
      ? 'text-emerald-700 bg-white shadow-sm shadow-emerald-900/5 ring-1 ring-emerald-500/20'
      : 'text-gray-500 hover:text-gray-900 hover:bg-white/70'
    }`;
}

function NavDropdown({ group, pathname, isOpen, onToggle, onClose }) {
  const ref = useRef(null);
  const Icon = group.icon;
  const groupActive = isGroupActive(group, pathname);

  // Close when clicking outside this dropdown.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <button
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={pillClasses(groupActive)}
      >
        <Icon size={15} className={groupActive ? '' : 'opacity-70'} />
        {group.label}
        <ChevronDown size={13} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${groupActive ? '' : 'opacity-60'}`} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-2 w-64 rounded-2xl p-1.5 z-50 animate-scale-in border border-gray-200/70 shadow-2xl shadow-gray-400/20"
          style={{
            transformOrigin: 'top left',
            background: 'linear-gradient(160deg, rgba(255,255,255,0.97) 0%, rgba(248,250,252,0.98) 100%)',
            backdropFilter: 'blur(24px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
          }}
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
            {group.label}
          </div>
          {group.items.map(({ href, label, icon: ItemIcon, desc }) => {
            const itemActive = isItemActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={onClose}
                className={`group/item flex items-center gap-3 px-2.5 py-2 rounded-xl no-underline transition-all duration-150
                  ${itemActive ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
              >
                <span
                  className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 transition-colors duration-150
                    ${itemActive
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-500/30'
                      : 'bg-gray-100 text-gray-500 group-hover/item:bg-gray-200 group-hover/item:text-gray-700'
                    }`}
                >
                  <ItemIcon size={17} />
                </span>
                <span className="flex flex-col min-w-0">
                  <span className={`text-[14px] font-semibold leading-tight ${itemActive ? 'text-emerald-700' : 'text-gray-800'}`}>
                    {label}
                  </span>
                  <span className="text-[11.5px] leading-tight truncate text-gray-400">
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

// Search field trigger shown in the bar; opens the command palette.
function SearchTrigger() {
  return (
    <button
      onClick={openCommandPalette}
      className="hidden sm:flex items-center justify-between gap-3 pl-3 pr-2 py-2 rounded-xl text-[13px] font-medium text-gray-400 bg-gray-100/60 border border-white/60 hover:text-gray-600 hover:bg-white/80 transition-all duration-200 min-w-[230px]"
      title="Search (Ctrl+S)"
      aria-label="Open command palette"
    >
      <span className="flex items-center gap-2">
        <Search size={14} />
        <span>Search…</span>
      </span>
      <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/70 border border-gray-200 text-[10px] font-semibold text-gray-400">
        Ctrl+S
      </kbd>
    </button>
  );
}

// Full-screen drawer for narrow screens.
function MobileDrawer({ open, onClose, pathname, onLogout }) {
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-[10000]">
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={onClose} />
      <div
        className="absolute top-0 right-0 h-full w-[82%] max-w-sm overflow-y-auto p-5 animate-slide-in-right"
        style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,1) 100%)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] font-bold uppercase tracking-wide text-gray-400">Menu</span>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <button
          onClick={() => { onClose(); openCommandPalette(); }}
          className="w-full flex items-center gap-2 px-3 py-2.5 mb-4 rounded-xl text-[14px] font-medium text-gray-500 bg-gray-100/70 border border-gray-200"
        >
          <Search size={15} /> Search pages & tickers…
        </button>

        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-4">
            <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: ItemIcon, desc }) => {
                const itemActive = isItemActive(href, pathname);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-2.5 py-2 rounded-xl no-underline transition-colors
                      ${itemActive ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0
                      ${itemActive ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      <ItemIcon size={17} />
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className={`text-[14px] font-semibold leading-tight ${itemActive ? 'text-emerald-700' : 'text-gray-800'}`}>{label}</span>
                      <span className="text-[11.5px] leading-tight truncate text-gray-400">{desc}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 mt-2 rounded-xl text-[14px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const { logout, isDemo } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [openGroup, setOpenGroup] = useState(null); // only one dropdown open at a time
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    window.location.href = '/login';
  }, [logout]);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[9999] transition-all duration-500 ${scrolled ? 'shadow-lg shadow-gray-200/50' : ''}`}
      style={{
        background: scrolled
          ? 'linear-gradient(160deg, rgba(255,255,255,0.7) 0%, rgba(240,245,255,0.62) 30%, rgba(255,255,255,0.7) 60%, rgba(245,250,255,0.62) 100%)'
          : 'linear-gradient(160deg, rgba(255,255,255,0.45) 0%, rgba(240,248,255,0.38) 50%, rgba(255,255,255,0.45) 100%)',
        backdropFilter: scrolled ? 'blur(24px) saturate(2.0) brightness(1.08)' : 'blur(14px) saturate(1.6) brightness(1.05)',
        WebkitBackdropFilter: scrolled ? 'blur(24px) saturate(2.0) brightness(1.08)' : 'blur(14px) saturate(1.6) brightness(1.05)',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.3)',
        boxShadow: scrolled
          ? '0 4px 30px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)'
          : 'inset 0 1px 0 rgba(255,255,255,0.4)',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-4">
        {/* Brand + current page breadcrumb */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
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
            <span className="hidden md:block w-px h-6 bg-gray-300/80" />
            <span className="hidden md:block font-semibold text-[16px] tracking-tight text-gray-700 origin-left transition-transform duration-200 group-hover:scale-[1.03]">
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

        {/* Desktop nav pill bar — menu options first, then search on the right */}
        <div className="hidden lg:flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 p-1 rounded-2xl bg-gray-100/50 border border-white/60">
            {NAV_GROUPS.map(group => (
              <NavDropdown
                key={group.label}
                group={group}
                pathname={pathname}
                isOpen={openGroup === group.label}
                onToggle={() => setOpenGroup(prev => (prev === group.label ? null : group.label))}
                onClose={() => setOpenGroup(null)}
              />
            ))}
          </div>

          <SearchTrigger />

          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-9 h-9 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>

        {/* Mobile controls */}
        <div className="flex lg:hidden items-center gap-1.5">
          <button
            onClick={openCommandPalette}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-white/70 transition-colors"
            aria-label="Search"
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => setMobileOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-600 hover:bg-white/70 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} pathname={pathname} onLogout={handleLogout} />
    </nav>
  );
}
