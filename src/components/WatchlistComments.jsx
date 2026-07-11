'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MessageCircle, Plus, ChevronDown, ChevronRight, Bell, Users, Loader2, Clock, Star, X } from 'lucide-react';
import PersonSearchSelect from '@/components/PersonSearchSelect';
import CommentThread, { ROLE_META, makeId } from '@/components/CommentThread';
import { DEFAULT_AUTO_NOTIFY } from '@/lib/autoNotify';

/**
 * WatchlistComments — the Draft & Review comment workflow, presented as a right-side
 * slide-out drawer over the Watchlist. Same data model and same `CommentThread` UI as
 * Draft & Review, and — crucially — the SAME store: comments live on the ticker's
 * thesis (thesis.underwriting.draftReview), so a comment is one entity that follows
 * the name across every stage. Add it here and it's there in Draft & Review after a
 * promote; a Draft & Review comment (open or resolved) shows here after a demote.
 * The page owns loading/saving that thesis; this component just renders the review.
 *
 * It renders as a full-height drawer (backdrop + panel) mounted once at the page
 * level rather than a popover trapped inside a card, so it never overflows the
 * viewport, never overlaps neighboring cards, and has room to actually read/type.
 *
 *   review = { threads: [...], author, reviewer, autoNotify }
 *
 * Controlled: it owns no review state, calling onChange(nextReview, persist).
 * `onNotify(threadIds)` sends the "notify now" emails (POST /api/notify-review) and
 * returns { sent, skipped } so the button can reflect what went out.
 */

// Drawer chrome shared by the loading and loaded states: a dimmed backdrop (click to
// close), a right-anchored full-height panel that slides in, Escape-to-close, and a
// body-scroll lock so the page behind doesn't scroll while the drawer is open.
function DrawerShell({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100]" data-comments-drawer>
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className="absolute right-0 top-16 bottom-0 w-full md:w-2/3 max-w-[1100px] bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {children}
      </div>
    </div>
  );
}

