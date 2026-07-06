'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CircleDot, CheckCircle2, X, Plus, ArrowLeft, Trash2, MessageSquare,
  Search, ChevronDown, ChevronRight, ChevronUp, Check, ShieldCheck, Loader2,
  RotateCcw, MessageSquarePlus, Tag, Wrench,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import RichTextArea from '@/components/RichTextArea';
import {
  EMPTY_ISSUE_BODY,
  ISSUE_COMPLEXITIES,
  ISSUE_LABELS,
  ISSUE_PRIORITIES,
  ISSUE_SORTS,
  blocksToHtml,
  countOpenIssues,
  createIssueRecord,
  deleteIssueById,
  deleteIssueCommentById,
  fetchIssues,
  filterIssues,
  findIssueSortSwap,
  getVisibleIssues,
  isBodyEmpty,
  labelDef,
  mutateIssue,
  timeAgo,
} from '@/lib/issues';

/**
 * IssuesWidget — an in-app issue tracker modeled on GitHub Issues.
 *
 * Rendered once in the dashboard layout. Opened by the floating "Feedback" button
 * this component pins to the bottom-right corner of every page, or by dispatching
 * an `open-issues` window event (the command-palette pattern). Opens as a wide
 * centered panel: a searchable Open/Closed list with label filters and sorting,
 * and a detail view with a comment timeline.
 *
 * Permissions mirror the API (src/app/api/issues/route.js): every user can open an
 * issue, comment, and edit labels — but non-admins are served ONLY the tickets
 * they authored (open + previously closed), so for them this reads as a personal
 * "my tickets" panel rather than a team board (the list chrome — label filter,
 * sort — is hidden too). Only an admin (the CIO login) sees everyone's issues
 * and Close / Reopen / Delete.
 */

// Read-only render of stored rich-text (issue body / comment). The scoped styles
// in the component cover images, tables and lists so content looks the same as in
// the editor without mounting an editable RichTextArea.
function RichDisplay({ value }) {
  const html = blocksToHtml(value);
  if (!html) return <p className="text-[13px] text-gray-400 italic">No description provided.</p>;
  return <div className="issue-rt text-[13.5px] text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Avatar({ name, size = 'w-6 h-6 text-[10px]' }) {
  const initials = (name || '?').trim().slice(0, 2).toUpperCase();
  return (
    <span className={`${size} rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0`}>
      {initials}
    </span>
  );
}

function LabelChip({ name }) {
  const def = labelDef(name);
  return (
    <span className={`inline-flex items-center px-2 py-[1px] rounded-full text-[11px] font-semibold ring-1 ring-inset ${def.chip}`}>
      {name}
    </span>
  );
}

// One triage pill + its dropdown (Priority / Complexity share the exact same
// chrome — a ghost pill until a value is set, then the def's colored chip).
// Caller owns the menu state so only one dropdown is ever open panel-wide.
function TriageControl({ defs, placeholder, title, value, menuKey, menu, setMenu, onSelect }) {
  const def = defs.find(p => p.value === value);
  return (
    <div className="relative">
      <button
        onClick={() => setMenu(m => (m === menuKey ? null : menuKey))}
        title={title}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset transition-colors ${
          def ? def.chip : 'bg-white text-gray-400 ring-gray-300 hover:text-gray-600'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${def ? def.dot : 'bg-gray-300'}`} />
        {/* Once a value is set the chip alone ("High" / "Hard") doesn't say
            which triage axis it is — a tiny muted prefix disambiguates. */}
        {def && <span className="text-[8.5px] font-bold uppercase tracking-wider opacity-60">{title}</span>}
        {def ? def.label : placeholder}
        <ChevronDown size={11} />
      </button>
      <Menu open={menu === menuKey} onClose={() => setMenu(null)} title={title} align="left" width="w-44">
        {defs.map(p => (
          <button
            key={p.value}
            onClick={() => onSelect(p.value)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-50"
          >
            <span className="w-3.5 shrink-0">{value === p.value && <Check size={13} className="text-emerald-600" />}</span>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.dot}`} />
            {p.label}
          </button>
        ))}
        <button
          onClick={() => onSelect(null)}
          className="w-full px-3 py-1.5 mt-1 border-t border-gray-100 text-left text-[12px] font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-50"
        >
          Clear {title.toLowerCase()}
        </button>
      </Menu>
    </div>
  );
}

// The big state badge on the detail view — GitHub's solid "Open"/"Closed" pill.
function StateBadge({ status }) {
  const closed = status === 'resolved';
  return (
    <span className={`inline-flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full text-[13px] font-semibold text-white shrink-0 ${
      closed ? 'bg-purple-600' : 'bg-emerald-600'
    }`}>
      {closed ? <CheckCircle2 size={15} /> : <CircleDot size={15} />}
      {closed ? 'Closed' : 'Open'}
    </span>
  );
}

