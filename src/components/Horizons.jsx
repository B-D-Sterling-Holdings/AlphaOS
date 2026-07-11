'use client';

// Horizons — the long-term planning suite on /tasks. A firm-level strategy space
// distinct from the day-to-day Board/Week task lists: a "North Star" strategy
// statement plus strategic priorities bucketed into time horizons (This Quarter /
// This Year / Long-Term). Cards are deliberately minimal — just the priority and
// expandable notes; you drag a card between columns to re-horizon it. One plan per
// tenant, persisted through /api/horizons (an app_settings blob). Every edit is
// optimistic + saved in the background.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, X, ChevronDown, ChevronUp, Compass, GripVertical } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import {
  HORIZONS, normalizePlan, prioritiesFor, makePriority, upsertPriority, removePriority,
} from '@/lib/horizons';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function horizonFromDropId(id) {
  return typeof id === 'string' && id.startsWith('horizon-') ? id.slice(8) : null;
}

// A textarea that grows to fit its content (titles/notes without a scrollbar).
function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// Collapsed notes preview height (≈3 lines) — the "certain amount" shown before
// you click Show more, mirroring the watchlist note panel.
const COLLAPSED_NOTES_HEIGHT = 52;

// --- One strategic priority card ---------------------------------------------

function PriorityCard({ priority, onPatchLocal, onCommit, onDelete }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: priority.id });
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const titleRef = useRef(null);
  const notesRef = useRef(null);
  const hasNotes = !!priority.detail?.trim();
  const showNotes = adding || hasNotes;

  // Title always shows in full.
  useEffect(() => { autosize(titleRef.current); }, [priority.title]);

  // Notes: full height when expanded, else clamped to the preview height. Measure
  // whether there's more to reveal in a rAF so we never setState in the effect body.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    if (expanded) autosize(el);
    else el.style.height = `${COLLAPSED_NOTES_HEIGHT}px`;
    const raf = requestAnimationFrame(() => setOverflows(el.scrollHeight > COLLAPSED_NOTES_HEIGHT + 4));
    return () => cancelAnimationFrame(raf);
  }, [showNotes, expanded, priority.detail]);

  return (
    <div
      ref={setNodeRef}
      className={`group bg-white border border-gray-200 rounded-xl p-3 shadow-sm ${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
          aria-label="Drag priority"
        >
          <GripVertical size={13} />
        </button>
        <textarea
          ref={titleRef}
          value={priority.title}
          onChange={e => onPatchLocal(priority.id, { title: e.target.value })}
          onBlur={() => onCommit(priority.id)}
          rows={1}
          placeholder="Priority…"
          className="flex-1 min-w-0 resize-none overflow-hidden text-sm font-semibold text-gray-900 placeholder-gray-300 leading-snug bg-transparent outline-none"
        />
        {confirming ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setConfirming(false)}
              className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onDelete(priority.id)}
              className="text-[11px] font-semibold text-white bg-red-500 px-2 py-0.5 rounded-md hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            aria-label="Delete priority"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Notes — a preview that expands to reveal the rest when there's more. */}
      {showNotes ? (
        <div className="mt-2">
          <textarea
            ref={notesRef}
            autoFocus={adding}
            value={priority.detail}
            onChange={e => onPatchLocal(priority.id, { detail: e.target.value })}
            onFocus={() => setExpanded(true)}
            onBlur={() => { onCommit(priority.id); if (!priority.detail?.trim()) setAdding(false); }}
            placeholder="Notes, strategy, what success looks like…"
            className="w-full resize-none overflow-hidden text-xs text-gray-600 placeholder-gray-300 leading-relaxed bg-gray-50 border border-gray-100 rounded-lg p-2 outline-none focus:border-emerald-300"
          />
          {(overflows || expanded) && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-1 flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-1.5 flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Plus size={12} /> Add notes
        </button>
      )}
    </div>
  );
}

// Static card under the cursor while dragging (kept separate so it doesn't
// register a second draggable with the same id).
function PriorityCardGhost({ priority }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-lg ring-2 ring-emerald-200 rotate-1 w-64">
      <div className="flex items-start gap-1.5">
        <GripVertical size={13} className="text-gray-300 mt-0.5" />
        <span className="flex-1 text-sm font-semibold text-gray-900 leading-snug">{priority.title || 'Priority'}</span>
      </div>
    </div>
  );
}

// --- Add-priority inline input -----------------------------------------------

function AddPriority({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const submit = () => {
    const title = value.trim();
    if (title) onAdd(title);
    setValue('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full flex items-center gap-1.5 text-sm text-gray-400 hover:text-emerald-600 px-2 py-2 rounded-lg border border-dashed border-gray-200 hover:border-emerald-300 transition-colors">
        <Plus size={15} /> Add priority
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { setValue(''); setOpen(false); } }}
      placeholder="Priority title…"
      className="w-full text-sm border border-emerald-300 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-emerald-300"
    />
  );
}

// --- Droppable horizon column ------------------------------------------------

function HorizonColumn({ horizon, items, onPatchLocal, onCommit, onDelete, onAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: `horizon-${horizon.key}` });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border p-3 flex flex-col transition-colors ${
        isOver ? 'border-emerald-400 bg-emerald-50/60' : 'border-gray-200 bg-gray-50/50'
      }`}
    >
      <div className="flex items-baseline justify-between px-1 mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{horizon.label}</h3>
          <p className="text-[11px] text-gray-400">{horizon.hint}</p>
        </div>
        <span className="text-xs text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">{items.length}</span>
      </div>
      <div className="flex-1 space-y-2 min-h-[40px]">
        {items.map(p => (
          <PriorityCard
            key={p.id}
            priority={p}
            onPatchLocal={onPatchLocal}
            onCommit={onCommit}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div className="mt-2">
        <AddPriority onAdd={onAdd} />
      </div>
    </div>
  );
}

// --- The suite ---------------------------------------------------------------

export default function Horizons() {
  const [vision, setVision] = useState('');
  const [priorities, setPriorities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const prioritiesRef = useRef([]);
  prioritiesRef.current = priorities;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection = useCallback((args) => {
    const within = pointerWithin(args);
    return within.length > 0 ? within : rectIntersection(args);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/horizons');
        const plan = normalizePlan(await res.json());
        setVision(plan.vision);
        setPriorities(plan.priorities);
      } catch (err) {
        console.error('Failed to load horizons', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const savePriority = useCallback(async (priority) => {
    try {
      await fetch('/api/horizons', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ priority }) });
    } catch (err) {
      console.error('Failed to save priority', err);
    }
  }, []);

  const patchLocal = useCallback((id, fields) => {
    setPriorities(prev => upsertPriority(prev, { id, ...fields }));
  }, []);
  const commit = useCallback((id) => {
    const merged = prioritiesRef.current.find(p => p.id === id);
    if (merged) savePriority(merged);
  }, [savePriority]);
  const patchSave = useCallback((id, fields) => {
    const merged = upsertPriority(prioritiesRef.current, { id, ...fields }).find(p => p.id === id);
    setPriorities(prev => upsertPriority(prev, { id, ...fields }));
    if (merged) savePriority(merged);
  }, [savePriority]);

  const addPriority = useCallback((horizonKey, title) => {
    const p = makePriority(horizonKey, prioritiesRef.current);
    p.title = title;
    setPriorities(prev => [...prev, p]);
    savePriority(p);
  }, [savePriority]);

  const deletePriority = useCallback(async (id) => {
    const snapshot = prioritiesRef.current;
    setPriorities(prev => removePriority(prev, id));
    try {
      await fetch(`/api/horizons?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete priority', err);
      setPriorities(snapshot);
    }
  }, []);

  const saveVision = useCallback(async (text) => {
    try {
      await fetch('/api/horizons', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ vision: text }) });
    } catch (err) {
      console.error('Failed to save vision', err);
    }
  }, []);

  const handleDragEnd = (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const card = prioritiesRef.current.find(p => p.id === active.id);
    if (!card) return;
    const targetHorizon = horizonFromDropId(over.id);
    if (!targetHorizon || targetHorizon === card.horizon) return;
    const inTarget = prioritiesFor(prioritiesRef.current, targetHorizon);
    const position = inTarget.length ? (inTarget[inTarget.length - 1].position ?? 0) + 1 : 0;
    patchSave(active.id, { horizon: targetHorizon, position });
  };

  const activeCard = activeId ? priorities.find(p => p.id === activeId) : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* North Star / strategy statement */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-gradient-to-br from-emerald-50/60 to-white p-5">
        <div className="flex items-center gap-2 mb-2">
          <Compass size={16} className="text-emerald-600" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">North Star</h2>
          <span className="text-xs text-gray-400">— the strategy to keep in mind</span>
        </div>
        <textarea
          value={vision}
          onChange={e => setVision(e.target.value)}
          onBlur={() => saveVision(vision)}
          rows={2}
          placeholder="What are we ultimately building toward? The long-term thesis, edge, and where the firm should be in 3–5 years…"
          className="w-full resize-y text-sm text-gray-700 leading-relaxed placeholder-gray-400 bg-transparent outline-none"
        />
      </div>

      {/* Horizon columns — drag a card between columns to re-horizon it */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={e => setActiveId(e.active.id)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {HORIZONS.map(h => (
            <HorizonColumn
              key={h.key}
              horizon={h}
              items={prioritiesFor(priorities, h.key)}
              onPatchLocal={patchLocal}
              onCommit={commit}
              onDelete={deletePriority}
              onAdd={(title) => addPriority(h.key, title)}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? <PriorityCardGhost priority={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