const AUTO_CADENCE_OPTIONS = [
  { days: 1, label: 'Daily' },
  { days: 2, label: 'Every 2 days' },
  { days: 3, label: 'Every 3 days' },
];
const minutesToHHMM = (m) => {
  const v = Number.isFinite(m) ? m : 540;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
const hhmmToMinutes = (s) => {
  const [h, m] = String(s || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 540;
};
const browserTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
};

export default function WatchlistComments({ ticker, review, loading = false, onChange, onNotify, onClose }) {
  const threads = useMemo(() => (Array.isArray(review?.threads) ? review.threads : []), [review]);
  const author = review?.author || { name: '', email: '' };
  const reviewer = review?.reviewer || { name: '', email: '' };
  const cfg = review?.autoNotify || DEFAULT_AUTO_NOTIFY;

  const patchReview = (updates, persist = false) => onChange({ ...review, threads, author, reviewer, autoNotify: cfg, ...updates }, persist);
  const setThreads = (next, persist = false) => patchReview({ threads: next }, persist);
  const setAutoNotify = (patch) => patchReview({ autoNotify: { ...cfg, ...patch } }, true);

  const openCount = threads.filter(t => !t.resolved).length;
  const resolvedCount = threads.length - openCount;

  // Track which threads are COLLAPSED (default: none → everything shows expanded).
  // Using a collapsed-set rather than an expanded-set matters because threads load
  // async: an expanded-set seeded at mount (when threads were still empty) would
  // leave freshly-loaded comments collapsed. It also means resolved comments are
  // visible by default, which is what we want here.
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [showConfig, setShowConfig] = useState(false);
  const newThreadRef = useRef(null);
  const [pendingScrollId, setPendingScrollId] = useState(null);

  useEffect(() => {
    if (!pendingScrollId) return;
    const el = newThreadRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setPendingScrollId(null);
  }, [pendingScrollId, threads]);

  const toggleThread = (id) => setCollapsedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addThread = () => {
    const thread = { id: makeId(), title: '', resolved: false, createdAt: new Date().toISOString(), messages: [] };
    setThreads([...threads, thread], true);
    // New threads render expanded by default (they're absent from collapsedIds).
    setPendingScrollId(thread.id);
  };
  const updateThread = (id, next, persist) => setThreads(threads.map(t => t.id === id ? next : t), persist);
  const removeThread = (id) => setThreads(threads.filter(t => t.id !== id), true);

  // Display order only: resolved threads sink to the bottom (stable within groups).
  const orderedThreads = [...threads].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved));

  // ── Saved people (address book) ──
  const [savedPeople, setSavedPeople] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/saved-emails')
      .then(r => r.json())
      .then(data => { if (!cancelled && Array.isArray(data.people)) setSavedPeople(data.people); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const persistSavedPeople = useCallback((people) => {
    setSavedPeople(people);
    fetch('/api/saved-emails', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ people }),
    }).catch(() => {});
  }, []);
  const saveContact = useCallback((person) => {
    const name = (person?.name || '').trim();
    const email = (person?.email || '').trim();
    if (!email) return;
    const key = email.toLowerCase();
    persistSavedPeople([{ name, email }, ...savedPeople.filter(p => (p.email || '').toLowerCase() !== key)]);
  }, [savedPeople, persistSavedPeople]);
  const removeContact = useCallback((email) => {
    const key = (email || '').toLowerCase();
    persistSavedPeople(savedPeople.filter(p => (p.email || '').toLowerCase() !== key));
  }, [savedPeople, persistSavedPeople]);

  // ── Notify (email now) ──
  const [notifying, setNotifying] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const notifyRef = useRef(null);

  const pendingList = useMemo(() => {
    const list = [];
    for (const t of threads) {
      if (t.resolved) continue;
      const msgs = t.messages || [];
      if (!msgs.length) continue;
      const lastMsg = msgs[msgs.length - 1];
      list.push({ id: t.id, title: t.title, role: lastMsg.role === 'reviewer' ? 'author' : 'reviewer' });
    }
    return list;
  }, [threads]);
  const pendingTotal = pendingList.length;

  const toggleNotifyMenu = () => {
    if (notifyOpen) { setNotifyOpen(false); return; }
    setSelectedIds(new Set(pendingList.map(p => p.id)));
    setNotifyOpen(true);
  };
  const toggleSelected = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = pendingTotal > 0 && pendingList.every(p => selectedIds.has(p.id));
  const toggleAllSelected = () => setSelectedIds(allSelected ? new Set() : new Set(pendingList.map(p => p.id)));

  useEffect(() => {
    if (!notifyOpen) return;
    const onDown = (e) => { if (notifyRef.current && !notifyRef.current.contains(e.target)) setNotifyOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [notifyOpen]);

  const handleSend = async () => {
    if (!onNotify || notifying || selectedIds.size === 0) return;
    setNotifying(true);
    try {
      await onNotify([...selectedIds]);
      setNotifyOpen(false);
    } finally {
      setNotifying(false);
    }
  };

  const autoEnabled = !!cfg.enabled;
  const autoMissingEmail =
    (cfg.roles?.reviewer !== false && !reviewer.email) ||
    (cfg.roles?.author !== false && !author.email);

  if (loading) {
    return (
      <DrawerShell onClose={onClose}>
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <MessageCircle size={14} />
            </div>
            <h3 className="text-[13px] font-bold text-gray-900">{ticker} · Comments</h3>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </DrawerShell>
    );
  }

  return (
    <DrawerShell onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <MessageCircle size={14} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold text-gray-900 leading-tight">{ticker} · Comments</h3>
            <p className="text-[10px] text-gray-400">
              {threads.length === 0 ? 'Author ⇄ Reviewer discussion' : `${openCount} open · ${resolvedCount} resolved`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={addThread}
            className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
          <div className="w-px h-5 bg-gray-200 mx-0.5" />
          <div ref={notifyRef} className="relative">
            <button
              onClick={toggleNotifyMenu}
              title={pendingTotal === 0 ? 'No comments are awaiting a response' : `Email who's up next (${pendingTotal})`}
              className={`relative flex items-center p-1.5 rounded-lg transition-colors ${notifyOpen ? 'bg-blue-50 text-blue-600' : pendingTotal > 0 ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-300 hover:bg-gray-50'}`}
            >
              {notifying ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
              {pendingTotal > 0 && !notifying && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                  {pendingTotal}
                </span>
              )}
            </button>
            {notifyOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-30 w-72 rounded-xl border border-gray-200 bg-white shadow-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Notify</span>
                  {pendingTotal > 0 && <span className="text-[10px] text-gray-400 tabular-nums">{selectedIds.size} of {pendingTotal}</span>}
                </div>
                {pendingTotal === 0 ? (
                  <p className="text-[12px] text-gray-400 py-2">No comments are awaiting a response.</p>
                ) : (
                  <>
                    <div className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-3">
                      {['reviewer', 'author'].map(role => {
                        const items = pendingList.filter(p => p.role === role);
                        if (!items.length) return null;
                        const meta = ROLE_META[role];
                        const person = role === 'reviewer' ? reviewer : author;
                        return (
                          <div key={role}>
                            <div className="flex items-center gap-1.5 mb-1 px-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                              <span className={`text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
                              <span className={`text-[10px] truncate ${person.email ? 'text-gray-400' : 'text-amber-500'}`}>
                                {person.email || 'no email set'}
                              </span>
                            </div>
                            <div className="space-y-0.5">
                              {items.map(item => (
                                <label key={item.id} className="flex items-start gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} className="mt-0.5 accent-blue-600" />
                                  <span className="text-[12px] text-gray-700 leading-snug">{item.title?.trim() || 'Untitled comment'}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-gray-100">
                      <button onClick={toggleAllSelected} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 transition-colors">
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                      <button
                        onClick={handleSend}
                        disabled={selectedIds.size === 0 || notifying}
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {notifying ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                        Send{selectedIds.size > 0 ? ` ${selectedIds.size}` : ''}
                      </button>
                    </div>
                  </>
                )}

                {/* Auto-notify */}
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Auto-notify</span>
                    <button
                      type="button" role="switch" aria-checked={autoEnabled}
                      onClick={() => setAutoNotify(autoEnabled ? { enabled: false } : { enabled: true, tz: browserTz() })}
                      className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${autoEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${autoEnabled ? 'translate-x-[14px]' : ''}`} />
                    </button>
                  </div>
                  {autoEnabled && (
                    <div className="mt-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                          <Clock size={12} className="text-gray-400" /> Remind
                        </span>
                        <div className="flex items-center gap-1">
                          <select
                            value={cfg.everyDays ?? 1}
                            onChange={(e) => setAutoNotify({ everyDays: Number(e.target.value), tz: browserTz() })}
                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-700 outline-none focus:ring-1 focus:ring-blue-300 cursor-pointer"
                          >
                            {AUTO_CADENCE_OPTIONS.map(o => <option key={o.days} value={o.days}>{o.label}</option>)}
                          </select>
                          <span className="text-[11px] text-gray-400">at</span>
                          <input
                            type="time" step={1800}
                            value={minutesToHHMM(cfg.atMinutes)}
                            onChange={(e) => setAutoNotify({ atMinutes: hhmmToMinutes(e.target.value), tz: browserTz() })}
                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-700 outline-none focus:ring-1 focus:ring-blue-300 cursor-pointer"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-gray-600">Auto-send to</span>
                        <div className="flex items-center gap-1">
                          {['reviewer', 'author'].map(role => {
                            const meta = ROLE_META[role];
                            const on = cfg.roles?.[role] !== false;
                            return (
                              <button
                                key={role} type="button" aria-pressed={on}
                                onClick={() => setAutoNotify({ roles: { ...cfg.roles, [role]: !on }, tz: browserTz() })}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${on ? `${meta.badge} border-transparent` : 'text-gray-400 border-gray-200 hover:border-gray-300'}`}
                              >
                                {meta.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {autoMissingEmail && (
                        <p className="flex items-start gap-1 text-[10px] text-amber-500 leading-snug">
                          <Users size={11} className="mt-0.5 shrink-0" />
                          Set an email for each role (the <Users size={10} className="inline -mt-0.5" /> button) so reminders can reach them.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowConfig(v => !v)}
            title="Set author & reviewer emails"
            className={`flex items-center p-1.5 rounded-lg transition-colors ${showConfig ? 'text-emerald-600 bg-emerald-50' : 'text-gray-300 hover:text-gray-600 hover:bg-gray-50'}`}
          >
            <Users size={14} />
          </button>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {showConfig && (
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
            <p className="text-[11px] text-gray-400">
              Pick a saved person or type someone new and <Star size={10} className="inline -mt-0.5" /> to save them.
            </p>
            {[
              { role: 'reviewer', person: reviewer, key: 'reviewer', meta: ROLE_META.reviewer },
              { role: 'author', person: author, key: 'author', meta: ROLE_META.author },
            ].map(({ role, person, key, meta }) => {
              const trimmedEmail = (person.email || '').trim();
              const isSaved = !!trimmedEmail && savedPeople.some(p => (p.email || '').toLowerCase() === trimmedEmail.toLowerCase());
              const onPersonChange = (value, persist = false) => patchReview({ [key]: value }, persist);
              return (
                <div key={role} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center gap-1.5 text-[11px] font-semibold w-16 shrink-0 ${meta.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
                    </span>
                    {savedPeople.length > 0 && (
                      <PersonSearchSelect
                        people={savedPeople}
                        value={isSaved ? trimmedEmail : ''}
                        onSelect={(picked) => onPersonChange({ name: picked.name || '', email: picked.email || '' }, true)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={person.name}
                      onChange={(e) => onPersonChange({ ...person, name: e.target.value })}
                      onBlur={(e) => onPersonChange({ ...person, name: e.target.value }, true)}
                      placeholder="Name"
                      className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] text-gray-700 outline-none focus:ring-1 focus:ring-emerald-300"
                    />
                    <input
                      type="email"
                      value={person.email}
                      onChange={(e) => onPersonChange({ ...person, email: e.target.value })}
                      onBlur={(e) => onPersonChange({ ...person, email: e.target.value }, true)}
                      placeholder="email@example.com"
                      className="flex-[1.4] min-w-0 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] text-gray-700 outline-none focus:ring-1 focus:ring-emerald-300"
                    />
                    <button
                      type="button"
                      onClick={() => isSaved ? removeContact(trimmedEmail) : saveContact(person)}
                      disabled={!trimmedEmail}
                      title={!trimmedEmail ? 'Enter an email to save' : isSaved ? 'Remove from saved' : 'Save for reuse'}
                      className={`shrink-0 p-1.5 rounded-lg transition-colors ${!trimmedEmail ? 'text-gray-200 cursor-not-allowed' : isSaved ? 'text-amber-500 hover:bg-amber-50' : 'text-gray-300 hover:text-amber-500 hover:bg-amber-50'}`}
                    >
                      <Star size={14} fill={isSaved ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {threads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center">
            <MessageCircle size={20} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No comments yet</p>
            <p className="text-xs text-gray-300 mt-1">Add a point or question, then answer it below.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orderedThreads.map((thread, idx) => (
              <div key={thread.id} ref={thread.id === pendingScrollId ? newThreadRef : null} className="scroll-mt-4">
                <CommentThread
                  thread={thread}
                  index={idx}
                  ticker={ticker}
                  autoFocus={thread.id === pendingScrollId}
                  collapsed={collapsedIds.has(thread.id)}
                  onToggleCollapsed={() => toggleThread(thread.id)}
                  onChange={(next, persist) => updateThread(thread.id, next, persist)}
                  onRemove={() => removeThread(thread.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </DrawerShell>
  );
}