// Shared dropdown chrome for the Labels / Sort / sidebar-label menus. Caller owns
// open state; a transparent fixed overlay behind the menu handles click-outside.
function Menu({ open, onClose, align = 'right', width = 'w-56', title, children }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[10]" onClick={onClose} />
      <div className={`absolute top-full mt-1.5 ${align === 'right' ? 'right-0' : 'left-0'} ${width} z-[11] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden`}>
        {title && (
          <div className="px-3 py-2 text-[11.5px] font-bold text-gray-700 border-b border-gray-100 flex items-center justify-between">
            {title}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
          </div>
        )}
        <div className="max-h-72 overflow-y-auto py-1">{children}</div>
      </div>
    </>
  );
}

export default function IssuesWidget() {
  const { authenticated, isAdmin } = useAuth();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list');      // 'list' | 'new' | 'detail'
  const [tab, setTab] = useState('open');        // 'open' | 'closed'
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // List controls
  const [query, setQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState([]);   // label names
  const [sort, setSort] = useState('newest');
  const [menu, setMenu] = useState(null);               // 'labels' | 'sort' | 'edit-labels' | null

  // New-issue composer
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState(EMPTY_ISSUE_BODY);
  const [newLabels, setNewLabels] = useState([]);
  const [creating, setCreating] = useState(false);

  // Comment composer (in detail view)
  const [commentDraft, setCommentDraft] = useState(EMPTY_ISSUE_BODY);
  const [composerNonce, setComposerNonce] = useState(0);
  const [posting, setPosting] = useState(false);

  // Per-action busy / confirm state
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Admin triage (Dev tab): inline note editing in list rows, and the notes
  // box in the detail sidebar.
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [detailNotes, setDetailNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setIssues(await fetchIssues());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Open via the global event the navbar button dispatches.
  useEffect(() => {
    const onOpen = () => { setOpen(true); setView('list'); };
    window.addEventListener('open-issues', onOpen);
    return () => window.removeEventListener('open-issues', onOpen);
  }, []);

  // Refresh the list whenever the panel opens.
  useEffect(() => { if (open) load(); }, [open, load]);

  // Load once on mount too, so the FAB's open-count badge is right before the
  // panel is ever opened.
  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);

  // Escape steps back one layer at a time: open dropdown → back to the list
  // (from detail / new issue) → close the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(null);
      else if (view !== 'list') { setView('list'); setSelectedId(null); }
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, menu, view]);

  const selected = useMemo(() => issues.find(i => i.id === selectedId) || null, [issues, selectedId]);
  const totalOpen = useMemo(() => countOpenIssues(issues), [issues]);

  // Keep the detail-sidebar notes box in sync with the selected issue (but don't
  // clobber while the admin is typing — only reset when the selection changes).
  useEffect(() => {
    setDetailNotes(issues.find(i => i.id === selectedId)?.dev_notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // The Dev tab is admin-only; fall back to Open if role changes mid-session.
  const effTab = tab === 'dev' && !isAdmin ? 'open' : tab;

  // Search + label filter run before the Open/Closed split, so the tab counts
  // reflect the current filters (as on GitHub).
  const filtered = useMemo(
    () => filterIssues(issues, { query, labelFilter }),
    [issues, query, labelFilter],
  );

  const openCount = useMemo(() => countOpenIssues(filtered), [filtered]);
  const closedCount = filtered.length - openCount;

  const visible = useMemo(
    () => getVisibleIssues(filtered, { tab: effTab, sort }),
    [filtered, effTab, sort],
  );

  const resetComposers = () => {
    setNewTitle('');
    setNewBody(EMPTY_ISSUE_BODY);
    setNewLabels([]);
    setCommentDraft(EMPTY_ISSUE_BODY);
    setComposerNonce(n => n + 1);
    setConfirmDelete(false);
    setMenu(null);
  };

  const goList = () => { setView('list'); setSelectedId(null); resetComposers(); };
  const openDetail = (id) => { setSelectedId(id); setView('detail'); resetComposers(); };

  // Shared PUT helper — sends an action, folds the updated row back into state.
  const mutate = async (payload) => {
    const updated = await mutateIssue(payload);
    setIssues(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    return updated;
  };

  const createIssue = async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const created = await createIssueRecord({ title: newTitle.trim(), body: newBody, labels: newLabels });
      setIssues(prev => [created, ...prev]);
      setTab('open');
      openDetail(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const postComment = async () => {
    if (isBodyEmpty(commentDraft) || posting || !selected) return;
    setPosting(true);
    setError('');
    try {
      await mutate({ id: selected.id, action: 'comment', body: commentDraft });
      setCommentDraft(EMPTY_ISSUE_BODY);
      setComposerNonce(n => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  // Close / reopen. If there's a pending comment when closing, post it first —
  // GitHub's "Close with comment".
  const setStatus = async (action) => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!isBodyEmpty(commentDraft)) {
        await mutate({ id: selected.id, action: 'comment', body: commentDraft });
        setCommentDraft(EMPTY_ISSUE_BODY);
        setComposerNonce(n => n + 1);
      }
      await mutate({ id: selected.id, action });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Manual ordering in the Dev tab — same pattern as Strategic Hub's Position
  // Overview: the chevrons swap a row with its nearest neighbor of the SAME
  // priority band and persist both rows' sort_order (admin-only on the API).
  const rowRefs = useRef({});
  const moveIssue = async (issue, direction) => {
    const swap = findIssueSortSwap(visible, issue, direction);
    if (!swap) return;
    const { other, issueSortOrder, otherSortOrder } = swap;

    // Animate the swap (same feel as Strategic Hub)
    const curEl = rowRefs.current[issue.id];
    const otherEl = rowRefs.current[other.id];
    if (curEl && otherEl) {
      const dy = otherEl.getBoundingClientRect().top - curEl.getBoundingClientRect().top;
      curEl.style.transition = 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)';
      otherEl.style.transition = 'transform 320ms ease-out';
      curEl.style.transform = `translateY(${dy * 0.6}px) scale(1.02)`;
      otherEl.style.transform = `translateY(${-dy}px)`;
      curEl.style.zIndex = '5';
      curEl.style.position = 'relative';
      curEl.style.boxShadow = '0 6px 16px -8px rgba(16,185,129,0.4)';
      await new Promise(r => setTimeout(r, 200));
    }

    setIssues(prev => prev.map(i => (
      i.id === issue.id ? { ...i, sort_order: issueSortOrder }
        : i.id === other.id ? { ...i, sort_order: otherSortOrder }
          : i
    )));

    // Reset styles next tick after re-render
    requestAnimationFrame(() => {
      if (curEl) {
        curEl.style.transition = '';
        curEl.style.transform = '';
        curEl.style.zIndex = '';
        curEl.style.position = '';
        curEl.style.boxShadow = '';
      }
      if (otherEl) {
        otherEl.style.transition = '';
        otherEl.style.transform = '';
      }
    });

    setError('');
    try {
      await Promise.all([
        mutate({ id: issue.id, action: 'sort-order', sort_order: issueSortOrder }),
        mutate({ id: other.id, action: 'sort-order', sort_order: otherSortOrder }),
      ]);
    } catch (e) {
      setError(e.message);
    }
  };

  const setPriority = async (issue, priority) => {
    setMenu(null);
    setError('');
    try {
      await mutate({ id: issue.id, action: 'priority', priority });
    } catch (e) {
      setError(e.message);
    }
  };

  const setComplexity = async (issue, complexity) => {
    setMenu(null);
    setError('');
    try {
      await mutate({ id: issue.id, action: 'complexity', complexity });
    } catch (e) {
      setError(e.message);
    }
  };

  const saveNote = async (issue, text) => {
    setEditingNoteId(null);
    if ((issue.dev_notes || '') === text) return;
    setError('');
    try {
      await mutate({ id: issue.id, action: 'dev-notes', notes: text });
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleIssueLabel = async (name) => {
    if (!selected) return;
    const current = selected.labels || [];
    const next = current.includes(name) ? current.filter(l => l !== name) : [...current, name];
    setError('');
    try {
      await mutate({ id: selected.id, action: 'labels', labels: next });
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteIssue = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteIssueById(selected.id);
      setIssues(prev => prev.filter(i => i.id !== selected.id));
      goList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteComment = async (commentId) => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await deleteIssueCommentById(selected.id, commentId);
      setIssues(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Only render for signed-in sessions (the widget lives inside the auth-gated
  // dashboard, but guard anyway so it never flashes on the login screen).
  if (!authenticated) return null;

  const commentCards = selected ? [
    { id: '__op__', author: selected.author, createdAt: selected.created_at, body: selected.body, isOp: true },
    ...(selected.comments || []).map(c => ({ ...c, isOp: false })),
  ] : [];

  return (
    <>
      <style jsx global>{`
        .issue-rt img { max-width: 100%; height: auto; border-radius: 6px; vertical-align: middle; }
        .issue-rt table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; table-layout: fixed; }
        .issue-rt td, .issue-rt th { border: 1px solid #e5e7eb; padding: 5px 8px; text-align: left; vertical-align: top; word-break: break-word; }
        .issue-rt th, .issue-rt tr:first-child td { background: #f9fafb; font-weight: 600; color: #374151; }
        .issue-rt ul { list-style: disc; margin: 6px 0; padding-left: 22px; }
        .issue-rt ol { list-style: decimal; margin: 6px 0; padding-left: 22px; }
        .issue-rt li { margin: 2px 0; }
      `}</style>

      {/* Floating feedback button — pinned bottom-right on every page so there is
          always one obvious place to report a bug or leave feedback. z-40 keeps it
          under toasts (z-50) and the panel backdrop. */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setView('list'); }}
          aria-label="Open feedback"
          title="Report a bug or share feedback"
          className="fixed bottom-6 right-6 z-40 group flex items-center gap-2.5 pl-4 pr-5 py-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 hover:shadow-xl hover:shadow-emerald-600/40 hover:-translate-y-0.5 transition-all duration-200"
        >
          <MessageSquarePlus size={20} className="shrink-0" />
          <span className="text-[15px] font-bold leading-none">Feedback</span>
          <span className="hidden sm:block text-[11px] font-medium text-emerald-100/90 leading-none -ml-0.5 pl-2.5 border-l border-emerald-400/50">
            Spotted a bug? Tell us
          </span>
          {totalOpen > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full bg-white text-emerald-700 text-[11px] font-bold shadow ring-2 ring-emerald-600 tabular-nums">
              {totalOpen}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[10002]">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* Panel — wide and centered, GitHub-issues proportions */}
          <div className="absolute inset-0 sm:inset-4 lg:inset-y-6 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[min(1080px,calc(100vw-48px))] flex flex-col bg-white sm:rounded-2xl shadow-2xl overflow-hidden">

            {/* Panel header */}
            <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-gray-200 shrink-0 bg-gray-50/70">
              <div className="flex items-center gap-2.5 min-w-0">
                {view !== 'list' ? (
                  <>
                    <button
                      onClick={goList}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-[12.5px] font-semibold text-gray-700 shadow-sm hover:bg-gray-100 hover:border-gray-400 transition-colors shrink-0"
                      title="Back to issues (Esc)"
                    >
                      <ArrowLeft size={14} /> Back to issues
                    </button>
                    <span className="flex items-center gap-1 text-[13px] text-gray-400 min-w-0">
                      <span>Issues</span>
                      <ChevronRight size={13} className="shrink-0" />
                      <span className="font-semibold text-gray-700 truncate">
                        {view === 'new'
                          ? 'New issue'
                          : selected?.number ? `#${selected.number}` : (selected?.title || 'Issue')}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <CircleDot size={16} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-bold text-gray-900 leading-tight">{isAdmin ? 'Issues' : 'Your tickets'}</h2>
                      <p className="text-[11px] text-gray-400">
                        {isAdmin ? 'Report bugs & discuss with the team' : 'Report a bug or request and track its status'}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Close">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-[12px] font-medium shrink-0">
                {error}
              </div>
            )}

            {/* ---- LIST VIEW ---- */}
            {view === 'list' && (
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {/* Search + New issue */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder={isAdmin ? 'Search all issues' : 'Search your tickets'}
                      className="w-full bg-gray-50 border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-[13.5px] text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                    />
                  </div>
                  <button
                    onClick={() => { setView('new'); resetComposers(); }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shrink-0"
                  >
                    <Plus size={15} /> New issue
                  </button>
                </div>

                {/* Issue list */}
                <div className="border border-gray-200 rounded-xl overflow-visible">
                  {/* List header: state tabs + filter dropdowns */}
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200 rounded-t-xl">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setTab('open')}
                        className={`flex items-center gap-1.5 text-[13px] transition-colors ${effTab === 'open' ? 'font-bold text-gray-900' : 'font-medium text-gray-500 hover:text-gray-800'}`}
                      >
                        <CircleDot size={15} className={effTab === 'open' ? 'text-emerald-600' : ''} />
                        Open
                        <span className={`px-1.5 py-px rounded-full text-[11px] tabular-nums ${effTab === 'open' ? 'bg-gray-200 text-gray-700' : 'bg-gray-200/60 text-gray-500'}`}>
                          {openCount}
                        </span>
                      </button>
                      <button
                        onClick={() => setTab('closed')}
                        className={`flex items-center gap-1.5 text-[13px] transition-colors ${effTab === 'closed' ? 'font-bold text-gray-900' : 'font-medium text-gray-500 hover:text-gray-800'}`}
                      >
                        <Check size={15} className={effTab === 'closed' ? 'text-purple-600' : ''} />
                        Closed
                        <span className={`px-1.5 py-px rounded-full text-[11px] tabular-nums ${effTab === 'closed' ? 'bg-gray-200 text-gray-700' : 'bg-gray-200/60 text-gray-500'}`}>
                          {closedCount}
                        </span>
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => setTab('dev')}
                          title="Admin triage: every issue in priority order, with your notes"
                          className={`flex items-center gap-1.5 text-[13px] transition-colors ${effTab === 'dev' ? 'font-bold text-gray-900' : 'font-medium text-gray-500 hover:text-gray-800'}`}
                        >
                          <Wrench size={14} className={effTab === 'dev' ? 'text-amber-600' : ''} />
                          Dev
                          <span className={`px-1.5 py-px rounded-full text-[11px] tabular-nums ${effTab === 'dev' ? 'bg-gray-200 text-gray-700' : 'bg-gray-200/60 text-gray-500'}`}>
                            {openCount}
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Filter/sort chrome is a team-board affordance — a non-admin's
                        personal ticket list is short enough not to need it. */}
                    {isAdmin && (
                    <div className="flex items-center gap-1">
                      <div className="relative">
                        <button
                          onClick={() => setMenu(m => (m === 'labels' ? null : 'labels'))}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${labelFilter.length ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
                        >
                          Labels{labelFilter.length > 0 && <span className="tabular-nums">({labelFilter.length})</span>}
                          <ChevronDown size={13} />
                        </button>
                        <Menu open={menu === 'labels'} onClose={() => setMenu(null)} title="Filter by label">
                          {ISSUE_LABELS.map(l => {
                            const active = labelFilter.includes(l.name);
                            return (
                              <button
                                key={l.name}
                                onClick={() => setLabelFilter(prev => (active ? prev.filter(n => n !== l.name) : [...prev, l.name]))}
                                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-50"
                              >
                                <span className="w-3.5 shrink-0">{active && <Check size={13} className="text-emerald-600" />}</span>
                                <span className={`w-3 h-3 rounded-full shrink-0 ${l.dot}`} />
                                {l.name}
                              </button>
                            );
                          })}
                          {labelFilter.length > 0 && (
                            <button
                              onClick={() => { setLabelFilter([]); setMenu(null); }}
                              className="w-full px-3 py-1.5 mt-1 border-t border-gray-100 text-left text-[12px] font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                            >
                              Clear label filters
                            </button>
                          )}
                        </Menu>
                      </div>

                      {effTab === 'dev' ? (
                        <span className="px-2.5 py-1.5 text-[12.5px] font-semibold text-gray-400">Priority order</span>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => setMenu(m => (m === 'sort' ? null : 'sort'))}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                          >
                            {ISSUE_SORTS.find(s => s.key === sort)?.label || 'Newest'}
                            <ChevronDown size={13} />
                          </button>
                          <Menu open={menu === 'sort'} onClose={() => setMenu(null)} title="Sort by" width="w-48">
                            {ISSUE_SORTS.map(s => (
                              <button
                                key={s.key}
                                onClick={() => { setSort(s.key); setMenu(null); }}
                                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-50"
                              >
                                <span className="w-3.5 shrink-0">{sort === s.key && <Check size={13} className="text-emerald-600" />}</span>
                                {s.label}
                              </button>
                            ))}
                          </Menu>
                        </div>
                      )}
                    </div>
                    )}
                  </div>

                  {/* Rows */}
                  {loading ? (
                    <div className="flex items-center justify-center py-14 text-gray-400">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  ) : visible.length === 0 ? (
                    <div className="py-14 text-center px-6">
                      {effTab === 'closed'
                        ? <CheckCircle2 size={28} className="text-gray-300 mx-auto mb-3" />
                        : effTab === 'dev'
                          ? <Wrench size={28} className="text-gray-300 mx-auto mb-3" />
                          : <CircleDot size={28} className="text-gray-300 mx-auto mb-3" />}
                      <p className="text-[14px] font-bold text-gray-600">
                        {query.trim() || labelFilter.length
                          ? 'No results matched your search.'
                          : effTab === 'closed' ? (isAdmin ? "There aren't any closed issues." : "You don't have any closed tickets.")
                            : effTab === 'dev' ? 'Nothing to triage yet.'
                              : (isAdmin ? "There aren't any open issues." : "You haven't opened any tickets yet.")}
                      </p>
                      <p className="text-[12px] text-gray-400 mt-1">
                        {query.trim() || labelFilter.length
                          ? 'Try clearing the search or label filters.'
                          : effTab === 'closed' ? (isAdmin ? 'Closed issues will appear here.' : 'Tickets the team resolves will appear here.')
                            : effTab === 'dev' ? 'Every open issue shows up here with your priority and notes.'
                              : (isAdmin ? 'Open one with the New issue button.' : 'Report a bug or request with the New issue button.')}
                      </p>
                    </div>
                  ) : (
                    visible.map((issue, idx) => {
                      const closed = issue.status === 'resolved';
                      return (
                        // The row div is mouse-clickable for convenience, but the title is
                        // the real (focusable) control — putting role="button" on the row
                        // would flatten the nested triage controls out of the a11y tree.
                        <div
                          key={issue.id}
                          ref={el => { if (el) rowRefs.current[issue.id] = el; }}
                          onClick={() => openDetail(issue.id)}
                          className={`w-full group text-left flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/80 transition-colors ${idx < visible.length - 1 ? 'border-b border-gray-100' : 'rounded-b-xl'}`}
                        >
                          {/* Dev tab: reorder chevrons — move the issue up/down
                              within its priority band, as in Strategic Hub. */}
                          {effTab === 'dev' && (
                            <div
                              className="flex flex-col -my-1 -ml-1 self-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                              onClick={e => e.stopPropagation()}
                            >
                              <button
                                onClick={() => moveIssue(issue, 'up')}
                                title="Move up within priority"
                                className="p-0.5 text-gray-400 hover:text-gray-700"
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                onClick={() => moveIssue(issue, 'down')}
                                title="Move down within priority"
                                className="p-0.5 text-gray-400 hover:text-gray-700"
                              >
                                <ChevronDown size={12} />
                              </button>
                            </div>
                          )}
                          {closed
                            ? <CheckCircle2 size={16} className="text-purple-600 mt-0.5 shrink-0" />
                            : <CircleDot size={16} className="text-emerald-600 mt-0.5 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <button
                                onClick={e => { e.stopPropagation(); openDetail(issue.id); }}
                                className="text-[14px] font-semibold text-gray-900 group-hover:text-emerald-700 leading-snug transition-colors text-left"
                              >
                                {issue.title}
                              </button>
                              {(issue.labels || []).map(name => <LabelChip key={name} name={name} />)}
                            </div>
                            <p className="text-[12px] text-gray-500 mt-1">
                              {issue.number ? `#${issue.number} · ` : ''}
                              {closed
                                ? <>{issue.author || 'Unknown'} · closed {timeAgo(issue.resolved_at || issue.updated_at)}</>
                                : <>{issue.author || 'Unknown'} opened {timeAgo(issue.created_at)}</>}
                            </p>
                          </div>
                          {(issue.comments || []).length > 0 && (
                            <span className="flex items-center gap-1 text-[12px] text-gray-500 font-medium shrink-0 mt-0.5">
                              <MessageSquare size={13} />{issue.comments.length}
                            </span>
                          )}

                          {/* Dev tab: admin triage rail — priority + complexity + quick-glance
                              note. stopPropagation so triaging never opens the issue. */}
                          {effTab === 'dev' && (
                            <div
                              className="w-60 shrink-0 flex flex-col items-start gap-1.5 pl-3 border-l border-gray-100"
                              onClick={e => e.stopPropagation()}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <TriageControl
                                  defs={ISSUE_PRIORITIES}
                                  placeholder="Set priority"
                                  title="Priority"
                                  value={issue.priority}
                                  menuKey={`prio-${issue.id}`}
                                  menu={menu}
                                  setMenu={setMenu}
                                  onSelect={v => setPriority(issue, v)}
                                />
                                <TriageControl
                                  defs={ISSUE_COMPLEXITIES}
                                  placeholder="Set complexity"
                                  title="Complexity"
                                  value={issue.complexity}
                                  menuKey={`cplx-${issue.id}`}
                                  menu={menu}
                                  setMenu={setMenu}
                                  onSelect={v => setComplexity(issue, v)}
                                />
                              </div>
                              {editingNoteId === issue.id ? (
                                <textarea
                                  value={noteDraft}
                                  onChange={e => setNoteDraft(e.target.value)}
                                  onBlur={() => saveNote(issue, noteDraft)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
                                    if (e.key === 'Escape') { e.stopPropagation(); setEditingNoteId(null); }
                                  }}
                                  autoFocus
                                  rows={2}
                                  placeholder="Quick note…"
                                  className="w-full text-[11.5px] text-gray-700 border border-emerald-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                                />
                              ) : (
                                <button
                                  onClick={() => { setEditingNoteId(issue.id); setNoteDraft(issue.dev_notes || ''); }}
                                  className="w-full text-left"
                                  title="Edit note"
                                >
                                  {issue.dev_notes ? (
                                    <span className="block text-[11.5px] text-gray-600 leading-snug line-clamp-2 hover:text-gray-900">
                                      {issue.dev_notes}
                                    </span>
                                  ) : (
                                    <span className="text-[11.5px] text-gray-300 italic hover:text-gray-500">Add a note…</span>
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ---- NEW ISSUE VIEW ---- */}
            {view === 'new' && (
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <h3 className="text-[17px] font-bold text-gray-900 mb-4">Create new issue</h3>
                <div className="flex flex-col lg:flex-row gap-6">
                  <div className="flex-1 min-w-0">
                    <label className="block text-[13px] font-bold text-gray-800 mb-1.5">Add a title</label>
                    <input
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                      placeholder="Title"
                      autoFocus
                      className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3.5 py-2 text-[14px] text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all mb-4"
                    />
                    <label className="block text-[13px] font-bold text-gray-800 mb-1.5">Add a description</label>
                    <RichTextArea
                      key={`new-${composerNonce}`}
                      value={newBody}
                      onChange={setNewBody}
                      ticker="ISSUES"
                      placeholder="Describe the bug or request. Paste screenshots directly…"
                      rows={8}
                      enableTables
                    />
                    {/* preventDefault on mousedown keeps the editor focused while the
                        click lands — otherwise blur hides the RichTextArea toolbar and
                        the buttons shift up mid-click, swallowing the first click. */}
                    <div className="flex justify-end items-center gap-2 mt-4" onMouseDown={(e) => e.preventDefault()}>
                      <button onClick={goList} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg text-gray-500 hover:text-gray-700 transition-colors">
                        Cancel
                      </button>
                      <button
                        onClick={createIssue}
                        disabled={!newTitle.trim() || creating}
                        className="flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {creating && <Loader2 size={14} className="animate-spin" />}
                        Create
                      </button>
                    </div>
                  </div>

                  {/* Labels rail */}
                  <div className="w-full lg:w-60 shrink-0">
                    <p className="flex items-center gap-1.5 text-[12px] font-bold text-gray-500 uppercase tracking-wide pb-2 border-b border-gray-200 mb-2">
                      <Tag size={12} /> Labels
                    </p>
                    <div className="space-y-0.5">
                      {ISSUE_LABELS.map(l => {
                        const active = newLabels.includes(l.name);
                        return (
                          <button
                            key={l.name}
                            onClick={() => setNewLabels(prev => (active ? prev.filter(n => n !== l.name) : [...prev, l.name]))}
                            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-[12.5px] transition-colors ${active ? 'bg-emerald-50 text-gray-900 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            <span className={`w-3 h-3 rounded-full shrink-0 ${l.dot}`} />
                            <span className="flex-1">{l.name}</span>
                            {active && <Check size={13} className="text-emerald-600" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---- DETAIL VIEW ---- */}
            {view === 'detail' && selected && (
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {/* Title + meta */}
                <h3 className="text-[20px] font-bold text-gray-900 leading-snug">
                  {selected.title}{' '}
                  {selected.number && <span className="font-normal text-gray-400">#{selected.number}</span>}
                </h3>
                <div className="flex flex-wrap items-center gap-2.5 mt-2.5 pb-4 border-b border-gray-200">
                  <StateBadge status={selected.status} />
                  <p className="text-[12.5px] text-gray-500">
                    <span className="font-semibold text-gray-700">{selected.author || 'Unknown'}</span>
                    {' '}opened this issue {timeAgo(selected.created_at)}
                    {' '}· {(selected.comments || []).length} {(selected.comments || []).length === 1 ? 'comment' : 'comments'}
                  </p>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 mt-4">
                  {/* Thread */}
                  <div className="flex-1 min-w-0">
                    <div className="relative">
                      {/* Timeline spine behind the cards */}
                      <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-200" />
                      <div className="relative space-y-3">
                        {commentCards.map(c => (
                          <div key={c.id} className="border border-gray-200 rounded-xl bg-white overflow-hidden">
                            <div className="flex items-center gap-2 px-3.5 py-2 bg-gray-50 border-b border-gray-200">
                              <Avatar name={c.author} />
                              <span className="text-[12.5px] text-gray-500 min-w-0 truncate">
                                <span className="font-semibold text-gray-800">{c.author || 'Unknown'}</span>
                                {' '}{c.isOp ? 'opened' : 'commented'} {timeAgo(c.createdAt)}
                              </span>
                              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                                {c.author && c.author === selected.author && (
                                  <span className="text-[10.5px] font-semibold text-gray-500 border border-gray-300 rounded-full px-2 py-px">
                                    Author
                                  </span>
                                )}
                                {isAdmin && !c.isOp && (
                                  <button
                                    onClick={() => deleteComment(c.id)}
                                    disabled={busy}
                                    className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                    title="Delete comment"
                                  >
                                    <Trash2 size={12.5} />
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className="px-3.5 py-3">
                              <RichDisplay value={c.body} />
                            </div>
                          </div>
                        ))}

                        {/* Closed event */}
                        {selected.status === 'resolved' && (
                          <div className="flex items-center gap-2.5 pl-1.5 py-1">
                            <span className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0">
                              <CheckCircle2 size={14} />
                            </span>
                            <p className="text-[12.5px] text-gray-500">
                              <span className="font-semibold text-gray-700">{selected.resolved_by || 'An admin'}</span>
                              {' '}closed this {timeAgo(selected.resolved_at)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Add a comment */}
                    <h4 className="text-[15px] font-bold text-gray-900 mt-6 mb-2.5">Add a comment</h4>
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="p-2">
                        <RichTextArea
                          key={`comment-${composerNonce}`}
                          value={commentDraft}
                          onChange={setCommentDraft}
                          ticker="ISSUES"
                          placeholder="Use the toolbar to format your comment…"
                          rows={4}
                          enableTables
                        />
                      </div>
                      {/* Same mousedown guard as the new-issue buttons: keep the editor
                          focused so its toolbar doesn't collapse and shift these buttons
                          mid-click. */}
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-gray-100 bg-gray-50/70" onMouseDown={(e) => e.preventDefault()}>
                        {isAdmin ? (
                          <span className="text-[11.5px] text-gray-400">Paste screenshots directly into the editor</span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-[11.5px] text-gray-400">
                            <ShieldCheck size={12} /> Only an admin can close issues
                          </span>
                        )}
                        <div className="flex items-center gap-2 ml-auto">
                          {isAdmin && (
                            selected.status === 'resolved' ? (
                              <button
                                onClick={() => setStatus('reopen')}
                                disabled={busy}
                                className="flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                              >
                                <RotateCcw size={13} /> Reopen issue
                              </button>
                            ) : (
                              <button
                                onClick={() => setStatus('resolve')}
                                disabled={busy}
                                className="flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-purple-700 bg-white hover:bg-purple-50 disabled:opacity-50 transition-colors"
                              >
                                <CheckCircle2 size={13} />
                                {isBodyEmpty(commentDraft) ? 'Close issue' : 'Close with comment'}
                              </button>
                            )
                          )}
                          <button
                            onClick={postComment}
                            disabled={isBodyEmpty(commentDraft) || posting}
                            className="flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {posting && <Loader2 size={13} className="animate-spin" />}
                            Comment
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar */}
                  <div className="w-full lg:w-60 shrink-0">
                    <div className="relative">
                      <button
                        onClick={() => setMenu(m => (m === 'edit-labels' ? null : 'edit-labels'))}
                        className="w-full flex items-center justify-between text-[12px] font-bold text-gray-500 uppercase tracking-wide pb-2 border-b border-gray-200 hover:text-gray-800 transition-colors"
                        title="Edit labels"
                      >
                        <span className="flex items-center gap-1.5"><Tag size={12} /> Labels</span>
                        <ChevronDown size={13} />
                      </button>
                      <Menu open={menu === 'edit-labels'} onClose={() => setMenu(null)} title="Apply labels" align="left" width="w-full">
                        {ISSUE_LABELS.map(l => {
                          const active = (selected.labels || []).includes(l.name);
                          return (
                            <button
                              key={l.name}
                              onClick={() => toggleIssueLabel(l.name)}
                              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-50"
                            >
                              <span className="w-3.5 shrink-0">{active && <Check size={13} className="text-emerald-600" />}</span>
                              <span className={`w-3 h-3 rounded-full shrink-0 ${l.dot}`} />
                              {l.name}
                            </button>
                          );
                        })}
                      </Menu>
                      <div className="flex flex-wrap gap-1.5 py-2.5">
                        {(selected.labels || []).length === 0
                          ? <span className="text-[12px] text-gray-400">None yet</span>
                          : (selected.labels || []).map(name => <LabelChip key={name} name={name} />)}
                      </div>
                    </div>

                    {/* Triage lives in the Dev tab only — an issue opened from the
                        Open/Closed tabs reads like a plain GitHub issue. `tab` is
                        unchanged while a detail view is open, so it records where
                        the issue was opened from. */}
                    {isAdmin && effTab === 'dev' && (
                      <div className="mt-4 pt-3 border-t border-gray-200">
                        <p className="flex items-center gap-1.5 text-[12px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                          <Wrench size={12} /> Dev triage
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <TriageControl
                            defs={ISSUE_PRIORITIES}
                            placeholder="Set priority"
                            title="Priority"
                            value={selected.priority}
                            menuKey="detail-prio"
                            menu={menu}
                            setMenu={setMenu}
                            onSelect={v => setPriority(selected, v)}
                          />
                          <TriageControl
                            defs={ISSUE_COMPLEXITIES}
                            placeholder="Set complexity"
                            title="Complexity"
                            value={selected.complexity}
                            menuKey="detail-cplx"
                            menu={menu}
                            setMenu={setMenu}
                            onSelect={v => setComplexity(selected, v)}
                          />
                        </div>
                        <textarea
                          value={detailNotes}
                          onChange={e => setDetailNotes(e.target.value)}
                          onBlur={() => saveNote(selected, detailNotes)}
                          rows={3}
                          placeholder="Quick note on this issue (only admins see this)…"
                          className="w-full text-[12px] text-gray-700 border border-gray-200 rounded-lg px-2.5 py-2 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none transition-all"
                        />
                      </div>
                    )}

                    {isAdmin && (
                      <div className="mt-4 pt-3 border-t border-gray-200">
                        {confirmDelete ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={deleteIssue} disabled={busy} className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors">
                              <Check size={13} /> Confirm delete
                            </button>
                            <button onClick={() => setConfirmDelete(false)} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-[12px] font-semibold text-red-600 hover:text-red-700 transition-colors">
                            <Trash2 size={13} /> Delete issue
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
