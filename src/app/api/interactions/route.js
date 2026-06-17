import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/*
  CREATE TABLE interactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'note',
    summary TEXT DEFAULT '',
    next_step TEXT DEFAULT '',
    date TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_interactions_contact ON interactions(contact_id);
  CREATE INDEX idx_interactions_date ON interactions(date DESC);
*/

const TABLE = 'interactions';

export async function GET(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get('contact_id');

  let query = supabase.from(TABLE).select('*').order('date', { ascending: false });
  if (contactId) query = query.eq('contact_id', contactId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { contact_id, type = 'note', summary, next_step, date } = body;

  if (!contact_id) return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });

  const record = {
    contact_id,
    type,
    summary: summary || '',
    next_step: next_step || '',
    date: date || new Date().toISOString(),
  };

  const { data, error } = await supabase.from(TABLE).insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update the contact's last_contacted_at and optionally next_action / follow_up_date
  const contactUpdates = {
    last_contacted_at: record.date,
    updated_at: new Date().toISOString(),
  };
  if (next_step) contactUpdates.next_action = next_step;
  if (body.follow_up_date) contactUpdates.follow_up_date = body.follow_up_date;

  await supabase.from('contacts').update(contactUpdates).eq('id', contact_id);

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
