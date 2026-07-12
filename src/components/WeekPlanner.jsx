'use client';

// Week view of /tasks — a Mon–Sun planner grid. Each task lands in the column
// for its `due_date`; undated tasks sit in the Backlog rail; past-due incomplete
// tasks surface in an Overdue rail so they can be dragged forward. It shares the
// active board's task set with the priority Board view: scheduling a task is just
// setting its date, so a card can live in both views. All persistence is done by
// the parent through the callbacks below — this component owns only view state
// (which week, what's being edited).

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus, X, Check, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, CalendarDays, GripVertical, AlertTriangle, Inbox,
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, pointerWithin, rectIntersection,
} from '@dnd-kit/core';
import { getAssigneeInlineStyle } from '@/lib/taskBoard';
import AssigneeColorDot from '@/components/AssigneeColorDot';
import {
  startOfWeek, addWeeks, weekLabel,
  groupTasksForWeek, dueDateFromDropId, dayDropId,
} from '@/lib/weekPlanner';

const PRIORITY_META = {
  highest: { dot: 'bg-red-500', label: 'High' },
  medium: { dot: 'bg-yellow-400', label: 'Medium' },
  low: { dot: 'bg-emerald-500', label: 'Low' },
};
const PRIORITY_CYCLE = ['highest', 'medium', 'low'];

function nextPriority(current) {
  const idx = PRIORITY_CYCLE.indexOf(current);
  return PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
}

// --- Assignee menu (self-contained; mirrors the board's colour roster) --------

