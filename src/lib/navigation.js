import {
  Briefcase, Search, Eye, FolderOpen, ClipboardList, ListChecks,
  PieChart, DollarSign, Link2, Users, Target, LayoutDashboard, MessagesSquare,
  GraduationCap,
} from 'lucide-react';

// Single source of truth for app navigation.
// Consumed by the Navbar (dropdowns + mobile drawer) and the Command Palette.
// All top-level entries are dropdown groups so navigation is consistent —
// no mixed standalone links.
export const NAV_GROUPS = [
  {
    label: 'CIO Suite',
    icon: Briefcase,
    items: [
      { href: '/holdings', label: 'Holdings', icon: Briefcase },
      { href: '/allocation', label: 'Allocation', icon: PieChart },
      { href: '/relationships', label: 'Relationships', icon: Users },
    ],
  },
  {
    label: 'Strategy',
    icon: Target,
    items: [
      { href: '/strategic-hub', label: 'Strategic Hub', icon: Target },
      { href: '/tasks', label: 'Tasks', icon: ListChecks },
      { href: '/lessons', label: 'Lessons Learned', icon: GraduationCap },
    ],
  },
  {
    label: 'Equity Research',
    icon: Search,
    items: [
      { href: '/watchlist', label: 'Watchlist', icon: Eye },
      { href: '/draft-review', label: 'Draft & Review', icon: MessagesSquare },
      { href: '/research', label: 'Research', icon: Search },
      { href: '/position-review', label: 'Position Review', icon: ClipboardList },
    ],
  },
  {
    label: 'Admin',
    icon: FolderOpen,
    items: [
      { href: '/documents', label: 'Documents', icon: FolderOpen },
      { href: '/link-database', label: 'Link Database', icon: Link2 },
      { href: '/financials', label: 'Financials', icon: DollarSign },
    ],
  },
];

// Whether a given pathname falls under a group (for active highlighting).
export function isGroupActive(group, pathname) {
  return group.items.some(
    item => pathname === item.href || pathname.startsWith(item.href + '/')
  );
}

// Whether a given pathname matches a specific destination.
export function isItemActive(href, pathname) {
  return pathname === href || pathname.startsWith(href + '/');
}

// Flat list of every destination, including the dashboard home.
// Used by the command palette and the breadcrumb page title.
export const ALL_PAGES = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Home' },
  ...NAV_GROUPS.flatMap(group =>
    group.items.map(item => ({ ...item, group: group.label }))
  ),
];

// Resolve the human-readable title for the current route.
export function pageTitleForPath(pathname) {
  if (pathname === '/') return 'Dashboard';
  // Prefer the most specific (longest) matching href.
  const match = ALL_PAGES
    .filter(p => p.href !== '/' && (pathname === p.href || pathname.startsWith(p.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match ? match.label : 'Dashboard';
}
