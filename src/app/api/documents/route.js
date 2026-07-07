import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { versionedWrite, VersionConflictError } from '@/lib/concurrency';
import { conflictResponse } from '@/lib/apiResponses';
import {
  uploadTenantDocument,
  deleteTenantDocument,
  appStorageUrl,
  DOCUMENT_BUCKET,
} from '@/lib/storage';

/*
  Document library. Bytes live in the private `documents` bucket (uploaded /
  deleted through src/lib/storage.js, which owns path construction and tenant
  authorization); metadata lives in the tenant-scoped `documents` table.

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

export async function POST(request) {
  const supabase = await getDb();
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const title = formData.get('title')?.toString() || '';
    const category = formData.get('category')?.toString() || 'other';
    const ticker = formData.get('ticker')?.toString().toUpperCase() || '';
    const notes = formData.get('notes')?.toString() || '';

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const { path, url } = await uploadTenantDocument({ category, file });

    const { data: doc, error: dbError } = await supabase.from('documents').insert({
      title: title || file.name,
      category,
      ticker,
      notes,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
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
