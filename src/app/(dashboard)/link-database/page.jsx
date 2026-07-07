'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Link2, Plus, X, ExternalLink, Trash2, Save, Pencil, Check,
  MessageSquare, FileText, Newspaper, Gavel, Mic, MoreHorizontal,
  AlertCircle, ChevronDown, Send, BookOpen, Eye, EyeOff,
} from 'lucide-react';

/* ── Constants ────────────────────────────────────────────────── */

const CONTENT_TYPES = [
  { value: 'tweet',         label: 'Tweet',         icon: MessageSquare, color: 'blue' },
  { value: 'web_article',   label: 'Article',       icon: FileText,      color: 'emerald' },
  { value: 'white_paper',   label: 'White Paper',   icon: BookOpen,      color: 'indigo' },
  { value: 'transcript',    label: 'Transcript',    icon: Mic,           color: 'teal' },
  { value: 'report',         label: 'Report',        icon: FileText,      color: 'amber' },
  { value: 'deck',           label: 'Deck',          icon: BookOpen,      color: 'violet' },
  { value: 'other',         label: 'Other',         icon: MoreHorizontal,color: 'gray' },
];

const CONTENT_TYPE_MAP = Object.fromEntries(CONTENT_TYPES.map(c => [c.value, c]));

const TYPE_COLORS = {
  blue:    'bg-blue-50 text-blue-700 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  violet:  'bg-violet-50 text-violet-700 border-violet-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  teal:    'bg-teal-50 text-teal-700 border-teal-200',
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  gray:    'bg-gray-100 text-gray-600 border-gray-200',
};

const TYPE_SELECTED = {
  blue:    'bg-blue-600 text-white border-blue-600',
  emerald: 'bg-emerald-600 text-white border-emerald-600',
  violet:  'bg-violet-600 text-white border-violet-600',
  amber:   'bg-amber-500 text-white border-amber-500',
  teal:    'bg-teal-600 text-white border-teal-600',
  indigo:  'bg-indigo-600 text-white border-indigo-600',
  gray:    'bg-gray-600 text-white border-gray-600',
};


const FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'tweet', label: 'Tweets' },
  { value: 'web_article', label: 'Articles' },
  { value: 'transcript', label: 'Transcripts' },
  { value: 'white_paper', label: 'White Papers' },
  { value: 'report', label: 'Reports' },
  { value: 'deck', label: 'Decks' },
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Ticker Filter Dropdown ───────────────────────────────────── */

