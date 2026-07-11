import nodemailer from 'nodemailer';

/**
 * Gmail + Nodemailer transport used by the Draft & Review notifications.
 * Sends from a regular Gmail account using an App Password — no domain to
 * verify, and emails reach any recipient.
 *
 * Requires env vars:
 *   GMAIL_USER         — the Gmail address you send from, e.g. you@gmail.com
 *   GMAIL_APP_PASSWORD — a 16-char Google App Password (NOT your login password).
 *                        Create one at https://myaccount.google.com/apppasswords
 *                        (requires 2-Step Verification to be enabled).
 *   EMAIL_FROM         — optional display "from", e.g. "AlphaOS <you@gmail.com>".
 *                        Defaults to GMAIL_USER. Gmail forces the actual sender to
 *                        the authenticated account regardless of this value.
 */

let _transport = null;
function getTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!_transport) {
    _transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }
  return _transport;
}

export async function sendEmail({ to, subject, html }) {
  const transport = getTransport();
  if (!transport) {
    throw new Error('Email is not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in the environment.');
  }
  const from = process.env.EMAIL_FROM || process.env.GMAIL_USER;
  return transport.sendMail({ from, to, subject, html });
}

/* ── HTML rendering helpers ── */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A message body is either a legacy plain string, an HTML string, or an array of
// rich-text blocks ([{type:'text', value:'<html>'}, {type:'image', url, name}]).
function renderBody(body) {
  if (Array.isArray(body)) {
    const parts = body.map(block => {
      if (block?.type === 'image' && block.url) {
        return `<div style="margin:6px 0;"><img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.name || '')}" style="max-width:100%;border-radius:8px;" /></div>`;
      }
      const v = (block?.value || '').trim();
      if (!v) return '';
      return /[<&]/.test(v) ? v : escapeHtml(v).replace(/\n/g, '<br>');
    });
    return parts.filter(Boolean).join('') || '<span style="color:#9ca3af;">(no content)</span>';
  }
  if (typeof body === 'string' && body.trim()) {
    return /[<&]/.test(body) ? body : escapeHtml(body).replace(/\n/g, '<br>');
  }
  return '<span style="color:#9ca3af;">(no content)</span>';
}

const ROLE_LABEL = { reviewer: 'Reviewer', author: 'Author' };
const ROLE_COLOR = { reviewer: '#dc2626', author: '#059669' };

/**
 * Build the notification email for one recipient.
 * @param {object} opts
 * @param {string} opts.ticker
 * @param {string} opts.recipientName
 * @param {'author'|'reviewer'} opts.role — the recipient's role / whose turn it is
 * @param {Array} opts.threads — threads awaiting this recipient, each { title, messages }
 */
