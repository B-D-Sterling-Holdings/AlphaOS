import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createTenantDocumentUploadUrl } from '@/lib/storage';

/*
  Direct-to-Storage upload handshake for the document library.

  Large files (research PDFs, etc.) exceed the serverless request-body limit, so
  the bytes must NOT flow through this function. Instead the browser asks here
  for a short-lived signed upload URL, PUTs the file straight to Supabase
  Storage, then POSTs /api/documents with the returned path to record metadata.

  The object path is built server-side from the session tenant's prefix
  (createTenantDocumentUploadUrl) — the client only supplies a category hint and
  the original file name, never the destination path. getDb() gates the call on
  a valid session; storage.js re-derives the tenant from that session.
*/

export async function POST(request) {
  // Ensure the caller has a valid session before minting anything.
  await getDb();
  try {
    const body = await request.json().catch(() => ({}));
    const category = body.category?.toString() || 'other';
    const fileName = body.fileName?.toString() || '';
    if (!fileName) {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }
    const { bucket, path, token, signedUrl } = await createTenantDocumentUploadUrl({ category, fileName });
    return NextResponse.json({ bucket, path, token, signedUrl });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
