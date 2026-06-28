'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Plus, Trash2, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import RichTextArea from '@/components/RichTextArea';

/**
 * LessonComments — the same numbered, Reviewer <-> Author discussion threads used
 * on the Draft & Review page, scoped to a single lesson. Each thread is one point
 * with a reply chain that alternates Reviewer -> Author until it's resolved.
 *
 * Threads live in `lesson.comments` (an array). This component owns all
 * thread/message mutations and pushes the whole array back via `onChange`. The
 * parent debounces persistence, so `onChange` is fire-and-forget here.
 *
 *   <LessonComments ticker={ticker} threads={lesson.comments} onChange={next => ...} />
 */

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `lc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

const ROLE_META = {
  reviewer: { label: 'Reviewer', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-300' },
  author:   { label: 'Author',   dot: 'bg-emerald-500', text: 'text-emerald-600', bar: 'bg-emerald-300' },
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
  const lastRole = messages.length ? messages[messages.length - 1].role : null;
  const [replyRole, setReplyRole] = useState(lastRole ? (lastRole === 'reviewer' ? 'author' : 'reviewer') : 'reviewer');
  const nextRole = lastRole === 'reviewer' ? 'author' : 'reviewer';

  useEffect(() => { autoSizeTitle(titleRef.current); }, [thread.title, collapsed]);
  useEffect(() => {
    if (autoFocus) titleRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (updates) => onChange({ ...thread, ...updates });
  const updateMessage = (msgId, body) => patch({ messages: messages.map(m => m.id === msgId ? { ...m, body } : m) });
  const removeMessage = (msgId) => patch({ messages: messages.filter(m => m.id !== msgId) });

  const postReply = () => {
    if (bodyIsEmpty(draft)) return;
    const message = { id: makeId(), role: replyRole, body: draft, createdAt: new Date().toISOString() };
    patch({ messages: [...messages, message] });
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
          onClick={() => patch({ resolved: !resolved })}
          className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${resolved ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200'}`}
          title={resolved ? 'Reopen' : 'Mark resolved'}
        >
          <Check size={12} strokeWidth={3} />
          {resolved ? 'Resolved' : 'Resolve'}
        </button>
        {confirmThreadDelete ? (
          <span className="flex-shrink-0 flex items-center gap-0.5">
            <button onClick={() => { setConfirmThreadDelete(false); onRemove(); }} className="p-1 text-red-500 hover:text-red-600" title="Confirm delete">
              <Check size={13} strokeWidth={3} />
            </button>
            <button onClick={() => setConfirmThreadDelete(false)} className="p-1 text-gray-300 hover:text-gray-500" title="Cancel">
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
                          <button onClick={() => { removeMessage(msg.id); setConfirmMsgId(null); }} className="p-0.5 text-red-500 hover:text-red-600" title="Confirm delete">
                            <Check size={12} strokeWidth={3} />
                          </button>
                          <button onClick={() => setConfirmMsgId(null)} className="p-0.5 text-gray-300 hover:text-gray-500" title="Cancel">
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
                      onBlur={(value) => updateMessage(msg.id, value)}
                      onCommit={(value) => updateMessage(msg.id, value)}
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

          {/* Composer */}
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
                  <button onClick={cancelReply} className="text-[11px] font-semibold px-3 py-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors">
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

export default function LessonComments({ ticker, threads = [], onChange }) {
  // Threads start expanded so the discussion reads at a glance; ids in this set
  // are collapsed.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [autoFocusId, setAutoFocusId] = useState(null);

  const openCount = threads.filter(t => !t.resolved).length;
  const resolvedCount = threads.length - openCount;
  const allCollapsed = threads.length > 0 && threads.every(t => collapsed.has(t.id));

  // Resolved threads sink to the bottom (display order only).
  const ordered = [...threads].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved));

  const addThread = () => {
    const thread = { id: makeId(), title: '', resolved: false, createdAt: new Date().toISOString(), messages: [] };
    onChange([...threads, thread]);
    setCollapsed(prev => { const next = new Set(prev); next.delete(thread.id); return next; });
    setAutoFocusId(thread.id);
  };
  const updateThread = (id, nextThread) => onChange(threads.map(t => t.id === id ? nextThread : t));
  const removeThread = (id) => onChange(threads.filter(t => t.id !== id));

  const toggleThread = (id) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(threads.map(t => t.id)));

  return (
    <div className="rounded-2xl border border-gray-100 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <MessageCircle size={15} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900">Review Comments</h3>
            <p className="text-[11px] text-gray-400">
              {threads.length === 0 ? 'Reviewer ↔ Author discussion' : `${openCount} open · ${resolvedCount} resolved`}
            </p>
          </div>
        </div>
        {threads.length > 0 && (
          <button onClick={toggleAll} className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-emerald-600 transition-colors px-1.5 shrink-0">
            {allCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {allCollapsed ? 'Expand' : 'Collapse'}
          </button>
        )}
      </div>

      {/* Threads */}
      <div className="p-3 space-y-2.5 max-h-[60vh] overflow-y-auto">
        {threads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
            <MessageCircle size={22} className="text-gray-300 mx-auto mb-2" />
            <p className="text-[13px] font-semibold text-gray-500">No comments yet</p>
            <p className="text-[11.5px] text-gray-400 mt-1">Raise a point and reply back and forth, Reviewer ↔ Author, until it&apos;s resolved.</p>
          </div>
        ) : (
          ordered.map((thread, idx) => (
            <Thread
              key={thread.id}
              thread={thread}
              index={idx}
              ticker={ticker}
              autoFocus={thread.id === autoFocusId}
              collapsed={collapsed.has(thread.id)}
              onToggleCollapsed={() => toggleThread(thread.id)}
              onChange={(next) => updateThread(thread.id, next)}
              onRemove={() => removeThread(thread.id)}
            />
          ))
        )}
      </div>

      {/* Add */}
      <div className="px-3 py-2.5 border-t border-gray-100">
        <button
          onClick={addThread}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
        >
          <Plus size={14} /> Add comment
        </button>
      </div>
    </div>
  );
}
