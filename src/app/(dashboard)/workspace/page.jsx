'use client';

import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import {
  Plus, Search, Pin, PinOff, Trash2, X, Check, ChevronLeft, ChevronRight,
  Lightbulb, HelpCircle, StickyNote, Archive,
  ArchiveRestore, Tag as TagIcon, Palette, AlertCircle,
} from 'lucide-react';

/* ── Constants ────────────────────────────────────────────────── */

const CATEGORIES = [
  { value: 'idea',     label: 'Idea',     icon: Lightbulb,   accent: 'text-amber-600' },
  { value: 'question', label: 'Question', icon: HelpCircle,  accent: 'text-sky-600' },
  { value: 'note',     label: 'Note',     icon: StickyNote,  accent: 'text-violet-600' },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

const COLORS = [
  { value: 'yellow', bg: 'bg-amber-50',    border: 'border-amber-200/70',   swatch: 'bg-amber-200',   tagInk: 'text-amber-700/80' },
  { value: 'blue',   bg: 'bg-sky-50',      border: 'border-sky-200/70',     swatch: 'bg-sky-200',     tagInk: 'text-sky-700/80' },
  { value: 'green',  bg: 'bg-emerald-50',  border: 'border-emerald-200/70', swatch: 'bg-emerald-200', tagInk: 'text-emerald-700/80' },
  { value: 'pink',   bg: 'bg-rose-50',     border: 'border-rose-200/70',    swatch: 'bg-rose-200',    tagInk: 'text-rose-700/80' },
  { value: 'purple', bg: 'bg-violet-50',   border: 'border-violet-200/70',  swatch: 'bg-violet-200',  tagInk: 'text-violet-700/80' },
  { value: 'orange', bg: 'bg-orange-50',   border: 'border-orange-200/70',  swatch: 'bg-orange-200',  tagInk: 'text-orange-700/80' },
  { value: 'gray',   bg: 'bg-gray-50',     border: 'border-gray-200/70',    swatch: 'bg-gray-200',    tagInk: 'text-gray-500' },
];
const COLOR_MAP = Object.fromEntries(COLORS.map(c => [c.value, c]));

// Deterministic tiny rotation per card (sticky-note vibe)
function rotationFor(id) {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 200) / 100 - 1; // -1..+1 deg
}

function formatAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function WorkspacePage() {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);

  // Modal (for both new and edit)
  const [editing, setEditing] = useState(null);

  const blankIdea = () => ({
    id: null,
    title: '',
    content: '',
    category: 'idea',
    color: 'yellow',
    tags: [],
    pinned: false,
    archived: false,
  });

  // FLIP animation refs
  const gridRef = useRef(null);
  const prevPositionsRef = useRef(new Map());
  const shouldAnimateRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/ideas${showArchived ? '?archived=1' : ''}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setLoadError(data.error || `Request failed (${res.status})`);
        setIdeas([]);
      } else {
        setIdeas(data.ideas || []);
      }
    } catch (e) {
      setLoadError(e.message || 'Network error');
      setIdeas([]);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  const allTags = useMemo(() => {
    const t = new Map();
    for (const i of ideas) {
      for (const tag of (i.tags || [])) {
        t.set(tag, (t.get(tag) || 0) + 1);
      }
    }
    return [...t.entries()].sort((a, b) => b[1] - a[1]);
  }, [ideas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter(i => {
      if (showArchived ? !i.archived : i.archived) return false;
      if (showPinnedOnly && !i.pinned) return false;
      if (filterCategory && i.category !== filterCategory) return false;
      if (filterTag && !(i.tags || []).includes(filterTag)) return false;
      if (q) {
        const blob = `${i.title} ${i.content} ${(i.tags || []).join(' ')}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [ideas, search, filterCategory, filterTag, showPinnedOnly, showArchived]);

  const stats = useMemo(() => {
    const byCat = {};
    let pinned = 0;
    for (const i of ideas) {
      if (i.archived) continue;
      byCat[i.category] = (byCat[i.category] || 0) + 1;
      if (i.pinned) pinned++;
    }
    return { total: ideas.filter(i => !i.archived).length, byCat, pinned };
  }, [ideas]);

  /* ── Actions ─────────────────────────────────────── */

  const updateIdea = async (id, patch, opts = {}) => {
    // Guard the save on the version we currently hold (optimistic-concurrency).
    const current = ideas.find(i => i.id === id);
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    if (opts.closeEditor) setEditing(null);
    try {
      const res = await fetch('/api/ideas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch, baseVersion: current?.version }) });
      const data = await res.json();
      if (res.status === 409 && data.conflict) {
        // Someone edited this note in another session — adopt their version rather
        // than clobber it, and tell the user their change didn't apply.
        if (data.current) setIdeas(prev => prev.map(i => i.id === id ? data.current : i));
        setLoadError('This note was changed elsewhere — reloaded the latest. Re-apply your change.');
        return;
      }
      if (data.idea) {
        setIdeas(prev => prev.map(i => i.id === id ? data.idea : i));
      } else if (data.error) {
        setLoadError(data.error);
      }
    } catch (e) {
      setLoadError(e.message || 'Failed to save');
    }
  };

  // Unified save: create if no id, update if id present. Skips creating empty notes.
  const saveIdea = async (idea, patch, opts = {}) => {
    if (idea?.id) {
      return updateIdea(idea.id, patch, opts);
    }
    const hasContent = (patch.title && patch.title.trim()) || (patch.content && patch.content.trim());
    if (opts.closeEditor) setEditing(null);
    if (!hasContent) return;
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.idea) {
        setIdeas(prev => [data.idea, ...prev]);
      } else if (data.error) {
        setLoadError(data.error);
      }
    } catch (e) {
      setLoadError(e.message || 'Failed to save');
    }
  };

  const deleteIdea = async (id) => {
    setIdeas(prev => prev.filter(i => i.id !== id));
    await fetch(`/api/ideas?id=${id}`, { method: 'DELETE' });
    setEditing(null);
  };

  const moveIdea = async (id, direction) => {
    const clicked = ideas.find(i => i.id === id);
    if (!clicked) return;

    const sameBucket = (i) =>
      !!i.pinned === !!clicked.pinned && !!i.archived === !!clicked.archived;

    // Find the nearest visible neighbor in the same bucket within the user's current view.
    const displayIdx = filtered.findIndex(i => i.id === id);
    if (displayIdx < 0) return;
    const step = direction === 'left' ? -1 : 1;
    let neighborId = null;
    for (let i = displayIdx + step; i >= 0 && i < filtered.length; i += step) {
      if (sameBucket(filtered[i])) { neighborId = filtered[i].id; break; }
    }
    if (!neighborId) return;

    // Physically swap the two items in the full ideas array so the UI reorders immediately.
    const newOrder = [...ideas];
    const aIdx = newOrder.findIndex(i => i.id === id);
    const bIdx = newOrder.findIndex(i => i.id === neighborId);
    if (aIdx < 0 || bIdx < 0) return;
    [newOrder[aIdx], newOrder[bIdx]] = [newOrder[bIdx], newOrder[aIdx]];

    // Renumber the bucket sequentially based on the new array order.
    const posMap = {};
    let p = 0;
    for (const item of newOrder) {
      if (sameBucket(item)) { posMap[item.id] = p++; }
    }

    const updated = newOrder.map(i =>
      posMap[i.id] !== undefined ? { ...i, position: posMap[i.id] } : i
    );
    shouldAnimateRef.current = true;
    setIdeas(updated);

    await Promise.all(Object.entries(posMap).map(([uid, pos]) =>
      fetch('/api/ideas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: uid, position: pos }),
      })
    ));
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('workspace-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // FLIP: capture positions each render; when a reorder was just triggered, animate from previous -> new
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = grid.querySelectorAll('[data-idea-id]');
    const newPositions = new Map();
    cards.forEach(el => {
      const id = el.getAttribute('data-idea-id');
      const rect = el.getBoundingClientRect();
      newPositions.set(id, { x: rect.left, y: rect.top });
      if (shouldAnimateRef.current) {
        const prev = prevPositionsRef.current.get(id);
        if (prev && (prev.x !== rect.left || prev.y !== rect.top)) {
          const dx = prev.x - rect.left;
          const dy = prev.y - rect.top;
          try {
            el.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0px, 0px)' },
              ],
              { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', composite: 'add' }
            );
          } catch { /* older browsers without composite:add — ignore */ }
        }
      }
    });
    prevPositionsRef.current = newPositions;
    shouldAnimateRef.current = false;
  });

  /* ── Render ─────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 lg:px-10 pt-12 pb-24">
        {/* Header */}
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Workspace</h1>
            <p className="text-sm text-gray-500 mt-1">Thoughts, questions, and half-baked plans.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchived(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition ${
                showArchived ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 hover:text-gray-900 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {showArchived ? 'Archived' : 'Archive'}
            </button>
            <button
              onClick={() => setEditing(blankIdea())}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 transition"
            >
              <Plus size={14} /> New
            </button>
          </div>
        </div>

        {/* Load error banner */}
        {loadError && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertCircle size={16} className="text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-rose-700">
              <div className="font-semibold mb-0.5">Could not reach the ideas table.</div>
              <div className="text-rose-600/90">
                {loadError}. If this is first-run, create the <code className="font-mono bg-white/60 px-1 rounded">ideas</code> table in Supabase (see <code className="font-mono bg-white/60 px-1 rounded">scripts/supabase-schema.sql</code>, section 20).
              </div>
            </div>
            <button onClick={() => setLoadError('')} className="text-rose-400 hover:text-rose-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              id="workspace-search"
              type="text" spellCheck={true}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-gray-400 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={() => setShowPinnedOnly(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition ${
              showPinnedOnly ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 hover:text-gray-900 border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <Pin size={12} /> Pinned
          </button>

          <div className="w-px h-5 bg-gray-200 mx-1" />

          <button
            onClick={() => setFilterCategory('')}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
              !filterCategory ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(c => {
            const Icon = c.icon;
            const selected = filterCategory === c.value;
            const count = stats.byCat[c.value] || 0;
            return (
              <button
                key={c.value}
                onClick={() => setFilterCategory(selected ? '' : c.value)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                  selected ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon size={12} className={selected ? c.accent : 'text-gray-400'} />
                {c.label}
                {count > 0 && <span className="text-[10px] text-gray-400">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Tag chips */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 mb-6 flex-wrap">
            {allTags.slice(0, 18).map(([tag, count]) => {
              const selected = filterTag === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setFilterTag(selected ? '' : tag)}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 transition ${
                    selected ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  #{tag}
                  <span className={selected ? 'text-white/60' : 'text-gray-300'}>{count}</span>
                </button>
              );
            })}
            {filterTag && (
              <button onClick={() => setFilterTag('')} className="text-[11px] text-gray-400 hover:text-gray-700 ml-1">clear</button>
            )}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="text-sm text-gray-400 py-20 text-center">Loading</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-gray-400">
              {ideas.length === 0 ? 'Nothing here yet.' : 'No matches.'}
            </p>
            {ideas.length === 0 && !loadError && (
              <button
                onClick={() => setEditing(blankIdea())}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-800"
              >
                <Plus size={13} /> Add one
              </button>
            )}
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                rotation={rotationFor(idea.id)}
                onTogglePin={() => updateIdea(idea.id, { pinned: !idea.pinned })}
                onArchive={() => updateIdea(idea.id, { archived: !idea.archived })}
                onEdit={() => setEditing(idea)}
                onDelete={() => deleteIdea(idea.id)}
                onColor={(c) => updateIdea(idea.id, { color: c })}
                onMove={(dir) => moveIdea(idea.id, dir)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal (also used for creating) */}
      {editing && (
        <EditModal
          idea={editing}
          isNew={!editing.id}
          onClose={() => setEditing(null)}
          onSave={(patch) => saveIdea(editing, patch, { closeEditor: true })}
          onDelete={() => editing.id && deleteIdea(editing.id)}
        />
      )}
    </div>
  );
}

/* ── Idea Card ────────────────────────────────────────────────── */

function IdeaCard({ idea, rotation, onTogglePin, onArchive, onEdit, onDelete, onColor, onMove }) {
  const color = COLOR_MAP[idea.color] || COLOR_MAP.yellow;
  const [showColors, setShowColors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      data-idea-id={idea.id}
      className={`group relative rounded-sm border ${color.bg} ${color.border} transition-all duration-200 ease-out`}
      style={{
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 6px 14px -6px rgba(0,0,0,0.10)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06), 0 18px 30px -12px rgba(0,0,0,0.18)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04), 0 6px 14px -6px rgba(0,0,0,0.10)';
      }}
    >
      <div className="p-5 cursor-pointer min-h-[220px] flex flex-col" onClick={onEdit}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-[17px] font-semibold text-gray-900 leading-snug break-words flex-1 min-w-0">
            {idea.title || <span className="font-normal italic text-gray-300">Untitled</span>}
          </h3>
          <div className="flex items-center gap-2 text-[10px] text-gray-400 flex-shrink-0 mt-1">
            {idea.pinned && <Pin size={10} className="text-amber-500 fill-amber-500" />}
            <span>{formatAgo(idea.updated_at || idea.created_at)}</span>
          </div>
        </div>

        {idea.content && (
          <p className="text-[13px] text-gray-700 leading-relaxed whitespace-pre-wrap break-words line-clamp-5">
            {idea.content}
          </p>
        )}

        {idea.tags?.length > 0 && (
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-3">
            {idea.tags.map(t => (
              <span key={t} className="text-[11px] font-medium text-gray-500">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-auto pt-3 flex items-center justify-end gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => onMove('left')}
            title="Move left"
            className="p-1 rounded text-gray-500 hover:text-gray-900 hover:bg-white/60 transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => onMove('right')}
            title="Move right"
            className="p-1 rounded text-gray-500 hover:text-gray-900 hover:bg-white/60 transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Hover toolbar */}
      <div
        className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm rounded-md border border-gray-200/60 p-0.5"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onTogglePin}
          title={idea.pinned ? 'Unpin' : 'Pin'}
          className={`p-1.5 rounded transition-colors ${idea.pinned ? 'text-amber-600' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'}`}
        >
          {idea.pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>

        <div className="relative">
          <button
            onClick={() => setShowColors(v => !v)}
            title="Color"
            className="p-1.5 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <Palette size={12} />
          </button>
          {showColors && (
            <div
              className="absolute top-full right-0 mt-1 flex items-center gap-1 bg-white rounded-md border border-gray-200 shadow-md p-1.5 z-10"
              onMouseLeave={() => setShowColors(false)}
            >
              {COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => { onColor(c.value); setShowColors(false); }}
                  className={`w-4 h-4 rounded-full ${c.swatch} ${idea.color === c.value ? 'ring-2 ring-offset-1 ring-gray-900' : 'hover:scale-110'} transition`}
                />
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onArchive}
          title={idea.archived ? 'Restore' : 'Archive'}
          className="p-1.5 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          {idea.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
        </button>

        {confirmDelete ? (
          <button
            autoFocus
            onClick={onDelete}
            onBlur={() => setConfirmDelete(false)}
            title="Confirm delete"
            className="p-1.5 rounded text-white bg-red-500 hover:bg-red-600 transition-colors"
          >
            <Check size={12} />
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete"
            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Edit Modal ───────────────────────────────────────────────── */

function EditModal({ idea, isNew, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState({
    title: idea.title || '',
    content: idea.content || '',
    category: idea.category || 'idea',
    color: idea.color || 'yellow',
    tags: [...(idea.tags || [])],
  });
  const [tagDraft, setTagDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = COLOR_MAP[draft.color] || COLOR_MAP.yellow;

  const addTag = () => {
    const t = tagDraft.trim();
    if (!t || draft.tags.includes(t)) { setTagDraft(''); return; }
    setDraft(v => ({ ...v, tags: [...v.tags, t] }));
    setTagDraft('');
  };

  const save = () => {
    onSave({
      title: draft.title.trim(),
      content: draft.content.trim(),
      category: draft.category,
      color: draft.color,
      tags: draft.tags,
    });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center pt-20 px-4" onClick={save}>
      <div
        className={`w-full max-w-2xl rounded-xl border ${color.bg} ${color.border} shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {CATEGORIES.map(c => {
              const Icon = c.icon;
              const selected = draft.category === c.value;
              return (
                <button
                  key={c.value}
                  onClick={() => setDraft(v => ({ ...v, category: c.value }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    selected ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  <Icon size={12} />
                  {c.label}
                </button>
              );
            })}
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              {COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setDraft(v => ({ ...v, color: c.value }))}
                  title={c.value}
                  className={`w-4 h-4 rounded-full ${c.swatch} ${draft.color === c.value ? 'ring-2 ring-offset-1 ring-gray-900' : 'hover:scale-110'} transition`}
                />
              ))}
            </div>
          </div>

          <input
            autoFocus
            type="text" spellCheck={true}
            value={draft.title}
            onChange={e => setDraft(v => ({ ...v, title: e.target.value }))}
            placeholder="Title"
            className="w-full bg-transparent text-xl font-semibold text-gray-900 outline-none placeholder:text-gray-300 mb-2"
          />
          <textarea spellCheck={true}
            value={draft.content}
            onChange={e => setDraft(v => ({ ...v, content: e.target.value }))}
            placeholder="Write freely..."
            rows={10}
            className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-300 resize-y leading-relaxed min-h-[160px]"
          />

          <div className="flex items-center gap-x-2 gap-y-1 mt-4 flex-wrap">
            {draft.tags.map(t => (
              <span key={t} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-500">
                #{t}
                <button onClick={() => setDraft(v => ({ ...v, tags: v.tags.filter(x => x !== t) }))} className="opacity-60 hover:opacity-100 hover:text-red-500">
                  <X size={10} />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <TagIcon size={11} />
              <input
                type="text" spellCheck={true}
                value={tagDraft}
                onChange={e => setTagDraft(e.target.value.replace(/\s+/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                onBlur={addTag}
                placeholder="add tag"
                className="w-24 bg-transparent outline-none text-xs text-gray-700 placeholder:text-gray-300"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t border-gray-200/60 bg-white/40">
          {!isNew && (
            confirmDelete ? (
              <button
                autoFocus
                onClick={onDelete}
                onBlur={() => setConfirmDelete(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600"
              >
                <Check size={12} /> Confirm delete
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 size={12} /> Delete
              </button>
            )
          )}

          <div className="flex-1" />

          <span className="text-[11px] text-gray-400 mr-2">
            {isNew ? 'Click outside to save' : 'Click outside to save'}
          </span>

          <button onClick={onClose} className="px-4 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-white/60">
            {isNew ? 'Cancel' : 'Discard'}
          </button>
        </div>
      </div>
    </div>
  );
}
