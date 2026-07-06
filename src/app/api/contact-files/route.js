import { getDb } from '@/lib/db';
import { apiBadRequest, apiCreated, apiError, apiJson, apiOk } from '@/lib/apiResponses';

/*
  CREATE TABLE contact_files (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT DEFAULT '',
    type TEXT DEFAULT 'link',
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_contact_files_contact ON contact_files(contact_id);
*/

const TABLE = 'contact_files';

export async function GET(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get('contact_id');

  let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
  if (contactId) query = query.eq('contact_id', contactId);

  const { data, error } = await query;
  if (error) return apiError(error);
  return apiJson(data);
}

export async function POST(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { contact_id, name, url, type = 'link' } = body;

  if (!contact_id || !name) return apiBadRequest('contact_id and name are required');

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ contact_id, name, url: url || '', type })
    .select()
    .single();

  if (error) return apiError(error);
  return apiCreated(data);
}

export async function DELETE(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return apiBadRequest('id is required');

  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) return apiError(error);
  return apiOk();
}
