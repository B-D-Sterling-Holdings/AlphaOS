import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, mutateSetting } from '@/lib/appSettings';

const KEY = 'sector_config';

export async function GET() {
  const supabase = await getDb();
  return NextResponse.json((await readSetting(supabase, KEY, {})) || {});
}

export async function PUT(request) {
  try {
    const { sector, label, color } = await request.json();
    if (!sector) {
      return NextResponse.json({ error: 'sector is required' }, { status: 400 });
    }
    const supabase = await getDb();

    // Server-side read-modify-write under the version guard: relabeling one sector
    // won't clobber a concurrent relabel of another (both are patches to the same
    // JSONB blob).
    const config = await mutateSetting(supabase, KEY, (current) => {
      const next = { ...(current || {}) };
      next[sector] = { ...(next[sector] || {}) };

      if (label !== undefined) {
        if (!label || label.trim() === '' || label.trim() === sector) delete next[sector].label;
        else next[sector].label = label.trim();
      }
      if (color !== undefined) {
        if (!color) delete next[sector].color;
        else next[sector].color = color;
      }
      if (Object.keys(next[sector]).length === 0) delete next[sector];
      return next;
    }, {});

    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
