'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CircleDot, CheckCircle2, X, Plus, ArrowLeft, Trash2, MessageSquare,
  Archive, Send, ShieldCheck, Loader2, RotateCcw, Check, MessageSquarePlus,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import RichTextArea from '@/components/RichTextArea';

/**
 * IssuesWidget — an in-app issue tracker (a small GitHub-issues clone).
 *
 * Rendered once in the dashboard layout. Opened by the floating "Feedback" button
 * this component pins to the bottom-right corner of every page, or by dispatching
 * an `open-issues` window event (the command-palette pattern). Slides in as a
 * right-hand drawer with an Open tab and an Archived (resolved) tab.
 *
 * Permissions mirror the API (src/app/api/issues/route.js): every user can open an
 * issue and comment; only an admin (the CIO login) sees Resolve / Reopen / Delete.
 */

const EMPTY_BODY = [{ type: 'text', value: '' }];

// Merge stored RichTextArea blocks into display HTML (same shape RichTextArea emits:
// text blocks concatenated with <br>, legacy image blocks folded in as <img>).
function blocksToHtml(value) {
  const blocks = Array.isArray(value) ? value : [{ type: 'text', value: value || '' }];
  return blocks
    .map(b => (b?.type === 'image'
      ? `<img src="${String(b.url || '').replace(/"/g, '&quot;')}" class="rt-inline-img" />`
      : (b?.value || '')))
    .filter(frag => frag && frag.trim())
    .join('<br>');
}

