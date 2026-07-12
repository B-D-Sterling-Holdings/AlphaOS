'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { FileText, MessageCircle, Plus, ChevronDown, ChevronRight, ChevronLeft, Bell, Users, Loader2, Clock, Calculator } from 'lucide-react';
import Card from '@/components/Card';
import RichTextArea from '@/components/RichTextArea';
import PersonSearchSelect from '@/components/PersonSearchSelect';
import CommentThread, { ROLE_META, makeId } from '@/components/CommentThread';
import { DEFAULT_AUTO_NOTIFY, selectDueReminders, computeNextSent } from '@/lib/autoNotify';

/**
 * DraftReview — the "write a paper, then review it back-and-forth" workspace.
 *
 * Layout: the paper (rich text + inline images) sits in the main column; a panel
 * of numbered discussion threads sits beside it. Each thread is one reviewer
 * point/question with a reply chain that alternates Reviewer <-> Author until the
 * thread is resolved.
 *
 * State lives in thesis.underwriting.draftReview = { paper: <blocks>, threads: [...] }.
 * The component owns all thread/message mutations and pushes the whole `threads`
 * array (and `paper` value) back up via onThreadsChange / onPaperChange. Pass
 * persist=true to trigger an immediate save (used on blur / structural changes).
 */


// Cadence for the scheduled auto-notify reminder (fires every N days at a set time).
const AUTO_CADENCE_OPTIONS = [
  { days: 1, label: 'Daily' },
  { days: 2, label: 'Every 2 days' },
  { days: 3, label: 'Every 3 days' },
];

