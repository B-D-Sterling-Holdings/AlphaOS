'use client';

// StickyNotes — the app-wide, Windows-Sticky-Notes-style workspace layer.
//
// Mounted ONCE in the dashboard layout, so it survives client-side navigation
// (Next keeps the layout mounted while only the page segment swaps) — a pinned
// note stays put on screen as you move between pages, no reload. Refreshes and
// future sessions are covered by the database: every note stores both its
// content AND its floating-card UI state (pinned / minimized / position / size /
// stacking), so it comes back exactly where it was.
//
// Three surfaces, one data model (see src/lib/stickyNotesApi.js + /api/sticky-notes):
//   • a protruding "NOTES" tab on the right edge (same idea as the Research Task
//     rail's tab) that opens…
//   • a slide-out manager PANEL — search, create, open-to-edit, delete, pin/unpin;
//   • and the floating CARDS themselves (portaled to <body>), each draggable,
//     resizable, minimizable, closable and editable in place.
//
// Saves are serialized per note and version-guarded (OCC), so dragging, resizing,
// recolouring and typing never race each other into a lost update — and a genuine
// cross-tab conflict reloads that one note instead of clobbering it.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  StickyNote, Plus, X, Search, Trash2, Pin, PinOff, Minus, Maximize2,
  ChevronLeft, ChevronRight, Palette, Check, GripHorizontal,
} from 'lucide-react';
import { useCache } from '@/lib/CacheContext';
import RichTextArea from '@/components/RichTextArea';
import {
  STICKY_COLORS, COLOR_KEYS, colorOf, noteTitle, matchesQuery, bodyToText,
  parseBody, serializeBody,
  MIN_W, MIN_H, DEFAULT_W, DEFAULT_H,
  fetchStickyNotes, createStickyNote, updateStickyNote, deleteStickyNote,
} from '@/lib/stickyNotesApi';

/* ------------------------------------------------------------------ *
 * Time helper — "just now" / "5m ago" / a short date, for the footer.
 * ------------------------------------------------------------------ */
