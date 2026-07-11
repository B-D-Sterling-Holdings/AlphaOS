import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';
import { versionedMutate } from '@/lib/concurrency';
import { sendEmail, renderIssueNotifyEmail } from '@/lib/email';
import { signStorageUrlsForTenant } from '@/lib/storage';

/*
  In-app issue tracker (the Issues widget in the navbar).

  Supabase table required — created by scripts/migrations/010_issues.sql. Rows are
  tenant-scoped by RLS, so every user in a tenant shares the same issue board.

  Authorization split:
    - Any authenticated user may open an issue (POST) or comment (PUT action=comment).
    - Non-admins only ever see (and may only comment on / relabel) issues THEY
      authored — the board is not shared; it reads as "my open/closed tickets".
    - Only an admin (the CIO login) sees every issue and may resolve, reopen, or
      delete. All of this is gated HERE, from the verified session — RLS only
      enforces tenant isolation, not roles.

  Author/attribution is always taken from the session (db.username), never from the
  client body — a user can't post as someone else.
*/

const TABLE = 'issues';

// Reject bodies that are visually empty (whitespace / empty tags / no image), so a
// blank rich-text editor doesn't create an empty issue or comment. Mirrors the
// emptiness check RichTextArea callers use.
function isBodyEmpty(value) {
  if (Array.isArray(value)) {
    return !value.some(block => block?.type === 'image'
      || (block?.value && block.value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()));
  }
  return !(typeof value === 'string' && value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
}

// Normalize a RichTextArea value into the stored block array shape.
function normalizeBody(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) return [{ type: 'text', value }];
  return [];
}

// Labels are stored as an array of plain names (the palette lives in the UI).
// Cap count/length so a hand-crafted request can't stuff junk in the column.
function normalizeLabels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter(l => typeof l === 'string')
    .map(l => l.trim().slice(0, 50))
    .filter(Boolean))].slice(0, 10);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email a comment notification when an admin explicitly opts in and chose a
// recipient in the comment composer. Best-effort and self-contained: the comment
// is already persisted before this runs, so any failure here (invalid address,
// mail transport down) is swallowed and must never fail the comment request.
// Only admins may trigger a send — a non-admin's notifyEmail is ignored, so this
// can't be abused as an open mail relay.
async function notifyIssueComment(db, { issue, commentBody, notify }) {
  try {
    if (!db.isAdmin) return;
    const to = (notify?.email || '').trim();
    if (!EMAIL_RE.test(to)) return; // no / invalid recipient → no email
    // Re-sign inline-image references so the recipient's email client (no cookie)
    // can load them; take the tenant from the verified session, never the client.
    const signedBody = await signStorageUrlsForTenant(commentBody, { tenantId: db.tenantId });
    const { subject, html } = renderIssueNotifyEmail({
      number: issue.number,
      title: issue.title,
      recipientName: typeof notify?.name === 'string' ? notify.name.slice(0, 120) : '',
      commenterName: db.username,
      body: signedBody,
      closing: !!notify?.closing,
    });
    await sendEmail({ to, subject, html });
  } catch {
    // Swallow — notification is best-effort; the comment already succeeded.
  }
}

