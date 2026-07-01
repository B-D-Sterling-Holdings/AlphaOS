import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const BUCKET = 'documents';

// Storage isolation is by the `<tenant_id>/` path prefix (storage bypasses
// table RLS), so user-supplied values that land in an object path must not be
// able to introduce separators or dot-dot segments.
function safeSegment(value, fallback) {
  const clean = String(value ?? '')
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim();
  return clean || fallback;
}

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

    return NextResponse.json({ documents: data || [] });
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = `${supabase.storagePrefix}${safeSegment(category, 'other')}/${Date.now()}_${safeSegment(file.name, 'file')}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);

    const { data: doc, error: dbError } = await supabase.from('documents').insert({
      title: title || file.name,
      category,
      ticker,
      notes,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_path: uploadData.path,
      url: urlData.publicUrl,
    }).select().single();

    if (dbError) throw new Error(dbError.message);

    return NextResponse.json({ success: true, document: doc });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
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

    const { category, ticker, notes } = body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (ticker !== undefined) updates.ticker = ticker;
    if (notes !== undefined) updates.notes = notes;

    const { data: doc, error } = await supabase
      .from('documents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, document: doc });
  } catch (e) {
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

    // Get the document to find storage path
    const { data: doc } = await supabase.from('documents').select('storage_path').eq('id', id).single();

    if (doc?.storage_path) {
      await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    }

    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
