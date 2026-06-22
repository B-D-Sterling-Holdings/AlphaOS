/*
  Auto-notify: shared, dependency-free logic for the Draft & Review reminders.

  Both the in-app trigger (src/components/DraftReview.jsx — fires while a review is
  open) and the server cron (src/app/api/cron/auto-notify/route.js — fires when
  nobody is looking) import this module, so "is this comment due a reminder?" is
  decided in exactly one place and the two paths can never drift apart.

  The two paths cooperate through one shared dedup map, `autoNotify.sent`, persisted
  on the review: it records the last message we reminded about per thread. Whoever
  sends first stamps it; the other then sees the stamp and skips. A fresh reply
  changes the thread's last-message id, which re-arms the reminder.

  Pure functions only — no React, no Node, no DB. Safe in a client bundle.
*/

export const DEFAULT_AUTO_NOTIFY = {
  enabled: false,
  afterHours: 24,
  roles: { author: true, reviewer: true },
  sent: {},
};

// Coerce a stored (possibly legacy/partial) autoNotify blob into a full shape.
export function normalizeAutoNotify(autoNotify) {
  const a = autoNotify || {};
  const afterHours = Number(a.afterHours);
  return {
    enabled: !!a.enabled,
    afterHours: afterHours > 0 ? afterHours : 24,
    roles: {
      author: a.roles?.author !== false,
      reviewer: a.roles?.reviewer !== false,
    },
    sent: a.sent && typeof a.sent === 'object' ? a.sent : {},
  };
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
 * and has an email, the comment has waited longer than `afterHours`, and we
 * haven't already reminded about this exact message (dedup via `sent`).
 *
 * @returns {{reviewer: object[], author: object[]}} full thread objects per role.
 */
export function selectDueReminders({ threads, autoNotify, emails, now }) {
  const cfg = normalizeAutoNotify(autoNotify);
  const due = { reviewer: [], author: [] };
  if (!cfg.enabled) return due;
  const thresholdMs = cfg.afterHours * 3600 * 1000;
  const sent = cfg.sent;
  for (const thread of threads || []) {
    const info = pendingInfo(thread);
    if (!info) continue;
    if (cfg.roles[info.role] === false) continue;
    // No email → don't "consume" the dedup slot; we'd never retry once one is added.
    if (!emails?.[info.role]) continue;
    const since = info.awaitingSinceMs == null ? now : info.awaitingSinceMs;
    if (now - since < thresholdMs) continue;
    if (sent[info.id]?.msgId === info.lastMessageId) continue;
    due[info.role].push(thread);
  }
  return due;
}

/**
 * The `sent` map to persist after reminding `remindedIds`. Keeps existing entries
 * for threads still pending, stamps the reminded ones with the message they were
 * reminded about, and drops threads that are gone or resolved so the map can't
 * grow without bound.
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
