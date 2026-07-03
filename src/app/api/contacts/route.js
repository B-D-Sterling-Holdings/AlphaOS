import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/*
  Supabase tables required — run this SQL in the Supabase SQL Editor:

  CREATE TABLE contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT DEFAULT '',
    role TEXT DEFAULT '',
    relationship_type TEXT DEFAULT 'other',
    contact_method TEXT DEFAULT '',
    contact_value TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    relationship_strength TEXT DEFAULT 'new',
    summary TEXT DEFAULT '',
    next_action TEXT DEFAULT '',
    follow_up_date DATE,
    last_contacted_at TIMESTAMPTZ,
    tags JSONB DEFAULT '[]'::jsonb,
    city TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    last_meeting_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_contacts_status ON contacts(status);
  CREATE INDEX idx_contacts_follow_up ON contacts(follow_up_date);
  CREATE INDEX idx_contacts_last_contacted ON contacts(last_contacted_at);

  -- If table already exists, run these to add missing columns:
  -- ALTER TABLE contacts ADD COLUMN IF NOT EXISTS importance INTEGER DEFAULT 3;
  -- ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
  -- ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_meeting_note TEXT DEFAULT '';
  -- ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_type TEXT DEFAULT 'other';
*/

const TABLE = 'contacts';

export async function GET() {
  const supabase = await getDb();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { name } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const record = {
    name: name.trim(),
    company: body.company || '',
    role: body.role || '',
    relationship_type: body.relationship_type || 'other',
    contact_method: body.contact_method || '',
    contact_value: body.contact_value || '',
    status: 'active',
    relationship_strength: 'new',
    importance: body.importance || 3,
    outreach_type: body.outreach_type || 'other',
    summary: body.summary || '',
    next_action: '',
    follow_up_date: null,
    last_contacted_at: null,
    tags: body.tags || [],
    city: body.city || '',
    phone: body.phone || '',
    notes: body.notes || '',
    last_meeting_note: '',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from(TABLE).insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req) {
  const supabase = await getDb();
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from(TABLE)
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req) {
  const supabase = await getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Delete related interactions and files first
  await supabase.from('interactions').delete().eq('contact_id', id);
  await supabase.from('contact_files').delete().eq('contact_id', id);
  const { error } = await supabase.from(TABLE).delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
