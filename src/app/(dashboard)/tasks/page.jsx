'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Check, ChevronDown, ChevronRight, User, Pencil, GripVertical, Trash2, Circle } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  COLOR_PALETTE,
  PRIORITY_SECTIONS,
  addAssignee as addAssigneeToList,
  addSubtask as addSubtaskToTask,
  completedTasks as selectCompletedTasks,
  createBoard as createBoardState,
  finalizeTaskDrag,
  findPriority,
  getAssigneeInlineStyle,
  getMaxForPriority,
  insertBlankSubtaskAfter,
  moveTaskAcrossPriority,
  openTaskCount,
  removeAssignee as removeAssigneeFromList,
  removeBoard as removeBoardState,
  removeEmptySubtask,
  removeSubtask as removeSubtaskFromTask,
  renameBoard as renameBoardState,
  renameSubtask as renameSubtaskInTask,
  resolveBoardsPayload,
  tasksByPriority as selectTasksByPriority,
  toggleSubtask as toggleSubtaskInTask,
  updateSubtask as updateSubtaskInTask,
  updateSubtasks as replaceTaskSubtasks,
} from '@/lib/taskBoard';
import WeekPlanner from '@/components/WeekPlanner';
import Horizons from '@/components/Horizons';
import {
  createTask,
  deleteTask,
  deleteTasksForBoard,
  fetchAssigneesForBoard,
  fetchTaskBoards,
  fetchTasksForBoard,
  reorderTasks,
  saveAssigneesForBoard,
  saveTaskBoardsMeta,
  updateTask,
} from '@/lib/taskBoardApi';

function AssigneeTag({ assignee, onClick, size = 'normal', savedAssignees = [] }) {
  if (!assignee) {
    return (
      <button
        onClick={onClick}
        className={`opacity-0 group-hover:opacity-100 group-hover/sub:opacity-100 p-0.5 text-gray-400 hover:text-gray-600 transition-all duration-200`}
        title="Assign"
      >
        <User size={size === 'small' ? 12 : 14} />
      </button>
    );
  }
  const sizeClasses = size === 'small' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5';
  return (
    <button
      onClick={onClick}
      className={`font-medium rounded-full border transition-colors hover:opacity-80 ${sizeClasses}`}
      style={getAssigneeInlineStyle(assignee, savedAssignees)}
    >
      {assignee}
    </button>
  );
}

function AssigneePicker({ current, onSelect, onClose, anchorRef, savedAssignees = [], onAddAssignee, onRemoveAssignee }) {
  const [customValue, setCustomValue] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(null);
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleAddPerson = () => {
    const name = customValue.trim();
    if (!name) return;
    if (onAddAssignee) onAddAssignee(name, selectedColor);
    onSelect(name);
    onClose();
  };

  return createPortal(
    <div ref={ref} style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)' }} className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[160px]">
      {savedAssignees.map(({ name, color }) => (
        <div
          key={name}
          className="group/row flex items-center hover:bg-gray-50 transition-colors"
        >
          <button
            onClick={() => { onSelect(name); onClose(); }}
            className={`flex-1 text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
              current?.toLowerCase() === name.toLowerCase() ? 'font-semibold' : ''
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            {name}
          </button>
          {onRemoveAssignee && confirmingRemove === name ? (
            <div className="flex items-center gap-1 pr-2" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setConfirmingRemove(null)}
                className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors"
              >
                No
              </button>
              <button
                onClick={() => { onRemoveAssignee(name); setConfirmingRemove(null); }}
                className="text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded hover:bg-red-600 transition-colors"
              >
                Yes
              </button>
            </div>
          ) : onRemoveAssignee ? (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmingRemove(name); }}
              className="opacity-0 group-hover/row:opacity-100 pr-2 text-gray-300 hover:text-red-500 transition-all"
              title={`Remove ${name}`}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ))}

      <div className="border-t border-gray-100 mt-1 pt-1">
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center gap-2"
          >
            <Plus size={12} />
            Add person...
          </button>
        ) : (
          <div className="px-2.5 pb-2 pt-1 space-y-2">
            <input
              type="text" spellCheck={true}
              placeholder="Name..."
              value={customValue}
              onChange={e => setCustomValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddPerson();
                if (e.key === 'Escape') { setShowAddForm(false); setCustomValue(''); }
              }}
              autoFocus
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  className={`w-5 h-5 rounded-full transition-all ${selectedColor === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {customValue.trim() && (
                <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: selectedColor }}>
                  {customValue.trim()}
                </span>
              )}
              <button
                onClick={handleAddPerson}
                disabled={!customValue.trim()}
                className="ml-auto text-xs px-2 py-1 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-30 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {current && (
        <button
          onClick={() => { onSelect(''); onClose(); }}
          className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors border-t border-gray-100 mt-1"
        >
          Remove assignee
        </button>
      )}
    </div>,
    document.body
  );
}