function TickerFilterDropdown({ value, onChange, tickers }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!search) return tickers;
    return tickers.filter(([t]) => t.toLowerCase().includes(search.toLowerCase()));
  }, [tickers, search]);

  const totalCount = tickers.reduce((sum, [, c]) => sum + c, 0);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen(o => !o); setSearch(''); }}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
          value ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200'
        }`}>
        {value || 'All Tickers'}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {!value && <span className="text-xs font-semibold text-gray-400">{totalCount}</span>}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl border border-gray-200 shadow-lg z-50">
          <div className="p-2">
            <input
              type="text" spellCheck={true}
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              placeholder="Search tickers..."
              autoFocus
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-300 placeholder:text-gray-300"
            />
          </div>
          <div className="max-h-60 overflow-y-auto pb-1">
            <button onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition-colors ${
                !value ? 'text-emerald-700 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'
              }`}>
              All <span className="text-xs text-gray-400">{totalCount}</span>
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
            ) : (
              filtered.map(([ticker, count]) => (
                <button key={ticker} onClick={() => { onChange(value === ticker ? '' : ticker); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm font-bold transition-colors ${
                    ticker === value ? 'text-emerald-700 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}>
                  {ticker} <span className="text-xs font-semibold text-gray-400">{count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Link Card ────────────────────────────────────────────────── */

function parseTickers(ticker) {
  if (!ticker) return [];
  return [...new Set(ticker.split(',').map(t => t.trim()).filter(Boolean))];
}

function LinkCard({ link, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [savingField, setSavingField] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const ct = CONTENT_TYPE_MAP[link.content_type] || CONTENT_TYPE_MAP.other;
  const TypeIcon = ct.icon;
  const displaySummary = link.manual_summary || link.auto_summary || '';
  const tickers = parseTickers(link.ticker);
  const isRead = link.is_read;

  // One version-guarded PUT for every link edit. On a conflict (someone changed
  // this link in another session) it adopts the server's fresh row instead of
  // clobbering it, and reports { conflict } so the caller can react.
  const putLink = async (fields) => {
    const res = await fetch('/api/links', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: link.id, ...fields, baseVersion: link.version }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.conflict) {
      if (data.current) onUpdate(data.current);
      return { conflict: true };
    }
    if (data.link) onUpdate(data.link);
    return { ok: !!data.link };
  };

  const markRead = async () => {
    if (isRead) return;
    try { await putLink({ is_read: true }); } catch {}
  };

  const toggleRead = async (e) => {
    e.stopPropagation();
    try { await putLink({ is_read: !isRead }); } catch {}
  };

  const startEditing = () => {
    setEditFields({
      title: link.title || '',
      url: link.url || '',
      source: link.source || '',
      notes: link.notes || '',
      ticker: link.ticker || '',
      publishedAt: link.published_at ? link.published_at.split('T')[0] : '',
      contentType: link.content_type,
      manualSummary: link.manual_summary || '',
    });
    setEditing(true);
  };

  const saveField = async (fields) => {
    const key = Object.keys(fields)[0];
    setSavingField(key);
    try { await putLink(fields); } catch {} finally { setSavingField(null); }
  };

  const handleDelete = async () => {
    try {
      await fetch(`/api/links?id=${link.id}`, { method: 'DELETE' });
      onDelete(link.id);
    } catch {}
  };

  const saveAllEdits = async () => {
    setSavingField('all');
    try {
      const res = await putLink(editFields);
      // Keep the editor open on conflict so the reloaded row is visible and the
      // user's in-progress edits (still in editFields) can be re-applied.
      if (!res.conflict) setEditing(false);
    } catch {} finally { setSavingField(null); }
  };

  const ef = (field) => (e) => setEditFields(prev => ({ ...prev, [field]: e.target.value }));
  const iCls = 'bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-300 transition-all';

  if (editing) {
    return (
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm transition-all">
        <div className="flex items-center gap-1.5 px-4 py-2.5">
          <input type="text" spellCheck={true} value={editFields.ticker}
            onChange={e => setEditFields(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
            placeholder="AAPL,MSFT" className={`${iCls} w-24 font-bold text-center uppercase`} />
          <select value={editFields.contentType} onChange={ef('contentType')}
            className={`${iCls} w-24`}>
            {CONTENT_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
          </select>
          <input type="url" value={editFields.url} onChange={ef('url')} placeholder="URL"
            className={`${iCls} flex-1 text-gray-500 min-w-0`} />
          <button onClick={() => setEditing(false)}
            className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded transition-colors flex-shrink-0">Cancel</button>
          <button onClick={saveAllEdits} disabled={savingField === 'all'}
            className="flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-2.5 py-1 rounded-md transition-colors flex-shrink-0">
            {savingField === 'all' ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={11} />}
            Save
          </button>
        </div>
        <div className="px-4 pb-2.5">
          <textarea spellCheck={true} value={editFields.notes} onChange={ef('notes')} placeholder="Notes..."
            rows={2}
            className={`${iCls} w-full text-gray-500 resize-vertical min-h-[2.5rem] overflow-hidden`}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
          />
        </div>
      </div>
    );
  }

  /* ── Display mode ──────────────────────────────────────────── */

  return (
    <div className={`group bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all ${
      isRead ? 'border-gray-100 hover:border-gray-200' : 'border-l-2 border-l-emerald-400 border-gray-100 hover:border-gray-200'
    }`}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {!isRead && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
              <a href={link.url} target="_blank" rel="noopener noreferrer"
                onClick={markRead}
                className={`text-sm font-semibold truncate max-w-md transition-colors ${
                  isRead ? 'text-gray-500 hover:text-emerald-600' : 'text-gray-900 hover:text-emerald-600'
                }`}>
                {link.title || link.url}
              </a>
              {link.source && <span className="text-xs text-gray-400 flex-shrink-0">{link.source}</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {tickers.map(t => (
                <span key={t} className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{t}</span>
              ))}
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TYPE_COLORS[ct.color]}`}>
                <TypeIcon size={10} />
                {ct.label}
              </span>
              {link.published_at && <span className="text-[10px] text-gray-400">{formatDate(link.published_at)}</span>}
              <span className="text-[10px] text-gray-300">{formatDate(link.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={toggleRead}
              className={`p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${
                isRead ? 'text-gray-400 hover:text-amber-500 hover:bg-amber-50' : 'text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'
              }`} title={isRead ? 'Mark unread' : 'Mark read'}>
              {isRead ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button onClick={startEditing}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Edit">
              <Pencil size={14} />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1 ml-1">
                <button onClick={() => setConfirmDelete(false)} className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
                <button onClick={handleDelete} className="text-[11px] font-semibold text-white bg-red-500 px-2.5 py-1 rounded-lg hover:bg-red-600 transition-colors">Delete</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        {link.notes && <p className="text-xs text-gray-500 mt-2 italic">{link.notes}</p>}

        {displaySummary && (
          <div className="mt-3">
            <p className="text-sm text-gray-700 leading-relaxed">{displaySummary}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */

export default function LinkDatabasePage() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTicker, setActiveTicker] = useState('');
  const [activeTypeFilter, setActiveTypeFilter] = useState('');
  const [readFilter, setReadFilter] = useState(''); // '', 'unread', 'read'

  // Add bar state
  const [url, setUrl] = useState('');
  const [addTicker, setAddTicker] = useState('');
  const [addType, setAddType] = useState('web_article');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [addError, setAddError] = useState('');
  const urlRef = useRef(null);

  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/links');
      const data = await res.json();
      setLinks(data.links || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Sync add ticker with active tab
  useEffect(() => { setAddTicker(activeTicker); }, [activeTicker]);

  const tickers = useMemo(() => {
    const counts = {};
    links.forEach(l => {
      parseTickers(l.ticker).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [links]);

  const unreadCount = useMemo(() => links.filter(l => !l.is_read).length, [links]);

  const filtered = useMemo(() => {
    return links.filter(l => {
      if (activeTicker && !parseTickers(l.ticker).includes(activeTicker)) return false;
      if (activeTypeFilter && l.content_type !== activeTypeFilter) return false;
      if (readFilter === 'unread' && l.is_read) return false;
      if (readFilter === 'read' && !l.is_read) return false;
      return true;
    });
  }, [links, activeTicker, activeTypeFilter, readFilter]);

  const typeCounts = useMemo(() => {
    const pool = activeTicker ? links.filter(l => l.ticker === activeTicker) : links;
    const counts = {};
    pool.forEach(l => { counts[l.content_type] = (counts[l.content_type] || 0) + 1; });
    return counts;
  }, [links, activeTicker]);

  const handleAddLink = async () => {
    if (!url.trim() || saving) return;
    setSaving(true);
    setAddError('');
    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, ticker: addTicker || '', contentType: addType }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAddError(data.error || 'Failed to save');
        return;
      }
      if (data.link) {
        setLinks(prev => [data.link, ...prev]);
        setUrl('');
        setAddTicker('');
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1200);
        urlRef.current?.focus();
      }
    } catch (err) {
      setAddError('Network error — could not save');
    } finally { setSaving(false); }
  };

  const handleUpdateLink = (updated) => { setLinks(prev => prev.map(l => l.id === updated.id ? updated : l)); };
  const handleDeleteLink = (id) => { setLinks(prev => prev.filter(l => l.id !== id)); };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="h-10 w-56 bg-gray-200 rounded-xl animate-pulse mb-6" />
        <div className="flex gap-2 mb-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-9 w-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
        <div className="h-12 bg-white rounded-2xl border border-gray-100 animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header */}
      <div className="mb-6 animate-fade-in-up">
        <h1 className="text-3xl font-bold text-gray-900">Link Database</h1>
        <p className="text-sm text-gray-400 mt-1">
          {links.length} link{links.length !== 1 ? 's' : ''} saved{unreadCount > 0 && <span className="text-emerald-500 font-semibold"> &middot; {unreadCount} unread</span>}
          {activeTicker && (
            <span>
              <span className="mx-2 text-gray-300">&middot;</span>
              <span className="font-semibold text-gray-600">{activeTicker}</span>
              <span className="mx-1">({filtered.length})</span>
            </span>
          )}
        </p>
      </div>

      {/* Ticker filter dropdown + read filter */}
      <div className="relative z-50 flex items-center gap-2 mb-3 animate-fade-in-up stagger-2">
        <TickerFilterDropdown value={activeTicker} onChange={setActiveTicker} tickers={tickers} />
        <div className="flex items-center bg-gray-50 rounded-lg border border-gray-200 p-0.5">
          {[
            { value: '', label: 'All' },
            { value: 'unread', label: 'Unread' },
            { value: 'read', label: 'Read' },
          ].map(opt => (
            <button key={opt.value} onClick={() => setReadFilter(readFilter === opt.value ? '' : opt.value)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                readFilter === opt.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content type filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-5 scrollbar-hide animate-fade-in-up stagger-3">
        {FILTER_TABS.map(tab => {
          const count = tab.value ? (typeCounts[tab.value] || 0) : (activeTicker ? links.filter(l => l.ticker === activeTicker).length : links.length);
          return (
            <button key={tab.value} onClick={() => setActiveTypeFilter(prev => prev === tab.value ? '' : tab.value)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTypeFilter === tab.value ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200'
              }`}>
              {tab.label}
              {count > 0 && <span className={`ml-1 ${activeTypeFilter === tab.value ? 'text-emerald-200' : 'text-gray-400'}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Always-on add input ──────────────────────────────────── */}
      <div className={`rounded-2xl border mb-4 transition-all animate-fade-in-up stagger-4 ${
        justSaved ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200 bg-white'
      }`}>
        <div className="flex items-center gap-2 px-4 py-3">
          <Plus size={16} className={`flex-shrink-0 transition-colors ${justSaved ? 'text-emerald-500' : 'text-gray-300'}`} />
          <input
            ref={urlRef}
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddLink(); }}
            placeholder="Paste a link..."
            className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-300"
          />
          <input
            type="text" spellCheck={true}
            value={addTicker}
            onChange={e => setAddTicker(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleAddLink(); }}
            placeholder="TICK,TICK"
            className="w-[80px] bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-[11px] font-bold text-center outline-none focus:ring-1 focus:ring-emerald-200 focus:border-emerald-300 transition-all uppercase placeholder:text-gray-300 placeholder:font-normal"
          />
          <button
            onClick={handleAddLink}
            disabled={!url.trim() || saving}
            className={`p-1.5 rounded-lg transition-all ${
              justSaved
                ? 'text-emerald-500'
                : url.trim() && !saving
                  ? 'text-gray-900 hover:bg-gray-100'
                  : 'text-gray-200 cursor-not-allowed'
            }`}
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            ) : justSaved ? (
              <Check size={16} />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>

        {/* Type picker — always visible */}
        <div className="flex items-center gap-1 px-4 pb-3 pt-0">
          {CONTENT_TYPES.map(ct => {
            const Icon = ct.icon;
            const selected = addType === ct.value;
            return (
              <button key={ct.value} onClick={() => setAddType(ct.value)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-all ${
                  selected ? TYPE_SELECTED[ct.color] : `border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50`
                }`}>
                <Icon size={10} />
                {ct.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error message */}
      {addError && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium">
          <AlertCircle size={14} />
          {addError}
          <button onClick={() => setAddError('')} className="ml-auto text-red-400 hover:text-red-600"><X size={12} /></button>
        </div>
      )}

      {/* Link cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
            <Link2 size={24} className="text-gray-300" />
          </div>
          <h3 className="text-sm font-semibold text-gray-400">
            {links.length === 0 ? 'No links yet — paste one above' : 'No links match filters'}
          </h3>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((link, i) => (
            <div key={link.id} className="animate-fade-in-up" style={{ animationDelay: `${0.15 + i * 0.03}s` }}>
              <LinkCard link={link} onUpdate={handleUpdateLink} onDelete={handleDeleteLink} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
