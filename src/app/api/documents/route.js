import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { conflictResponse } from '@/lib/apiResponses';
import {
  confirmTenantDocumentUpload,
  deleteTenantDocument,
  appStorageUrl,
  DOCUMENT_BUCKET,
} from '@/lib/storage';

/*
  Document library. Bytes live in the private `documents` bucket; metadata lives
  in the tenant-scoped `documents` table.

  Uploads are two-step so large files don't have to stream through this
  serverless function (which has a small request-body limit): the browser first
  gets a signed upload URL from /api/documents/upload-url, PUTs the bytes
  directly to Storage, then POSTs here with the resulting storage path. POST
  re-verifies (via storage.js) that the path belongs to this tenant and the
  object really exists before recording the row — size/type are read back from
  Storage, not trusted from the body.

  Rows store — and GET always (re)derives — the app-relative, auth-gated URL
  for each file (`/api/storage/object?...`). Deriving on read means rows
  written before the private-bucket cutover (which stored public object URLs)
  serve correctly with no data migration for this table.
*/

export async function GET(request) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    let query = supabase.from('documents').select('*').order('uploaded_at', { ascending: false });
    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const documents = (data || []).map((doc) =>
      doc.storage_path ? { ...doc, url: appStorageUrl(DOCUMENT_BUCKET, doc.storage_path) } : doc
    );

    return NextResponse.json({ documents });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — record metadata for a file the browser already uploaded directly to
// Storage (see /api/documents/upload-url). The bytes never touch this function.
export async function POST(request) {
  const supabase = await getDb();
  try {
    const body = await request.json().catch(() => ({}));
    const storagePath = body.storagePath?.toString() || '';
    const fileName = body.fileName?.toString() || '';
    const title = body.title?.toString() || '';
    const category = body.category?.toString() || 'other';
    const ticker = body.ticker?.toString().toUpperCase() || '';
    const notes = body.notes?.toString() || '';

    if (!storagePath) {
      return NextResponse.json({ error: 'storagePath is required' }, { status: 400 });
    }

    // Re-authorize the path against the session tenant and confirm the object
    // exists; size/type come back from Storage, not the client body.
    const { path, url, size, contentType } = await confirmTenantDocumentUpload(storagePath);

    const { data: doc, error: dbError } = await supabase.from('documents').insert({
      title: title || fileName,
      category,
      ticker,
      notes,
      file_name: fileName,
      file_type: contentType || body.fileType?.toString() || '',
      file_size: size,
      storage_path: path,
      url,
    }).select().single();

    if (dbError) throw new Error(dbError.message);

    return NextResponse.json({ success: true, document: doc });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}

export async function PUT(request) {
  const supabase = await getDb();
  try {
    const body = await request.json();
    const { id, title } = body;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { category, ticker, notes, baseVersion } = body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (ticker !== undefined) updates.ticker = ticker;
    if (notes !== undefined) updates.notes = notes;

    // Version-guarded metadata edit → canonical 409 on a concurrent edit.
    const doc = await versionedWrite(supabase, 'documents', {
      match: { id }, values: updates, baseVersion, onConflict: 'id',
    });

    return NextResponse.json({ success: true, document: doc });
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // The row is RLS-scoped to this tenant, and deleteTenantDocument
    // re-authorizes the path against the session tenant anyway.
    const { data: doc } = await supabase.from('documents').select('storage_path').eq('id', id).single();

    if (doc?.storage_path) {
      await deleteTenantDocument(doc.storage_path);
    }

    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