// atMinutes (minutes from midnight) <-> "HH:MM" for the native time input.
const minutesToHHMM = (m) => {
  const v = Number.isFinite(m) ? m : 540;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
const hhmmToMinutes = (s) => {
  const [h, m] = String(s || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 540;
};
// The configuring browser's IANA zone, stamped on the config so the cron reads
// the chosen time in the same wall clock the user picked it in.
const browserTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
};


export default function DraftReview({ ticker, paper, threads, author, reviewer, autoNotify, onPaperChange, onThreadsChange, onAuthorChange, onReviewerChange, onAutoNotifyChange, onNotify, valuationSlot }) {
  // null = both panels open; 'paper' = paper collapsed (review fills the row);
  // 'review' = review collapsed (paper fills the row). Collapse is an lg-only
  // affordance — on mobile both panels always stack full-width.
  const [collapsed, setCollapsed] = useState(null);
  // Which view the left column shows: the written paper or the valuation model. The
  // Review panel on the right is unaffected and keeps its own collapse/resize.
  const [leftTab, setLeftTab] = useState('overview'); // 'overview' | 'valuation'
  const paperCollapsed = collapsed === 'paper';
  const reviewCollapsed = collapsed === 'review';

  // Threads (comments) start collapsed; only ids in this set are expanded.
  const [expanded, setExpanded] = useState(() => new Set());
  const allExpanded = threads.length > 0 && threads.every(t => expanded.has(t.id));

  // After "Add point", scroll the freshly added thread into view (and focus it)
  // so you don't have to hunt for it at the bottom of the list.
  const newThreadRef = useRef(null);
  const [pendingScrollId, setPendingScrollId] = useState(null);

  useEffect(() => {
    if (!pendingScrollId) return;
    const el = newThreadRef.current;
    if (!el) return; // the new thread hasn't rendered yet — wait for threads to update
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPendingScrollId(null);
  }, [pendingScrollId, threads]);

  const toggleThread = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllThreads = () => {
    setExpanded(allExpanded ? new Set() : new Set(threads.map(t => t.id)));
  };

  const openCount = threads.filter(t => !t.resolved).length;
  const resolvedCount = threads.length - openCount;

  const [showConfig, setShowConfig] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const notifyRef = useRef(null);
  const safeAuthor = author || { userId: '', name: '' };
  const safeReviewer = reviewer || { userId: '', name: '' };

  // The Author/Reviewer are picked from the workspace's users (managed in Admin).
  // Their email lives on the user record, so we resolve "does this person have an
  // email" from this roster rather than storing an address on the review.
  const [people, setPeople] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspace-users')
      .then(r => r.json())
      .then(data => { if (!cancelled && Array.isArray(data.users)) setPeople(data.users); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Whether a picked person (by userId) currently has an email set in Admin.
  const hasEmailFor = useCallback((person) => {
    if (!person?.userId) return false;
    return !!people.find(p => p.id === person.userId)?.hasEmail;
  }, [people]);
  const authorHasEmail = hasEmailFor(safeAuthor);
  const reviewerHasEmail = hasEmailFor(safeReviewer);

  // Unresolved comments waiting on a response: a comment waits on whoever should
  // speak next (opposite of the last message's role). Empty comments (no replies
  // yet) aren't included — there's nothing to respond to.
  const pendingList = useMemo(() => {
    const list = [];
    for (const t of threads) {
      if (t.resolved) continue;
      const msgs = t.messages || [];
      if (!msgs.length) continue;
      const lastMsg = msgs[msgs.length - 1];
      const awaitingSinceMs = Date.parse(lastMsg.createdAt);
      list.push({
        id: t.id,
        title: t.title,
        role: lastMsg.role === 'reviewer' ? 'author' : 'reviewer',
        lastMessageId: lastMsg.id,
        awaitingSinceMs: Number.isNaN(awaitingSinceMs) ? Date.now() : awaitingSinceMs,
      });
    }
    return list;
  }, [threads]);
  const pendingTotal = pendingList.length;

  // Open the menu with every pending comment pre-checked; closing/opening resets.
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

  // Close the menu on an outside click.
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

  // ---- Auto-notify ----------------------------------------------------------
  // Emails reminders for comments still waiting at their scheduled send time
  // (every N days at a chosen time of day). The server cron
  // (src/app/api/cron/auto-notify) is the source of truth — it fires even when
  // nobody is looking. This in-app check is the same logic run while the review is
  // open (on mount + a 60s timer, since fire times are wall-clock based) for
  // immediate feedback. Both paths share one dedup map, `cfg.sent`, so
  // whoever sends first stamps it and the other skips — they never double-send.
  const cfg = autoNotify || DEFAULT_AUTO_NOTIFY;
  const autoEnabled = !!cfg.enabled;
  const setAutoNotify = (patch) => onAutoNotifyChange?.({ ...cfg, ...patch }, true);

  const autoBusyRef = useRef(false);
  const autoStateRef = useRef(null);
  autoStateRef.current = {
    cfg, threads, onNotify, onAutoNotifyChange,
    // selectDueReminders only needs to know whether a role is reachable; the
    // server resolves the actual address at send time. Pass a truthy marker when
    // the person has an email set, empty otherwise.
    emails: {
      reviewer: reviewerHasEmail ? '1' : '',
      author: authorHasEmail ? '1' : '',
    },
  };

  const runAutoNotify = useCallback(async () => {
    const { cfg: c, threads: th, onNotify: notify, onAutoNotifyChange: saveCfg, emails } = autoStateRef.current;
    if (!c?.enabled || !notify || autoBusyRef.current) return;
    const now = Date.now();
    const due = selectDueReminders({ threads: th, autoNotify: c, emails, now });
    const dueIds = [...due.reviewer, ...due.author].map(t => t.id);
    if (!dueIds.length) return;
    autoBusyRef.current = true;
    try {
      // Stamp the dedup map only for roles whose email actually sent — a failed
      // send (dead SMTP creds, network…) must stay unstamped so both this timer
      // and the server cron retry it instead of marking it silently "done".
      const result = await notify(dueIds);
      const sentRoles = new Set((result?.sent || []).map(s => s.role));
      const remindedIds = ['reviewer', 'author']
        .filter(role => sentRoles.has(role))
        .flatMap(role => due[role].map(t => t.id));
      if (!remindedIds.length) return;
      const nextSent = computeNextSent({ threads: th, prevSent: c.sent, remindedIds, nowIso: new Date(now).toISOString() });
      saveCfg?.({ ...c, sent: nextSent }, true);
    } finally {
      autoBusyRef.current = false;
    }
  }, []);

  const pendingSignature = pendingList.map(p => `${p.id}:${p.lastMessageId}`).join('|');
  useEffect(() => {
    if (!autoEnabled) return;
    runAutoNotify();
    const iv = setInterval(runAutoNotify, 60 * 1000);
    return () => clearInterval(iv);
  }, [autoEnabled, cfg.everyDays, cfg.atMinutes, cfg.tz, cfg.roles?.author, cfg.roles?.reviewer, pendingSignature, runAutoNotify]);

  const autoMissingEmail =
    (cfg.roles?.reviewer !== false && !reviewerHasEmail) ||
    (cfg.roles?.author !== false && !authorHasEmail);

  // Display order only (stored order is untouched): resolved threads sink to the
  // bottom, with relative order preserved within each group (Array.sort is stable).
  const orderedThreads = [...threads].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved));

  const addThread = () => {
    const thread = { id: makeId(), title: '', resolved: false, createdAt: new Date().toISOString(), messages: [] };
    onThreadsChange([...threads, thread], true);
    // A freshly added point opens so you can type its title and first comment.
    setExpanded(prev => new Set(prev).add(thread.id));
    setPendingScrollId(thread.id);
  };

  const updateThread = (id, nextThread, persist) => {
    onThreadsChange(threads.map(t => t.id === id ? nextThread : t), persist);
  };

  const removeThread = (id) => {
    onThreadsChange(threads.filter(t => t.id !== id), true);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* Paper */}
      {paperCollapsed ? (
        <button
          onClick={() => setCollapsed(null)}
          title="Expand the paper"
          className="hidden lg:flex shrink-0 w-9 flex-col items-center gap-3 py-4 rounded-2xl border border-gray-200 bg-white text-gray-400 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
        >
          <ChevronRight size={16} />
          <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">{leftTab === 'valuation' ? 'Valuation' : 'Overview'}</span>
        </button>
      ) : (
        <div className={`min-w-0 w-full lg:w-auto ${reviewCollapsed ? 'lg:flex-1' : 'lg:flex-[2_1_0%]'}`}>
          <Card>
            <div className="flex items-center gap-2 mb-1">
              {/* Tabs — switch the left column between the written paper and the
                  valuation model. Localized here; the Review panel is untouched. */}
              <div className="flex items-center gap-1 bg-gray-100/80 rounded-xl p-1 min-w-0">
                <button
                  onClick={() => setLeftTab('overview')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                    leftTab === 'overview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <FileText size={14} /> Investment Overview
                </button>
                <button
                  onClick={() => setLeftTab('valuation')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                    leftTab === 'valuation' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Calculator size={14} /> Valuation
                </button>
              </div>
              <button
                onClick={() => setCollapsed('paper')}
                title="Collapse this panel"
                className="ml-auto hidden lg:flex shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
            {/* Both views stay mounted (hidden, not unmounted) so switching tabs never
                drops in-progress edits or re-triggers their loads/auto-saves. */}
            <div className={`mt-4 ${leftTab === 'overview' ? '' : 'hidden'}`}>
              <RichTextArea
                value={paper}
                onChange={(value) => onPaperChange(value)}
                onBlur={(value) => onPaperChange(value, true)}
                onCommit={(value) => onPaperChange(value, true)}
                ticker={ticker}
                enableTables
                stickyToolbar
                placeholder="Open with the thesis in a sentence, then build the full argument — business, drivers, valuation, risks…"
                rows={22}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[15px] leading-relaxed text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none overflow-hidden"
              />
            </div>
            <div className={`mt-4 ${leftTab === 'valuation' ? '' : 'hidden'}`}>
              {valuationSlot}
            </div>
          </Card>
        </div>
      )}

      {/* Review threads — sticky, but with its own bounded height + scroll so a
          long thread/composer never grows past the viewport (a sticky box taller
          than the screen pins to the top and hides its own bottom). pr-1 keeps
          the composer's focus ring from being clipped by overflow. */}
      {reviewCollapsed ? (
        <button
          onClick={() => setCollapsed(null)}
          title="Expand the review"
          className="hidden lg:flex shrink-0 w-9 flex-col items-center gap-3 py-4 rounded-2xl border border-gray-200 bg-white text-gray-400 hover:text-emerald-600 hover:border-emerald-200 transition-colors lg:sticky lg:top-6"
        >
          <ChevronLeft size={16} />
          <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">Review</span>
        </button>
      ) : (
        <div className={`min-w-0 w-full lg:w-auto space-y-4 ${paperCollapsed ? 'lg:flex-1' : 'lg:flex-[1_1_0%]'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <MessageCircle size={15} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900">Review</h3>
                <p className="text-[11px] text-gray-400">
                  {threads.length === 0 ? 'Points & questions on the paper' : `${openCount} open · ${resolvedCount} resolved`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={addThread}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
              >
                <Plus size={13} />
                Add point
              </button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <div ref={notifyRef} className="relative">
                <button
                  onClick={toggleNotifyMenu}
                  title={pendingTotal === 0 ? 'No comments are awaiting a response' : `Choose who to email (${pendingTotal} awaiting)`}
                  className={`relative flex items-center p-1.5 rounded-lg transition-colors ${notifyOpen ? 'bg-blue-50 text-blue-600' : pendingTotal > 0 ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-300 hover:bg-gray-50'}`}
                >
                  {notifying ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />}
                  {pendingTotal > 0 && !notifying && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
                      {pendingTotal}
                    </span>
                  )}
                </button>
                {notifyOpen && (
                  <div className="absolute right-0 top-full mt-1.5 z-30 w-80 rounded-xl border border-gray-200 bg-white shadow-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Notify</span>
                      {pendingTotal > 0 && (
                        <span className="text-[10px] text-gray-400 tabular-nums">{selectedIds.size} of {pendingTotal} selected</span>
                      )}
                    </div>
                    {pendingTotal === 0 ? (
                      <p className="text-[12px] text-gray-400 py-2">No comments are awaiting a response.</p>
                    ) : (
                      <>
                        <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-3">
                          {['reviewer', 'author'].map(role => {
                            const items = pendingList.filter(p => p.role === role);
                            if (!items.length) return null;
                            const meta = ROLE_META[role];
                            const person = role === 'reviewer' ? safeReviewer : safeAuthor;
                            const roleUser = person.userId ? people.find(p => p.id === person.userId) : null;
                            const roleEmail = roleUser?.hasEmail ? roleUser.email : '';
                            return (
                              <div key={role}>
                                <div className="flex items-center gap-1.5 mb-1 px-1">
                                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                                  <span className={`text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
                                  {person.name && <span className="text-[10px] text-gray-500 truncate">{person.name}</span>}
                                  <span className={`text-[10px] truncate ${roleEmail ? 'text-gray-400' : 'text-amber-500'}`}>
                                    {roleEmail || 'email is not set up'}
                                  </span>
                                </div>
                                <div className="space-y-0.5">
                                  {items.map(item => (
                                    <label key={item.id} className="flex items-start gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={selectedIds.has(item.id)}
                                        onChange={() => toggleSelected(item.id)}
                                        className="mt-0.5 accent-blue-600"
                                      />
                                      <span className="text-[12px] text-gray-700 leading-snug">{item.title?.trim() || 'Untitled comment'}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-gray-100">
                          <button
                            onClick={toggleAllSelected}
                            className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                          >
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

                    {/* Auto-notify — set-and-forget reminders for waiting comments. */}
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Auto-notify</span>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoEnabled}
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
                              <Clock size={12} className="text-gray-400" />
                              Remind
                            </span>
                            <div className="flex items-center gap-1">
                              <select
                                value={cfg.everyDays ?? 1}
                                onChange={(e) => setAutoNotify({ everyDays: Number(e.target.value), tz: browserTz() })}
                                className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-700 outline-none focus:ring-1 focus:ring-blue-300 focus:border-transparent cursor-pointer"
                              >
                                {AUTO_CADENCE_OPTIONS.map(o => (
                                  <option key={o.days} value={o.days}>{o.label}</option>
                                ))}
                              </select>
                              <span className="text-[11px] text-gray-400">at</span>
                              <input
                                type="time"
                                step={1800}
                                value={minutesToHHMM(cfg.atMinutes)}
                                onChange={(e) => setAutoNotify({ atMinutes: hhmmToMinutes(e.target.value), tz: browserTz() })}
                                className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-700 outline-none focus:ring-1 focus:ring-blue-300 focus:border-transparent cursor-pointer"
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
                                    key={role}
                                    type="button"
                                    aria-pressed={on}
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
                              Set an email for each role above (the <Users size={10} className="inline -mt-0.5" /> button) so reminders can reach them.
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
                <Users size={15} />
              </button>
              <button
                onClick={() => setCollapsed('review')}
                title="Collapse the review"
                className="hidden lg:flex p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {showConfig && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3.5 space-y-3">
              <p className="text-[11px] text-gray-400">
                Choose the Author and Reviewer from the people in this workspace. Emails are managed in Admin — a person with no email can be chosen but can’t be notified until one is set.
              </p>
              {[
                { role: 'reviewer', person: safeReviewer, onChange: onReviewerChange, hasEmail: reviewerHasEmail, dot: ROLE_META.reviewer },
                { role: 'author', person: safeAuthor, onChange: onAuthorChange, hasEmail: authorHasEmail, dot: ROLE_META.author },
              ].map(({ role, person, onChange, hasEmail, dot }) => (
                <div key={role} className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className={`flex items-center gap-1.5 text-[11px] font-semibold w-20 shrink-0 ${dot.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${dot.dot}`} />
                    {dot.label}
                  </span>
                  <PersonSearchSelect
                    people={people}
                    value={person.userId || ''}
                    onSelect={(picked) => onChange?.({ userId: picked.id, name: picked.name }, true)}
                  />
                  {person.userId && !hasEmail && (
                    <span className="text-[11px] text-amber-600">⚠ email is not set up</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {threads.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={toggleAllThreads}
                className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-emerald-600 transition-colors"
              >
                {allExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}

          {threads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
              <MessageCircle size={22} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No review points yet</p>
              <p className="text-xs text-gray-300 mt-1">Add a point or question, then answer it below it.</p>
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
                    collapsed={!expanded.has(thread.id)}
                    onToggleCollapsed={() => toggleThread(thread.id)}
                    onChange={(next, persist) => updateThread(thread.id, next, persist)}
                    onRemove={() => removeThread(thread.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