const STATUS_OPTIONS = [
  { value: '',          label: 'No status',     color: 'transparent', textColor: 'text-gray-400', bg: '' },
  { value: 'working',   label: 'Working on it', color: '#f59e0b', textColor: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
  { value: 'stuck',     label: 'Stuck',         color: '#ef4444', textColor: 'text-red-700',     bg: 'bg-red-50 border-red-200' },
  { value: 'waiting',   label: 'Waiting',       color: '#8b5cf6', textColor: 'text-violet-700',  bg: 'bg-violet-50 border-violet-200' },
  { value: 'review',    label: 'In review',     color: '#3b82f6', textColor: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
];

function StatusTag({ status, onClick, size = 'normal', groupClass = 'group-hover:opacity-100' }) {
  const opt = STATUS_OPTIONS.find(o => o.value === (status || '')) || STATUS_OPTIONS[0];
  if (!status) {
    return (
      <button
        onClick={onClick}
        className={`opacity-0 ${groupClass} p-0.5 text-gray-400 hover:text-gray-600 transition-all duration-200`}
        title="Set status"
      >
        <Circle size={size === 'small' ? 12 : 14} />
      </button>
    );
  }
  const sizeClasses = size === 'small' ? 'text-[10px] px-1.5 py-0' : 'text-[11px] px-2 py-0.5';
  return (
    <button
      onClick={onClick}
      className={`font-semibold rounded-full border transition-colors hover:opacity-80 ${sizeClasses} ${opt.bg} ${opt.textColor}`}
    >
      {opt.label}
    </button>
  );
}

function StatusPicker({ current, onSelect, onClose, anchorRef }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return createPortal(
    <div ref={ref} style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)' }} className="z-[9999] bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[150px]">
      {STATUS_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => { onSelect(opt.value); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${
            (current || '') === opt.value ? 'font-semibold' : ''
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-gray-200" style={{ backgroundColor: opt.color || '#e5e7eb' }} />
          {opt.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

function SortableTaskRow({ task, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  // Only apply Y-axis translation to prevent horizontal jitter
  const yOnly = transform ? { ...transform, x: 0 } : null;
  const smoothTransition = transition || 'transform 250ms cubic-bezier(0.25, 1, 0.5, 1), opacity 200ms ease';

  const style = {
    transform: CSS.Transform.toString(yOnly),
    transition: smoothTransition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative',
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ dragHandleProps: listeners })}
    </div>
  );
}

function DroppableSection({ id, isEmpty, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const showHighlight = isOver && isEmpty;
  const innerRef = useRef(null);
  const [height, setHeight] = useState('auto');

  useEffect(() => {
    if (!innerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });
    ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[2rem] rounded-xl overflow-hidden ${showHighlight ? 'bg-emerald-50/60 ring-2 ring-emerald-200 ring-inset' : ''}`}
      style={{ height: typeof height === 'number' ? height : 'auto', transition: 'height 300ms cubic-bezier(0.25, 1, 0.5, 1)' }}
    >
      <div ref={innerRef}>
        {children}
      </div>
    </div>
  );
}

function BoardSelector({ boards, activeBoardId, onSwitch, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  // Measure the trigger and toggle in the click handler (where ref access is fine)
  // rather than reading the ref during render.
  const toggleOpen = () => {
    const next = !open;
    if (next && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left });
    }
    setOpen(next);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setOpen(false);
        setCreatingNew(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeBoard = boards.find(b => b.id === activeBoardId) || boards[0];

  if (!activeBoard) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900">&nbsp;</h1>
      </div>
    );
  }

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
      className="z-[9999] bg-white border border-gray-200 rounded-2xl shadow-xl py-2 min-w-[260px] max-h-80 overflow-y-auto"
    >
      {boards.map(board => (
        <div
          key={board.id}
          onClick={() => {
            if (renamingId || confirmDeleteId) return;
            onSwitch(board.id);
            setOpen(false);
          }}
          className={`group/row flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
            board.id === activeBoardId ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'
          }`}
        >
          {renamingId === board.id ? (
            <form
              className="flex-1 flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (renameValue.trim()) {
                  onRename(board.id, renameValue.trim());
                  setRenamingId(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button type="submit" className="p-1 text-emerald-600 hover:text-emerald-700">
                <Check size={14} />
              </button>
            </form>
          ) : confirmDeleteId === board.id ? (
            <div className="flex-1 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <span className="text-sm text-red-600">Delete?</span>
              <button
                onClick={() => { onDelete(board.id); setConfirmDeleteId(null); setOpen(false); }}
                className="text-xs px-2 py-0.5 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"
              >
                No
              </button>
            </div>
          ) : (
            <>
              <span className="flex-1 text-sm text-gray-800">{board.name}</span>
              <div className="opacity-0 group-hover/row:opacity-100 flex items-center gap-1 transition-opacity" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { setRenamingId(board.id); setRenameValue(board.name); setConfirmDeleteId(null); }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <Pencil size={13} />
                </button>
                {boards.length > 1 && (
                  <button
                    onClick={() => { setConfirmDeleteId(board.id); setRenamingId(null); }}
                    className="p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="border-t border-gray-100 mt-1 pt-1">
        {!creatingNew ? (
          <button
            onClick={(e) => { e.stopPropagation(); setCreatingNew(true); setNewName(''); }}
            className="w-full text-left px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors flex items-center gap-2"
          >
            <Plus size={14} />
            New board...
          </button>
        ) : (
          <form
            className="px-3 py-2 flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) {
                onCreate(newName.trim());
                setCreatingNew(false);
                setNewName('');
                setOpen(false);
              }
            }}
            onClick={e => e.stopPropagation()}
          >
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setCreatingNew(false); }}
              placeholder="Board name..."
              className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button type="submit" disabled={!newName.trim()} className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-30">
              <Check size={14} />
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div>
      <div
        ref={triggerRef}
        onClick={toggleOpen}
        className="flex items-center gap-2 cursor-pointer group"
      >
        <h1 className="text-3xl font-bold text-gray-900">{activeBoard?.name || 'Task Board'}</h1>
        <ChevronDown size={20} className={`text-gray-400 group-hover:text-gray-600 transition-all ${open ? 'rotate-180' : ''}`} />
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{boards.length}</span>
      </div>
      {dropdown}
    </div>
  );
}

export default function TaskBoardPage() {
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('board'); // 'board' (priority sections) | 'week' (Mon–Sun planner) | 'horizons' (long-term strategy)
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingNotes, setEditingNotes] = useState('');
  const [expandedTasks, setExpandedTasks] = useState(new Set());
  const [addingSubtask, setAddingSubtask] = useState(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(null);     // 'task-{id}' or 'sub-{taskId}-{subId}'
  const [statusPickerOpen, setStatusPickerOpen] = useState(null);        // 'task-{id}'
  const [editingSubId, setEditingSubId] = useState(null);                 // '{taskId}-{subId}'
  const [editingSubTitle, setEditingSubTitle] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [savedAssignees, setSavedAssignees] = useState([]);
  const [capacityFlash, setCapacityFlash] = useState(null); // section key that's full
  const [pendingDelete, setPendingDelete] = useState(null); // 'task-{id}' or 'sub-{taskId}-{subId}'
  const tasksSnapshot = useRef(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const editRef = useRef(null);
  const subEditRef = useRef(null);
  const assigneeAnchorRefs = useRef({});
  const statusAnchorRefs = useRef({});
  const capacityFlashTimer = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const lastOverId = useRef(null);
  const lastOverTime = useRef(0);
  const stableCollision = useCallback((args) => {
    const { droppableRects, droppableContainers, collisionRect } = args;
    if (!collisionRect) return closestCenter(args);

    const pointerY = collisionRect.top + collisionRect.height / 2;

    // Score by vertical distance only — prevents skipping over adjacent tasks
    const collisions = [];
    for (const container of droppableContainers) {
      const rect = droppableRects.get(container.id);
      if (!rect) continue;
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(pointerY - centerY);
      // Only match if pointer is within the vertical bounds (with some padding)
      if (pointerY >= rect.top - 10 && pointerY <= rect.bottom + 10) {
        collisions.push({ id: container.id, data: { droppableContainer: container, value: dist } });
      }
    }

    // Sort by distance, closest first
    collisions.sort((a, b) => a.data.value - b.data.value);

    // If nothing in range, fall back to closestCenter
    if (!collisions.length) return closestCenter(args);

    const topId = collisions[0].id;
    const now = Date.now();
    // Require pointer to hover over new target for 100ms before switching
    if (topId !== lastOverId.current) {
      if (now - lastOverTime.current < 100) {
        const prev = collisions.find(c => c.id === lastOverId.current);
        return prev ? [prev] : collisions;
      }
      lastOverId.current = topId;
      lastOverTime.current = now;
    }
    return collisions;
  }, []);

  const fetchTasks = useCallback(async (boardId) => {
    const bid = boardId || activeBoardId;
    setLoading(true);
    try {
      const data = await fetchTasksForBoard(bid);
      if (Array.isArray(data)) setTasks(data);
    } catch (err) {
      console.error('Failed to load tasks', err);
    } finally {
      setLoading(false);
    }
  }, [activeBoardId]);

  const fetchAssignees = useCallback(async (boardId) => {
    const bid = boardId || activeBoardId;
    try {
      const data = await fetchAssigneesForBoard(bid);
      if (Array.isArray(data.assignees) && data.assignees.length > 0) {
        setSavedAssignees(data.assignees);
      } else {
        setSavedAssignees([]);
      }
    } catch (err) {
      console.error('Failed to load assignees', err);
      setSavedAssignees([]);
    }
  }, [activeBoardId]);

  const fetchBoards = useCallback(async () => {
    try {
      const data = await fetchTaskBoards();
      const resolved = resolveBoardsPayload(data);
      setBoards(resolved.boards);
      setActiveBoardId(resolved.activeBoardId);
      return resolved.activeBoardId;
    } catch (err) {
      console.error('Failed to load boards', err);
    }
    return 'default';
  }, []);

  useEffect(() => {
    (async () => {
      const boardId = await fetchBoards();
      fetchTasks(boardId);
      fetchAssignees(boardId);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveBoardsMeta = async (newBoards, newActiveId) => {
    try {
      await saveTaskBoardsMeta({ boards: newBoards, activeBoardId: newActiveId });
    } catch (err) {
      console.error('Failed to save boards', err);
    }
  };

  const switchBoard = async (boardId) => {
    if (boardId === activeBoardId) return;
    setActiveBoardId(boardId);
    setSavedAssignees([]);
    saveBoardsMeta(undefined, boardId);
    fetchTasks(boardId);
    fetchAssignees(boardId);
  };

  const createBoard = async (name) => {
    const next = createBoardState(boards, name);
    setBoards(next.boards);
    setActiveBoardId(next.activeBoardId);
    setTasks([]);
    setSavedAssignees([]);
    saveBoardsMeta(next.boards, next.activeBoardId);
  };

  const renameBoard = async (id, name) => {
    const newBoards = renameBoardState(boards, id, name);
    setBoards(newBoards);
    saveBoardsMeta(newBoards, undefined);
  };

  const deleteBoard = async (id) => {
    const next = removeBoardState(boards, activeBoardId, id);
    if (!next) return;
    setBoards(next.boards);
    setActiveBoardId(next.activeBoardId);
    saveBoardsMeta(next.boards, next.activeBoardId);
    if (activeBoardId === id) fetchTasks(next.activeBoardId);
    try {
      await deleteTasksForBoard(id);
    } catch (err) {
      console.error('Failed to delete board tasks', err);
    }
  };

  const addAssignee = useCallback(async (name, color) => {
    const updated = addAssigneeToList(savedAssignees, name, color);
    if (updated === savedAssignees) return;
    setSavedAssignees(updated);
    try {
      await saveAssigneesForBoard(activeBoardId, updated);
    } catch (err) {
      console.error('Failed to save assignees', err);
    }
  }, [savedAssignees, activeBoardId]);

  const removeAssignee = useCallback(async (name) => {
    const updated = removeAssigneeFromList(savedAssignees, name);
    setSavedAssignees(updated);
    try {
      await saveAssigneesForBoard(activeBoardId, updated);
    } catch (err) {
      console.error('Failed to save assignees', err);
    }
  }, [savedAssignees, activeBoardId]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
      // Auto-size textarea to fit content
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
    }
  }, [editingId]);

  useEffect(() => {
    if (editingSubId && subEditRef.current) {
      subEditRef.current.focus();
      subEditRef.current.select();
      subEditRef.current.style.height = 'auto';
      subEditRef.current.style.height = subEditRef.current.scrollHeight + 'px';
    }
  }, [editingSubId]);


  const tasksByPriority = (key) => selectTasksByPriority(tasks, key);
  const completedTasks = selectCompletedTasks(tasks);
  const [completedOpen, setCompletedOpen] = useState(false);
  const totalOpen = openTaskCount(tasks);

  // --- Task CRUD ---

  const handleAddTask = async (priority, { keepOpen = false } = {}) => {
    if (!newTaskTitle.trim()) return;
    const max = getMaxForPriority(priority);
    const currentCount = tasks.filter(t => t.priority === priority && !t.done).length;
    if (max && currentCount >= max) return;
    const title = newTaskTitle.trim();
    setNewTaskTitle('');
    const willBeAtCapacity = max && currentCount + 1 >= max;
    if (!keepOpen || willBeAtCapacity) setAdding(null);
    try {
      const { ok, data } = await createTask({ title, priority, boardId: activeBoardId });
      if (ok) setTasks(prev => [...prev, data]);
    } catch (err) {
      console.error('Failed to add task', err);
    }
  };

  // Version-guarded task save shared by every edit path. Looks up the task's loaded
  // version, sends it, and on a conflict adopts the server's fresh row (incl. its
  // new version) instead of clobbering a concurrent edit; on a plain failure runs
  // the caller's revert; on success stamps the new version so the next edit guards
  // against the right row.
  const persistTask = useCallback(async (id, updates, revert) => {
    const base = tasksRef.current.find(t => t.id === id)?.version;
    let res;
    try {
      res = await updateTask(id, updates, base);
    } catch {
      revert?.();
      return;
    }
    if (res.conflict && res.current) {
      setTasks(prev => prev.map(t => t.id === id ? res.current : t));
      return;
    }
    if (!res.ok) { revert?.(); return; }
    const v = res.data?.version;
    if (typeof v === 'number') setTasks(prev => prev.map(t => t.id === id ? { ...t, version: v } : t));
  }, []);

  const toggleDone = async (id, currentDone) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !currentDone } : t));
    await persistTask(id, { done: !currentDone },
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, done: currentDone } : t)));
  };

  const removeTask = async (id) => {
    const prev = tasks;
    setTasks(t => t.filter(x => x.id !== id));
    try {
      await deleteTask(id);
    } catch (err) {
      setTasks(prev);
    }
  };

  const startEditing = (task) => {
    setEditingId(task.id);
    setEditingTitle(task.title);
    setEditingNotes(task.notes || '');
  };

  const saveEdit = async (id, { thenAddTask = false } = {}) => {
    const task = tasks.find(t => t.id === id);
    if (!task) { setEditingId(null); return; }

    const newTitle = editingTitle.trim() || task.title;
    const newNotes = editingNotes.trim();
    const titleChanged = newTitle !== task.title;
    const notesChanged = newNotes !== (task.notes || '');

    setEditingId(null);

    if (thenAddTask) {
      const max = getMaxForPriority(task.priority);
      if (!max || tasks.filter(t => t.priority === task.priority).length < max) {
        setAdding(task.priority);
        setNewTaskTitle('');
      }
    }

    if (!titleChanged && !notesChanged) return;

    const updates = {};
    if (titleChanged) updates.title = newTitle;
    if (notesChanged) updates.notes = newNotes;

    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    await persistTask(id, updates,
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, title: task.title, notes: task.notes } : t)));
  };

  const updateAssignee = async (id, assignee) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, assignee } : t));
    await persistTask(id, { assignee },
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, assignee: task.assignee } : t)));
  };

  const updateStatus = async (id, status) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    await persistTask(id, { status },
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, status: task.status } : t)));
  };

  // --- Week planner handlers (share the active board's task set) ---

  // Set/clear a task's due_date (null = back to the Backlog). Drives drag-to-day.
  const setDueDate = async (id, dueDate) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const next = dueDate || null;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, due_date: next } : t));
    await persistTask(id, { due_date: next },
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, due_date: task.due_date ?? null } : t)));
  };

  const setPriority = async (id, priority) => {
    const task = tasks.find(t => t.id === id);
    if (!task || task.priority === priority) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority } : t));
    await persistTask(id, { priority },
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: task.priority } : t)));
  };

  const renameTask = async (id, title) => {
    const task = tasks.find(t => t.id === id);
    const newTitle = title.trim();
    if (!task || !newTitle || newTitle === task.title) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, title: newTitle } : t));
    await persistTask(id, { title: newTitle },
      () => setTasks(prev => prev.map(t => t.id === id ? { ...t, title: task.title } : t)));
  };

  // Quick-add from a day column (or the Backlog when dueDate is null). Week tasks
  // default to 'low' priority, which has no capacity cap on the board.
  const createWeekTask = async ({ title, dueDate }) => {
    const trimmed = title?.trim();
    if (!trimmed) return;
    try {
      const { ok, data } = await createTask({ title: trimmed, priority: 'low', boardId: activeBoardId, dueDate: dueDate || null });
      if (ok) setTasks(prev => [...prev, data]);
    } catch (err) {
      console.error('Failed to add task', err);
    }
  };

  const weekHandlers = {
    onCreateTask: createWeekTask,
    onSetDueDate: setDueDate,
    onToggleDone: toggleDone,
    onUpdateAssignee: updateAssignee,
    onSetPriority: setPriority,
    onRename: renameTask,
    onRemove: removeTask,
  };

  // --- Subtask helpers ---

  const toggleExpanded = (id) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const updateSubtasks = async (taskId, subtasks) => {
    setTasks(prev => replaceTaskSubtasks(prev, taskId, subtasks));
    await persistTask(taskId, { subtasks }, () => fetchTasks());
  };

  const addSubtask = (taskId, { keepOpen = false } = {}) => {
    if (!newSubtaskTitle.trim()) return;
    const nextTasks = addSubtaskToTask(tasks, taskId, newSubtaskTitle.trim());
    const task = nextTasks.find(t => t.id === taskId);
    updateSubtasks(taskId, task?.subtasks || []);
    setNewSubtaskTitle('');
    if (!keepOpen) setAddingSubtask(null);
  };

  const toggleSubtask = (taskId, subtaskId) => {
    const nextTasks = toggleSubtaskInTask(tasks, taskId, subtaskId);
    const task = nextTasks.find(t => t.id === taskId);
    updateSubtasks(taskId, task?.subtasks || []);
  };

  const removeSubtask = (taskId, subtaskId) => {
    const nextTasks = removeSubtaskFromTask(tasks, taskId, subtaskId);
    const task = nextTasks.find(t => t.id === taskId);
    updateSubtasks(taskId, task?.subtasks || []);
  };

  const startEditingSubtask = (taskId, sub) => {
    setEditingSubId(`${taskId}-${sub.id}`);
    setEditingSubTitle(sub.title);
  };

  const saveSubtaskEdit = (taskId, subtaskId, { thenAdd = false } = {}) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) { setEditingSubId(null); return; }
    const newTitle = editingSubTitle.trim();
    if (!newTitle) {
      const nextTasks = removeEmptySubtask(tasks, taskId, subtaskId);
      const nextTask = nextTasks.find(t => t.id === taskId);
      if (nextTask && nextTask !== task) updateSubtasks(taskId, nextTask.subtasks || []);
      setEditingSubId(null);
      return;
    }
    const renamedTasks = renameSubtaskInTask(tasks, taskId, subtaskId, newTitle);
    const renamedTask = renamedTasks.find(t => t.id === taskId);
    const currentSubs = renamedTask?.subtasks || [];

    if (thenAdd) {
      const { tasks: withBlank, subtask: newSub } = insertBlankSubtaskAfter(renamedTasks, taskId, subtaskId);
      const nextTask = withBlank.find(t => t.id === taskId);
      updateSubtasks(taskId, nextTask?.subtasks || currentSubs);
      setEditingSubId(`${taskId}-${newSub.id}`);
      setEditingSubTitle('');
    } else {
      setEditingSubId(null);
      updateSubtasks(taskId, currentSubs);
    }
  };

  const updateSubtaskAssignee = (taskId, subtaskId, assignee) => {
    const nextTasks = updateSubtaskInTask(tasks, taskId, subtaskId, { assignee });
    const task = nextTasks.find(t => t.id === taskId);
    updateSubtasks(taskId, task?.subtasks || []);
  };

  // Subtask drag reorder — pointer-event based, immediate swap on crossing midpoints
  const [subDragId, setSubDragId] = useState(null); // currently dragging subtask id
  const subDragTaskId = useRef(null);
  const subRowRefs = useRef({}); // subId -> element ref

  const handleSubPointerDown = (e, taskId, subId) => {
    e.preventDefault();
    e.stopPropagation();
    setSubDragId(subId);
    subDragTaskId.current = taskId;

    const onMove = (ev) => {
      const tid = subDragTaskId.current;
      if (!tid) return;
      // Find which row the pointer is over by checking midpoints
      const task = tasksRef.current.find(t => t.id === tid);
      if (!task) return;
      const subs = task.subtasks || [];
      const curIdx = subs.findIndex(s => s.id === subId);
      if (curIdx === -1) return;

      for (let i = 0; i < subs.length; i++) {
        if (i === curIdx) continue;
        const el = subRowRefs.current[subs[i].id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        // If dragging down and pointer passed below a lower item's midpoint, swap
        // If dragging up and pointer passed above a higher item's midpoint, swap
        if ((i > curIdx && ev.clientY > midY) || (i < curIdx && ev.clientY < midY)) {
          const newSubs = [...subs];
          const [moved] = newSubs.splice(curIdx, 1);
          newSubs.splice(i, 0, moved);
          updateSubtasks(tid, newSubs);
          break; // only swap one at a time
        }
      }
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      setSubDragId(null);
      subDragTaskId.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  // --- Drag and Drop ---

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
    tasksSnapshot.current = tasks;
    setCapacityFlash(null);
    lastOverId.current = null;
    lastOverTime.current = 0;
    if (capacityFlashTimer.current) { clearTimeout(capacityFlashTimer.current); capacityFlashTimer.current = null; }
  };

  // onDragOver: ONLY handle cross-container moves (changing priority).
  // Within the same container, do nothing — let onDragEnd handle final ordering.
  const handleDragOver = (event) => {
    const { active, over } = event;
    if (!over) return;

    const activePriority = findPriority(tasksRef.current, active.id);
    const overPriority = findPriority(tasksRef.current, over.id);

    if (!activePriority || !overPriority) return;
    // Same container — skip, onDragEnd will handle reordering
    if (activePriority === overPriority) return;

    // Cross-container: move the active task into the over container
    setTasks(prev => {
      const moved = moveTaskAcrossPriority(prev, active.id, over.id);
      if (moved.rejectedPriority) {
        if (!capacityFlashTimer.current) {
          setCapacityFlash(moved.rejectedPriority);
          capacityFlashTimer.current = setTimeout(() => {
            setCapacityFlash(null);
            capacityFlashTimer.current = null;
          }, 800);
        }
        return prev;
      }
      return moved.tasks;
    });
  };

  // onDragEnd: handle final positioning (same-container reorder + persist)
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    const snapshot = tasksSnapshot.current;
    tasksSnapshot.current = null;
    setActiveId(null);

    const {
      tasks: newTasks,
      itemsToSave,
      shouldRevert,
    } = finalizeTaskDrag(tasksRef.current, snapshot, active.id, over?.id);

    if (shouldRevert) {
      setTasks(newTasks);
      return;
    }

    setTasks(newTasks);

    // Persist
    if (itemsToSave.length === 0) return;

    try {
      const res = await reorderTasks(itemsToSave);
      if (!res.ok) console.error('Reorder API error:', await res.text());
    } catch (err) {
      console.error('Failed to reorder tasks', err);
      setTasks(snapshot);
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    if (tasksSnapshot.current) {
      setTasks(tasksSnapshot.current);
      tasksSnapshot.current = null;
    }
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up flex items-start justify-between gap-4 flex-wrap">
        <div>
          <BoardSelector
            boards={boards}
            activeBoardId={activeBoardId}
            onSwitch={switchBoard}
            onCreate={createBoard}
            onRename={renameBoard}
            onDelete={deleteBoard}
          />
          <p className="text-sm text-gray-500 mt-1">{totalOpen} open task{totalOpen !== 1 ? 's' : ''}</p>
        </div>
        {/* Board ⇄ Week view toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {[
            { key: 'board', label: 'Board' },
            { key: 'week', label: 'Week' },
            { key: 'horizons', label: 'Horizons' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'horizons' ? (
        <Horizons />
      ) : view === 'week' ? (
        <WeekPlanner tasks={tasks} savedAssignees={savedAssignees} handlers={weekHandlers} />
      ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={stableCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-48 mb-6" />
              <div className="h-4 bg-gray-100 rounded w-32 mx-auto" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {PRIORITY_SECTIONS.map(({ key, label, color, maxTasks }, sectionIdx) => {
            const sectionTasks = tasksByPriority(key);
            const openCount = sectionTasks.filter(t => !t.done).length;
            const atCapacity = maxTasks ? sectionTasks.length >= maxTasks : false;
            const countLabel = maxTasks ? `${sectionTasks.length} / ${maxTasks}` : `${openCount}`;
            const taskIds = sectionTasks.map(t => t.id);

            return (
              <div key={key} className={`rounded-3xl border p-6 shadow-sm animate-fade-in-up ${capacityFlash === key ? 'bg-red-50 border-red-300 ring-2 ring-red-200' : 'bg-white border-gray-200'}`} style={{ animationDelay: `${0.06 + sectionIdx * 0.08}s`, transition: 'all 300ms cubic-bezier(0.25, 1, 0.5, 1)' }}>
                {/* Section Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${color}`} />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">{label}</h2>
                    <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${
                      atCapacity ? 'text-red-500 border-red-200 bg-red-50' : 'text-gray-500 border-gray-200'
                    }`}>
                      {countLabel}
                    </span>
                  </div>
                  {!atCapacity && (
                    <button
                      onClick={() => { setAdding(key); setNewTaskTitle(''); }}
                      className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      <Plus size={16} />
                      Add Task
                    </button>
                  )}
                </div>

                {/* Task List */}
                {sectionTasks.length === 0 && adding === key ? null : (
                <DroppableSection id={`section-${key}`} isEmpty={sectionTasks.length === 0}>
                {sectionTasks.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 transition-all duration-300">No tasks yet</p>
                ) : (
                  <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2" style={{ transition: 'all 300ms cubic-bezier(0.25, 1, 0.5, 1)' }}>
                    {sectionTasks.map(task => {
                      const subtasks = task.subtasks || [];
                      const hasSubtasks = subtasks.length > 0;
                      const isExpanded = expandedTasks.has(task.id);
                      const doneSubtasks = subtasks.filter(s => s.done).length;
                      const isEditing = editingId === task.id;

                      return (
                        <SortableTaskRow key={task.id} task={task}>
                          {({ dragHandleProps }) => (
                        <div>
                          {/* Main Task Row */}
                          <div
                            className={`rounded-xl border transition-all duration-200 ${
                              isEditing
                                ? 'bg-white border-emerald-200 shadow-sm group'
                                : 'bg-gray-50/70 border-gray-100 hover:border-gray-200 group'
                            }`}
                            onBlur={(e) => {
                              if (isEditing && !e.currentTarget.contains(e.relatedTarget)) {
                                saveEdit(task.id);
                              }
                            }}
                            onMouseLeave={() => {
                              if (pendingDelete === `task-${task.id}` || pendingDelete?.startsWith(`sub-${task.id}-`)) {
                                setPendingDelete(null);
                              }
                            }}
                          >
                            <div className={`flex gap-3 px-4 py-3 ${isEditing ? 'items-start' : 'items-center'}`}>
                              {/* Drag handle */}
                              <button
                                {...dragHandleProps}
                                className={`flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors touch-none ${isEditing ? 'mt-0.5' : ''}`}
                                tabIndex={-1}
                              >
                                <GripVertical size={16} />
                              </button>

                              {/* Expand toggle */}
                              <button
                                onClick={() => toggleExpanded(task.id)}
                                className={`flex-shrink-0 w-4 text-gray-400 hover:text-gray-600 transition-colors ${isEditing ? 'mt-0.5' : ''}`}
                              >
                                {hasSubtasks ? (
                                  isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                                ) : (
                                  <span className="w-[14px]" />
                                )}
                              </button>

                              {/* Checkbox */}
                              <button
                                onClick={() => toggleDone(task.id, task.done)}
                                className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 ${isEditing ? 'mt-0.5' : ''} ${
                                  task.done
                                    ? 'bg-emerald-500 border-emerald-500 text-white'
                                    : 'border-gray-300 hover:border-emerald-400'
                                }`}
                              >
                                {task.done && <Check size={12} strokeWidth={3} />}
                              </button>

                              {/* Title */}
                              {isEditing ? (
                                <textarea spellCheck={true}
                                  ref={editRef}
                                  value={editingTitle}
                                  onChange={e => {
                                    setEditingTitle(e.target.value);
                                    e.target.style.height = 'auto';
                                    e.target.style.height = e.target.scrollHeight + 'px';
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(task.id, { thenAddTask: true }); }
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  rows={1}
                                  className="flex-1 bg-transparent text-sm text-gray-900 outline-none resize-none leading-relaxed"
                                  style={{ overflow: 'hidden' }}
                                />
                              ) : (
                                <span
                                  onClick={() => startEditing(task)}
                                  className={`flex-1 text-sm cursor-text ${task.done ? 'line-through text-gray-400' : 'text-gray-800'}`}
                                >
                                  {task.title}
                                </span>
                              )}

                              {/* Right side: tags + actions */}
                              <div className="flex items-center gap-0 ml-auto flex-shrink-0">
                                {/* Subtask count badge */}
                                {hasSubtasks && (
                                  <span className="text-xs text-gray-400 mr-2">
                                    {doneSubtasks}/{subtasks.length}
                                  </span>
                                )}

                                {/* Status tag */}
                                <div className="relative flex-shrink-0 transition-all duration-700 ease-in-out delay-0 group-hover:delay-200 max-w-0 overflow-hidden group-hover:max-w-[120px] group-hover:mr-2" ref={el => { statusAnchorRefs.current[`task-${task.id}`] = el; }}
                                  style={task.status || isEditing ? { maxWidth: '120px', marginRight: '8px' } : {}}
                                >
                                  <StatusTag
                                    status={task.status}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const key = `task-${task.id}`;
                                      setStatusPickerOpen(statusPickerOpen === key ? null : key);
                                    }}
                                  />
                                  {statusPickerOpen === `task-${task.id}` && (
                                    <StatusPicker
                                      current={task.status}
                                      onSelect={(val) => updateStatus(task.id, val)}
                                      onClose={() => setStatusPickerOpen(null)}
                                      anchorRef={{ current: statusAnchorRefs.current[`task-${task.id}`] }}
                                    />
                                  )}
                                </div>

                                {/* Assignee tag */}
                                <div className="relative flex-shrink-0 transition-all duration-700 ease-in-out delay-0 group-hover:delay-200 max-w-0 overflow-hidden group-hover:max-w-[120px] group-hover:mr-2" ref={el => { assigneeAnchorRefs.current[`task-${task.id}`] = el; }}
                                  style={task.assignee || isEditing ? { maxWidth: '120px', marginRight: '8px' } : {}}
                                >
                                  <AssigneeTag
                                    assignee={task.assignee}
                                    savedAssignees={savedAssignees}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const key = `task-${task.id}`;
                                      setAssigneePickerOpen(assigneePickerOpen === key ? null : key);
                                    }}
                                  />
                                  {assigneePickerOpen === `task-${task.id}` && (
                                    <AssigneePicker
                                      current={task.assignee}
                                      onSelect={(val) => updateAssignee(task.id, val)}
                                      onClose={() => setAssigneePickerOpen(null)}
                                      anchorRef={{ current: assigneeAnchorRefs.current[`task-${task.id}`] }}
                                      savedAssignees={savedAssignees}
                                      onAddAssignee={addAssignee}
                                      onRemoveAssignee={removeAssignee}
                                    />
                                  )}
                                </div>

                                {/* Actions */}
                                {!isEditing && (
                                  <div className={`flex items-center gap-0 overflow-hidden opacity-0 group-hover:opacity-100 ${pendingDelete === `task-${task.id}` ? 'max-w-[180px] transition-opacity duration-300' : 'max-w-0 group-hover:max-w-[80px] transition-all duration-700 ease-in-out delay-0 group-hover:delay-200'}`}
                                  >
                                    <button
                                      onClick={() => {
                                        setAddingSubtask(task.id);
                                        setNewSubtaskTitle('');
                                        if (!expandedTasks.has(task.id)) toggleExpanded(task.id);
                                      }}
                                      className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                                      title="Add subtask"
                                    >
                                      <Plus size={14} />
                                    </button>
                                    {pendingDelete === `task-${task.id}` ? (
                                      <div className="flex items-center gap-1 ml-1 whitespace-nowrap">
                                        <button onClick={() => setPendingDelete(null)}
                                          className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                                        <button onClick={() => { removeTask(task.id); setPendingDelete(null); }}
                                          className="text-[11px] font-semibold text-white bg-red-500 px-2 py-0.5 rounded-md hover:bg-red-600 transition-colors">Delete</button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setPendingDelete(`task-${task.id}`)}
                                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                        title="Delete task"
                                      >
                                        <X size={14} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Notes area */}
                            {isEditing ? (
                              <div className="px-4 pb-3 pl-16">
                                <textarea spellCheck={true}
                                  value={editingNotes}
                                  onChange={e => setEditingNotes(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  placeholder="Add a note..."
                                  rows={2}
                                  className="w-full bg-gray-50/80 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 placeholder-gray-400 outline-none focus:ring-1 focus:ring-emerald-500 focus:border-transparent resize-none transition-all duration-200"
                                />
                              </div>
                            ) : (
                              task.notes && (
                                <div
                                  onClick={() => startEditing(task)}
                                  className="px-4 pb-3 pl-16 cursor-text"
                                >
                                  <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{task.notes}</p>
                                </div>
                              )
                            )}
                          </div>

                          {/* Subtasks */}
                          {isExpanded && (
                            <div className="ml-10 mt-1">
                              {subtasks.map(sub => {
                                const subKey = `${task.id}-${sub.id}`;
                                const isEditingSub = editingSubId === subKey;
                                const pickerKey = `sub-${task.id}-${sub.id}`;
                                const isDraggingThis = subDragId === sub.id;

                                return (
                                  <div
                                    key={sub.id}
                                    ref={el => { subRowRefs.current[sub.id] = el; }}
                                    className={`flex ${isEditingSub ? 'items-start' : 'items-center'} gap-3 px-4 py-2 rounded-lg group/sub hover:bg-gray-50 transition-all duration-150 ${
                                      isDraggingThis ? 'bg-emerald-50 shadow-sm ring-1 ring-emerald-200 scale-[1.01]' : ''
                                    } ${subDragId && !isDraggingThis ? 'transition-all duration-200' : ''}`}
                                  >
                                    <div
                                      onPointerDown={(e) => handleSubPointerDown(e, task.id, sub.id)}
                                      className="flex-shrink-0 text-gray-300 opacity-0 group-hover/sub:opacity-100 transition-opacity cursor-grab touch-none select-none"
                                    >
                                      <GripVertical size={12} />
                                    </div>
                                    <button
                                      onClick={() => toggleSubtask(task.id, sub.id)}
                                      className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-200 ${
                                        sub.done
                                          ? 'bg-emerald-500 border-emerald-500 text-white'
                                          : 'border-gray-300 hover:border-emerald-400'
                                      }`}
                                    >
                                      {sub.done && <Check size={10} strokeWidth={3} />}
                                    </button>

                                    {isEditingSub ? (
                                      <textarea spellCheck={true}
                                        ref={subEditRef}
                                        value={editingSubTitle}
                                        onChange={e => {
                                          setEditingSubTitle(e.target.value);
                                          e.target.style.height = 'auto';
                                          e.target.style.height = e.target.scrollHeight + 'px';
                                        }}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveSubtaskEdit(task.id, sub.id, { thenAdd: true }); }
                                          if (e.key === 'Escape') setEditingSubId(null);
                                        }}
                                        onBlur={() => saveSubtaskEdit(task.id, sub.id)}
                                        rows={1}
                                        className="flex-1 bg-white border border-emerald-300 rounded-lg px-2 py-0.5 text-sm text-gray-900 outline-none focus:ring-1 focus:ring-emerald-500 resize-none leading-relaxed"
                                        style={{ overflow: 'hidden' }}
                                      />
                                    ) : (
                                      <span
                                        onClick={() => startEditingSubtask(task.id, sub)}
                                        className={`flex-1 text-sm cursor-text ${sub.done ? 'line-through text-gray-400' : 'text-gray-600'}`}
                                      >
                                        {sub.title}
                                      </span>
                                    )}

                                    {/* Right side: tags + actions */}
                                    <div className="flex items-center gap-0 ml-auto flex-shrink-0">
                                      {/* Subtask status */}
                                      <div className="relative flex-shrink-0 transition-all duration-700 ease-in-out delay-0 group-hover/sub:delay-200 max-w-0 overflow-hidden group-hover/sub:max-w-[120px] group-hover/sub:mr-2" ref={el => { statusAnchorRefs.current[pickerKey] = el; }}
                                        style={sub.status ? { maxWidth: '120px', marginRight: '8px', overflow: 'visible' } : {}}
                                      >
                                        <StatusTag
                                          status={sub.status}
                                          size="small"
                                          groupClass="group-hover/sub:opacity-100"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setStatusPickerOpen(statusPickerOpen === pickerKey ? null : pickerKey);
                                          }}
                                        />
                                        {statusPickerOpen === pickerKey && (
                                          <StatusPicker
                                            current={sub.status}
                                            onSelect={(val) => {
                                              const nextTasks = updateSubtaskInTask(tasks, task.id, sub.id, { status: val });
                                              const nextTask = nextTasks.find(t => t.id === task.id);
                                              updateSubtasks(task.id, nextTask?.subtasks || []);
                                            }}
                                            onClose={() => setStatusPickerOpen(null)}
                                            anchorRef={{ current: statusAnchorRefs.current[pickerKey] }}
                                          />
                                        )}
                                      </div>

                                      {/* Subtask assignee */}
                                      <div className="relative flex-shrink-0 transition-all duration-700 ease-in-out delay-0 group-hover/sub:delay-200 max-w-0 overflow-hidden group-hover/sub:max-w-[120px] group-hover/sub:mr-2" ref={el => { assigneeAnchorRefs.current[pickerKey] = el; }}
                                        style={sub.assignee ? { maxWidth: '120px', marginRight: '8px', overflow: 'visible' } : {}}
                                      >
                                        <AssigneeTag
                                          assignee={sub.assignee}
                                          size="small"
                                          savedAssignees={savedAssignees}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setAssigneePickerOpen(assigneePickerOpen === pickerKey ? null : pickerKey);
                                          }}
                                        />
                                        {assigneePickerOpen === pickerKey && (
                                          <AssigneePicker
                                            current={sub.assignee}
                                            onSelect={(val) => updateSubtaskAssignee(task.id, sub.id, val)}
                                            onClose={() => setAssigneePickerOpen(null)}
                                            anchorRef={{ current: assigneeAnchorRefs.current[pickerKey] }}
                                            savedAssignees={savedAssignees}
                                            onAddAssignee={addAssignee}
                                            onRemoveAssignee={removeAssignee}
                                          />
                                        )}
                                      </div>

                                      <div className={`flex items-center overflow-hidden opacity-0 group-hover/sub:opacity-100 ${pendingDelete === `sub-${task.id}-${sub.id}` ? 'max-w-[160px] transition-opacity duration-300' : 'max-w-0 group-hover/sub:max-w-[40px] transition-all duration-700 ease-in-out delay-0 group-hover/sub:delay-200'}`}
                                        onMouseLeave={() => { if (pendingDelete === `sub-${task.id}-${sub.id}`) setPendingDelete(null); }}>
                                        {pendingDelete === `sub-${task.id}-${sub.id}` ? (
                                          <div className="flex items-center gap-1 ml-1 whitespace-nowrap">
                                            <button onClick={() => setPendingDelete(null)}
                                              className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-md hover:bg-gray-200 transition-colors">Cancel</button>
                                            <button onClick={() => { removeSubtask(task.id, sub.id); setPendingDelete(null); }}
                                              className="text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded-md hover:bg-red-600 transition-colors">Delete</button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => setPendingDelete(`sub-${task.id}-${sub.id}`)}
                                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                          >
                                            <X size={12} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Add subtask input — inline row */}
                              {addingSubtask === task.id && (
                                <div className="animate-slide-in-down">
                                  <div className="flex items-center gap-3 px-4 py-2 rounded-lg">
                                    <span className="flex-shrink-0 text-gray-200">
                                      <GripVertical size={12} />
                                    </span>
                                    <span className="flex-shrink-0 w-4 h-4 rounded border-2 border-gray-200" />
                                    <input
                                      autoFocus
                                      type="text" spellCheck={true}
                                      placeholder="Subtask title..."
                                      value={newSubtaskTitle}
                                      onChange={e => setNewSubtaskTitle(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                          if (newSubtaskTitle.trim()) {
                                            addSubtask(task.id, { keepOpen: true });
                                          } else {
                                            setAddingSubtask(null);
                                          }
                                        }
                                        if (e.key === 'Escape') setAddingSubtask(null);
                                      }}
                                      onBlur={() => {
                                        if (newSubtaskTitle.trim()) {
                                          addSubtask(task.id);
                                        } else {
                                          setAddingSubtask(null);
                                        }
                                      }}
                                      className="flex-1 bg-transparent text-sm text-gray-600 placeholder-gray-400 outline-none"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                          )}
                        </SortableTaskRow>
                      );
                    })}
                  </div>
                  </SortableContext>
                )}
                </DroppableSection>
                )}

                {/* Add Task Input — inline row that looks like a task */}
                {adding === key && !atCapacity && (
                  <div className="animate-slide-in-down mt-2">
                    <div className="rounded-xl border border-emerald-200 bg-white shadow-sm">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span className="flex-shrink-0 text-gray-200">
                          <GripVertical size={16} />
                        </span>
                        <span className="flex-shrink-0 w-4" />
                        <span className="flex-shrink-0 w-5 h-5 rounded-md border-2 border-gray-200" />
                        <input
                          autoFocus
                          type="text" spellCheck={true}
                          placeholder="Task title..."
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              if (newTaskTitle.trim()) {
                                handleAddTask(key, { keepOpen: true });
                              } else {
                                setAdding(null);
                              }
                            }
                            if (e.key === 'Escape') setAdding(null);
                          }}
                          onBlur={() => {
                            if (newTaskTitle.trim()) {
                              handleAddTask(key);
                            } else {
                              setAdding(null);
                            }
                          }}
                          className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Completed Tasks */}
          {completedTasks.length > 0 && (
            <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
              <button
                onClick={() => setCompletedOpen(o => !o)}
                className="flex items-center gap-3 w-full"
              >
                <ChevronRight size={16} className={`text-gray-400 transition-transform duration-200 ${completedOpen ? 'rotate-90' : ''}`} />
                <span className="w-3 h-3 rounded-full bg-gray-300" />
                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Completed</h2>
                <span className="text-xs font-medium text-gray-400 border border-gray-200 rounded-full px-2.5 py-0.5">
                  {completedTasks.length}
                </span>
              </button>

              {completedOpen && (
                <div className="mt-4 space-y-1">
                  {completedTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-xl group hover:bg-gray-50 transition-colors">
                      <button
                        onClick={() => toggleDone(task.id, task.done)}
                        className="flex-shrink-0 w-5 h-5 rounded-md bg-emerald-500 border-2 border-emerald-500 text-white flex items-center justify-center transition-all duration-200 hover:bg-emerald-400 hover:border-emerald-400"
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>
                      <span className="flex-1 text-sm text-gray-400 line-through">{task.title}</span>
                      {task.status && (() => {
                        const opt = STATUS_OPTIONS.find(o => o.value === task.status);
                        return opt ? (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border opacity-50 ${opt.bg} ${opt.textColor}`}>
                            {opt.label}
                          </span>
                        ) : null;
                      })()}
                      {task.assignee && (
                        <span
                          className="text-xs px-2 py-0.5 font-medium rounded-full border opacity-50"
                          style={getAssigneeInlineStyle(task.assignee, savedAssignees)}
                        >
                          {task.assignee}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-300 uppercase tracking-wide">{task.priority}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      )}

      {/* Drag overlay for visual feedback */}
      <DragOverlay>
        {activeTask ? (
          <div className="rounded-xl border border-emerald-300 bg-white shadow-lg px-4 py-3 opacity-90">
            <div className="flex items-center gap-3">
              <GripVertical size={16} className="text-emerald-500" />
              <span className="text-sm text-gray-800">{activeTask.title}</span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>
      )}

    </div>
  );
}
