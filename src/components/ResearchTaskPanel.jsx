'use client';

// ResearchTaskPanel — the collapsible left rail shared by the Draft & Review,
// Research, and Position Review pages. It is a structured to-do list scoped to
// the company currently open (one ticker): "build the model", "analyze
// utilization rates", etc. Each item carries a status, an optional assignee (the
// person responsible, picked from the workspace's users — the same people the
// /tasks board assigns from, sourced from /api/workspace-users), free-form tags,
// and notes.
//
// It is a fixed overlay: collapsing/expanding only toggles visibility, it never
// reflows the page underneath (per the design — "nothing moves around, it's just
// visible or not"). Render it only when a ticker is selected; it returns null
// otherwise. Persistence and concurrency reuse existing app infrastructure (see
// researchTaskApi).

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, User, Tag as TagIcon, ChevronDown,
  ClipboardList, GripVertical, Flag, Check,
} from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCache } from '@/lib/CacheContext';
import { getAssigneeInlineStyle } from '@/lib/taskBoard';
import { fetchWorkspaceUsers, saveWorkspaceUserColor } from '@/lib/taskBoardApi';
import AssigneeColorDot from '@/components/AssigneeColorDot';
import {
  fetchResearchTasks,
  createResearchTask,
  updateResearchTask,
  deleteResearchTask,
  reorderResearchTasks,
} from '@/lib/researchTaskApi';

const STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'done'];
const STATUS_META = {
  todo:        { label: 'To Do',       dot: 'bg-gray-300',    chip: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'In Progress', dot: 'bg-blue-500',    chip: 'bg-blue-50 text-blue-700' },
  blocked:     { label: 'Blocked',     dot: 'bg-red-500',     chip: 'bg-red-50 text-red-700' },
  done:        { label: 'Done',        dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
};

// Priority is chosen from the pill dropdown on each card. The list is kept
// ordered by tier — High at the top, Medium in the middle, Low at the bottom —
// and drag-to-reorder only works WITHIN a tier (dragging a card into a different
// tier is rejected on drop).
const PRIORITY_ORDER = ['high', 'medium', 'low'];
const PRIORITY_META = {
  high:   { label: 'High',   dot: 'bg-red-500',    chip: 'bg-red-50 text-red-700' },
  medium: { label: 'Medium', dot: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700' },
  low:    { label: 'Low',    dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
};
// A task's tier, normalising any unexpected value to 'medium'.
const tierOf = (t) => (t?.priority === 'high' || t?.priority === 'low' ? t.priority : 'medium');
// One tier's tasks in manual (position) order.
const tasksInTier = (tasks, tier) =>
  tasks.filter(t => tierOf(t) === tier).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

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
 * Assignee picker — pick from the workspace's users (managed in Admin)
 * ------------------------------------------------------------------ */
function AssigneePicker({ current, roster, onSelect, onSetColor, onClose, anchorRef }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest?.('[data-assignee-color-pop]')) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      data-rtp-popover
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
      {roster.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">
          No people in this workspace yet. Add users in Admin.
        </div>
      ) : (
        roster.map(({ name: n, color: c }) => (
          <div
            key={n}
            className={`w-full px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 ${current?.toLowerCase() === n.toLowerCase() ? 'font-semibold' : ''}`}
          >
            <AssigneeColorDot color={c} onPick={onSetColor ? (color) => onSetColor(n, color) : undefined} />
            <button onClick={() => { onSelect(n); onClose(); }} className="flex-1 text-left">
              {n}
            </button>
          </div>
        ))
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
 * EditableText — a self-contained auto-saving, auto-growing text field. This is
 * the ONE place text-field save behaviour lives, so every editable text in the
 * panel saves the same, reliable way:
 *
 *   • The live value is mirrored into a ref on every keystroke, and commits read
 *     that ref — never React state — so "type then click off immediately" saves
 *     the exact text on screen (no lost last keystroke, no stale-state skip).
 *   • Commits fire on blur, on Enter (single-line), AND on unmount — so switching
 *     company or collapsing the panel with an uncommitted edit still saves it.
 *   • It only calls onCommit when the value actually changed, so viewing a task
 *     never triggers a needless write.
 *   • It auto-grows to fit its content (long titles/notes are fully visible).
 * ------------------------------------------------------------------ */
function EditableText({ initialValue = '', onCommit, singleLine = false, minRows = 1, className = '', ...props }) {
  const [value, setValue] = useState(initialValue);
  const valueRef = useRef(initialValue);       // live value, updated synchronously
  const committedRef = useRef(initialValue);   // last value handed to onCommit
  const onCommitRef = useRef(onCommit);         // freshest callback (set in effect)
  const taRef = useRef(null);

  useEffect(() => { onCommitRef.current = onCommit; });

  const resize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(() => { resize(); }, [value, resize]);

  const commit = useCallback(() => {
    const raw = valueRef.current;
    const cleaned = singleLine ? raw.trim() : raw;
    if (cleaned === committedRef.current) return;      // nothing changed
    if (singleLine && !cleaned) {                       // never save an empty title
      valueRef.current = committedRef.current;
      setValue(committedRef.current);
      return;
    }
    committedRef.current = cleaned;
    onCommitRef.current?.(cleaned);
  }, [singleLine]);

  // Flush a pending edit if the field unmounts (ticker switch / panel collapse).
  useEffect(() => () => commit(), [commit]);

  return (
    <textarea
      ref={taRef}
      value={value}
      rows={minRows}
      onChange={(e) => { valueRef.current = e.target.value; setValue(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); e.target.blur(); }
      }}
      className={`resize-none overflow-hidden ${className}`}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Task card — one to-do item. Sortable: it renders its own drag handle
 * (matching the /tasks board) via dnd-kit's useSortable.
 * ------------------------------------------------------------------ */
function TaskCard({ task, roster, onPatch, onChangePriority, onDelete, onOpenAssignee }) {
  // The card is keyed by id only (it does NOT remount on save). Text fields own
  // their own edit state inside EditableText and save themselves reliably, so all
  // this card does is forward the committed value up via onPatch.
  const [showNotes, setShowNotes] = useState(Boolean(task.notes));
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        <EditableText
          initialValue={task.title}
          onCommit={val => onPatch(task, { title: val })}
          singleLine
          placeholder="Task…"
          className={`flex-1 min-w-0 text-sm bg-transparent outline-none leading-snug break-words ${done ? 'line-through text-gray-400' : 'text-gray-900'}`}
        />
        {confirmDelete ? (
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            <button
              onClick={() => onDelete(task)}
              className="text-[10px] font-bold text-white bg-red-500 hover:bg-red-600 px-1.5 py-0.5 rounded transition-colors"
              title="Confirm delete"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-gray-300 hover:text-gray-500 transition-colors"
              title="Cancel"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all flex-shrink-0 mt-0.5"
            title="Delete task"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-1.5">
          <SelectPill value={task.status} order={STATUS_ORDER} meta={STATUS_META} fallback="todo" onChange={s => onPatch(task, { status: s })} />
          <SelectPill value={tierOf(task)} order={PRIORITY_ORDER} meta={PRIORITY_META} fallback="medium" icon={Flag} onChange={p => onChangePriority(task, p)} />
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
        <EditableText
          initialValue={task.notes || ''}
          onCommit={val => onPatch(task, { notes: val })}
          minRows={2}
          placeholder="Notes…"
          autoFocus={!task.notes}
          className="mt-2 w-full text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-emerald-200"
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
  const [saved, setSaved] = useState(false); // transient "Saved" confirmation pill
  const loadSeq = useRef(0);
  const savedTimer = useRef(null);
  const panelRef = useRef(null);
  const tabRef = useRef(null);

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

  // Load this ticker's tasks whenever the selected company changes — even while
  // collapsed, so the count badge on the tab is accurate before the panel is ever
  // opened. A monotonic sequence guards against a slow response for a previously-
  // selected company landing after a newer one; state is only ever set from the
  // async callback, so `loading` is derived below from `loadedTicker` rather than
  // flipped synchronously here.
  useEffect(() => {
    if (!upper) return;
    const seq = ++loadSeq.current;
    fetchResearchTasks(upper).then(rows => {
      if (seq !== loadSeq.current) return; // superseded by a newer load
      setTasks(rows);
      setLoadedTicker(upper);
    });
  }, [upper]);

  // Skeleton shows until the CURRENT ticker's tasks have arrived, which also
  // hides the previous company's list during a switch.
  const loading = !!upper && loadedTicker !== upper;

  // The assignable people are the workspace's users (managed in Admin), shared
  // across every company; load them once the panel is open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchWorkspaceUsers().then(r => { if (alive) setRoster(r); }).catch(() => {});
    return () => { alive = false; };
  }, [open]);

  // Recolour a person's assignee tag: optimistic roster update + persist per-tenant.
  const setAssigneeColor = useCallback((name, color) => {
    setRoster(prev => prev.map(p => p.name === name ? { ...p, color } : p));
    saveWorkspaceUserColor(name, color).catch(() => {});
  }, []);

  const flash = useCallback((msg) => {
    setNotice(msg);
  }, []);

  // Brief "Saved" confirmation, shown after a successful edit (blur/Enter save,
  // status/priority/tag/assignee change). Auto-hides after a moment.
  const flashSaved = useCallback(() => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  }, []);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  // Click-off-to-close: while the panel is open, a click anywhere on the main
  // screen collapses it. Clicks on the panel itself, its protruding TASKS tab, or
  // any portaled popover it owns (the assignee picker, tagged `data-rtp-popover`)
  // are ignored so interacting with the panel never closes it.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e) => {
      const t = e.target;
      if (panelRef.current?.contains(t)) return;
      if (tabRef.current?.contains(t)) return;
      if (t.closest?.('[data-rtp-popover]')) return;
      toggleOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, toggleOpen]);

  /* ---- task mutations (optimistic, last-write-wins) ----
     Apply the change locally, then persist with a plain PUT. No version tokens:
     the server does a direct UPDATE, so a save always lands and rapid back-to-back
     edits never bounce off a stale-version 409. */
  const patchTask = async (task, updates) => {
    setNotice('');
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, ...updates } : t)));
    const res = await updateResearchTask(task.id, updates);
    if (res.ok) {
      setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, ...res.data } : t)));
      flashSaved();
    } else {
      // Reload server truth so the UI can't get stuck showing an unsaved value.
      const fresh = await fetchResearchTasks(upper);
      setTasks(fresh);
      flash('Could not save that change — please try again.');
    }
  };

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

  /* ---- drag-and-drop reorder, constrained to a single priority tier ----
     Reordering only happens WITHIN a tier (high/medium/low). Dragging a card over
     a card in another tier is rejected on drop, so it snaps back. Priority itself
     is changed via the card's priority pill, not by dragging. Computed on drop
     from a render-closure snapshot; NOT memoised so it always sees fresh `tasks`. */
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || over.id === active.id) return;

    const snapshot = tasks;
    const activeTask = snapshot.find(t => t.id === active.id);
    const overTask = snapshot.find(t => t.id === over.id);
    if (!activeTask || !overTask) return;

    // Cross-tier drags don't reorder — only same-tier moves are allowed.
    const tier = tierOf(activeTask);
    if (tier !== tierOf(overTask)) return;

    const items = tasksInTier(snapshot, tier);
    const oldIndex = items.findIndex(t => t.id === active.id);
    const newIndex = items.findIndex(t => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

    // Reorder within the tier and give the tier contiguous positions.
    const reordered = arrayMove(items, oldIndex, newIndex).map((t, i) => ({ ...t, position: i }));
    const pos = new Map(reordered.map(t => [t.id, t.position]));
    setTasks(snapshot.map(t => (pos.has(t.id) ? { ...t, position: pos.get(t.id) } : t)));

    const changed = reordered
      .filter(t => { const o = snapshot.find(s => s.id === t.id); return o && o.position !== t.position; })
      .map(t => ({ id: t.id, position: t.position }));
    if (changed.length) {
      const res = await reorderResearchTasks(changed);
      if (!res.ok) { setTasks(snapshot); flash('Could not reorder tasks.'); return; }
    }
    // Resync quietly so positions reflect exactly what the server stored.
    const seq = ++loadSeq.current;
    fetchResearchTasks(upper).then(rows => {
      if (seq === loadSeq.current) setTasks(rows);
    });
  };

  // Change a card's priority from its pill. The task moves to the bottom of its
  // new tier (a fresh position past everything already there), carried on the
  // same OCC-guarded PUT that sets the priority.
  const changePriority = async (task, p) => {
    if (tierOf(task) === p) return;
    const dest = tasksInTier(tasks, p);
    const nextPos = dest.length ? Math.max(...dest.map(t => t.position ?? 0)) + 1 : 0;
    await patchTask(task, { priority: p, position: nextPos });
  };

  const counts = useMemo(() => {
    const openCount = tasks.filter(t => t.status !== 'done').length;
    return { open: openCount, total: tasks.length };
  }, [tasks]);

  // Tasks grouped by tier for rendering — High, then Medium, then Low — each in
  // its own manual (position) order.
  const byTier = useMemo(
    () => PRIORITY_ORDER.map(tier => ({ tier, items: tasksInTier(tasks, tier) })),
    [tasks]
  );

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
        ref={tabRef}
        onClick={() => toggleOpen(!open)}
        style={{ left: open ? PANEL_LEFT : '0px' }}
        className="fixed top-1/2 -translate-y-1/2 z-[9999] flex flex-col items-center gap-1.5 bg-white border border-l-0 border-gray-200 rounded-r-xl py-3 px-1.5 shadow-md hover:shadow-lg hover:pl-2.5 transition-all duration-300 group"
        title={open ? 'Hide research tasks' : 'Show research tasks'}
      >
        <TaskHandleContents openCount={counts.open} collapse={open} />
      </button>

      {!open ? null : (
      // Expanded: the full rail. Fixed + overlay, so the page underneath never moves.
      <aside ref={panelRef} className="fixed left-0 top-20 bottom-0 z-[9998] w-[22rem] max-w-[85vw] bg-white border-r border-gray-200 shadow-xl flex flex-col animate-fade-in-up">
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
          // One continuous list ordered High → Medium → Low. Each tier is its own
          // SortableContext, so a card only reorders among its own tier's cards;
          // dragging across tiers is rejected on drop (snaps back).
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="space-y-2.5">
              {byTier.map(({ tier, items }) => (
                <SortableContext key={tier} items={items.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {items.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      roster={roster}
                      onPatch={patchTask}
                      onChangePriority={changePriority}
                      onDelete={removeTask}
                      onOpenAssignee={(t, anchorRef) => setAssigneeFor({ task: t, anchorRef })}
                    />
                  ))}
                </SortableContext>
              ))}
            </div>
          </DndContext>
        )}
      </div>

      {assigneeFor && (
        <AssigneePicker
          current={assigneeFor.task.assignee}
          roster={roster}
          anchorRef={assigneeFor.anchorRef}
          onSelect={(name) => patchTask(assigneeFor.task, { assignee: name })}
          onSetColor={setAssigneeColor}
          onClose={() => setAssigneeFor(null)}
        />
      )}

      {/* Transient "Saved" confirmation — appears when an edit is committed
          (clicking off a field, pressing Enter, or changing status/priority). */}
      <div
        className={`pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-900 text-white text-[11px] font-semibold shadow-lg transition-all duration-200 ${
          saved ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
      >
        <Check size={12} className="text-emerald-400" /> Saved
      </div>
      </aside>
      )}
    </>
  );
}
