import {
  Briefcase, Search, Eye, FolderOpen, ClipboardList, ListChecks,
  PieChart, DollarSign, Link2, Users, Activity, Target, Sparkles, LayoutDashboard, Workflow, MessagesSquare,
} from 'lucide-react';

// Single source of truth for app navigation.
// Consumed by the Navbar (dropdowns + mobile drawer) and the Command Palette.
// All top-level entries are dropdown groups so navigation is consistent —
// no mixed standalone links. Tasks lives under "Strategy" (previously it was
// only reachable as a tab buried inside Strategic Hub).
export const NAV_GROUPS = [
  {
    label: 'CIO Suite',
    icon: Briefcase,
    items: [
      { href: '/holdings', label: 'Holdings', icon: Briefcase, desc: 'Positions & P&L' },
      { href: '/allocation', label: 'Allocation', icon: PieChart, desc: 'Asset & sector weights' },
      { href: '/macro-regime', label: 'Market Confidence', icon: Activity, desc: 'Macro regime signals' },
      { href: '/relationships', label: 'Relationships', icon: Users, desc: 'Contacts & interactions' },
    ],
  },
  {
    label: 'Strategy',
    icon: Target,
    items: [
      { href: '/strategic-hub', label: 'Strategic Hub', icon: Target, desc: 'Positioning & convictions' },
      { href: '/tasks', label: 'Tasks', icon: ListChecks, desc: 'Task board & to-dos' },
      { href: '/workspace', label: 'Workspace', icon: Sparkles, desc: 'AI research workspace' },
    ],
  },
  {
    label: 'Equity Research',
    icon: Search,
    items: [
      { href: '/workflow', label: 'Workflow', icon: Workflow, desc: 'Research pipeline overview' },
      { href: '/watchlist', label: 'Watchlist', icon: Eye, desc: 'Tracked tickers' },
      { href: '/draft-review', label: 'Draft & Review', icon: MessagesSquare, desc: 'Paper & reviewer threads' },
      { href: '/research', label: 'Research', icon: Search, desc: 'Deep-dive analysis' },
      { href: '/position-review', label: 'Position Review', icon: ClipboardList, desc: 'Active position checks' },
    ],
  },
  {
    label: 'Admin',
    icon: FolderOpen,
    items: [
      { href: '/documents', label: 'Documents', icon: FolderOpen, desc: 'Files & uploads' },
      { href: '/link-database', label: 'Link Database', icon: Link2, desc: 'Saved links' },
      { href: '/financials', label: 'Financials', icon: DollarSign, desc: 'Accounting & NAV' },
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
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, desc: 'Overview & fund NAV', group: 'Home' },
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
