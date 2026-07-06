import { NextResponse } from 'next/server';
import { uploadTenantImage, deleteTenantImage } from '@/lib/storage';

/*
  Rich-text inline images. All storage mechanics (tenant-prefixed path
  construction, private bucket, path authorization) live in src/lib/storage.js
  — this route only shuttles the multipart body in and the app-relative URL
  out. The returned `url` is auth-gated (/api/storage/object), not a public
  object URL, so pasting/copying it leaks nothing.
*/

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    const { path, url } = await uploadTenantImage({
      ticker: formData.get('ticker')?.toString(),
      file,
    });
    return NextResponse.json({ success: true, url, path });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    // deleteTenantImage authorizes the path against the session tenant
    // (including the CIO legacy-path exception) before removing anything.
    await deleteTenantImage(path);
    return NextResponse.json({ success: true });
  } catch (e) {
    const status = e.status || 500;
    const message = status === 403 ? 'Invalid path' : e.message;
    return NextResponse.json({ error: message }, { status });
  }
}
