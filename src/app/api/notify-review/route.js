import { NextResponse } from 'next/server';
import { sendEmail, renderNotifyEmail, computePendingThreads } from '@/lib/email';
import { getSession } from '@/lib/db';
import { getEmailsForUserIds } from '@/lib/users';
import { signStorageUrlsForTenant } from '@/lib/storage';
import { STAGE_LABELS } from '@/lib/stageMove';

/**
 * POST /api/notify-review
 * Body: { ticker, author: {userId, name}, reviewer: {userId, name}, threads: [...] }
 *
 * Author/reviewer are now workspace users: their email is resolved live from the
 * users table (see /api/workspace-users + the Admin email field), scoped to the
 * session's tenant, rather than a typed-in address. A person with no email set
 * is reported as skipped with reason "email is not set up". Legacy records that
 * still carry a `person.email` (pre-migration) fall back to it so old theses
 * keep working.
 *
 * Looks at every unresolved thread, works out whose turn it is to respond next,
 * and sends each person (author / reviewer) a single email bundling all the
 * comments awaiting them — including the full comment + reply content.
 */
export async function POST(request) {
  try {
    // The session tenant authorizes which storage paths may be re-signed into
    // the outgoing email — a crafted body can't reference another tenant's
    // files into a signed URL (those paths are simply left untouched).
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ticker, author, reviewer, threads, threadIds, stage } = await request.json();

    if (!ticker) {
      return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
    }

    // Which pipeline stage the name is viewed in (sent by the page that fired the
    // notify), surfaced in the email so the recipient knows where it lives. Unknown
    // stages fall through to the generic wording.
    const stageLabel = STAGE_LABELS[stage] || null;

    const pending = computePendingThreads(threads);

    // If the caller picked specific comments, only notify about those.
    if (Array.isArray(threadIds)) {
      const idSet = new Set(threadIds);
      pending.author = pending.author.filter(t => idSet.has(t.id));
      pending.reviewer = pending.reviewer.filter(t => idSet.has(t.id));
    }
    const roles = { author, reviewer };

    // Resolve each role's email from their workspace user record (scoped to this
    // tenant), falling back to any legacy typed-in address on the record.
    const ids = [author?.userId, reviewer?.userId].filter(Boolean);
    const emailById = await getEmailsForUserIds(ids, session.tenantId);
    const emailFor = (person) =>
      (person?.userId && emailById.get(person.userId)) || person?.email || null;

    const sent = [];
    const skipped = [];

    for (const role of ['reviewer', 'author']) {
      const items = pending[role];
      if (!items.length) continue;

      const person = roles[role] || {};
      const personEmail = emailFor(person);
      if (!personEmail) {
        skipped.push({ role, count: items.length, reason: 'email is not set up' });
        continue;
      }

      // CC the other party so both sides see the back-and-forth: the author is
      // copied when the reviewer is emailed, and vice versa. Skip when the
      // counterpart has no email, or is the same address as the recipient.
      const counterpart = roles[role === 'reviewer' ? 'author' : 'reviewer'] || {};
      const counterpartEmail = emailFor(counterpart);
      const cc = counterpartEmail && counterpartEmail.toLowerCase() !== personEmail.toLowerCase()
        ? counterpartEmail
        : undefined;

      // Rewrite inline-image references into signed URLs the recipient's
      // email client can actually load (no cookie there).
      const signedItems = await signStorageUrlsForTenant(items, { tenantId: session.tenantId });
      const { subject, html } = renderNotifyEmail({
        ticker,
        recipientName: person.name,
        role,
        threads: signedItems,
        stageLabel,
      });

      try {
        await sendEmail({ to: personEmail, cc, subject, html });
        sent.push({ role, email: personEmail, cc: cc || null, count: items.length });
      } catch (e) {
        skipped.push({ role, count: items.length, reason: e.message });
      }
    }

    if (!sent.length && !skipped.length) {
      return NextResponse.json({ sent, skipped, message: 'No comments are awaiting a response.' });
    }

    return NextResponse.json({ sent, skipped });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