// GET — the caller's visible issues (newest activity first). Admins see the whole
// tenant board; everyone else sees only the tickets they authored. The client
// splits open vs. resolved into the Open / Closed tabs. Priority and dev notes
// are the admin's private triage state — stripped for everyone else.
export async function GET() {
  try {
    const db = await getDb();
    let query = db
      .from(TABLE)
      .select('*')
      .order('updated_at', { ascending: false });
    if (!db.isAdmin) query = query.eq('author', db.username || '');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = db.isAdmin
      ? (data || [])
      : (data || []).map(({ priority, dev_notes, sort_order, complexity, ...rest }) => rest);
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — open a new issue. Any authenticated user.
export async function POST(req) {
  try {
    const db = await getDb();
    const body = await req.json();
    const title = (body.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    const insert = {
      title,
      body: normalizeBody(body.body),
      status: 'open',
      author: db.username || '',
      comments: [],
      updated_at: new Date().toISOString(),
    };
    // Per-tenant sequential number (#12), GitHub-style. max(number) runs under
    // RLS so it only ever sees this tenant's rows; numbers are not reused after
    // deletes. Concurrent creates racing to the same number is acceptable here —
    // it's an internal tracker, and number carries no uniqueness constraint.
    // If the select errors, migration 013 hasn't been applied yet — insert
    // without number/labels so issue creation keeps working.
    const { data: top, error: topErr } = await db
      .from(TABLE).select('number').order('number', { ascending: false }).limit(1);
    if (!topErr) {
      insert.number = (top?.[0]?.number || 0) + 1;
      insert.labels = normalizeLabels(body.labels);
    }
    const { data, error } = await db.from(TABLE).insert(insert).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT — mutate an existing issue via an explicit action:
//   comment            (any user)  append a comment
//   labels             (any user)  replace the label list
//   resolve / reopen   (admin only) change status
//   archive / unarchive(admin only) move to / out of the Archived tab
//   priority           (admin only) set triage priority (1..4 or null)
//   complexity       (admin only) set triage complexity (1..5 or null)
//   dev-notes        (admin only) set the triage note
//   sort-order       (admin only) set the manual rank within a priority band
export async function PUT(req) {
  try {
    const db = await getDb();
    const body = await req.json();
    const { id, action } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Comment — admins anywhere; everyone else only on their own tickets
    // (mirrors GET visibility, so you can't comment on an issue you can't see).
    if (action === 'comment') {
      if (isBodyEmpty(body.body)) {
        return NextResponse.json({ error: 'Comment is empty' }, { status: 400 });
      }
      // Version-guarded read-modify-write with retry, so two people commenting on
      // the same issue at once BOTH land (an append must never be lost or 409'd).
      const data = await versionedMutate(db, TABLE, {
        match: { id },
        mutate: (existing) => {
          // Non-admins can only comment on their own tickets (mirrors GET visibility).
          if (!db.isAdmin && existing.author !== db.username) return null;
          const comment = {
            id: randomUUID(),
            author: db.username || '',
            body: normalizeBody(body.body),
            createdAt: new Date().toISOString(),
          };
          return { comments: [...(existing.comments || []), comment], updated_at: new Date().toISOString() };
        },
      });
      if (!data) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
      // Optional email notification — only when the admin opted in and picked a
      // recipient in the composer (body.notify). This single hook covers both a
      // plain comment and "close with comment" (the UI posts the comment before
      // resolving, flagging notify.closing). No notify → no email.
      await notifyIssueComment(db, {
        issue: data,
        commentBody: normalizeBody(body.body),
        notify: body.notify,
      });
      return NextResponse.json(data);
    }

    // Labels — admins anywhere; everyone else only on their own tickets.
    if (action === 'labels') {
      let update = db
        .from(TABLE)
        .update({ labels: normalizeLabels(body.labels), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (!db.isAdmin) update = update.eq('author', db.username || '');
      const { data, error } = await update.select().maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
      return NextResponse.json(data);
    }

    // Priority / complexity / dev notes / manual order — the admin's triage
    // state for the Dev tab.
    if (action === 'priority' || action === 'complexity' || action === 'dev-notes' || action === 'sort-order') {
      if (!db.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      const updates = action === 'priority'
        ? { priority: [1, 2, 3, 4].includes(body.priority) ? body.priority : null }
        : action === 'complexity'
          ? { complexity: [1, 2, 3, 4, 5].includes(body.complexity) ? body.complexity : null }
          : action === 'sort-order'
            ? { sort_order: Number.isFinite(Number(body.sort_order)) ? Math.trunc(Number(body.sort_order)) : 0 }
            : { dev_notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '' };
      // Triage doesn't touch updated_at — reprioritizing shouldn't bump an issue
      // to the top of "Recently updated" for the whole team.
      const { data, error } = await db
        .from(TABLE).update(updates).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    // Resolve / reopen — admin only.
    if (action === 'resolve' || action === 'reopen') {
      if (!db.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      const updates = action === 'resolve'
        ? { status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: db.username || '' }
        : { status: 'open', resolved_at: null, resolved_by: null };
      updates.updated_at = new Date().toISOString();
      const { data, error } = await db
        .from(TABLE).update(updates).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    // Archive / unarchive — admin only. Orthogonal to status (an open OR a
    // resolved issue can be archived); archived rows are hidden from every tab
    // except the Archived one. Requires migration 033 (the archived_at column);
    // before that runs the update simply errors and the button reports it.
    if (action === 'archive' || action === 'unarchive') {
      if (!db.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      const updates = {
        archived_at: action === 'archive' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await db
        .from(TABLE).update(updates).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE — admin only. `?id=` removes the issue; `?id=&commentId=` removes a single
// comment (moderation). Regular users can never delete anything.
export async function DELETE(req) {
  try {
    const db = await getDb();
    if (!db.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const params = new URL(req.url).searchParams;
    const id = params.get('id');
    const commentId = params.get('commentId');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    if (commentId) {
      // Same guarded read-modify-write as the append, so deleting a comment can't
      // clobber a concurrent comment on the same issue.
      const data = await versionedMutate(db, TABLE, {
        match: { id },
        mutate: (existing) => ({
          comments: (existing.comments || []).filter(c => c.id !== commentId),
          updated_at: new Date().toISOString(),
        }),
      });
      if (!data) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
      return NextResponse.json(data);
    }

    const { error } = await db.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
