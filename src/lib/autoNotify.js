/*
  Auto-notify: shared, dependency-free logic for the Draft & Review reminders.

  Both the in-app trigger (src/components/DraftReview.jsx — fires while a review is
  open) and the server cron (src/app/api/cron/auto-notify/route.js — fires when
  nobody is looking) import this module, so "is this comment due a reminder?" is
  decided in exactly one place and the two paths can never drift apart.

  Scheduling model (absolute, not relative): a reminder fires at a chosen time of
  day (`atMinutes`, in the configured IANA `tz`), every `everyDays` days, counting
  from the calendar date the comment started waiting. It repeats at each cadence
  until the comment is answered or the thread is resolved. The first fire is one
  cadence after the comment's date, so a comment never gets nudged the same day.

  The two paths cooperate through one shared dedup map, `autoNotify.sent`, persisted
  on the review: it records, per thread, the last message we reminded about and
  when. We re-arm for the next scheduled occurrence (the stored `at` falls before
  the most recent fire time) or when a fresh reply changes the thread's last-message
  id. Whoever sends first stamps it; the other then sees the stamp and skips.

  Pure functions only — no React, no Node, no DB. Safe in a client bundle. Time-zone
  math uses Intl (full ICU), available in both modern browsers and Node 13+.
*/

export const CADENCE_DAYS = [1, 2, 3]; // selectable "every N days" cadences

export const DEFAULT_AUTO_NOTIFY = {
  enabled: false,
  everyDays: 1, // 1 = daily, up to 3
  atMinutes: 540, // time of day to send, minutes from midnight (540 = 09:00)
  tz: 'UTC', // IANA zone the atMinutes wall-clock time is read in
  roles: { author: true, reviewer: true },
  sent: {},
};

// Coerce a stored (possibly legacy/partial) autoNotify blob into a full shape.
// Legacy configs carry `afterHours` instead of everyDays/atMinutes; map the delay
// to the nearest cadence so an existing reminder keeps roughly its intent.
export function normalizeAutoNotify(autoNotify) {
  const a = autoNotify || {};

  let everyDays = Math.round(Number(a.everyDays));
  if (!CADENCE_DAYS.includes(everyDays)) {
    const legacyDays = Math.round(Number(a.afterHours) / 24);
    everyDays = CADENCE_DAYS.includes(legacyDays) ? legacyDays : 1;
  }

  let atMinutes = Math.round(Number(a.atMinutes));
  if (!Number.isFinite(atMinutes) || atMinutes < 0 || atMinutes > 1439) atMinutes = 540;

  const tz = typeof a.tz === 'string' && a.tz ? a.tz : 'UTC';

  return {
    enabled: !!a.enabled,
    everyDays,
    atMinutes,
    tz,
    roles: {
      author: a.roles?.author !== false,
      reviewer: a.roles?.reviewer !== false,
    },
    sent: a.sent && typeof a.sent === 'object' ? a.sent : {},
  };
}

// --- Time-zone helpers ------------------------------------------------------
// Read an instant's wall-clock fields in a given IANA zone.
function tzParts(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out = {};
  for (const { type, value } of dtf.formatToParts(ms)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return out; // { year, month, day, hour, minute, second }
}

// Zone offset (ms) at an instant: (wall-clock read as if UTC) − actual instant.
function tzOffsetMs(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

// The UTC instant for a wall-clock time (y/m/d at `minutes`) in a zone. One
// correction pass settles DST boundaries to within reminder-grade accuracy.
function wallToUtcMs(year, month, day, minutes, tz) {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let utc = naive - tzOffsetMs(naive, tz);
  utc = naive - tzOffsetMs(utc, tz);
  return utc;
}

const DAY_MS = 86400000;

// Day index (whole days, in `tz`) for an instant — lets us count calendar days
// between two instants without DST drift.
function tzDayIndex(ms, tz) {
  const p = tzParts(ms, tz);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/**
 * The most recent scheduled fire instant at or before `now`, or null if the
 * comment hasn't reached its first scheduled reminder yet. Fires land on
 * (comment date + k·everyDays) at `atMinutes`, for k = 1, 2, 3, …
 */
export function lastScheduledFire({ awaitingSinceMs, now, everyDays, atMinutes, tz }) {
  const day0 = tzDayIndex(awaitingSinceMs, tz);
  const deltaDays = tzDayIndex(now, tz) - day0;
  // Largest cadence step whose fire-day is on or before today, then step back if
  // today's fire time hasn't passed. The loop runs at most twice.
  for (let k = Math.floor(deltaDays / everyDays); k >= 1; k--) {
    const d = new Date((day0 + k * everyDays) * DAY_MS);
    const fire = wallToUtcMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), atMinutes, tz);
    if (fire <= now) return fire;
  }
  return null;
}

// Whose turn it is and since when, for one thread. Returns null when there's
// nothing to respond to (resolved, or no messages yet).
function pendingInfo(thread) {
  if (!thread || thread.resolved) return null;
  const msgs = thread.messages || [];
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  const awaiting = Date.parse(last.createdAt);
  return {
    id: thread.id,
    // A comment waits on whoever should speak next — the opposite of who spoke last.
    role: last.role === 'reviewer' ? 'author' : 'reviewer',
    lastMessageId: last.id,
    awaitingSinceMs: Number.isNaN(awaiting) ? null : awaiting,
  };
}

/**
 * The threads currently due an auto-reminder, grouped by recipient role.
 *
 * A thread is due when auto-notify is enabled, the recipient role is turned on
 * and has an email, a scheduled fire time has passed, and we haven't already
 * reminded for that occurrence of this exact message (dedup via `sent`).
 *
 * @returns {{reviewer: object[], author: object[]}} full thread objects per role.
 */
export function selectDueReminders({ threads, autoNotify, emails, now }) {
  const cfg = normalizeAutoNotify(autoNotify);
  const due = { reviewer: [], author: [] };
  if (!cfg.enabled) return due;
  const sent = cfg.sent;
  for (const thread of threads || []) {
    const info = pendingInfo(thread);
    if (!info) continue;
    if (cfg.roles[info.role] === false) continue;
    // No email → don't "consume" the dedup slot; we'd never retry once one is added.
    if (!emails?.[info.role]) continue;
    if (info.awaitingSinceMs == null) continue;
    const fire = lastScheduledFire({
      awaitingSinceMs: info.awaitingSinceMs,
      now,
      everyDays: cfg.everyDays,
      atMinutes: cfg.atMinutes,
      tz: cfg.tz,
    });
    if (fire == null) continue; // no scheduled reminder has come due yet
    // Skip only if we've already nudged this message for this (or a later) fire.
    const prev = sent[info.id];
    if (prev?.msgId === info.lastMessageId && Date.parse(prev.at) >= fire) continue;
    due[info.role].push(thread);
  }
  return due;
}

/**
 * The `sent` map to persist after reminding `remindedIds`. Keeps existing entries
 * for threads still pending, stamps the reminded ones with the message + time
 * they were reminded about (so the next cadence occurrence re-arms), and drops
 * threads that are gone or resolved so the map can't grow without bound.
 */
export function computeNextSent({ threads, prevSent, remindedIds, nowIso }) {
  const reminded = remindedIds instanceof Set ? remindedIds : new Set(remindedIds || []);
  const prev = prevSent || {};
  const next = {};
  for (const thread of threads || []) {
    const info = pendingInfo(thread);
    if (!info) continue;
    if (reminded.has(info.id)) next[info.id] = { msgId: info.lastMessageId, at: nowIso };
    else if (prev[info.id]) next[info.id] = prev[info.id];
  }
  return next;
}
