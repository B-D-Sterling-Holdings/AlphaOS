import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/*
  Saved review contacts — a small per-tenant address book of people you regularly
  add as the Author or Reviewer on a Draft & Review. Stored as a JSON array of
  { name, email } in the shared `app_settings` key/value table (same pattern as
  /api/assignees), so no new table/migration is needed.
*/

const TABLE = 'app_settings';
const KEY = 'saved_emails';

function normalizePerson(p) {
  return { name: (p?.name || '').trim(), email: (p?.email || '').trim() };
}

// De-dupe by lowercased email (falling back to name), keeping the first seen.
function dedupe(people) {
  const seen = new Set();
  const out = [];
  for (const raw of people) {
    const p = normalizePerson(raw);
    if (!p.email && !p.name) continue;
    const k = (p.email || p.name).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// GET - load the saved [{name, email}] list
export async function GET() {
  const supabase = await getDb();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('key', KEY)
      .single();

    if (error && error.code === 'PGRST116') {
      return NextResponse.json({ people: [] });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let people = [];
    try {
      people = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch {
      people = [];
    }

    return NextResponse.json({ people: Array.isArray(people) ? dedupe(people) : [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT - replace the saved list with the provided [{name, email}] array
export async function PUT(req) {
  const supabase = await getDb();
  try {
    const { people } = await req.json();
    if (!Array.isArray(people)) {
      return NextResponse.json({ error: 'people must be an array' }, { status: 400 });
    }

    const clean = dedupe(people);
    const row = { key: KEY, value: clean }; // app_settings.value is JSONB — store natively

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: 'tenant_id,key' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let saved = [];
    try {
      saved = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch {
      saved = clean;
    }

    return NextResponse.json({ people: Array.isArray(saved) ? saved : clean });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