function timeAgo(ts) {
  if (!ts) return '';
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------------ *
 * SavingText — a self-syncing auto-saving field (single-line title OR a
 * scrollable multi-line body). Local state drives the input for lag-free typing;
 * a ref mirror means a commit reads exactly what's on screen. Commits fire
 * debounced (body), on blur, and on unmount. When the note changes underneath us
 * (a conflict reload, or the same note edited on the other surface) and we're not
 * focused, we adopt the new value.
 * ------------------------------------------------------------------ */
function SavingText({ value, onCommit, debounceMs = 0, singleLine = false, className = '', ...props }) {
  const [local, setLocal] = useState(value ?? '');
  const [lastExternal, setLastExternal] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  const localRef = useRef(value ?? '');
  const committedRef = useRef(value ?? '');
  const timerRef = useRef(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; });

  // External resync — adopt a changed `value` (conflict reload, or the same note
  // edited on the other surface) while we're not mid-edit. Done during render
  // (React's "adjusting state when a prop changes" pattern) rather than in an
  // effect, so there's no extra commit-then-rerender pass. The mirror refs below
  // are kept in step via effects (they can't be written during render).
  if ((value ?? '') !== lastExternal && !focused) {
    setLastExternal(value ?? '');
    setLocal(value ?? '');
  }
  // localRef mirrors the on-screen value so a debounced/blur commit reads exactly
  // what's shown; committedRef tracks the last value handed to the parent, so an
  // externally-adopted value is never redundantly re-committed.
  useEffect(() => { localRef.current = local; }, [local]);
  useEffect(() => { committedRef.current = lastExternal; }, [lastExternal]);

  const commit = useCallback(() => {
    clearTimeout(timerRef.current);
    const val = localRef.current;
    if (val === committedRef.current) return;
    committedRef.current = val;
    onCommitRef.current?.(val);
  }, []);

  // Flush a pending edit if the field unmounts (panel closes, card unpinned…).
  useEffect(() => () => commit(), [commit]);

  const handleChange = (e) => {
    localRef.current = e.target.value;
    setLocal(e.target.value);
    if (debounceMs > 0) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commit, debounceMs);
    }
  };
  const handleFocus = () => { setFocused(true); };
  const handleBlur = () => { setFocused(false); commit(); };

  if (singleLine) {
    return (
      <input
        value={local}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
        className={className}
        {...props}
      />
    );
  }
  return (
    <textarea
      value={local}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ *
 * ColorMenu — the six-swatch colour picker used by the card + panel editor.
 * ------------------------------------------------------------------ */
function ColorMenu({ current, onPick, onClose, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return (
    <div ref={ref} className={`z-[10] flex items-center gap-1.5 p-1.5 rounded-xl bg-white border border-gray-200 shadow-lg ${className}`}>
      {COLOR_KEYS.map(key => (
        <button
          key={key}
          onClick={() => { onPick(key); onClose(); }}
          title={STICKY_COLORS[key].label}
          className={`w-5 h-5 rounded-full ${STICKY_COLORS[key].swatch} flex items-center justify-center ring-offset-1 transition-transform hover:scale-110 ${current === key ? `ring-2 ${STICKY_COLORS[key].ring}` : ''}`}
        >
          {current === key && <Check size={11} className="text-gray-700" />}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * TickerChip — the little symbol pill shown on a note that's about a ticker.
 * ------------------------------------------------------------------ */
function TickerChip({ ticker, className = '' }) {
  if (!ticker) return null;
  return (
    <span className={`inline-flex items-center shrink-0 rounded-md bg-emerald-600/10 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 tracking-wide ${className}`}>
      {ticker}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * TickerField — an auto-saving, always-uppercase ticker input (reuses SavingText).
 * ------------------------------------------------------------------ */
function TickerField({ value, onCommit, className = '' }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] font-bold text-emerald-700 select-none">$</span>
      <SavingText
        singleLine
        value={value || ''}
        onCommit={(val) => onCommit(val.trim().toUpperCase())}
        placeholder="Add a ticker…"
        maxLength={12}
        className={`uppercase bg-transparent font-bold tracking-wide text-emerald-800 outline-none placeholder:text-gray-400/70 placeholder:font-normal placeholder:normal-case ${className}`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * NoteBodyEditor — the rich note body. Wraps the shared RichTextArea (the exact
 * Draft & Review editor: bold/italic/underline, font sizes, lists, pasted images
 * & tables) and auto-saves: debounced while typing, flushed on blur, after an
 * image insert, and on unmount. The block array is serialized to a JSON string
 * for the `body` column. Keyed by note id by the caller so it re-inits cleanly
 * when a different note opens.
 * ------------------------------------------------------------------ */
function NoteBodyEditor({ note, onSaveBody, enableTables = false, rows = 4, className }) {
  const timerRef = useRef(null);
  const latestRef = useRef(note.body || '');   // freshest serialized body
  const bodyRef = useRef(note.body || '');      // freshest persisted body (from props)
  const onSaveBodyRef = useRef(onSaveBody);     // freshest callback (avoids churn below)
  useEffect(() => { bodyRef.current = note.body || ''; });
  useEffect(() => { onSaveBodyRef.current = onSaveBody; });

  // Stable so the unmount flush below fires ONLY on unmount, not on every render.
  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    if (latestRef.current !== bodyRef.current) onSaveBodyRef.current(latestRef.current);
  }, []);

  // Flush any pending edit when the editor unmounts (panel closes, card unpinned…).
  useEffect(() => () => flush(), [flush]);

  const handleChange = (blocks) => {
    latestRef.current = serializeBody(blocks);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 700);
  };

  return (
    <RichTextArea
      value={parseBody(note.body)}
      onChange={handleChange}
      onBlur={flush}
      onCommit={(blocks) => { latestRef.current = serializeBody(blocks); flush(); }}
      ticker={note.ticker || 'NOTES'}
      placeholder="Take a note…"
      rows={rows}
      enableTables={enableTables}
      compact
      className={className}
    />
  );
}

/* ------------------------------------------------------------------ *
 * FloatingNote — one pinned card, portaled to <body>. Owns its live position &
 * size during a drag/resize (for smoothness), committing to the shared save path
 * on release. Title/body edit in place; minimize collapses to the title bar;
 * close unpins (keeps the note in the list); trash deletes.
 * ------------------------------------------------------------------ */
function FloatingNote({ note, zIndex, onSave, onDelete, onFront }) {
  const c = colorOf(note);
  const [pos, setPos] = useState({ x: note.pos_x, y: note.pos_y });
  const [size, setSize] = useState({ w: note.width || DEFAULT_W, h: note.height || DEFAULT_H });
  const [showColors, setShowColors] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Adopt external position/size changes when we're not actively dragging —
  // during render (see SavingText), keyed on a signature of the persisted geometry.
  const extSig = `${note.pos_x},${note.pos_y},${note.width},${note.height}`;
  const [lastSig, setLastSig] = useState(extSig);
  if (extSig !== lastSig && !dragging) {
    setLastSig(extSig);
    setPos({ x: note.pos_x, y: note.pos_y });
    setSize({ w: note.width || DEFAULT_W, h: note.height || DEFAULT_H });
  }

  // Keep a card that was saved off-screen (smaller window now) reachable.
  const clampPos = useCallback((x, y) => {
    const maxX = Math.max(0, window.innerWidth - 60);
    const maxY = Math.max(64, window.innerHeight - 48);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(64, y), maxY) };
  }, []);

  const startDrag = (e) => {
    if (e.button !== 0) return;
    // Bringing the card to front is handled by the root pointer-down (this event
    // bubbles up to it), so it isn't repeated here.
    const start = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    setDragging(true);
    const move = (ev) => {
      const next = clampPos(start.x + (ev.clientX - start.px), start.y + (ev.clientY - start.py));
      setPos(next);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const final = clampPos(start.x + (ev.clientX - start.px), start.y + (ev.clientY - start.py));
      setDragging(false);
      if (final.x !== start.x || final.y !== start.y) onSave({ pos_x: final.x, pos_y: final.y });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onFront();
    const start = { px: e.clientX, py: e.clientY, w: size.w, h: size.h };
    setDragging(true);
    const move = (ev) => {
      setSize({
        w: Math.max(MIN_W, start.w + (ev.clientX - start.px)),
        h: Math.max(MIN_H, start.h + (ev.clientY - start.py)),
      });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const w = Math.max(MIN_W, start.w + (ev.clientX - start.px));
      const h = Math.max(MIN_H, start.h + (ev.clientY - start.py));
      setDragging(false);
      if (w !== start.w || h !== start.h) onSave({ width: w, height: h });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const minimized = note.minimized;

  return (
    <div
      data-sticky-card
      onPointerDown={onFront}
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: minimized ? undefined : size.h, zIndex }}
      className={`flex flex-col rounded-xl border shadow-xl ${c.card} animate-fade-in-up`}
    >
      {/* Title bar — drag handle + window controls */}
      <div
        onPointerDown={startDrag}
        className={`flex items-center gap-1 px-2 py-1.5 border-b rounded-t-xl cursor-grab active:cursor-grabbing select-none ${c.bar}`}
      >
        <GripHorizontal size={14} className="text-gray-400 shrink-0" />
        <TickerChip ticker={note.ticker} />
        <span className="flex-1 min-w-0 truncate text-[12px] font-semibold text-gray-700">
          {noteTitle(note)}
        </span>
        {/* Controls don't drag: stop propagation on their pointer-down. */}
        <div className="flex items-center gap-0.5 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <div className="relative">
            <button
              onClick={() => setShowColors(v => !v)}
              className="p-1 rounded-md text-gray-500 hover:bg-black/5"
              title="Colour"
            >
              <Palette size={13} />
            </button>
            {showColors && (
              <ColorMenu
                current={note.color}
                onPick={(color) => onSave({ color })}
                onClose={() => setShowColors(false)}
                className="absolute top-full right-0 mt-1"
              />
            )}
          </div>
          <button
            onClick={() => onSave({ minimized: !minimized })}
            className="p-1 rounded-md text-gray-500 hover:bg-black/5"
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? <Maximize2 size={13} /> : <Minus size={13} />}
          </button>
          <button
            onClick={() => onSave({ pinned: false })}
            className="p-1 rounded-md text-gray-500 hover:bg-black/5"
            title="Close (keeps it in your notes)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <SavingText
            singleLine
            value={note.title}
            onCommit={(val) => onSave({ title: val })}
            placeholder="Title"
            className="px-3 pt-2 pb-1 bg-transparent text-[13px] font-semibold text-gray-900 outline-none placeholder:text-gray-400/70"
          />
          <div className="px-3 pb-1">
            <TickerField value={note.ticker} onCommit={(t) => onSave({ ticker: t })} className="text-[11px] w-full" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden px-2 pb-1">
            <NoteBodyEditor
              key={note.id}
              note={note}
              onSaveBody={(body) => onSave({ body })}
              rows={3}
              className="w-full bg-transparent text-[13px] leading-relaxed text-gray-800 outline-none"
            />
          </div>
          {/* Footer — timestamp + delete */}
          <div className={`flex items-center justify-between gap-2 px-2 py-1 border-t ${c.bar}`} onPointerDown={(e) => e.stopPropagation()}>
            <span className="text-[10px] text-gray-500/80">Edited {timeAgo(note.updated_at)}</span>
            <button onClick={() => onDelete(note)} className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-black/5" title="Delete note">
              <Trash2 size={12} />
            </button>
          </div>
          {/* Resize handle (bottom-right) */}
          <div
            onPointerDown={startResize}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
            title="Resize"
          >
            <svg viewBox="0 0 10 10" className="w-full h-full text-gray-400/70">
              <path d="M9 1 L9 9 L1 9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * PanelEditor — the in-panel edit view for one note.
 * ------------------------------------------------------------------ */
function PanelEditor({ note, onSave, onDelete, onBack }) {
  const c = colorOf(note);
  const [showColors, setShowColors] = useState(false);
  const pinned = note.pinned;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Editor toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <button
          onClick={onBack}
          title="Back to all notes (Esc)"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-[12.5px] font-semibold text-gray-700 shadow-sm hover:bg-gray-100 hover:border-gray-400 transition-colors"
        >
          <ChevronLeft size={15} /> All notes
        </button>
        <div className="flex-1" />
        <div className="relative">
          <button onClick={() => setShowColors(v => !v)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="Colour">
            <Palette size={15} />
          </button>
          {showColors && (
            <ColorMenu current={note.color} onPick={(color) => onSave({ color })} onClose={() => setShowColors(false)} className="absolute top-full right-0 mt-1" />
          )}
        </div>
        <button
          onClick={() => onSave({ pinned: !pinned })}
          className={`p-1.5 rounded-lg transition-colors ${pinned ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-gray-100'}`}
          title={pinned ? 'Unpin from workspace' : 'Pin to workspace'}
        >
          {pinned ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
      </div>

      {/* Body */}
      <div className={`flex-1 flex flex-col min-h-0 m-3 rounded-xl border ${c.card}`}>
        <SavingText
          singleLine
          value={note.title}
          onCommit={(val) => onSave({ title: val })}
          placeholder="Title"
          className="px-3 pt-3 pb-1 bg-transparent text-[15px] font-bold text-gray-900 outline-none placeholder:text-gray-400/70"
        />
        {/* Ticker section — sits under the title */}
        <div className="px-3 pb-2 pt-0.5 border-b border-black/5">
          <TickerField value={note.ticker} onCommit={(t) => onSave({ ticker: t })} className="text-[13px] w-full" />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden px-2 py-2">
          <NoteBodyEditor
            key={note.id}
            note={note}
            onSaveBody={(body) => onSave({ body })}
            enableTables
            rows={6}
            className="w-full bg-transparent text-[13.5px] leading-relaxed text-gray-800 outline-none"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-gray-100">
        <span className="text-[11px] text-gray-400">Edited {timeAgo(note.updated_at)}</span>
        <button onClick={() => onDelete(note)} className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600 hover:text-red-700">
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The feature
 * ------------------------------------------------------------------ */
export default function StickyNotes() {
  const cache = useCache();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(() => cache.get('sticky_notes_panel_open') ?? false);
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null); // note awaiting delete confirmation

  const notesRef = useRef([]);            // synchronous mirror of `notes`
  const saveQueue = useRef(new Map());    // per-note serialized save chain
  const noticeTimer = useRef(null);
  const panelRef = useRef(null);
  const tabRef = useRef(null);

  // Single source of truth: mutate the ref synchronously, then mirror to state.
  const commit = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(notesRef.current) : updater;
    notesRef.current = next;
    setNotes(next);
  }, []);

  const patchLocal = useCallback((id, updates) => {
    commit(list => list.map(n => (n.id === id ? { ...n, ...updates } : n)));
  }, [commit]);

  const flash = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3200);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  useEffect(() => { setMounted(true); }, []);

  // Load this user's notes once on mount.
  useEffect(() => {
    let alive = true;
    fetchStickyNotes().then(rows => { if (alive) commit(rows); });
    return () => { alive = false; };
  }, [commit]);

  const toggleOpen = useCallback((next) => {
    setOpen(prev => {
      const value = typeof next === 'boolean' ? next : !prev;
      cache.set('sticky_notes_panel_open', value);
      return value;
    });
  }, [cache]);

  /* ---- the one save path: optimistic + serialized per note + OCC ----
     Applies `updates` locally at once, then drains a per-note queue so
     concurrent edits (drag → type → recolour) never race a stale version into
     each other. A real cross-tab conflict adopts the newer version and re-applies
     our change on top; if it keeps losing, we reload that note and say so. */
  const runChain = useCallback(async (id) => {
    const entry = saveQueue.current.get(id);
    if (!entry) return;
    try {
      while (entry.pending) {
        const updates = entry.pending;
        entry.pending = null;
        const note = notesRef.current.find(n => n.id === id);
        if (!note) break;
        const res = await updateStickyNote(note, updates);
        if (res.ok && res.note) {
          // Adopt only server-authoritative bookkeeping; keep local content (which
          // is already what the user sees, and may be newer than this response).
          patchLocal(id, { version: res.note.version, updated_at: res.note.updated_at });
          entry.attempts = 0;
        } else if (res.conflict && res.server) {
          if ((entry.attempts || 0) >= 3) {
            patchLocal(id, res.server);         // give up gracefully — reload the note
            entry.pending = null;
            flash('A note was updated in another tab, so it was reloaded.');
            break;
          }
          entry.attempts = (entry.attempts || 0) + 1;
          patchLocal(id, { version: res.server.version });   // fresh version…
          entry.pending = { ...updates, ...(entry.pending || {}) }; // …retry our edit on top
        } else {
          flash('Could not save a note — check your connection.');
          break;
        }
      }
    } finally {
      entry.running = false;
    }
  }, [patchLocal, flash]);

  const saveNote = useCallback((id, updates) => {
    patchLocal(id, updates); // optimistic
    const q = saveQueue.current;
    const entry = q.get(id) || { pending: null, running: false, attempts: 0 };
    entry.pending = { ...(entry.pending || {}), ...updates };
    q.set(id, entry);
    if (!entry.running) { entry.running = true; runChain(id); }
  }, [patchLocal, runChain]);

  // A cascading spawn position so a freshly pinned note doesn't land on top of
  // the last one.
  const nextSpawn = useCallback(() => {
    const n = notesRef.current.filter(x => x.pinned).length;
    return { pos_x: 90 + (n % 6) * 26, pos_y: 130 + (n % 6) * 26 };
  }, []);

  const addNote = useCallback(async (opts = {}) => {
    const spawn = nextSpawn();
    const res = await createStickyNote({ color: 'yellow', ...spawn, ...opts });
    if (res.ok && res.note) {
      commit(list => [res.note, ...list]);
      setSelectedId(res.note.id);   // open the new note for editing
    } else {
      flash('Could not create a note.');
    }
  }, [commit, flash, nextSpawn]);

  const removeNote = useCallback(async (note) => {
    commit(list => list.filter(n => n.id !== note.id));
    saveQueue.current.delete(note.id);
    if (selectedId === note.id) setSelectedId(null);
    const res = await deleteStickyNote(note.id);
    if (!res.ok) {
      const fresh = await fetchStickyNotes();
      commit(fresh);
      flash('Could not delete that note.');
    }
  }, [commit, flash, selectedId]);

  // Bring a card to the front by giving it the highest stacking order.
  const bringToFront = useCallback((note) => {
    const maxZ = notesRef.current.reduce((m, n) => Math.max(m, n.z || 0), 0);
    if ((note.z || 0) >= maxZ && maxZ > 0) return; // already on top
    saveNote(note.id, { z: maxZ + 1 });
  }, [saveNote]);

  // Pinning from the panel positions the card if it has no spot yet.
  const setPinned = useCallback((note, pinned) => {
    if (pinned && !note.pos_x && !note.pos_y) saveNote(note.id, { pinned, ...nextSpawn() });
    else saveNote(note.id, { pinned });
  }, [saveNote, nextSpawn]);

  // Escape: from the editor go back to the list; from the list close the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (selectedId) setSelectedId(null);
      else toggleOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selectedId, toggleOpen]);

  // Click-off-to-close: a pointer-down anywhere off the panel closes it — which
  // unmounts the editor and flushes any in-flight edit (SavingText commits on
  // unmount), so "click away" always saves. Clicks on the NOTES tab, the panel
  // itself, or a floating card are ignored (interacting with a pinned card must
  // not dismiss the manager).
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const t = e.target;
      // The click removed its own target mid-event (e.g. deleting an inline image
      // detaches the image + its overlay button) — that's not an outside click, so
      // don't treat it as one and close the panel.
      if (t && t.isConnected === false) return;
      if (panelRef.current?.contains(t)) return;
      if (tabRef.current?.contains(t)) return;
      if (t.closest?.('[data-sticky-card]')) return;
      if (t.closest?.('[data-sticky-modal]')) return; // the delete-confirm dialog
      toggleOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, toggleOpen]);

  const pinnedNotes = useMemo(
    () => notes.filter(n => n.pinned).sort((a, b) => (a.z || 0) - (b.z || 0)),
    [notes],
  );
  const listNotes = useMemo(
    () => notes.filter(n => matchesQuery(n, query)),
    [notes, query],
  );
  const selected = useMemo(() => notes.find(n => n.id === selectedId) || null, [notes, selectedId]);

  const PANEL_W = 'min(22rem, 88vw)';

  return (
    <>
      {/* Protruding "NOTES" tab on the right edge — mirror of the Research Task
          rail's tab. Rides out to the panel's left edge when open. */}
      <button
        ref={tabRef}
        onClick={() => toggleOpen()}
        style={{ right: open ? PANEL_W : '0px' }}
        className="fixed top-1/2 -translate-y-1/2 z-[9991] flex flex-col items-center gap-1.5 bg-white border border-r-0 border-gray-200 rounded-l-xl py-3 px-1.5 shadow-md hover:shadow-lg hover:pr-2.5 transition-all duration-300 group"
        title={open ? 'Hide sticky notes' : 'Sticky notes'}
      >
        <StickyNote size={15} className="text-gray-500 group-hover:text-amber-500 transition-colors" />
        <span className="text-[10px] font-bold tracking-wider text-gray-500 [writing-mode:vertical-rl]">NOTES</span>
        {open
          ? <ChevronRight size={16} className="text-gray-500 group-hover:text-amber-500 transition-colors" />
          : <ChevronLeft size={16} className="text-gray-500 group-hover:text-amber-500 transition-colors" />}
        {notes.length > 0 && (
          <span className="text-[10px] font-bold text-white bg-amber-500 rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
            {notes.length}
          </span>
        )}
      </button>

      {/* Manager panel — slides in from the right. */}
      {open && (
        <aside ref={panelRef} className="fixed right-0 top-20 bottom-0 z-[9990] w-[22rem] max-w-[88vw] bg-white border-l border-gray-200 shadow-xl flex flex-col animate-fade-in-up">
          {selected ? (
            <PanelEditor
              note={selected}
              onSave={(u) => saveNote(selected.id, u)}
              onDelete={setPendingDelete}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
                    <StickyNote size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-gray-900 leading-tight">Sticky Notes</div>
                  </div>
                </div>
                <button onClick={() => toggleOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" title="Close">
                  <X size={16} />
                </button>
              </div>

              {/* Search + new */}
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search notes…"
                    className="w-full text-[13px] pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-200 focus:bg-white transition-all"
                  />
                </div>
                <button
                  onClick={() => addNote()}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 transition-colors shrink-0"
                  title="New note"
                >
                  <Plus size={15} /> New
                </button>
              </div>

              {notice && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 flex items-start gap-2">
                  <span className="flex-1">{notice}</span>
                  <button onClick={() => setNotice('')} className="text-amber-500 hover:text-amber-700"><X size={12} /></button>
                </div>
              )}

              {/* List */}
              <div className="flex-1 overflow-y-auto px-3 py-3">
                {listNotes.length === 0 ? (
                  <div className="text-center py-14 px-6">
                    <StickyNote size={26} className="text-gray-300 mx-auto mb-3" />
                    <div className="text-[13px] font-semibold text-gray-600">
                      {query.trim() ? 'No notes match your search.' : 'No notes yet'}
                    </div>
                    <div className="text-[12px] text-gray-400 mt-1">
                      {query.trim() ? 'Try a different search.' : 'Create one and pin it to keep it on top of your workspace.'}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {listNotes.map(note => {
                      const c = colorOf(note);
                      return (
                        <div
                          key={note.id}
                          onClick={() => setSelectedId(note.id)}
                          className={`group relative rounded-xl border p-3 cursor-pointer hover:shadow-sm transition-all ${c.card}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <TickerChip ticker={note.ticker} />
                                <div className="text-[13px] font-semibold text-gray-900 truncate">{noteTitle(note)}</div>
                              </div>
                              {(() => {
                                const preview = bodyToText(note.body);
                                return preview ? (
                                  <div className="text-[12px] text-gray-600 mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">{preview}</div>
                                ) : null;
                              })()}
                              <div className="text-[10.5px] text-gray-400 mt-1.5">Edited {timeAgo(note.updated_at)}</div>
                            </div>
                            {/* Quick pin + delete */}
                            <div className="flex flex-col items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => setPinned(note, !note.pinned)}
                                className={`p-1 rounded-md transition-colors ${note.pinned ? 'text-emerald-600 bg-white/70' : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-700'}`}
                                title={note.pinned ? 'Unpin' : 'Pin to workspace'}
                              >
                                {note.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                              </button>
                              <button
                                onClick={() => setPendingDelete(note)}
                                className="p-1 rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                                title="Delete note"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      )}

      {/* Floating pinned cards — portaled to <body> so they layer over the page
          regardless of where this component sits in the tree. */}
      {mounted && createPortal(
        pinnedNotes.map((note, i) => (
          <FloatingNote
            key={note.id}
            note={note}
            zIndex={30 + i}
            onSave={(u) => saveNote(note.id, u)}
            onDelete={setPendingDelete}
            onFront={() => bringToFront(note)}
          />
        )),
        document.body,
      )}

      {/* Delete confirmation — one dialog for every delete affordance (list row,
          panel editor, floating card). Portaled to <body> at a z above the panel
          so it's never hidden behind it. */}
      {mounted && pendingDelete && createPortal(
        <div data-sticky-modal className="fixed inset-0 z-[10050] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setPendingDelete(null)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5">
            <h3 className="text-[16px] font-bold text-gray-900">Delete this note?</h3>
            <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed">
              <span className="font-semibold text-gray-700">“{noteTitle(pendingDelete)}”</span> will be permanently deleted. This can’t be undone.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 text-[13px] font-semibold rounded-xl border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { const n = pendingDelete; setPendingDelete(null); removeNote(n); }}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-xl bg-red-500 text-white hover:bg-red-600 shadow-sm transition-colors"
              >
                <Trash2 size={14} /> Delete note
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
