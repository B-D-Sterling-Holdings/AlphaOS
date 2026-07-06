import { NextResponse } from 'next/server';
import { getTenantSignedUrl, isKnownBucket } from '@/lib/storage';

/*
  GET /api/storage/object?bucket=<bucket>&path=<tenant_id>/...[&download[=name]]

  The stable, auth-gated address of every stored object. Buckets are private
  (migration 021); this is the only way content reaches a browser. Stored
  rich-text images, document rows, and exports all reference THIS url — it is
  worthless without a valid session cookie, so a leaked link (history, logs,
  copied text, referrers) exposes nothing.

  Flow: verify session (proxy already required one; getTenantSignedUrl
  re-checks and enforces the tenant prefix) → 302 to a short-lived signed URL.
  <img src>, <a href>, and fetch() all follow the redirect transparently.

  The redirect is cacheable privately for slightly less than the signed URL's
  lifetime, so a page with many images doesn't re-mint on every render.
*/

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const bucket = searchParams.get('bucket');
  const path = searchParams.get('path');

  if (!bucket || !path) {
    return NextResponse.json({ error: 'bucket and path are required' }, { status: 400 });
  }
  if (!isKnownBucket(bucket)) {
    return NextResponse.json({ error: 'Unknown bucket' }, { status: 403 });
  }

  // Optional content-disposition: &download forces a download with the
  // object's own name, &download=<name> renames it.
  let download;
  if (searchParams.has('download')) {
    const name = searchParams.get('download');
    download = name ? name : true;
  }

  try {
    const signedUrl = await getTenantSignedUrl({ bucket, path, download });
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        // Private: per-user authorization decided this response. max-age just
        // under the signed TTL so a cached redirect never outlives its target.
        'Cache-Control': 'private, max-age=240',
      },
    });
  } catch (e) {
    const status = e.status || 500;
    const message = status === 403 ? 'Invalid path' : e.message;
    return NextResponse.json({ error: message }, { status });
  }
}
