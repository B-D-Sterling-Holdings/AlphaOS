import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';

/*
  In-app issue tracker (the Issues widget in the navbar).

  Supabase table required — created by scripts/migrations/010_issues.sql. Rows are
  tenant-scoped by RLS, so every user in a tenant shares the same issue board.

  Authorization split:
    - Any authenticated user may open an issue (POST) or comment (PUT action=comment).
    - Only an admin (the CIO login) may resolve, reopen, or delete. Those are gated
      HERE, from the verified session — RLS only enforces tenant isolation, not roles.

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

// GET — every issue for the tenant (newest activity first). The client splits
// open vs. resolved into the Open / Closed tabs. Priority and dev notes are the
// admin's private triage state — stripped for everyone else.
export async function GET() {
  try {
    const db = await getDb();
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = db.isAdmin
      ? (data || [])
      : (data || []).map(({ priority, dev_notes, ...rest }) => rest);
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
//   comment          (any user)  append a comment
//   labels           (any user)  replace the label list
//   resolve / reopen (admin only) change status / archive
//   priority         (admin only) set triage priority (1..4 or null)
//   dev-notes        (admin only) set the triage note
export async function PUT(req) {
  try {
    const db = await getDb();
    const body = await req.json();
    const { id, action } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Comment — open to every user in the tenant.
    if (action === 'comment') {
      if (isBodyEmpty(body.body)) {
        return NextResponse.json({ error: 'Comment is empty' }, { status: 400 });
      }
      // Read-modify-write the comments array (RLS scopes both to this tenant).
      const { data: existing, error: readErr } = await db
        .from(TABLE).select('comments').eq('id', id).single();
      if (readErr) throw new Error(readErr.message);
      const comment = {
        id: randomUUID(),
        author: db.username || '',
        body: normalizeBody(body.body),
        createdAt: new Date().toISOString(),
      };
      const comments = [...(existing?.comments || []), comment];
      const { data, error } = await db
        .from(TABLE)
        .update({ comments, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    // Labels — open to every user in the tenant (only closing is admin-locked).
    if (action === 'labels') {
      const { data, error } = await db
        .from(TABLE)
        .update({ labels: normalizeLabels(body.labels), updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    // Priority / dev notes — the admin's triage state for the Dev tab.
    if (action === 'priority' || action === 'dev-notes') {
      if (!db.isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
      const updates = action === 'priority'
        ? { priority: [1, 2, 3, 4].includes(body.priority) ? body.priority : null }
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
      const { data: existing, error: readErr } = await db
        .from(TABLE).select('comments').eq('id', id).single();
      if (readErr) throw new Error(readErr.message);
      const comments = (existing?.comments || []).filter(c => c.id !== commentId);
      const { data, error } = await db
        .from(TABLE)
        .update({ comments, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    const { error } = await db.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