export function renderNotifyEmail({ ticker, recipientName, role, threads, stageLabel }) {
  const roleLabel = ROLE_LABEL[role] || 'Reviewer';
  const count = threads.length;
  // Surface the pipeline stage the name currently sits in (Watchlist, Draft & Review,
  // …) so the recipient knows where the discussion lives. Optional: callers that don't
  // know the stage (e.g. the auto-notify cron) omit it and get the generic wording.
  const stageSuffix = stageLabel ? ` · ${stageLabel}` : '';
  const subject = `[${ticker}${stageSuffix}] ${count} comment${count === 1 ? '' : 's'} awaiting your response`;

  const threadHtml = threads.map((thread, i) => {
    const messagesHtml = (thread.messages || []).map(msg => {
      const label = ROLE_LABEL[msg.role] || 'Author';
      const color = ROLE_COLOR[msg.role] || '#059669';
      return `
        <div style="border-left:2px solid ${color}33;padding:2px 0 2px 12px;margin:8px 0;">
          <div style="font-size:12px;font-weight:600;color:${color};">${label}</div>
          <div style="font-size:14px;color:#374151;line-height:1.5;">${renderBody(msg.body)}</div>
        </div>`;
    }).join('');

    return `
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:4px;">
          ${i + 1}. ${escapeHtml(thread.title || 'Untitled comment')}
        </div>
        ${messagesHtml}
      </div>`;
  }).join('');

  // Name where the comment currently lives so the recipient has the context. Falls
  // back to the historical "draft review" wording when no stage was supplied.
  const context = stageLabel
    ? `on <strong>${escapeHtml(ticker)}</strong> — currently in the <strong>${escapeHtml(stageLabel)}</strong> stage`
    : `on the <strong>${escapeHtml(ticker)}</strong> draft review`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">
      <p style="font-size:15px;margin:0 0 4px;">Hi ${escapeHtml(recipientName || roleLabel)},</p>
      <p style="font-size:15px;color:#374151;margin:0 0 16px;">
        It's your turn to respond as <strong>${roleLabel}</strong> ${context}.
        There ${count === 1 ? 'is' : 'are'} <strong>${count}</strong> comment${count === 1 ? '' : 's'} awaiting your reply:
      </p>
      ${threadHtml}
      <p style="font-size:12px;color:#9ca3af;margin-top:20px;">Sent from AlphaOS · Strategic Research</p>
    </div>`;

  return { subject, html };
}

/**
 * Build the notification email for a new comment on an in-app Feedback / Issues
 * ticket. Sent only when the admin explicitly opts in and picks a recipient at
 * comment / close time — a single immediate email, no cadence / auto-reminder.
 *
 * @param {object} opts
 * @param {number|undefined} opts.number — the tenant-scoped issue number (#12)
 * @param {string} opts.title — the issue title
 * @param {string} opts.recipientName — optional display name of the recipient
 * @param {string} opts.commenterName — who wrote the comment
 * @param {*} opts.body — the new comment, in RichTextArea block format
 * @param {boolean} opts.closing — true when the comment accompanied closing the issue
 */
export function renderIssueNotifyEmail({ number, title, recipientName, commenterName, body, closing }) {
  const ref = number ? `#${number}` : '';
  const safeTitle = escapeHtml(title || 'this issue');
  const commenter = escapeHtml(commenterName || 'An admin');
  const action = closing
    ? `<strong>${commenter}</strong> closed an issue${ref ? ` (<strong>${ref}</strong>)` : ''} with a comment:`
    : `<strong>${commenter}</strong> commented on an issue${ref ? ` (<strong>${ref}</strong>)` : ''}:`;
  const subject = closing
    ? `[Issue${ref ? ` ${ref}` : ''}] Closed with a comment — "${title || 'issue'}"`
    : `[Issue${ref ? ` ${ref}` : ''}] New comment on "${title || 'issue'}"`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">
      <p style="font-size:15px;margin:0 0 4px;">Hi ${escapeHtml(recipientName || 'there')},</p>
      <p style="font-size:15px;color:#374151;margin:0 0 16px;">${action}</p>
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px;">${safeTitle}</div>
        <div style="border-left:2px solid #05966933;padding:2px 0 2px 12px;margin:4px 0;">
          <div style="font-size:12px;font-weight:600;color:#059669;">${commenter}</div>
          <div style="font-size:14px;color:#374151;line-height:1.5;">${renderBody(body)}</div>
        </div>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:16px 0 0;">
        Open the <strong>Feedback</strong> panel in AlphaOS to reply or see the full thread.
      </p>
      <p style="font-size:12px;color:#9ca3af;margin-top:20px;">Sent from AlphaOS · Strategic Research</p>
    </div>`;

  return { subject, html };
}

/**
 * Given the draftReview state, figure out which unresolved threads are waiting on
 * each role. A thread is "waiting" on whoever should speak next: the opposite of
 * the last message's role. Empty threads (no comments yet) are skipped — there's
 * nothing to respond to.
 */
export function computePendingThreads(threads) {
  const pending = { author: [], reviewer: [] };
  for (const thread of threads || []) {
    if (thread?.resolved) continue;
    const messages = thread?.messages || [];
    if (messages.length === 0) continue;
    const lastRole = messages[messages.length - 1].role;
    const nextRole = lastRole === 'reviewer' ? 'author' : 'reviewer';
    pending[nextRole].push(thread);
  }
  return pending;
}
