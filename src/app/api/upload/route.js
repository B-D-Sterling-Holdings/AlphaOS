import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const BUCKET = 'research-images';

export async function POST(request) {
  const supabase = await getDb();
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const ticker = formData.get('ticker')?.toString().toUpperCase() || 'UNKNOWN';

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop();
    const path = `${supabase.storagePrefix}${ticker}/${Date.now()}_${file.name}`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) throw new Error(error.message);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);

    return NextResponse.json({ success: true, url: urlData.publicUrl, path: data.path });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }

    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
