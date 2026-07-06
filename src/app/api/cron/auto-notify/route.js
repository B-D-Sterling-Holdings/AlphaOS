import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { sendEmail, renderNotifyEmail } from '@/lib/email';
import { selectDueReminders, computeNextSent } from '@/lib/autoNotify';
import { signStorageUrlsForTenant } from '@/lib/storage';

/**
 * GET|POST /api/cron/auto-notify
 *
 * The server side of Draft & Review auto-notify: it fires reminders even when no
 * one has the review open. A scheduler (Vercel Cron, GitHub Actions, system cron,
 * Supabase pg_cron…) hits this on an interval; for each review with auto-notify
 * enabled it emails whoever has a comment that has waited past the configured
 * delay, then records what it sent so the same comment isn't nudged twice.
 *
 * Auth: a shared secret (CRON_SECRET). Fail-closed — no secret set ⇒ 401.
 *   Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
 *   Other schedulers can use that header, `x-cron-secret: <secret>`, or `?secret=`.
 *
 * Tenancy: a cron has no user session, so it can't use the RLS-scoped client.
 * It runs through `supabaseAdmin` (service role, BYPASSRLS) to scan every tenant,
 * and writes the dedup map back via an RPC that updates only the nested
 * `draftReview.autoNotify.sent` path — so it can never clobber a user's
 * concurrent edit to the rest of the thesis (see migration 006).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: no secret configured ⇒ no access
  const header = request.headers.get('authorization');
  if (header === `Bearer ${secret}`) return true;
  if (request.headers.get('x-cron-secret') === secret) return true;
  try {
    if (new URL(request.url).searchParams.get('secret') === secret) return true;
  } catch { /* ignore malformed URL */ }
  return false;
}

async function runAutoNotify() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Service role bypasses RLS, so this returns every tenant's reviews. We pull
  // the whole `underwriting` (simplest + always correct) and filter in code;
  // theses are bounded by tickers-per-tenant. If that grows, add a JSON-path
  // filter: .eq('underwriting->draftReview->autoNotify->>enabled', true).
  const { data: rows, error } = await supabaseAdmin
    .from('theses')
    .select('tenant_id, ticker, underwriting');
  if (error) throw new Error(error.message);

  const summary = {
    scanned: rows?.length || 0,
    reviewsEnabled: 0,
    emailsSent: 0,
    threadsReminded: 0,
    skipped: [],
    errors: [],
  };

  for (const row of rows || []) {
    const draftReview = row.underwriting?.draftReview;
    const autoNotify = draftReview?.autoNotify;
    if (!autoNotify?.enabled) continue;
    summary.reviewsEnabled++;

    const threads = draftReview.threads || [];
    const author = draftReview.author || {};
    const reviewer = draftReview.reviewer || {};
    const emails = { author: author.email, reviewer: reviewer.email };

    const due = selectDueReminders({ threads, autoNotify, emails, now });
    const remindedIds = [];

    for (const role of ['reviewer', 'author']) {
      const items = due[role];
      if (!items.length) continue;
      const person = role === 'reviewer' ? reviewer : author;
      if (!person.email) {
        summary.skipped.push({ ticker: row.ticker, role, count: items.length, reason: 'no email set' });
        continue;
      }
      // Inline images reference auth-gated app URLs (or legacy public URLs),
      // neither of which an email client can load. Re-sign them for the
      // tenant that OWNS this thesis row — authority comes from the DB, and
      // paths outside that tenant's prefix are left untouched.
      const signedItems = await signStorageUrlsForTenant(items, { tenantId: row.tenant_id });
      const { subject, html } = renderNotifyEmail({
        ticker: row.ticker,
        recipientName: person.name,
        role,
        threads: signedItems,
      });
      try {
        await sendEmail({ to: person.email, subject, html });
        summary.emailsSent++;
        for (const t of items) remindedIds.push(t.id);
      } catch (e) {
        summary.errors.push({ ticker: row.ticker, role, error: e.message });
      }
    }

    if (!remindedIds.length) continue;
    summary.threadsReminded += remindedIds.length;

    // Persist the dedup map via a targeted nested-path update so a user's
    // concurrent thesis edit (which writes the whole `underwriting`) isn't lost.
    const nextSent = computeNextSent({ threads, prevSent: autoNotify.sent, remindedIds, nowIso });
    const { error: rpcError } = await supabaseAdmin.rpc('set_draftreview_autonotify_sent', {
      p_tenant: row.tenant_id,
      p_ticker: row.ticker,
      p_sent: nextSent,
    });
    if (rpcError) summary.errors.push({ ticker: row.ticker, role: 'persist', error: rpcError.message });
  }

  return summary;
}

async function handle(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runAutoNotify();
    // Send/persist failures (dead SMTP creds, RPC errors…) must not hide behind a
    // 200 — the Actions workflow only alarms on non-2xx, and a reminder that
    // silently never sends is worse than a red cron run.
    const ok = summary.errors.length === 0;
    return NextResponse.json(
      { ok, ranAt: new Date().toISOString(), ...summary },
      { status: ok ? 200 : 500 },
    );
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
