// Client-side helpers + shared constants for the app-wide Sticky Notes layer
// (src/components/StickyNotes.jsx, API /api/sticky-notes, migration 037).
//
// Every note carries both its content (title, body, colour) and its floating
// card's UI state (pinned, minimized, position, size, stacking z) plus an OCC
// `version`. Saves go through saveWithOCC so a stale write (e.g. the same user
// editing in two tabs) is reconciled rather than silently clobbering — the
// caller gets { conflict, server } and reloads that one note.

import { saveWithOCC } from '@/lib/occClient';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// The six Windows-Sticky-Notes-style colours. Class strings are written out in
// full (no interpolation) so Tailwind's JIT keeps them. Each colour styles the
// floating card surface, its header/footer bars, and the little swatch used in
// the list + colour picker. Tuned to sit calmly next to the app's emerald UI.
export const STICKY_COLORS = {
  yellow: { label: 'Yellow', swatch: 'bg-amber-300',   card: 'bg-amber-50 border-amber-200',   bar: 'bg-amber-100/80 border-amber-200',   tint: 'bg-amber-50',   ring: 'ring-amber-300' },
  green:  { label: 'Green',  swatch: 'bg-emerald-300', card: 'bg-emerald-50 border-emerald-200', bar: 'bg-emerald-100/80 border-emerald-200', tint: 'bg-emerald-50', ring: 'ring-emerald-300' },
  blue:   { label: 'Blue',   swatch: 'bg-sky-300',     card: 'bg-sky-50 border-sky-200',       bar: 'bg-sky-100/80 border-sky-200',       tint: 'bg-sky-50',     ring: 'ring-sky-300' },
  pink:   { label: 'Pink',   swatch: 'bg-rose-300',    card: 'bg-rose-50 border-rose-200',     bar: 'bg-rose-100/80 border-rose-200',     tint: 'bg-rose-50',    ring: 'ring-rose-300' },
  purple: { label: 'Purple', swatch: 'bg-violet-300',  card: 'bg-violet-50 border-violet-200', bar: 'bg-violet-100/80 border-violet-200', tint: 'bg-violet-50',  ring: 'ring-violet-300' },
  gray:   { label: 'Gray',   swatch: 'bg-gray-300',    card: 'bg-gray-50 border-gray-200',     bar: 'bg-gray-100/80 border-gray-200',     tint: 'bg-gray-50',    ring: 'ring-gray-300' },
};

export const COLOR_KEYS = Object.keys(STICKY_COLORS);

export const colorOf = (note) => STICKY_COLORS[note?.color] || STICKY_COLORS.yellow;

// Floating-card size clamps (px). Kept here so the resize handle and the create
// defaults agree.
export const MIN_W = 240;
export const MIN_H = 180;
export const DEFAULT_W = 320;
export const DEFAULT_H = 300;

/* ------------------------------------------------------------------ *
 * Rich body storage. The body is edited with the shared RichTextArea (the same
 * bold/italic/image/table editor as Draft & Review), whose value is a block
 * array [{ type:'text', value:'<html>' }, …]. We persist it as a JSON string in
 * the `body` text column; parseBody/serializeBody bridge the two, and bodyToText
 * pulls a plain-text version for search, the list preview and the title fallback.
 * ------------------------------------------------------------------ */

// DB string → RichTextArea value. A JSON block array is parsed; anything else is
// treated as legacy plain text (RichTextArea accepts a bare string too).
export function parseBody(body) {
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON — legacy plain text */ }
  return body;
}

// RichTextArea value → DB string.
export function serializeBody(blocks) {
  return Array.isArray(blocks) ? JSON.stringify(blocks) : String(blocks ?? '');
}

// Plain-text flattening of a body (strips HTML, notes images) for search/preview/title.
export function bodyToText(body) {
  const parsed = parseBody(body);
  const html = Array.isArray(parsed)
    ? parsed.map(b => (b?.type === 'image' ? ' [image] ' : (b?.value || ''))).join(' ')
    : String(parsed);
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A note's display title, falling back to the first line of its body, then a
// placeholder — mirrors how Windows Sticky Notes labels an untitled note.
export function noteTitle(note) {
  const t = (note?.title || '').trim();
  if (t) return t;
  const firstLine = bodyToText(note?.body).split('\n').map(s => s.trim()).find(Boolean);
  return firstLine || 'Untitled note';
}

// Case-insensitive search across ticker + title + body (plain text).
export function matchesQuery(note, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (`${note.ticker || ''} ${note.title || ''} ${bodyToText(note.body)}`).toLowerCase().includes(q);
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

export async function fetchStickyNotes() {
  try {
    const res = await fetch('/api/sticky-notes');
    if (!res.ok) return [];
    const data = await readJson(res);
    return Array.isArray(data.notes) ? data.notes : [];
  } catch {
    return [];
  }
}

export async function createStickyNote(fields = {}) {
  const res = await fetch('/api/sticky-notes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  });
  const data = await readJson(res);
  return { ok: res.ok, note: data.note };
}

// Version-guarded update. `note` supplies the current `version`; `updates` are
// the changed fields. Returns:
//   { ok:true, note }                    — saved (server row incl. new version)
//   { ok:false, conflict:true, server }  — someone else wrote; caller reloads
//   { ok:false, error }                  — network / server error
export async function updateStickyNote(note, updates) {
  const res = await saveWithOCC({
    url: '/api/sticky-notes',
    local: note,
    buildBody: () => ({ id: note.id, ...updates, baseVersion: note.version }),
  });
  if (res.ok) return { ok: true, note: res.data?.note };
  if (res.conflict) return { ok: false, conflict: true, server: res.server };
  return { ok: false, error: res.error };
}

export async function deleteStickyNote(id) {
  try {
    const res = await fetch(`/api/sticky-notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
