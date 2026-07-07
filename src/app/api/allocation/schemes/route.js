import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { mutateSetting, readSetting } from '@/lib/appSettings';

const KEY = 'allocation_schemes';
const MAX_SCHEMES = 50; // keep the newest N; the Strategic Hub card is a light history

// GET - list saved allocation schemes (newest first)
export async function GET() {
  try {
    const supabase = await getDb();
    const schemes = await readSetting(supabase, KEY, []);
    return NextResponse.json({ schemes: Array.isArray(schemes) ? schemes : [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST - create/append a scheme. Body: { scheme }
export async function POST(req) {
  try {
    const { scheme } = await req.json();
    if (!scheme || typeof scheme !== 'object' || !scheme.id) {
      return NextResponse.json({ error: 'scheme with an id is required' }, { status: 400 });
    }

    const supabase = await getDb();
    await mutateSetting(supabase, KEY, (current) => {
      const list = Array.isArray(current) ? current : [];
      // Replace if this id already exists (idempotent create), else prepend newest-first.
      const withoutDupe = list.filter((s) => s?.id !== scheme.id);
      return [scheme, ...withoutDupe].slice(0, MAX_SCHEMES);
    }, []);

    return NextResponse.json({ scheme });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE - remove a saved scheme by id. ?id=<schemeId>
export async function DELETE(req) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    const supabase = await getDb();
    await mutateSetting(supabase, KEY, (current) => {
      const list = Array.isArray(current) ? current : [];
      return list.filter((s) => s?.id !== id);
    }, []);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - update an existing scheme in place (by id). Body: { scheme }
export async function PUT(req) {
  try {
    const { scheme } = await req.json();
    if (!scheme || typeof scheme !== 'object' || !scheme.id) {
      return NextResponse.json({ error: 'scheme with an id is required' }, { status: 400 });
    }

    const supabase = await getDb();
    await mutateSetting(supabase, KEY, (current) => {
      const list = Array.isArray(current) ? current : [];
      const idx = list.findIndex((s) => s?.id === scheme.id);
      if (idx === -1) return [scheme, ...list].slice(0, MAX_SCHEMES); // upsert if missing
      const next = [...list];
      next[idx] = { ...next[idx], ...scheme };
      return next;
    }, []);

    return NextResponse.json({ scheme });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
