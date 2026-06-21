import { NextResponse } from 'next/server';
import { sendEmail, renderNotifyEmail, computePendingThreads } from '@/lib/email';

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

      const { subject, html } = renderNotifyEmail({
        ticker,
        recipientName: person.name,
        role,
        threads: items,
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