function isBodyEmpty(value) {
  if (Array.isArray(value)) {
    return !value.some(block => block?.type === 'image'
      || (block?.value && block.value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()));
  }
  return !(typeof value === 'string' && value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

// Read-only render of stored rich-text (issue body / comment). The scoped styles
// below cover images, tables and lists so content looks the same as in the editor
// without mounting an editable RichTextArea.
function RichDisplay({ value }) {
  const html = blocksToHtml(value);
  if (!html) return <p className="text-[13px] text-gray-400 italic">No description.</p>;
  return <div className="issue-rt text-[13px] text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
}

function StatusPill({ status }) {
  const resolved = status === 'resolved';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
      resolved ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'
    }`}>
      {resolved ? <CheckCircle2 size={11} /> : <CircleDot size={11} />}
      {resolved ? 'Resolved' : 'Open'}
    </span>
  );
}

export default function IssuesWidget() {
  const { authenticated, isAdmin } = useAuth();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list');      // 'list' | 'new' | 'detail'
  const [tab, setTab] = useState('open');          // 'open' | 'resolved'
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // New-issue composer
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState(EMPTY_BODY);
  const [creating, setCreating] = useState(false);

  // Comment composer (in detail view)
  const [commentDraft, setCommentDraft] = useState(EMPTY_BODY);
  const [composerNonce, setComposerNonce] = useState(0);
  const [posting, setPosting] = useState(false);

  // Per-action busy / confirm state
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/issues');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load issues');
      setIssues(await res.json());
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

  // Refresh the list whenever the drawer opens.
  useEffect(() => { if (open) load(); }, [open, load]);

  // Load once on mount too, so the FAB's open-count badge is right before the
  // drawer is ever opened.
  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const selected = useMemo(() => issues.find(i => i.id === selectedId) || null, [issues, selectedId]);
  const openCount = useMemo(() => issues.filter(i => i.status !== 'resolved').length, [issues]);
  const resolvedCount = issues.length - openCount;
  const visible = useMemo(
    () => issues.filter(i => (tab === 'resolved' ? i.status === 'resolved' : i.status !== 'resolved')),
    [issues, tab],
  );

  const resetComposers = () => {
    setNewTitle('');
    setNewBody(EMPTY_BODY);
    setCommentDraft(EMPTY_BODY);
    setComposerNonce(n => n + 1);
    setConfirmDelete(false);
  };

  const goList = () => { setView('list'); setSelectedId(null); resetComposers(); };
  const openDetail = (id) => { setSelectedId(id); setView('detail'); resetComposers(); };

  const createIssue = async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), body: newBody }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create issue');
      const created = await res.json();
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
      const res = await fetch('/api/issues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, action: 'comment', body: commentDraft }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to post comment');
      const updated = await res.json();
      setIssues(prev => prev.map(i => (i.id === updated.id ? updated : i)));
      setCommentDraft(EMPTY_BODY);
      setComposerNonce(n => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const setStatus = async (action) => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/issues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Action failed');
      const updated = await res.json();
      setIssues(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteIssue = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/issues?id=${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete');
      setIssues(prev => prev.filter(i => i.id !== selected.id));
      goList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Only render for signed-in sessions (the widget lives inside the auth-gated
  // dashboard, but guard anyway so it never flashes on the login screen).
  if (!authenticated) return null;

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
          under toasts (z-50) and the drawer backdrop. */}
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
          {openCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full bg-white text-emerald-700 text-[11px] font-bold shadow ring-2 ring-emerald-600 tabular-nums">
              {openCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[10002]">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />

          {/* Drawer */}
          <div
            className="absolute top-0 right-0 h-full w-full max-w-md flex flex-col animate-slide-in-right shadow-2xl"
            style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,1) 100%)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                {view !== 'list' ? (
                  <button onClick={goList} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Back">
                    <ArrowLeft size={17} />
                  </button>
                ) : (
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <CircleDot size={16} />
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold text-gray-900 leading-tight truncate">
                    {view === 'new' ? 'New issue' : view === 'detail' ? 'Issue' : 'Issues'}
                  </h2>
                  {view === 'list' && (
                    <p className="text-[11px] text-gray-400">Report bugs & discuss with the team</p>
                  )}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" title="Close">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-[12px] font-medium">
                {error}
              </div>
            )}

            {/* ---- LIST VIEW ---- */}
            {view === 'list' && (
              <>
                <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
                  <button
                    onClick={() => setTab('open')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${tab === 'open' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <CircleDot size={13} /> Open <span className="tabular-nums opacity-70">{openCount}</span>
                  </button>
                  <button
                    onClick={() => setTab('resolved')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${tab === 'resolved' ? 'bg-purple-50 text-purple-700' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <Archive size={13} /> Archived <span className="tabular-nums opacity-70">{resolvedCount}</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {loading ? (
                    <div className="flex items-center justify-center py-10 text-gray-400">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  ) : visible.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center mt-4">
                      {tab === 'resolved' ? <Archive size={24} className="text-gray-300 mx-auto mb-2" /> : <CircleDot size={24} className="text-gray-300 mx-auto mb-2" />}
                      <p className="text-[13px] font-semibold text-gray-500">
                        {tab === 'resolved' ? 'No archived issues' : 'No open issues'}
                      </p>
                      <p className="text-[11.5px] text-gray-400 mt-1">
                        {tab === 'resolved' ? 'Resolved issues will appear here.' : 'Open one with the button below.'}
                      </p>
                    </div>
                  ) : (
                    visible.map(issue => (
                      <button
                        key={issue.id}
                        onClick={() => openDetail(issue.id)}
                        className="w-full text-left rounded-xl border border-gray-200/80 bg-white hover:border-emerald-300 hover:shadow-sm p-3 transition-all"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[13.5px] font-semibold text-gray-900 leading-snug min-w-0">{issue.title}</span>
                          <StatusPill status={issue.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                          <span className="truncate">{issue.author || 'Unknown'}</span>
                          <span className="flex items-center gap-1 shrink-0"><MessageSquare size={11} />{(issue.comments || []).length}</span>
                          <span className="shrink-0 ml-auto">{formatTimestamp(issue.updated_at)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="px-4 py-3 border-t border-gray-100 shrink-0">
                  <button
                    onClick={() => { setView('new'); resetComposers(); }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                  >
                    <Plus size={15} /> New issue
                  </button>
                </div>
              </>
            )}

            {/* ---- NEW ISSUE VIEW ---- */}
            {view === 'new' && (
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Title</label>
                <input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Short summary of the issue"
                  autoFocus
                  className="w-full bg-gray-50/60 border border-gray-200 rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all mb-4"
                />
                <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Description</label>
                <RichTextArea
                  key={`new-${composerNonce}`}
                  value={newBody}
                  onChange={setNewBody}
                  ticker="ISSUES"
                  placeholder="Describe the bug or request. Paste screenshots directly…"
                  rows={6}
                  enableTables
                />
                <div className="flex justify-end items-center gap-2 mt-4">
                  <button onClick={goList} className="text-[12px] font-semibold px-3.5 py-2 rounded-lg text-gray-500 hover:text-gray-700 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={createIssue}
                    disabled={!newTitle.trim() || creating}
                    className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Create issue
                  </button>
                </div>
              </div>
            )}

            {/* ---- DETAIL VIEW ---- */}
            {view === 'detail' && selected && (
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="text-[16px] font-bold text-gray-900 leading-snug min-w-0">{selected.title}</h3>
                  <StatusPill status={selected.status} />
                </div>
                <p className="text-[11.5px] text-gray-400 mb-3">
                  Opened by <span className="font-semibold text-gray-500">{selected.author || 'Unknown'}</span> · {formatTimestamp(selected.created_at)}
                  {selected.status === 'resolved' && selected.resolved_by && (
                    <> · resolved by <span className="font-semibold text-purple-500">{selected.resolved_by}</span></>
                  )}
                </p>

                {/* Body */}
                <div className="rounded-xl border border-gray-200/80 bg-white p-3.5 mb-4">
                  <RichDisplay value={selected.body} />
                </div>

                {/* Admin controls */}
                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {selected.status === 'resolved' ? (
                      <button onClick={() => setStatus('reopen')} disabled={busy} className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition-colors">
                        <RotateCcw size={13} /> Reopen
                      </button>
                    ) : (
                      <button onClick={() => setStatus('resolve')} disabled={busy} className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 transition-colors">
                        <CheckCircle2 size={13} /> Resolve & archive
                      </button>
                    )}
                    {confirmDelete ? (
                      <span className="flex items-center gap-1">
                        <button onClick={deleteIssue} disabled={busy} className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors">
                          <Check size={13} /> Confirm delete
                        </button>
                        <button onClick={() => setConfirmDelete(false)} className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors ml-auto">
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                  </div>
                )}
                {!isAdmin && (
                  <p className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-4">
                    <ShieldCheck size={12} /> Only an admin can resolve or delete issues.
                  </p>
                )}

                {/* Comments */}
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare size={14} className="text-gray-400" />
                  <span className="text-[12px] font-bold text-gray-500">
                    {(selected.comments || []).length} {(selected.comments || []).length === 1 ? 'comment' : 'comments'}
                  </span>
                </div>
                <div className="space-y-2.5 mb-4">
                  {(selected.comments || []).map(c => (
                    <div key={c.id} className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[12px] font-semibold text-gray-700">{c.author || 'Unknown'}</span>
                        <span className="text-[10px] text-gray-300">{formatTimestamp(c.createdAt)}</span>
                      </div>
                      <RichDisplay value={c.body} />
                    </div>
                  ))}
                </div>

                {/* Comment composer */}
                <div className="border-t border-gray-100 pt-3">
                  <RichTextArea
                    key={`comment-${composerNonce}`}
                    value={commentDraft}
                    onChange={setCommentDraft}
                    ticker="ISSUES"
                    placeholder="Add a comment… (paste screenshots directly)"
                    rows={3}
                    enableTables
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={postComment}
                      disabled={isBodyEmpty(commentDraft) || posting}
                      className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {posting ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
                      Comment
                    </button>
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
