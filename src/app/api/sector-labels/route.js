import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { readSetting, writeSetting } from '@/lib/appSettings';

const KEY = 'sector_config';

async function readConfig() {
  const supabase = await getDb();
  return (await readSetting(supabase, KEY, {})) || {};
}

async function writeConfig(config) {
  const supabase = await getDb();
  await writeSetting(supabase, KEY, config);
}

export async function GET() {
  return NextResponse.json(await readConfig());
}

export async function PUT(request) {
  try {
    const { sector, label, color } = await request.json();
    if (!sector) {
      return NextResponse.json({ error: 'sector is required' }, { status: 400 });
    }

    const config = await readConfig();
    if (!config[sector]) config[sector] = {};

    if (label !== undefined) {
      if (!label || label.trim() === '' || label.trim() === sector) {
        delete config[sector].label;
      } else {
        config[sector].label = label.trim();
      }
    }

    if (color !== undefined) {
      if (!color) {
        delete config[sector].color;
      } else {
        config[sector].color = color;
      }
    }

    if (Object.keys(config[sector]).length === 0) delete config[sector];

    await writeConfig(config);
    return NextResponse.json(config);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
