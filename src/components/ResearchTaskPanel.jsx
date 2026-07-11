'use client';

// ResearchTaskPanel — the collapsible left rail shared by the Draft & Review,
// Research, and Position Review pages. It is a structured to-do list scoped to
// the company currently open (one ticker): "build the model", "analyze
// utilization rates", etc. Each item carries a status, an optional assignee (the
// person responsible, picked from the same saved-assignee roster the /tasks board
// uses), free-form tags, and notes.
//
// It is a fixed overlay: collapsing/expanding only toggles visibility, it never
// reflows the page underneath (per the design — "nothing moves around, it's just
// visible or not"). Render it only when a ticker is selected; it returns null
// otherwise. Persistence, concurrency and the assignee roster all reuse existing
// app infrastructure (see researchTaskApi + /api/assignees).

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, User, Tag as TagIcon, ChevronDown,
  ClipboardList, GripVertical, Flag,
} from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCache } from '@/lib/CacheContext';
import {
  COLOR_PALETTE,
  getAssigneeInlineStyle,
  addAssignee as addAssigneeToList,
  removeAssignee as removeAssigneeFromList,
} from '@/lib/taskBoard';
import {
  fetchResearchTasks,
  createResearchTask,
  updateResearchTask,
  deleteResearchTask,
  reorderResearchTasks,
} from '@/lib/researchTaskApi';

// The roster lives under its own board key so it's shared across every company's
// research tasks but kept separate from the /tasks board's roster.
const ROSTER_BOARD = 'research-tasks';

const STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'done'];
const STATUS_META = {
  todo:        { label: 'To Do',       dot: 'bg-gray-300',    chip: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'In Progress', dot: 'bg-blue-500',    chip: 'bg-blue-50 text-blue-700' },
  blocked:     { label: 'Blocked',     dot: 'bg-red-500',     chip: 'bg-red-50 text-red-700' },
  done:        { label: 'Done',        dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
};

const PRIORITY_ORDER = ['high', 'medium', 'low'];
const PRIORITY_META = {
  high:   { label: 'High',   dot: 'bg-red-500',    chip: 'bg-red-50 text-red-700' },
  medium: { label: 'Medium', dot: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700' },
  low:    { label: 'Low',    dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
};

// The contents of the little protruding "TASKS" tab — icon, vertical label,
// arrow and open-count. The SAME tab is shown whether the panel is collapsed or
// expanded (it just rides from the screen edge out to the panel's right edge);
// only the arrow flips — right to expand, left to collapse.
function TaskHandleContents({ openCount, collapse }) {
  const iconCls = 'text-gray-500 group-hover:text-emerald-600 transition-colors';
  return (
    <>
      <ClipboardList size={15} className={iconCls} />
      <span className="text-[10px] font-bold tracking-wider text-gray-500 [writing-mode:vertical-rl] rotate-180">
        TASKS
      </span>
      {collapse
        ? <ChevronLeft size={16} className={iconCls} />
        : <ChevronRight size={16} className={iconCls} />}
      {openCount > 0 && (
        <span className="text-[10px] font-bold text-white bg-emerald-500 rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
          {openCount}
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Assignee roster API (app_settings via /api/assignees)
 * ------------------------------------------------------------------ */
async function fetchRoster() {
  try {
    const res = await fetch(`/api/assignees?board_id=${ROSTER_BOARD}`);
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.assignees) ? data.assignees : [];
  } catch {
    return [];
  }
}

function saveRoster(assignees) {
  return fetch('/api/assignees', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignees, board_id: ROSTER_BOARD }),
  });
}

/* ------------------------------------------------------------------ *
 * Select pill — a small dropdown pill used for both status and priority.
 * `order` is the list of option keys; `meta` maps each key to {label,dot,chip}.
 * `icon` (optional) renders a leading glyph instead of the colour dot on the
 * button face (used by the priority pill).
 * ------------------------------------------------------------------ */
function SelectPill({ value, order, meta, onChange, fallback, icon: Icon }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = meta[value] || meta[fallback];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${current.chip} hover:opacity-80 transition-opacity`}
      >
        {Icon ? <Icon size={11} /> : <span className={`w-2 h-2 rounded-full ${current.dot}`} />}
        {current.label}
        <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[130px]">
          {order.map(key => {
            const m = meta[key];
            return (
              <button
                key={key}
                onClick={() => { onChange(key); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 ${key === value ? 'font-semibold' : ''}`}
              >
                <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Assignee picker — pick from the roster, or add / remove people
 * ------------------------------------------------------------------ */
function AssigneePicker({ current, roster, onSelect, onAddPerson, onRemovePerson, onClose, anchorRef }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [confirmRemove, setConfirmRemove] = useState(null);

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const commitAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddPerson(trimmed, color);
    onSelect(trimmed);
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
      className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px] max-h-[300px] overflow-y-auto"
    >
      {current && (
        <button
          onClick={() => { onSelect(''); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-2"
        >
          <X size={12} /> Unassign
        </button>
      )}
      {roster.map(({ name: n, color: c }) => (
        <div key={n} className="group/row flex items-center hover:bg-gray-50">
          <button
            onClick={() => { onSelect(n); onClose(); }}
            className={`flex-1 text-left px-3 py-1.5 text-sm flex items-center gap-2 ${current?.toLowerCase() === n.toLowerCase() ? 'font-semibold' : ''}`}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
            {n}
          </button>
          {confirmRemove === n ? (
            <div className="flex items-center gap-1 pr-2" onClick={e => e.stopPropagation()}>
              <button onClick={() => setConfirmRemove(null)} className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded hover:bg-gray-200">No</button>
              <button onClick={() => { onRemovePerson(n); setConfirmRemove(null); }} className="text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded hover:bg-red-600">Yes</button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmRemove(n); }}
              className="opacity-0 group-hover/row:opacity-100 pr-2 text-gray-300 hover:text-red-500 transition-all"
              title={`Remove ${n}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {showAdd ? (
        <div className="px-3 py-2 border-t border-gray-100 mt-1" onClick={e => e.stopPropagation()}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitAdd(); }}
            placeholder="Name"
            className="w-full text-sm px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-200 mb-2"
          />
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            {COLOR_PALETTE.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <button onClick={commitAdd} className="flex-1 text-xs font-semibold text-white bg-emerald-600 rounded-lg py-1 hover:bg-emerald-700">Add</button>
            <button onClick={() => { setShowAdd(false); setName(''); }} className="text-xs text-gray-500 px-2 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full text-left px-3 py-1.5 text-xs text-emerald-600 hover:bg-emerald-50 flex items-center gap-2 border-t border-gray-100 mt-1"
        >
          <Plus size={12} /> Add person
        </button>
      )}
    </div>,
    document.body,
  );
}

function AssigneeTag({ assignee, roster, onOpen, anchorRef }) {
  if (!assignee) {
    return (
      <button ref={anchorRef} onClick={onOpen} className="p-1 text-gray-400 hover:text-gray-600 transition-colors" title="Assign">
        <User size={14} />
      </button>
    );
  }
  return (
    <button
      ref={anchorRef}
      onClick={onOpen}
      className="text-[11px] font-medium rounded-full border px-2 py-0.5 hover:opacity-80 transition-opacity"
      style={getAssigneeInlineStyle(assignee, roster)}
    >
      {assignee}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Tags editor — small chips with add / remove
 * ------------------------------------------------------------------ */
function TagEditor({ tags, onChange }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  const commit = () => {
    const t = value.trim();
    if (t && !tags.some(x => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setValue('');
    setAdding(false);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.map(t => (
        <span key={t} className="group/tag inline-flex items-center gap-1 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-md px-1.5 py-0.5">
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} className="text-gray-400 hover:text-red-500">
            <X size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setValue(''); setAdding(false); } }}
          onBlur={commit}
          placeholder="tag"
          className="text-[10px] w-16 px-1.5 py-0.5 border border-gray-200 rounded-md outline-none focus:ring-1 focus:ring-emerald-200"
        />
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-gray-600" title="Add tag">
          <TagIcon size={10} /> tag
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Task card — one to-do item. Sortable: it renders its own drag handle
 * (matching the /tasks board) via dnd-kit's useSortable.
 * ------------------------------------------------------------------ */
function TaskCard({ task, roster, onPatch, onDelete, onOpenAssignee }) {
  // Local edit buffers for the free-text fields; committed to the server on blur.
  // The parent keys this card by `${id}:${version}`, so when a save (or a
  // conflict reload) bumps the version the card remounts and re-initialises from
  // fresh props — that's how server truth is adopted, no sync effect needed.
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes || '');
  const [showNotes, setShowNotes] = useState(Boolean(task.notes));
  const assigneeAnchor = useRef(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  // Y-only translate (matches SortableTaskRow on the /tasks board) to avoid
  // horizontal jitter in the narrow rail.
  const yOnly = transform ? { ...transform, x: 0 } : null;
  const style = {
    transform: CSS.Transform.toString(yOnly),
    transition: transition || 'transform 250ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity: isDragging ? 0.4 : 1,
    position: 'relative',
    zIndex: isDragging ? 20 : 'auto',
  };

  const done = task.status === 'done';

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== task.title) onPatch(task, { title: t });
    else if (!t) setTitle(task.title);
  };
  const commitNotes = () => {
    if ((notes || '') !== (task.notes || '')) onPatch(task, { notes });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="group rounded-xl border border-gray-200 bg-white p-3 hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-1.5">
        <button
          {...listeners}
          className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
          title="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <textarea
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }}
          rows={1}
          className={`flex-1 text-sm bg-transparent outline-none resize-none leading-snug ${done ? 'line-through text-gray-400' : 'text-gray-900'}`}
        />
        <button
          onClick={() => onDelete(task)}
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all flex-shrink-0 mt-0.5"
          title="Delete task"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-1.5">
          <SelectPill value={task.status} order={STATUS_ORDER} meta={STATUS_META} fallback="todo" onChange={s => onPatch(task, { status: s })} />
          <SelectPill value={task.priority} order={PRIORITY_ORDER} meta={PRIORITY_META} fallback="medium" icon={Flag} onChange={p => onPatch(task, { priority: p })} />
        </div>
        <AssigneeTag
          assignee={task.assignee}
          roster={roster}
          anchorRef={assigneeAnchor}
          onOpen={() => onOpenAssignee(task, assigneeAnchor)}
        />
      </div>

      <div className="mt-2">
        <TagEditor tags={task.tags || []} onChange={tags => onPatch(task, { tags })} />
      </div>

      {showNotes ? (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={commitNotes}
          rows={2}
          placeholder="Notes…"
          className="mt-2 w-full text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
        />
      ) : (
        <button onClick={() => setShowNotes(true)} className="mt-1.5 text-[11px] text-gray-400 hover:text-gray-600">
          + note
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */
export default function ResearchTaskPanel({ ticker, companyName }) {
  const cache = useCache();
  const [open, setOpen] = useState(() => cache.get('research_task_panel_open') ?? false);
  const [tasks, setTasks] = useState([]);
  const [loadedTicker, setLoadedTicker] = useState('');
  const [roster, setRoster] = useState([]);
  const [newTitle, setNewTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [assigneeFor, setAssigneeFor] = useState(null); // { task, anchorRef }
  const loadSeq = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const upper = ticker ? ticker.toUpperCase() : '';

  const toggleOpen = useCallback((next) => {
    setOpen(prev => {
      const value = typeof next === 'boolean' ? next : !prev;
      cache.set('research_task_panel_open', value);
      return value;
    });
  }, [cache]);

  // Load this ticker's tasks whenever the selected company changes (and only
  // once the panel has been opened — no point fetching for a company the user
  // never expands the rail on). A monotonic sequence guards against a slow
  // response for a previously-selected company landing after a newer one; state
  // is only ever set from the async callback, so `loading` is derived below
  // from `loadedTicker` rather than flipped synchronously here.
  useEffect(() => {
    if (!upper || !open) return;
    const seq = ++loadSeq.current;
    fetchResearchTasks(upper).then(rows => {
      if (seq !== loadSeq.current) return; // superseded by a newer load
      setTasks(rows);
      setLoadedTicker(upper);
    });
  }, [upper, open]);

  // Skeleton shows until the CURRENT ticker's tasks have arrived, which also
  // hides the previous company's list during a switch.
  const loading = open && !!upper && loadedTicker !== upper;

  // Roster is company-independent; load it once the panel is open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchRoster().then(r => { if (alive) setRoster(r); });
    return () => { alive = false; };
  }, [open]);

  const flash = useCallback((msg) => {
    setNotice(msg);
  }, []);

  /* ---- task mutations (optimistic + OCC) ---- */
  const patchTask = useCallback(async (task, updates) => {
    setNotice('');
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, ...updates } : t)));
    const res = await updateResearchTask(task.id, updates, task.version);
    if (res.ok) {
      setTasks(prev => prev.map(t => (t.id === task.id ? res.data : t)));
    } else if (res.conflict && res.current) {
      setTasks(prev => prev.map(t => (t.id === task.id ? res.current : t)));
      flash('This task changed elsewhere — reloaded the latest, please redo your edit.');
    } else {
      // Roll back to server truth to avoid a stuck optimistic state.
      const fresh = await fetchResearchTasks(upper);
      setTasks(fresh);
      flash('Could not save that change.');
    }
  }, [upper, flash]);

  const addTask = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || !upper) return;
    setNewTitle('');
    const res = await createResearchTask(upper, { title });
    if (res.ok && res.data?.id) {
      setTasks(prev => [...prev, res.data]);
    } else {
      flash('Could not add that task.');
      setNewTitle(title);
    }
  }, [newTitle, upper, flash]);

  const removeTask = useCallback(async (task) => {
    setTasks(prev => prev.filter(t => t.id !== task.id));
    const res = await deleteResearchTask(task.id);
    if (!res.ok) {
      const fresh = await fetchResearchTasks(upper);
      setTasks(fresh);
      flash('Could not delete that task.');
    }
  }, [upper, flash]);

  /* ---- roster mutations ---- */
  const addPerson = useCallback((name, color) => {
    setRoster(prev => { const next = addAssigneeToList(prev, name, color); saveRoster(next); return next; });
  }, []);
  const removePerson = useCallback((name) => {
    setRoster(prev => { const next = removeAssigneeFromList(prev, name); saveRoster(next); return next; });
  }, []);

  /* ---- drag-and-drop reorder (single flat list, dnd-kit like /tasks) ----
     Deliberately NOT memoised: it reads `tasks` from the render closure so it
     always sees the latest order, and DndContext re-takes it each render. */
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const snapshot = tasks;
    const oldIndex = snapshot.findIndex(t => t.id === active.id);
    const newIndex = snapshot.findIndex(t => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Optimistically apply the new order + contiguous positions. Versions are
    // left untouched so cards don't remount mid-animation.
    const reordered = arrayMove(snapshot, oldIndex, newIndex).map((t, i) => ({ ...t, position: i }));
    setTasks(reordered);

    const res = await reorderResearchTasks(reordered.map(t => ({ id: t.id, position: t.position })));
    if (!res.ok) {
      setTasks(snapshot);
      flash('Could not reorder tasks.');
      return;
    }
    // The positional write bumped each row's version server-side; resync quietly
    // so later field edits carry a fresh baseVersion (no lost-update false 409s).
    const seq = ++loadSeq.current;
    fetchResearchTasks(upper).then(rows => {
      if (seq === loadSeq.current) setTasks(rows);
    });
  };

  const counts = useMemo(() => {
    const openCount = tasks.filter(t => t.status !== 'done').length;
    return { open: openCount, total: tasks.length };
  }, [tasks]);

  const taskIds = useMemo(() => tasks.map(t => t.id), [tasks]);

  if (!upper) return null;

  // Panel width, kept in sync with the <aside>'s `w-[22rem] max-w-[85vw]` so the
  // protruding tab can ride exactly on the panel's right edge when expanded.
  const PANEL_LEFT = 'min(22rem, 85vw)';

  return (
    <>
      {/* The one protruding "TASKS" tab. It is the SAME box in both states: when
          collapsed it sits on the screen's left edge; when expanded it slides out
          to the panel's right edge (still vertically centred, still protruding),
          and its arrow flips to point back in. Above the panel so it never clips. */}
      <button
        onClick={() => toggleOpen(!open)}
        style={{ left: open ? PANEL_LEFT : '0px' }}
        className="fixed top-1/2 -translate-y-1/2 z-[9999] flex flex-col items-center gap-1.5 bg-white border border-l-0 border-gray-200 rounded-r-xl py-3 px-1.5 shadow-md hover:shadow-lg hover:pl-2.5 transition-all duration-300 group"
        title={open ? 'Hide research tasks' : 'Show research tasks'}
      >
        <TaskHandleContents openCount={counts.open} collapse={open} />
      </button>

      {!open ? null : (
      // Expanded: the full rail. Fixed + overlay, so the page underneath never moves.
      <aside className="fixed left-0 top-20 bottom-0 z-[9998] w-[22rem] max-w-[85vw] bg-white border-r border-gray-200 shadow-xl flex flex-col animate-fade-in-up">
      {/* Header — which company this list belongs to. The collapse control is the
          protruding tab on the right edge, so there's none in the corner. */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Research Tasks</div>
        <div className="text-sm font-semibold text-gray-900 truncate" title={companyName || upper}>
          {upper}{companyName ? ` · ${companyName}` : ''}
        </div>
      </div>

      {/* Add task */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
            placeholder="Add a research task…"
            className="flex-1 text-sm px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-all"
          />
          <button
            onClick={addTask}
            disabled={!newTitle.trim()}
            className="p-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Add task"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 flex items-start gap-2">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} className="text-amber-500 hover:text-amber-700"><X size={12} /></button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="text-sm text-gray-400 mb-1">No tasks yet</div>
            <div className="text-xs text-gray-400">Add research to-dos for {upper} — build the model, analyze utilization rates, and so on.</div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2.5">
                {tasks.map(task => (
                  <TaskCard
                    key={`${task.id}:${task.version}`}
                    task={task}
                    roster={roster}
                    onPatch={patchTask}
                    onDelete={removeTask}
                    onOpenAssignee={(t, anchorRef) => setAssigneeFor({ task: t, anchorRef })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {assigneeFor && (
        <AssigneePicker
          current={assigneeFor.task.assignee}
          roster={roster}
          anchorRef={assigneeFor.anchorRef}
          onSelect={(name) => patchTask(assigneeFor.task, { assignee: name })}
          onAddPerson={addPerson}
          onRemovePerson={removePerson}
          onClose={() => setAssigneeFor(null)}
        />
      )}
      </aside>
      )}
    </>
  );
}
