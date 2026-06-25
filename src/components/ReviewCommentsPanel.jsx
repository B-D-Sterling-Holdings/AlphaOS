'use client';

import { useState } from 'react';
import { MessageCircle, ChevronDown, ChevronRight, ChevronLeft, Check } from 'lucide-react';

/**
 * ReviewCommentsPanel — a read-only, sticky side rail that surfaces the Draft &
 * Review discussion threads inside the Research → Diligence tab.
 *
 * The threads live in thesis.underwriting.draftReview.threads and survive the
 * Draft & Review → Research stage move untouched (a stage move never destroys
 * data). This panel just re-renders them beside the Due Diligence / Dislocation
 * question editors — same numbered, role-coded layout they had in Draft & Review —
 * so the analyst can read the reviewer back-and-forth while writing the questions
 * those comments raise. Editing still happens on the Draft & Review page; here the
 * comments are reference-only.
 */

const ROLE_META = {
  reviewer: { label: 'Reviewer', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-300' },
  author: { label: 'Author', dot: 'bg-emerald-500', text: 'text-emerald-600', bar: 'bg-emerald-300' },
};

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

// A message body is either an array of rich blocks ({ type:'text'|'image' }) or a
// legacy HTML/plain string. Fold it into a single HTML fragment for read-only
// display, mirroring how RichTextArea merges blocks on render.
function bodyToHtml(value) {
  const blocks = Array.isArray(value) ? value : [{ type: 'text', value: value || '' }];
  return blocks
    .map(b => b?.type === 'image'
      ? `<img src="${String(b?.url || '').replace(/"/g, '&quot;')}" alt="${String(b?.name || '').replace(/"/g, '&quot;')}" class="rc-img" />`
      : (b?.value || ''))
    .filter(frag => frag && frag.trim())
    .join('<br>');
}

function bodyIsEmpty(value) {
  const html = bodyToHtml(value);
  return !(/<img\b/i.test(html) || html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
}

export default function ReviewCommentsPanel({ threads = [] }) {
  const [collapsed, setCollapsed] = useState(false);
  // Threads start expanded so the comments are readable at a glance; only ids in
  // this set are collapsed.
  const [collapsedThreads, setCollapsedThreads] = useState(() => new Set());

  const openCount = threads.filter(t => !t.resolved).length;
  const resolvedCount = threads.length - openCount;
  const allCollapsed = threads.length > 0 && threads.every(t => collapsedThreads.has(t.id));

  // Display order only: resolved comments sink to the bottom (stable within groups).
  const orderedThreads = [...threads].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved));

  const toggleThread = (id) => {
    setCollapsedThreads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsedThreads(allCollapsed ? new Set() : new Set(threads.map(t => t.id)));
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Show the Draft & Review comments"
        className="hidden lg:flex shrink-0 w-9 flex-col items-center gap-3 py-4 rounded-2xl border border-gray-200 bg-white text-gray-400 hover:text-emerald-600 hover:border-emerald-200 transition-colors lg:sticky lg:top-6"
      >
        <ChevronLeft size={16} />
        <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">Comments</span>
        {threads.length > 0 && (
          <span className="min-w-[16px] h-4 px-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center justify-center tabular-nums">
            {threads.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="rc-scroll min-w-0 w-full lg:w-80 xl:w-96 shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-2 space-y-4">
      <style jsx global>{`
        .rc-scroll { scrollbar-width: thin; scrollbar-color: rgb(209 213 219) transparent; }
        .rc-scroll::-webkit-scrollbar { width: 10px; }
        .rc-scroll::-webkit-scrollbar-track { background: transparent; }
        .rc-scroll::-webkit-scrollbar-thumb {
          background-color: rgb(229 231 235); border-radius: 9999px;
          border: 3px solid transparent; background-clip: content-box;
        }
        .rc-scroll:hover::-webkit-scrollbar-thumb { background-color: rgb(209 213 219); }
        .rc-scroll::-webkit-scrollbar-thumb:hover { background-color: rgb(156 163 175); }
        .rc-body { font-size: 13px; line-height: 1.6; color: rgb(55 65 81); word-break: break-word; }
        .rc-body img.rc-img { max-width: 100%; height: auto; border-radius: 8px; margin: 6px 0; }
        .rc-body table { border-collapse: collapse; margin: 6px 0; }
        .rc-body td, .rc-body th { border: 1px solid rgb(229 231 235); padding: 4px 8px; }
      `}</style>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <MessageCircle size={15} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900">Review Comments</h3>
            <p className="text-[11px] text-gray-400">
              {threads.length === 0 ? 'From Draft & Review' : `${openCount} open · ${resolvedCount} resolved`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {threads.length > 0 && (
            <button
              onClick={toggleAll}
              className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-emerald-600 transition-colors px-1.5"
            >
              {allCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {allCollapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button
            onClick={() => setCollapsed(true)}
            title="Hide comments"
            className="hidden lg:flex p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
          <MessageCircle size={22} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No review comments</p>
          <p className="text-xs text-gray-300 mt-1">Comments raised in Draft &amp; Review show up here for reference.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orderedThreads.map((thread, idx) => {
            const messages = (thread.messages || []).filter(m => !bodyIsEmpty(m.body));
            const isCollapsed = collapsedThreads.has(thread.id);
            const resolved = !!thread.resolved;
            return (
              <div
                key={thread.id}
                className={`rounded-xl border transition-colors duration-200 ${resolved ? 'border-gray-100 bg-gray-50/40' : 'border-gray-200/80 bg-white'}`}
              >
                <button
                  onClick={() => toggleThread(thread.id)}
                  className="w-full flex items-start gap-2 px-3.5 pt-2.5 pb-2 text-left"
                >
                  <span className="flex-shrink-0 w-4 mt-0.5 text-center text-[11px] font-bold text-gray-300 tabular-nums">
                    {idx + 1}
                  </span>
                  <span className="flex-shrink-0 mt-0.5 text-gray-300">
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </span>
                  <span className={`flex-1 min-w-0 text-[13px] font-semibold leading-snug ${resolved ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {thread.title?.trim() || 'Untitled comment'}
                  </span>
                  {resolved && (
                    <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500 text-white">
                      <Check size={11} strokeWidth={3} />
                      Resolved
                    </span>
                  )}
                </button>

                {!isCollapsed && messages.length > 0 && (
                  <div className="px-3.5 pb-3 space-y-2.5">
                    {messages.map(msg => {
                      const meta = ROLE_META[msg.role] || ROLE_META.author;
                      return (
                        <div key={msg.id} className="relative pl-3">
                          <span className={`absolute left-0 top-1 bottom-1 w-[2px] rounded-full ${meta.bar}`} />
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
                            <span className="text-[10px] text-gray-300">{formatTimestamp(msg.createdAt)}</span>
                          </div>
                          <div
                            className="rc-body mt-0.5"
                            dangerouslySetInnerHTML={{ __html: bodyToHtml(msg.body) }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
