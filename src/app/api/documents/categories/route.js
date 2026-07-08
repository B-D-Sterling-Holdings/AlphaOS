import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, writeSetting } from '@/lib/appSettings';
import { normalizeCategories } from '@/lib/documentCategories';

/*
  Editable document section types ("categories" — the left rail on the Documents
  page). The full list is one JSONB row in app_settings under `document_categories`,
  tenant-scoped by RLS. Absent row → the seeded defaults (normalizeCategories).

  Any authenticated tenant user may manage the list, matching the rest of the
  document library, which has no admin gate. The list is small and bounded, so we
  just replace the whole array on PUT (mirrors the allocation-schemes route).
*/

const KEY = 'document_categories';
const MAX_CATEGORIES = 40;

export async function GET() {
  try {
    const supabase = await getDb();
    const stored = await readSetting(supabase, KEY, null);
    return NextResponse.json({ categories: normalizeCategories(stored) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT — replace the whole list. Body: { categories: [...] }. The payload is
// sanitized (unknown icons/colors coerced, built-ins re-inserted) before saving,
// so a malformed client request can never corrupt the sidebar.
export async function PUT(request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.categories)) {
      return NextResponse.json({ error: 'categories array is required' }, { status: 400 });
    }
    const categories = normalizeCategories(body.categories).slice(0, MAX_CATEGORIES);

    const supabase = await getDb();
    await writeSetting(supabase, KEY, categories);
    return NextResponse.json({ categories });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
