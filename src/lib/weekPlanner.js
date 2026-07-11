// Pure helpers behind the Week view of /tasks — a Mon–Sun planner grid that
// buckets the active board's tasks by their `due_date`. Kept side-effect free
// (native Date only, no libraries) so the date math is easy to reason about and
// test, mirroring the pure-helper style of taskBoard.js.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Local-timezone YYYY-MM-DD. Deliberately NOT toISOString(), which would shift
// the day across the UTC boundary for anyone west of GMT.
export function toISODate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a 'YYYY-MM-DD' string into a local Date at midnight (avoids the UTC
// parsing browsers apply to bare date strings).
export function fromISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

// Monday 00:00 of the week containing `date` (weeks are Mon–Sun).
export function startOfWeek(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();               // 0=Sun … 6=Sat
  const diff = (day + 6) % 7;           // days since Monday
  d.setDate(d.getDate() - diff);
  return d;
}

export function addWeeks(weekStart, n) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + n * 7);
  return startOfWeek(d);
}

// The seven day descriptors for the week beginning `weekStart`.
export function getWeekDays(weekStart, now = new Date()) {
  const start = startOfWeek(weekStart);
  const today = todayISO(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY_MS);
    const iso = toISODate(d);
    return {
      iso,
      date: d,
      dayName: WEEKDAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
      monthName: MONTH_NAMES[d.getMonth()],
      isToday: iso === today,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });
}

// "Jul 13 – 19" or "Jun 30 – Jul 6" across a month boundary.
export function weekLabel(weekStart) {
  const days = getWeekDays(weekStart);
  const first = days[0];
  const last = days[6];
  if (first.monthName === last.monthName) {
    return `${first.monthName} ${first.dayNum} – ${last.dayNum}`;
  }
  return `${first.monthName} ${first.dayNum} – ${last.monthName} ${last.dayNum}`;
}

const PRIORITY_RANK = { highest: 0, medium: 1, low: 2 };

// Board order within a day/bucket: incomplete before done, then by priority,
// then by the board's manual `position`.
export function plannerSort(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  const pa = PRIORITY_RANK[a.priority] ?? 3;
  const pb = PRIORITY_RANK[b.priority] ?? 3;
  if (pa !== pb) return pa - pb;
  return (a.position ?? 0) - (b.position ?? 0);
}

// Split the board's tasks into the buckets the Week view renders:
//   byDay    — { [iso]: task[] } for each of the seven visible days
//   backlog  — tasks with no due_date
//   overdue  — dated, incomplete, before today AND before the visible week
//              (only meaningful things the planner should nag you to reschedule)
//   scheduledOtherWeek — dated tasks that fall outside the visible week and
//              aren't overdue; surfaced only as a count so nothing silently
//              disappears when you page between weeks.
export function groupTasksForWeek(tasks, weekStart, now = new Date()) {
  const days = getWeekDays(weekStart, now);
  const weekIsos = new Set(days.map(d => d.iso));
  const firstIso = days[0].iso;
  const today = todayISO(now);

  const byDay = {};
  for (const iso of weekIsos) byDay[iso] = [];
  const backlog = [];
  const overdue = [];
  let scheduledOtherWeek = 0;

  for (const task of tasks) {
    const due = task.due_date || null;
    if (!due) {
      // Completed undated tasks are done and unscheduled — nothing to plan, so
      // keep them out of the Backlog rather than cluttering it.
      if (!task.done) backlog.push(task);
      continue;
    }
    if (weekIsos.has(due)) {
      byDay[due].push(task);
      continue;
    }
    if (!task.done && due < today && due < firstIso) {
      overdue.push(task);
    } else {
      scheduledOtherWeek += 1;
    }
  }

  for (const iso of weekIsos) byDay[iso].sort(plannerSort);
  backlog.sort(plannerSort);
  overdue.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : plannerSort(a, b)));

  return { days, byDay, backlog, overdue, scheduledOtherWeek };
}

// Translate a droppable container id back into the due_date it represents.
// `day-YYYY-MM-DD` → that ISO date; `backlog` → null (undated). Returns
// `undefined` for anything unrecognised so callers can ignore stray drops.
export function dueDateFromDropId(dropId) {
  if (dropId === 'backlog') return null;
  if (typeof dropId === 'string' && dropId.startsWith('day-')) {
    return dropId.slice(4);
  }
  return undefined;
}

export function dayDropId(iso) {
  return `day-${iso}`;
}
