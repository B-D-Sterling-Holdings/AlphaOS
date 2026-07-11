'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import RichTextArea from '@/components/RichTextArea';

/**
 * CommentThread — one numbered discussion thread: a title, an alternating
 * Reviewer ⇄ Author reply chain, a resolve toggle, and an inline composer.
 *
 * Extracted from DraftReview so the Watchlist per-stock comment popover renders
 * the exact same threads with the exact same behavior (issue: "Draft & Review
 * style comments on watchlists"). The data model is shared:
 *   thread = { id, title, resolved, createdAt, messages: [{ id, role, body, createdAt }] }
 * with role ∈ { 'reviewer', 'author' }. The component is controlled — it owns no
 * thread state, it just calls onChange(nextThread, persist) / onRemove().
 */

export function makeId() {
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

export const ROLE_META = {
  reviewer: { label: 'Reviewer', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-300' },
  author: { label: 'Author', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', text: 'text-emerald-600', bar: 'bg-emerald-300' },
};

export function bodyIsEmpty(value) {
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

export default function CommentThread({ thread, index, ticker, autoFocus, collapsed, onToggleCollapsed, onChange, onRemove }) {
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

  // The wrapped line count depends on the box width, which changes when the panel
  // is resized (collapse/expand) or the window resizes. Re-measure height on width
  // change so stale extra lines don't linger. Guard on width so our own height
  // writes don't feed back into the observer.
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
