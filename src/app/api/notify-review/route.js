import { NextResponse } from 'next/server';
import { sendEmail, renderNotifyEmail, computePendingThreads } from '@/lib/email';
import { getSession } from '@/lib/db';
import { signStorageUrlsForTenant } from '@/lib/storage';

/**
 * POST /api/notify-review
 * Body: { ticker, author: {name, email}, reviewer: {name, email}, threads: [...] }
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

    const { ticker, author, reviewer, threads, threadIds } = await request.json();

    if (!ticker) {
      return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
    }

    const pending = computePendingThreads(threads);

    // If the caller picked specific comments, only notify about those.
    if (Array.isArray(threadIds)) {
      const idSet = new Set(threadIds);
      pending.author = pending.author.filter(t => idSet.has(t.id));
      pending.reviewer = pending.reviewer.filter(t => idSet.has(t.id));
    }
    const roles = { author, reviewer };

    const sent = [];
    const skipped = [];

    for (const role of ['reviewer', 'author']) {
      const items = pending[role];
      if (!items.length) continue;

      const person = roles[role] || {};
      if (!person.email) {
        skipped.push({ role, count: items.length, reason: 'no email set' });
        continue;
      }

      // Rewrite inline-image references into signed URLs the recipient's
      // email client can actually load (no cookie there).
      const signedItems = await signStorageUrlsForTenant(items, { tenantId: session.tenantId });
      const { subject, html } = renderNotifyEmail({
        ticker,
        recipientName: person.name,
        role,
        threads: signedItems,
      });

      try {
        await sendEmail({ to: person.email, subject, html });
        sent.push({ role, email: person.email, count: items.length });
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
