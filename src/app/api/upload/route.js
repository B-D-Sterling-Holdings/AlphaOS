import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CIO_TENANT_ID } from '@/lib/auth';

const BUCKET = 'research-images';

// Storage isolation is purely by the `<tenant_id>/` path prefix (storage
// bypasses table RLS), so any user-supplied value that lands in an object path
// must not be able to introduce separators or dot-dot segments.
function safeSegment(value, fallback) {
  const clean = String(value ?? '')
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim();
  return clean || fallback;
}

const TENANT_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

export async function POST(request) {
  const supabase = await getDb();
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const ticker = safeSegment(formData.get('ticker')?.toString().toUpperCase(), 'UNKNOWN');

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = safeSegment(file.name, 'file');
    const path = `${supabase.storagePrefix}${ticker}/${Date.now()}_${fileName}`;

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

    // Storage bypasses RLS, so authorize the path here: a session may only
    // delete objects inside its own tenant prefix. The CIO tenant may also
    // remove pre-multitenancy objects (uploaded before paths were prefixed),
    // which by construction never sit under another tenant's UUID prefix.
    const ownPath = path.startsWith(supabase.storagePrefix);
    const legacyCioPath =
      supabase.tenantId === CIO_TENANT_ID && !TENANT_PREFIX_RE.test(path);
    if (path.includes('..') || (!ownPath && !legacyCioPath)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
