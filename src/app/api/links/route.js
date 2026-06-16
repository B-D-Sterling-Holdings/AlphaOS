import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { summarizeByType } from '@/lib/summarizer';

/*
  Supabase table required — run this SQL in the Supabase SQL Editor:

  CREATE TABLE research_links (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ticker TEXT,
    url TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'other',
    title TEXT,
    source TEXT,
    published_at TIMESTAMPTZ,
    notes TEXT,
    extracted_text TEXT,
    pasted_text TEXT,
    auto_summary TEXT,
    manual_summary TEXT,
    summary_status TEXT DEFAULT 'pending',
    summary_method TEXT DEFAULT 'none',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX idx_research_links_ticker ON research_links(ticker);
  CREATE INDEX idx_research_links_content_type ON research_links(content_type);

  -- If table already exists, run these to add missing columns:
  -- ALTER TABLE research_links ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
*/

const TABLE = 'research_links';

/* ── Lightweight HTML text extraction ─────────────────────────── */

function extractTextFromHtml(html) {
  // Remove script, style, nav, footer, header tags + content
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // Try to find main content area
  const mainMatch = text.match(/<(article|main)[\s\S]*?<\/\1>/i);
  if (mainMatch) text = mainMatch[0];

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Normalize whitespace, cap at 5000 chars
  return text.replace(/\s+/g, ' ').trim().substring(0, 5000);
}

async function tryExtractFromUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    clearTimeout(timeout);
    if (!res.ok) return '';

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return '';

    const html = await res.text();
    return extractTextFromHtml(html);
  } catch {
    return '';
  }
}

/* ── GET — list links (optional ticker / contentType filters) ── */

export async function GET(request) {
  const supabase = await getDb();
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');
  const contentType = searchParams.get('contentType');

  let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false });

  if (ticker) query = query.eq('ticker', ticker);
  if (contentType) query = query.eq('content_type', contentType);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data || [] });
}

/* ── POST — quick-save a link (no auto-summarization) ──────── */

export async function POST(request) {
  const supabase = await getDb();
  const body = await request.json();

  const record = {
    ticker: (body.ticker || '').toUpperCase().trim() || '',
    url: (body.url || '').trim(),
    content_type: body.contentType || 'other',
    title: body.title || null,
    source: body.source || null,
    published_at: body.publishedAt || null,
    notes: body.notes || null,
    pasted_text: body.pastedText || null,
    extracted_text: null,
    auto_summary: null,
    manual_summary: null,
    summary_status: 'pending',
    summary_method: 'none',
    is_read: false,
  };

  const { data: saved, error } = await supabase
    .from(TABLE)
    .insert(record)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: saved });
}

/* ── PUT — update link (manual summary, regenerate, paste) ── */

export async function PUT(request) {
  const supabase = await getDb();
  const body = await request.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Regenerate summary flow
  if (body.regenerate) {
    const { data: existing } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Re-extract if no text available
    if (existing.content_type !== 'tweet' && !existing.extracted_text && !existing.pasted_text) {
      const extractedText = await tryExtractFromUrl(existing.url);
      if (extractedText) {
        await supabase.from(TABLE).update({ extracted_text: extractedText }).eq('id', id);
        existing.extracted_text = extractedText;
      }
    }

    const summaryResult = summarizeByType(existing);

    const { data, error } = await supabase
      .from(TABLE)
      .update({
        auto_summary: summaryResult.autoSummary,
        summary_method: summaryResult.summaryMethod,
        summary_status: summaryResult.summaryStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ link: data });
  }

  // Regular update — any editable field
  const updateData = { updated_at: new Date().toISOString() };

  if (body.title !== undefined) updateData.title = body.title || null;
  if (body.url !== undefined) updateData.url = (body.url || '').trim();
  if (body.source !== undefined) updateData.source = body.source || null;
  if (body.notes !== undefined) updateData.notes = body.notes || null;
  if (body.publishedAt !== undefined) updateData.published_at = body.publishedAt || null;
  if (body.contentType !== undefined) updateData.content_type = body.contentType;
  if (body.ticker !== undefined) updateData.ticker = (body.ticker || '').toUpperCase().trim();
  if (body.pastedText !== undefined) updateData.pasted_text = body.pastedText;
  if (body.is_read !== undefined) updateData.is_read = body.is_read;

  if (body.manualSummary !== undefined) {
    updateData.manual_summary = body.manualSummary;
    if (body.manualSummary) {
      updateData.summary_status = 'summarized';
      updateData.summary_method = 'manual';
    }
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data });
}

/* ── DELETE — remove a link ──────────────────────────────────── */

export async function DELETE(request) {
  const supabase = await getDb();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await supabase.from(TABLE).delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