function AssigneeMenu({ current, savedAssignees, onSelect, onSetColor, onClose, align = 'right' }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute z-50 mt-1 ${align === 'left' ? 'left-0' : 'right-0'} w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 max-h-56 overflow-y-auto`}>
        <button
          onClick={() => { onSelect(''); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${!current ? 'font-semibold text-gray-900' : 'text-gray-500'}`}
        >
          Unassigned
        </button>
        {savedAssignees.map(a => (
          <div
            key={a.name}
            className="w-full px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2"
          >
            <AssigneeColorDot color={a.color} onPick={onSetColor ? (c) => onSetColor(a.name, c) : undefined} />
            <button
              onClick={() => { onSelect(a.name); onClose(); }}
              className={`flex-1 text-left ${current?.toLowerCase() === a.name.toLowerCase() ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
            >
              {a.name}
            </button>
          </div>
        ))}
        {savedAssignees.length === 0 && (
          <div className="px-3 py-2 text-xs text-gray-400">No people in this workspace yet — add users in Admin.</div>
        )}
      </div>
    </>
  );
}

// --- One draggable task card --------------------------------------------------

// Static card shown under the cursor while dragging (DragOverlay). Kept separate
// from TaskChip so it doesn't register a second draggable with the same id.
function TaskChipGhost({ task, savedAssignees }) {
  const meta = PRIORITY_META[task.priority] || PRIORITY_META.low;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-lg ring-2 ring-emerald-200 text-sm rotate-1">
      <div className="flex items-center gap-1.5">
        <GripVertical size={13} className="text-gray-300" />
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dot}`} />
        <span className={`flex-1 leading-snug ${task.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</span>
      </div>
      {task.assignee && (
        <div className="flex justify-end mt-1">
          <span className="text-[11px] px-1.5 py-0.5 rounded-full border" style={getAssigneeInlineStyle(task.assignee, savedAssignees)}>
            {task.assignee}
          </span>
        </div>
      )}
    </div>
  );
}

// One compact card used everywhere (day columns, Overdue, Backlog): dense, small
// text, a left gutter (grip + checkbox with the assignee tag stacked below it),
// then the priority dot and a title that clamps at two lines.
//   Backlog cards pass `expandable`: the 2-line clamp gains a More/Less toggle
//   (shown only when the title actually overflows) that reveals the full title,
//   row-synced by the parent so a whole grid row grows/shrinks together.
function TaskChip({ task, savedAssignees, handlers, expandable = false, expanded = false, onToggleExpand }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef(null);
  const titleRef = useRef(null);

  const startEditing = () => { setTitle(task.title); setEditing(true); };
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  // Only show the More/Less toggle when the title actually exceeds the 2-line
  // clamp. Measured via ResizeObserver (its callback fires async, so no
  // setState-in-effect churn) and re-checked whenever the cell resizes.
  useEffect(() => {
    if (!expandable || expanded || editing) return;
    const el = titleRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setOverflowing(el.scrollHeight > el.clientHeight + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [expandable, expanded, editing, task.title]);

  const meta = PRIORITY_META[task.priority] || PRIORITY_META.low;
  const showToggle = expandable && (expanded || overflowing);
  const clampClass = expandable && expanded ? 'whitespace-normal break-words' : 'line-clamp-2';

  const commit = () => {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) handlers.onRename(task.id, trimmed);
    else setTitle(task.title);
  };

  const editInput = (
    <input
      ref={inputRef}
      value={title}
      onChange={e => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setTitle(task.title); setEditing(false); }
      }}
      className="w-full text-xs border border-emerald-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-300"
    />
  );

  return (
    <div
      ref={setNodeRef}
      {...(expandable ? { 'data-backlog-chip': String(task.id) } : {})}
      className={`group relative flex items-start gap-1.5 bg-white border rounded-lg px-2 py-1.5 shadow-sm ${
        task.done ? 'border-gray-100 opacity-60' : 'border-gray-200'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      {/* Left gutter: grip + checkbox, with the assignee tag stacked below.
          Its own column so the assignee's right edge stops before the dot. */}
      <div className="flex flex-col items-start gap-1 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            {...attributes}
            {...listeners}
            className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
            aria-label="Drag task"
          >
            <GripVertical size={11} />
          </button>
          <button
            onClick={() => handlers.onToggleDone(task.id, task.done)}
            className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
              task.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-400'
            }`}
            title={task.done ? 'Mark not done' : 'Mark done'}
          >
            {task.done && <Check size={9} />}
          </button>
        </div>
        <div className="relative">
          {task.assignee ? (
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="inline-flex items-center max-w-[68px] truncate rounded px-1.5 py-0.5 text-[10px] leading-none font-medium"
              style={getAssigneeInlineStyle(task.assignee, savedAssignees)}
              title={`Assigned to ${task.assignee}`}
            >
              {task.assignee}
            </button>
          ) : (
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center justify-center w-[18px] h-[18px] rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-emerald-400 hover:text-emerald-500 transition-colors"
              title="Assign"
            >
              <Plus size={11} />
            </button>
          )}
          {menuOpen && (
            <AssigneeMenu
              current={task.assignee}
              savedAssignees={savedAssignees}
              onSelect={name => handlers.onUpdateAssignee(task.id, name)}
              onSetColor={handlers.onSetColor}
              onClose={() => setMenuOpen(false)}
              align="left"
            />
          )}
        </div>
      </div>

      {/* Right: priority dot + title (wraps to two lines, then ellipsis) */}
      <div className="flex-1 min-w-0 flex items-start gap-1">
        <button
          onClick={() => handlers.onSetPriority(task.id, nextPriority(task.priority))}
          className={`mt-[4px] w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`}
          title={`${meta.label} priority — click to change`}
        />
        {editing ? editInput : (
          <div className="flex-1 min-w-0">
            <div
              ref={titleRef}
              onClick={startEditing}
              className={`text-[11.5px] leading-[1.3] cursor-text ${clampClass} ${task.done ? 'line-through text-gray-400' : 'text-gray-700'}`}
            >
              {task.title}
            </div>
            {showToggle && (
              <button
                onClick={() => onToggleExpand?.(task.id)}
                className="mt-0.5 flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                title={expanded ? 'Collapse row' : 'Expand row'}
              >
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {expanded ? 'Less' : 'More'}
              </button>
            )}
          </div>
        )}
      </div>

      {confirming ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => handlers.onRemove(task.id)}
            className="text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Cancel delete"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          aria-label="Delete task"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

// --- Inline quick-add ---------------------------------------------------------

function QuickAdd({ dueDate, onCreate }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const submit = (keepOpen) => {
    const title = value.trim();
    if (!title) { setOpen(false); return; }
    onCreate({ title, dueDate });
    setValue('');
    if (!keepOpen) setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-1 text-xs text-gray-400 hover:text-emerald-600 px-1 py-1 rounded transition-colors"
      >
        <Plus size={13} /> Add
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => submit(false)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(true); }
        if (e.key === 'Escape') { setValue(''); setOpen(false); }
      }}
      placeholder="Task title…"
      className="w-full text-sm border border-emerald-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-300"
    />
  );
}

// --- Droppable day column -----------------------------------------------------

function DayColumn({ day, tasks, savedAssignees, handlers }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(day.iso) });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-2xl border p-3 min-h-[260px] transition-colors ${
        isOver ? 'border-emerald-400 bg-emerald-50/60'
        : day.isToday ? 'border-emerald-200 bg-emerald-50/30'
        : day.isWeekend ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between px-1 mb-2">
        <span className={`text-xs font-bold uppercase tracking-wide ${day.isToday ? 'text-emerald-600' : 'text-gray-500'}`}>
          {day.dayName}
        </span>
        <span className={`text-sm font-semibold ${day.isToday ? 'text-emerald-600' : 'text-gray-700'}`}>
          {day.dayNum}
        </span>
      </div>
      <div className="flex-1 space-y-2">
        {tasks.map(task => (
          <TaskChip key={task.id} task={task} savedAssignees={savedAssignees} handlers={handlers} />
        ))}
      </div>
      <div className="mt-2">
        <QuickAdd dueDate={day.iso} onCreate={handlers.onCreateTask} />
      </div>
    </div>
  );
}

// --- Droppable horizontal rail (Backlog) --------------------------------------

function BacklogRail({ tasks, savedAssignees, handlers, gridRef, expandedIds, onToggleExpand, demoteActive }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'backlog' });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border p-3 transition-colors ${
        isOver ? 'border-emerald-400 bg-emerald-50/70 ring-2 ring-emerald-200'
        : demoteActive ? 'border-emerald-300 border-dashed bg-emerald-50/30'
        : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Inbox size={15} className="text-gray-400" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Backlog</h3>
        <span className="text-xs text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">{tasks.length}</span>
        <span className="text-xs text-gray-400">— undated; drag onto a day to schedule</span>
      </div>
      {/* Drop-here affordance shown while dragging a scheduled task, so it's
          discoverable that dropping here un-schedules (demotes) it. */}
      {demoteActive && (
        <div className={`mb-2 rounded-xl border-2 border-dashed py-3 text-center text-xs font-medium transition-colors ${
          isOver ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : 'border-emerald-200 text-emerald-500'
        }`}>
          ↩ Drop here to move back to Backlog
        </div>
      )}
      <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 items-stretch">
        {tasks.map(task => (
          <TaskChip
            key={task.id}
            task={task}
            savedAssignees={savedAssignees}
            handlers={handlers}
            expandable
            expanded={expandedIds.has(String(task.id))}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
      <div className="mt-2 max-w-xs">
        <QuickAdd dueDate={null} onCreate={handlers.onCreateTask} />
      </div>
    </div>
  );
}

function OverdueRail({ tasks, savedAssignees, handlers }) {
  if (tasks.length === 0) return null;
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={15} className="text-red-500" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-red-600">Overdue</h3>
        <span className="text-xs text-red-500 border border-red-200 rounded-full px-2 py-0.5">{tasks.length}</span>
        <span className="text-xs text-red-400">— past due; drag onto a day to reschedule</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        {tasks.map(task => (
          <TaskChip key={task.id} task={task} savedAssignees={savedAssignees} handlers={handlers} />
        ))}
      </div>
    </div>
  );
}

// --- The planner -------------------------------------------------------------

export default function WeekPlanner({ tasks, savedAssignees, handlers }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [activeId, setActiveId] = useState(null);
  const [expandedBacklog, setExpandedBacklog] = useState(() => new Set());
  const backlogGridRef = useRef(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Target whatever box the cursor is actually over — pointerWithin resolves the
  // droppable under the pointer immediately, so you don't have to overshoot into
  // a box. Falls back to rect intersection when the pointer is in a gutter/gap.
  const collisionDetection = useCallback((args) => {
    const withinPointer = pointerWithin(args);
    return withinPointer.length > 0 ? withinPointer : rectIntersection(args);
  }, []);

  // Expand/collapse a backlog card and — mirroring the watchlist — every card
  // sharing its visual grid row, so a row grows and shrinks as one. Row members
  // are read from the DOM (cards at the same vertical offset).
  const toggleBacklogExpand = useCallback((id) => {
    const key = String(id);
    const grid = backlogGridRef.current;
    let rowIds = [key];
    if (grid) {
      const chips = [...grid.querySelectorAll('[data-backlog-chip]')];
      const self = chips.find(c => c.getAttribute('data-backlog-chip') === key);
      if (self) {
        const top = self.getBoundingClientRect().top;
        rowIds = chips
          .filter(c => Math.abs(c.getBoundingClientRect().top - top) < 2)
          .map(c => c.getAttribute('data-backlog-chip'));
      }
    }
    setExpandedBacklog(prev => {
      const willExpand = !prev.has(key);
      const next = new Set(prev);
      for (const t of rowIds) { if (willExpand) next.add(t); else next.delete(t); }
      return next;
    });
  }, []);

  const { days, byDay, backlog, overdue, scheduledOtherWeek } = useMemo(
    () => groupTasksForWeek(tasks, weekStart),
    [tasks, weekStart]
  );

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const task = tasks.find(t => t.id === active.id);
    if (!task) return;
    const nextDue = dueDateFromDropId(over.id);
    if (nextDue === undefined) return;            // dropped somewhere irrelevant
    const currentDue = task.due_date || null;
    if ((nextDue || null) === currentDue) return; // no change
    handlers.onSetDueDate(task.id, nextDue);
  };

  const isCurrentWeek = useMemo(
    () => startOfWeek(new Date()).getTime() === weekStart.getTime(),
    [weekStart]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={e => setActiveId(e.active.id)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-emerald-600" />
          <h2 className="text-base font-bold text-gray-900">{weekLabel(weekStart)}</h2>
          {isCurrentWeek && (
            <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              This week
            </span>
          )}
          {scheduledOtherWeek > 0 && (
            <span className="text-xs text-gray-400">{scheduledOtherWeek} scheduled other weeks</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart(w => addWeeks(w, -1))}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(w => addWeeks(w, 1))}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Two rows — Mon–Thu on top, Fri–Sun below — so each day box is larger
          and shows more task text. Horizontally scrollable on narrow screens. */}
      <div className="overflow-x-auto pb-2 space-y-3">
        <div className="grid grid-cols-4 gap-3 min-w-[640px]">
          {days.slice(0, 4).map(day => (
            <DayColumn
              key={day.iso}
              day={day}
              tasks={byDay[day.iso] || []}
              savedAssignees={savedAssignees}
              handlers={handlers}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 min-w-[640px]">
          {days.slice(4).map(day => (
            <DayColumn
              key={day.iso}
              day={day}
              tasks={byDay[day.iso] || []}
              savedAssignees={savedAssignees}
              handlers={handlers}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <OverdueRail tasks={overdue} savedAssignees={savedAssignees} handlers={handlers} />
        <BacklogRail
          tasks={backlog}
          savedAssignees={savedAssignees}
          handlers={handlers}
          gridRef={backlogGridRef}
          expandedIds={expandedBacklog}
          onToggleExpand={toggleBacklogExpand}
          demoteActive={!!(activeTask && activeTask.due_date)}
        />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-56">
            <TaskChipGhost task={activeTask} savedAssignees={savedAssignees} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
