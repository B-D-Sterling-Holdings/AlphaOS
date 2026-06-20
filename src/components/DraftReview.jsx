'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, MessageCircle, Plus, Trash2, Check, X, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import Card from '@/components/Card';
import RichTextArea from '@/components/RichTextArea';

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

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

const ROLE_META = {
  reviewer: { label: 'Reviewer', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-300' },
  author: { label: 'Author', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', text: 'text-emerald-600', bar: 'bg-emerald-300' },
};

function bodyIsEmpty(value) {
  if (Array.isArray(value)) {
    return !value.some(block => block?.type === 'image'
      || (block?.value && block.value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()));
  }
  return !(typeof value === 'string' && value.replace(/<[^>]+>/g, '').trim());
}

function autoSizeTitle(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function Thread({ thread, index, ticker, autoFocus, collapsed, onToggleCollapsed, onChange, onRemove }) {
  const titleRef = useRef(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState([{ type: 'text', value: '' }]);
  const [composerNonce, setComposerNonce] = useState(0);
  const [confirmMsgId, setConfirmMsgId] = useState(null);
  const [confirmThreadDelete, setConfirmThreadDelete] = useState(false);

  const messages = thread.messages || [];
  // The reply composer defaults to whoever should speak next: the first comment
  // starts as Reviewer (they raise the point), then it alternates from the last
  // message — Reviewer → Author → Reviewer … (still switchable per reply).
  const lastRole = messages.length ? messages[messages.length - 1].role : null;
  const [replyRole, setReplyRole] = useState(lastRole ? (lastRole === 'reviewer' ? 'author' : 'reviewer') : 'reviewer');
  // Whose turn it is to respond next: the opposite of whoever spoke last.
  const nextRole = lastRole === 'reviewer' ? 'author' : 'reviewer';

  // Keep the title box tall enough to show the whole title (it wraps instead of
  // truncating) — re-measure on mount and whenever the title or collapse changes.
  useEffect(() => { autoSizeTitle(titleRef.current); }, [thread.title, collapsed]);

  // The wrapped line count depends on the box width, which changes when the
  // Review panel is resized (collapse/expand) or the window resizes. Re-measure
  // height on width change so stale extra lines don't linger. Guard on width so
  // our own height writes don't feed back into the observer.
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        autoSizeTitle(el);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A just-added point grabs focus so you can type its title immediately
  // (preventScroll: the parent handles the smooth scroll-into-view).
  useEffect(() => {
    if (autoFocus) titleRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (updates, persist = false) => onChange({ ...thread, ...updates }, persist);

  const updateMessage = (msgId, body, persist = false) => {
    patch({ messages: messages.map(m => m.id === msgId ? { ...m, body } : m) }, persist);
  };

  const removeMessage = (msgId) => {
    patch({ messages: messages.filter(m => m.id !== msgId) }, true);
  };

  const postReply = () => {
    if (bodyIsEmpty(draft)) return;
    const message = { id: makeId(), role: replyRole, body: draft, createdAt: new Date().toISOString() };
    patch({ messages: [...messages, message] }, true);
    setDraft([{ type: 'text', value: '' }]);
    setComposerNonce(n => n + 1);
    setReplyRole(replyRole === 'reviewer' ? 'author' : 'reviewer');
    setComposing(false);
  };

  const cancelReply = () => {
    setDraft([{ type: 'text', value: '' }]);
    setComposerNonce(n => n + 1);
    setComposing(false);
  };

  const resolved = !!thread.resolved;
  // The first comment opens automatically (the title above it IS its title); the
  // composer for any *additional* comment stays hidden behind "Add comment".
  const showComposer = composing || messages.length === 0;

  return (
    <div className={`group/thread rounded-xl border transition-colors duration-200 ${resolved ? 'border-gray-100 bg-gray-50/40' : 'border-gray-200/80 bg-white'}`}>
      {/* Thread header */}
      <div className="flex items-start gap-2 px-3.5 pt-2.5 pb-1.5">
        <span className="flex-shrink-0 w-4 mt-0.5 text-center text-[11px] font-bold text-gray-300 tabular-nums">
          {index + 1}
        </span>
        <button
          onClick={onToggleCollapsed}
          className="flex-shrink-0 mt-0.5 -ml-1 p-0.5 text-gray-300 hover:text-gray-600 transition-colors"
          title={collapsed ? 'Expand comment' : 'Collapse comment'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="flex-1 min-w-0">
          <textarea
            ref={titleRef}
            rows={1}
            spellCheck
            value={thread.title}
            onChange={(e) => { patch({ title: e.target.value }); autoSizeTitle(e.target); }}
            onBlur={(e) => patch({ title: e.target.value }, true)}
            placeholder="Add title of your comment…"
            className={`w-full bg-transparent text-[13px] font-semibold leading-snug outline-none placeholder-gray-300 resize-none overflow-hidden ${resolved ? 'text-gray-400 line-through' : 'text-gray-900'}`}
          />
          {!resolved && messages.length > 0 && (
            <span
              className={`flex items-center gap-1 text-[10px] font-medium ${ROLE_META[nextRole].text}`}
              title={`${ROLE_META[nextRole].label} needs to respond next`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${ROLE_META[nextRole].dot}`} />
              {ROLE_META[nextRole].label} to respond
            </span>
          )}
        </div>
        <button
          onClick={() => patch({ resolved: !resolved }, true)}
          className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${resolved ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200'}`}
          title={resolved ? 'Reopen' : 'Mark resolved'}
        >
          <Check size={12} strokeWidth={3} />
          {resolved ? 'Resolved' : 'Resolve'}
        </button>
        {confirmThreadDelete ? (
          <span className="flex-shrink-0 flex items-center gap-0.5">
            <button
              onClick={() => { setConfirmThreadDelete(false); onRemove(); }}
              className="p-1 text-red-500 hover:text-red-600"
              title="Confirm delete"
            >
              <Check size={13} strokeWidth={3} />
            </button>
            <button
              onClick={() => setConfirmThreadDelete(false)}
              className="p-1 text-gray-300 hover:text-gray-500"
              title="Cancel"
            >
              <X size={13} strokeWidth={3} />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmThreadDelete(true)}
            className="flex-shrink-0 p-1 text-gray-300 hover:text-red-400 transition-all opacity-0 group-hover/thread:opacity-100"
            title="Delete thread"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-3.5 pb-3">
          {/* Comments */}
          {messages.length > 0 && (
            <div className="space-y-2.5 mb-2">
              {messages.map(msg => {
                const meta = ROLE_META[msg.role] || ROLE_META.author;
                return (
                  <div key={msg.id} className="group/msg relative pl-3">
                    <span className={`absolute left-0 top-1 bottom-1 w-[2px] rounded-full ${meta.bar}`} />
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
                      <span className="text-[10px] text-gray-300">{formatTimestamp(msg.createdAt)}</span>
                      {confirmMsgId === msg.id ? (
                        <span className="ml-auto flex items-center gap-0.5">
                          <button
                            onClick={() => { removeMessage(msg.id); setConfirmMsgId(null); }}
                            className="p-0.5 text-red-500 hover:text-red-600"
                            title="Confirm delete"
                          >
                            <Check size={12} strokeWidth={3} />
                          </button>
                          <button
                            onClick={() => setConfirmMsgId(null)}
                            className="p-0.5 text-gray-300 hover:text-gray-500"
                            title="Cancel"
                          >
                            <X size={12} strokeWidth={3} />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmMsgId(msg.id)}
                          className="ml-auto opacity-0 group-hover/msg:opacity-100 p-0.5 text-gray-300 hover:text-red-400 transition-all"
                          title="Delete comment"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                    <RichTextArea
                      value={msg.body || ''}
                      onChange={(value) => updateMessage(msg.id, value)}
                      onBlur={(value) => updateMessage(msg.id, value, true)}
                      onCommit={(value) => updateMessage(msg.id, value, true)}
                      ticker={ticker}
                      inlineImages
                      resizableImages
                      placeholder="…"
                      rows={1}
                      className="w-full bg-transparent rounded-md px-2 -ml-2 py-0.5 text-[13px] text-gray-700 leading-relaxed outline-none focus:bg-gray-50 transition-colors resize-none overflow-hidden"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Composer — open for the first comment, then hidden behind "Add comment" */}
          {!resolved && (showComposer ? (
            <div className={messages.length > 0 ? 'border-t border-gray-100 pt-2.5' : ''}>
              <div className="flex items-center gap-3 mb-1.5">
                {(['reviewer', 'author']).map(role => {
                  const meta = ROLE_META[role];
                  const active = replyRole === role;
                  return (
                    <button
                      key={role}
                      onClick={() => setReplyRole(role)}
                      className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors ${active ? meta.text : 'text-gray-300 hover:text-gray-500'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full transition-colors ${active ? meta.dot : 'bg-gray-200'}`} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <RichTextArea
                key={composerNonce}
                value={draft}
                onChange={setDraft}
                ticker={ticker}
                inlineImages
                resizableImages
                placeholder={messages.length === 0 ? 'Write your comment…' : (replyRole === 'author' ? 'Answer…' : 'Add a follow-up…')}
                rows={2}
                className="w-full bg-gray-50/60 border border-gray-100 rounded-lg px-3 py-1.5 text-[13px] text-gray-700 outline-none focus:bg-white focus:ring-1 focus:ring-emerald-300 focus:border-transparent transition-all resize-none overflow-hidden"
              />
              <div className="flex justify-end items-center gap-2 mt-1.5">
                {messages.length > 0 && (
                  <button
                    onClick={cancelReply}
                    className="text-[11px] font-semibold px-3 py-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={postReply}
                  disabled={bodyIsEmpty(draft)}
                  className="text-[11px] font-semibold px-3 py-1 rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                >
                  Post
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setComposing(true)}
              className={`flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 transition-colors ${messages.length > 0 ? 'mt-0.5' : ''}`}
            >
              <Plus size={12} />
              Add comment
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DraftReview({ ticker, paper, threads, onPaperChange, onThreadsChange }) {
  // null = both panels open; 'paper' = paper collapsed (review fills the row);
  // 'review' = review collapsed (paper fills the row). Collapse is an lg-only
  // affordance — on mobile both panels always stack full-width.
  const [collapsed, setCollapsed] = useState(null);
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
      <style jsx global>{`
        .dr-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgb(209 213 219) transparent;
        }
        .dr-scroll::-webkit-scrollbar {
          width: 10px;
        }
        .dr-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .dr-scroll::-webkit-scrollbar-thumb {
          background-color: rgb(229 231 235);
          border-radius: 9999px;
          border: 3px solid transparent;
          background-clip: content-box;
        }
        .dr-scroll:hover::-webkit-scrollbar-thumb {
          background-color: rgb(209 213 219);
        }
        .dr-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgb(156 163 175);
        }
      `}</style>
      {/* Paper */}
      {paperCollapsed ? (
        <button
          onClick={() => setCollapsed(null)}
          title="Expand the paper"
          className="hidden lg:flex shrink-0 w-9 flex-col items-center gap-3 py-4 rounded-2xl border border-gray-200 bg-white text-gray-400 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
        >
          <ChevronRight size={16} />
          <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">The Paper</span>
        </button>
      ) : (
        <div className={`min-w-0 w-full lg:w-auto ${reviewCollapsed ? 'lg:flex-1' : 'lg:flex-[2_1_0%]'}`}>
          <Card>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <FileText size={15} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-900">The Paper</h2>
                <p className="text-[11px] text-gray-400">Write the full thesis here. Paste images and table screenshots directly into the text.</p>
              </div>
              <button
                onClick={() => setCollapsed('paper')}
                title="Collapse the paper"
                className="ml-auto hidden lg:flex shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            </div>
            <div className="mt-4">
              <RichTextArea
                value={paper}
                onChange={(value) => onPaperChange(value)}
                onBlur={(value) => onPaperChange(value, true)}
                onCommit={(value) => onPaperChange(value, true)}
                ticker={ticker}
                enableTables
                inlineImages
                resizableImages
                stickyToolbar
                placeholder="Open with the thesis in a sentence, then build the full argument — business, drivers, valuation, risks…"
                rows={22}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[15px] leading-relaxed text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none overflow-hidden"
              />
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
        <div className={`dr-scroll min-w-0 w-full lg:w-auto lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-3 space-y-4 ${paperCollapsed ? 'lg:flex-1' : 'lg:flex-[1_1_0%]'}`}>
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
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={addThread}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors"
              >
                <Plus size={13} />
                Add point
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
                  <Thread
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
