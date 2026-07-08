'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FolderOpen, Upload, Trash2, Search, FileText, File, X,
  Image as ImageIcon, UploadCloud, ChevronRight,
  FileSpreadsheet, BookOpen, Mail, Archive, Scale, Pencil, Check, ChevronDown, Download,
  Plus, Settings2, Briefcase, Landmark, Building2, BarChart3, DollarSign, PieChart,
  Newspaper, ClipboardList, Shield, Folder, FolderUp,
} from 'lucide-react';
import {
  COLOR_MAP, COLOR_OPTIONS, CATEGORY_ICON_NAMES, DEFAULT_ICON,
  EQUITY_RESEARCH_VALUES, DEFAULT_CATEGORIES, slugify, categoryOptions,
} from '@/lib/documentCategories';

// Map the whitelisted icon names (see documentCategories.js) to lucide
// components. Keep this in sync with CATEGORY_ICON_NAMES.
const CATEGORY_ICONS = {
  FileText, Mail, BookOpen, FileSpreadsheet, Scale, Archive,
  Briefcase, Landmark, Building2, BarChart3, DollarSign, PieChart,
  Newspaper, ClipboardList, Shield, Folder,
};

const iconFor = (name) => CATEGORY_ICONS[name] || CATEGORY_ICONS[DEFAULT_ICON];

// OS/editor junk that shows up in folder uploads — never worth storing.
const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const isUploadable = (file) => file && file.name && file.size > 0 && !IGNORED_FILE_NAMES.has(file.name);

// Folder-relative path when we have one (folder <input> sets webkitRelativePath;
// drag-dropped folders get _relPath from the traversal below), else the bare name.
const relPathOf = (file) => file.webkitRelativePath || file._relPath || file.name;

// Recursively collect File objects from a webkitGetAsEntry() filesystem entry,
// tagging each with its folder-relative path for display in the staging list.
function readEntryFiles(entry, prefix = '') {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file) => {
          try { Object.defineProperty(file, '_relPath', { value: prefix + file.name }); } catch {}
          resolve([file]);
        },
        () => resolve([]),
      );
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    return new Promise((resolve) => {
      const collected = [];
      // readEntries returns at most ~100 entries per call, so drain it in a loop.
      const readBatch = () => reader.readEntries(
        async (batch) => {
          if (!batch.length) {
            const nested = await Promise.all(collected.map((e) => readEntryFiles(e, `${prefix}${entry.name}/`)));
            resolve(nested.flat());
            return;
          }
          collected.push(...batch);
          readBatch();
        },
        () => resolve([]),
      );
      readBatch();
    });
  }
  return Promise.resolve([]);
}

// Extract files from a drop, descending into any dropped folders. Entries are
// captured synchronously — the DataTransferItemList is emptied after the event tick.
async function filesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const entries = items
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (entries.length) {
    const nested = await Promise.all(entries.map((entry) => readEntryFiles(entry)));
    return nested.flat();
  }
  return Array.from(dataTransfer.files || []);
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function fileIcon(doc) {
  const fileType = (doc.file_type || '').toLowerCase();
  const fileName = (doc.file_name || '').toLowerCase();

  if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
    return {
      icon: <FileText size={20} className="text-red-500" />,
      wrapperClass: 'bg-red-50',
    };
  }

  if (
    fileType.includes('word') ||
    fileType.includes('officedocument.wordprocessingml') ||
    fileType.includes('google-apps.document') ||
    fileName.match(/\.(docx?|gdoc)$/i)
  ) {
    return {
      icon: <FileText size={20} className="text-blue-600" />,
      wrapperClass: 'bg-blue-50',
    };
  }

  if (
    fileType.includes('sheet') ||
    fileType.includes('excel') ||
    fileType.includes('csv') ||
    fileType.includes('google-apps.spreadsheet') ||
    fileName.match(/\.(xlsx?|csv|gsheet)$/i)
  ) {
    return {
      icon: <FileSpreadsheet size={20} className="text-emerald-600" />,
      wrapperClass: 'bg-emerald-50',
    };
  }

  if (fileType.startsWith('image/')) {
    return {
      icon: <ImageIcon size={20} className="text-blue-500" />,
      wrapperClass: 'bg-blue-50',
    };
  }

  return {
    icon: <File size={20} className="text-gray-400" />,
    wrapperClass: 'bg-gray-50',
  };
}

/**
 * Manage Sections dialog — add / rename / recolor / re-icon / delete the section
 * types that make up the Documents sidebar. Edits happen on a local draft; the
 * whole list is persisted on Save. Built-in sections may be restyled but not
 * deleted (so core documents are never orphaned), and the Equity Research group's
 * sub-sections are fixed.
 */
function ManageSectionsModal({ initial, counts, onClose, onSave }) {
  const [draft, setDraft] = useState(() => initial.map(c => ({ ...c })));
  const [picker, setPicker] = useState(null); // { idx, type: 'color' | 'icon' } | null
  const [saving, setSaving] = useState(false);

  const update = (idx, patch) => setDraft(d => d.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const remove = (idx) => { setPicker(null); setDraft(d => d.filter((_, i) => i !== idx)); };
  const add = () => setDraft(d => [...d, { value: '', label: '', icon: DEFAULT_ICON, color: 'gray', isNew: true }]);

  const docCount = (cat) => {
    if (cat.subs) return cat.subs.reduce((n, s) => n + (counts[s.value] || 0), 0) + (counts[cat.value] || 0);
    return counts[cat.value] || 0;
  };

  const save = async () => {
    setSaving(true);
    // Existing values seed the "taken" set so a freshly-slugged section can't
    // collide with one further down the list.
    const taken = draft.filter(c => c.value).map(c => c.value);
    const cleaned = draft
      .map(({ isNew, ...c }) => {
        const label = (c.label || '').trim();
        if (!label) return null; // drop blank rows
        let value = c.value;
        if (!value) { value = slugify(label, taken); taken.push(value); }
        return { ...c, value, label };
      })
      .filter(Boolean);
    await onSave(cleaned);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Manage sections</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add, rename, recolor, or remove document sections</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          {draft.map((cat, idx) => {
            const colors = COLOR_MAP[cat.color] || COLOR_MAP.gray;
            const Icon = iconFor(cat.icon);
            const n = docCount(cat);
            return (
              <div key={cat.value || `new-${idx}`} className="rounded-xl border border-gray-100 bg-gray-50/60 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  {/* Icon picker toggle */}
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setPicker(p => (p?.idx === idx && p.type === 'icon' ? null : { idx, type: 'icon' }))}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${colors.badge}`}
                      title="Change icon"
                    >
                      <Icon size={16} />
                    </button>
                    {picker?.idx === idx && picker.type === 'icon' && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setPicker(null)} />
                        <div className="absolute top-full left-0 mt-1 z-20 w-52 p-2 rounded-xl border border-gray-200 bg-white shadow-xl grid grid-cols-6 gap-1">
                          {CATEGORY_ICON_NAMES.map(name => {
                            const IconOpt = iconFor(name);
                            return (
                              <button
                                key={name}
                                onClick={() => { update(idx, { icon: name }); setPicker(null); }}
                                className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${cat.icon === name ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                                title={name}
                              >
                                <IconOpt size={15} />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Color picker toggle */}
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setPicker(p => (p?.idx === idx && p.type === 'color' ? null : { idx, type: 'color' }))}
                      className="w-6 h-6 rounded-full border border-gray-200 flex items-center justify-center hover:scale-110 transition-transform"
                      title="Change color"
                    >
                      <span className={`w-3.5 h-3.5 rounded-full ${colors.dot}`} />
                    </button>
                    {picker?.idx === idx && picker.type === 'color' && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setPicker(null)} />
                        <div className="absolute top-full left-0 mt-1 z-20 p-2 rounded-xl border border-gray-200 bg-white shadow-xl grid grid-cols-5 gap-1.5">
                          {COLOR_OPTIONS.map(name => (
                            <button
                              key={name}
                              onClick={() => { update(idx, { color: name }); setPicker(null); }}
                              className={`w-6 h-6 rounded-full flex items-center justify-center ${cat.color === name ? 'ring-2 ring-offset-1 ring-gray-900' : ''}`}
                              title={name}
                            >
                              <span className={`w-4 h-4 rounded-full ${(COLOR_MAP[name] || COLOR_MAP.gray).dot}`} />
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Label */}
                  <input
                    type="text"
                    value={cat.label}
                    onChange={e => update(idx, { label: e.target.value })}
                    placeholder="Section name…"
                    autoFocus={cat.isNew}
                    className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                  />

                  {/* Delete (custom sections only) */}
                  {cat.builtin ? (
                    <span className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-300" title="Built-in section — can be restyled but not removed">
                      <Shield size={13} />
                    </span>
                  ) : (
                    <button
                      onClick={() => remove(idx)}
                      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete section"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {cat.subs && (
                  <p className="text-[11px] text-gray-400 mt-1.5 ml-11">
                    {cat.subs.length} fixed sub-sections
                  </p>
                )}
                {!cat.builtin && n > 0 && (
                  <p className="text-[11px] text-amber-600 mt-1.5 ml-11">
                    Deleting keeps {n} document{n !== 1 ? 's' : ''}, shown uncategorized
                  </p>
                )}
              </div>
            );
          })}

          <button
            onClick={add}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-gray-300 text-sm font-semibold text-gray-500 hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50/40 transition-all"
          >
            <Plus size={15} /> Add section
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="text-sm font-semibold text-gray-500 bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 px-5 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', category: '', ticker: '', notes: '' });
  const [uploadError, setUploadError] = useState('');
  const [filterTicker, setFilterTicker] = useState('');
  const [tickerDropdownOpen, setTickerDropdownOpen] = useState(false);
  const tickerDropdownRef = useRef(null);

  // Section types (categories) — editable per tenant, loaded from the API and
  // seeded from defaults so the sidebar renders instantly before the fetch lands.
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [manageOpen, setManageOpen] = useState(false);

  const allCategoryOptions = useMemo(() => categoryOptions(categories), [categories]);

  // Upload form state
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploadTicker, setUploadTicker] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/documents/categories');
      const data = await res.json();
      if (Array.isArray(data.categories) && data.categories.length) {
        setCategories(data.categories);
      }
    } catch {}
  }, []);

  // Persist the full list and adopt the server's normalized version.
  const saveCategories = useCallback(async (next) => {
    setCategories(next); // optimistic
    try {
      const res = await fetch('/api/documents/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: next }),
      });
      const data = await res.json().catch(() => ({}));
      const saved = Array.isArray(data.categories) ? data.categories : next;
      setCategories(saved);
      // If the active filter pointed at a section that was just deleted, drop it
      // so the document list doesn't get stuck showing nothing.
      setFilterCategory(prev => {
        if (!prev) return prev;
        const exists = saved.some(c => c.value === prev || (c.subs || []).some(s => s.value === prev));
        return exists ? prev : '';
      });
      return saved;
    } catch {
      return next;
    }
  }, []);

  useEffect(() => { loadDocuments(); loadCategories(); }, [loadDocuments, loadCategories]);

  const handleFilesSelected = (files) => {
    const list = Array.from(files || []).filter(isUploadable);
    if (!list.length) return;
    setUploadError('');
    setPendingFiles(list);
    setUploadTitle(list.length === 1 ? list[0].name.replace(/\.[^/.]+$/, '') : '');
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    // Descend into dropped folders; falls back to a flat file list otherwise.
    const files = await filesFromDataTransfer(e.dataTransfer);
    handleFilesSelected(files);
  };

  const handleUpload = async () => {
    if (!pendingFiles.length) return;
    setUploading(true);
    setUploadError('');
    const failed = [];
    for (const file of pendingFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', pendingFiles.length === 1 ? (uploadTitle || file.name) : file.name);
        formData.append('category', uploadCategory);
        formData.append('ticker', uploadTicker);
        formData.append('notes', uploadNotes);

        const res = await fetch('/api/documents', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
          failed.push({ name: file.name, reason: data.error || `Upload failed (${res.status})` });
          continue;
        }
        if (data.document) {
          setDocuments(prev => [data.document, ...prev]);
        }
      } catch (err) {
        failed.push({ name: file.name, reason: err.message || 'Network error' });
      }
    }
    if (failed.length > 0) {
      setUploadError(
        failed.length === 1
          ? `Failed to upload ${failed[0].name}: ${failed[0].reason}`
          : `Failed to upload ${failed.length} file${failed.length > 1 ? 's' : ''}: ${failed.map(f => f.name).join(', ')}`
      );
    }
    setPendingFiles([]);
    setUploadTitle('');
    setUploadCategory('other');
    setUploadTicker('');
    setUploadNotes('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
    setUploading(false);
  };

  const cancelUpload = () => {
    setPendingFiles([]);
    setUploadTitle('');
    setUploadCategory('other');
    setUploadTicker('');
    setUploadNotes('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleDownload = async (doc) => {
    try {
      const res = await fetch(doc.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || doc.title || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
      setDocuments(prev => prev.filter(d => d.id !== id));
      setConfirmDeleteId(null);
    } catch {} finally {
      setDeletingId(null);
    }
  };

  const startEditing = (doc) => {
    setEditingId(doc.id);
    setEditForm({
      title: doc.title || doc.file_name || '',
      category: doc.category || 'other',
      ticker: doc.ticker || '',
      notes: doc.notes || '',
    });
  };

  const handleSaveEdit = async (id) => {
    const baseVersion = documents.find(d => d.id === id)?.version;
    try {
      const res = await fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          title: editForm.title.trim() || undefined,
          category: editForm.category,
          ticker: editForm.ticker.trim().toUpperCase(),
          notes: editForm.notes.trim(),
          baseVersion,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.conflict) {
        // Another session edited this document's metadata first — adopt its version
        // and keep the editor open so the reloaded values are visible for re-edit.
        if (data.current) setDocuments(prev => prev.map(d => d.id === id ? data.current : d));
        return;
      }
      if (data.document) {
        setDocuments(prev => prev.map(d => d.id === id ? data.document : d));
      }
      setEditingId(null);
    } catch {
      setEditingId(null);
    }
  };

  // Close ticker dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (tickerDropdownRef.current && !tickerDropdownRef.current.contains(e.target)) {
        setTickerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Derived data
  const filtered = useMemo(() => (
    documents
      .filter(d => {
        if (filterCategory) {
          // If filtering by the parent "equity_research", include all sub-categories too
          if (filterCategory === 'equity_research') {
            if (!EQUITY_RESEARCH_VALUES.has(d.category)) return false;
          } else if (d.category !== filterCategory) {
            return false;
          }
        }
        if (filterTicker && d.ticker !== filterTicker) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (
            (d.title || '').toLowerCase().includes(q) ||
            (d.ticker || '').toLowerCase().includes(q) ||
            (d.notes || '').toLowerCase().includes(q) ||
            (d.file_name || '').toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
  ), [documents, filterCategory, filterTicker, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    documents.forEach(d => {
      counts[d.category] = (counts[d.category] || 0) + 1;
      // Also count toward the parent equity_research group
      if (EQUITY_RESEARCH_VALUES.has(d.category) && d.category !== 'equity_research') {
        counts['equity_research'] = (counts['equity_research'] || 0) + 1;
      }
    });
    return counts;
  }, [documents]);

  const tickerChips = useMemo(() => {
    const tickers = {};
    documents.forEach(d => { if (d.ticker) tickers[d.ticker] = (tickers[d.ticker] || 0) + 1; });
    return Object.entries(tickers).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [documents]);

  const totalSize = useMemo(() =>
    documents.reduce((sum, d) => sum + (Number(d.file_size) || 0), 0)
  , [documents]);

  const filterKey = `${searchQuery}|${filterCategory}|${filterTicker}`;

  const filteredIds = useMemo(() => new Set(filtered.map(d => d.id)), [filtered]);
  const [visibleDocs, setVisibleDocs] = useState(documents);
  const [exitingIds, setExitingIds] = useState(new Set());

  useEffect(() => {
    const leaving = visibleDocs.filter(d => !filteredIds.has(d.id)).map(d => d.id);
    if (leaving.length > 0) {
      setExitingIds(new Set(leaving));
      const timer = setTimeout(() => {
        setExitingIds(new Set());
        setVisibleDocs(filtered);
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setVisibleDocs(filtered);
    }
  }, [filtered]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="h-10 w-48 bg-gray-200 rounded-xl animate-pulse mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="max-w-7xl mx-auto px-6 lg:px-12 pb-16"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Full-page drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-40 bg-emerald-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-3xl shadow-2xl border-2 border-dashed border-emerald-400 px-16 py-12 text-center">
            <UploadCloud size={48} className="text-emerald-500 mx-auto mb-3" />
            <p className="text-lg font-bold text-gray-900">Drop files or folders here</p>
            <p className="text-sm text-gray-500 mt-1">Every file inside a folder is added to your document hub</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-400 mt-1">
            <span>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
            <span className="mx-2 text-gray-300">·</span>
            <span>{formatFileSize(totalSize) || '0 B'} stored</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => folderInputRef.current?.click()}
            className="flex items-center gap-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 px-4 py-2.5 rounded-xl transition-all shadow-sm"
            title="Upload every file inside a folder"
          >
            <FolderUp size={15} />
            Upload folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 px-5 py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md"
          >
            <Upload size={15} />
            Upload
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => handleFilesSelected(e.target.files)}
        />
        {/* Folder picker: webkitdirectory is set imperatively so React reliably
            passes it through; selecting a folder yields every nested file. */}
        <input
          ref={el => {
            folderInputRef.current = el;
            if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); }
          }}
          type="file"
          multiple
          className="hidden"
          onChange={e => handleFilesSelected(e.target.files)}
        />
      </div>

      {/* Upload error banner */}
      {uploadError && (
        <div className="mb-4 flex items-center justify-between bg-red-50 border border-red-200 rounded-2xl px-5 py-3 animate-fade-in-up">
          <p className="text-sm text-red-700 font-medium">{uploadError}</p>
          <button onClick={() => setUploadError('')} className="text-red-400 hover:text-red-600 transition-colors ml-3 flex-shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Upload staging area */}
      {pendingFiles.length > 0 && (
        <div className="mb-8 bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
          <div className="bg-emerald-50 px-6 py-3 flex items-center justify-between border-b border-emerald-100">
            <div className="flex items-center gap-2">
              <UploadCloud size={16} className="text-emerald-600" />
              <span className="text-sm font-semibold text-emerald-800">
                {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} ready to upload
              </span>
            </div>
            <button onClick={cancelUpload} className="text-emerald-600 hover:text-emerald-800 transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="p-6">
            {/* File list */}
            <div className="flex flex-wrap gap-2 mb-5">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 text-sm">
                  <File size={14} className="text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700 font-medium truncate max-w-[260px]" title={relPathOf(f)}>{relPathOf(f)}</span>
                  <span className="text-gray-400 text-xs flex-shrink-0">{formatFileSize(f.size)}</span>
                  <button
                    onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>

            {/* Metadata fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {pendingFiles.length === 1 && (
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Title</label>
                  <input
                    type="text" spellCheck={true}
                    value={uploadTitle}
                    onChange={e => setUploadTitle(e.target.value)}
                    placeholder="Document title..."
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Category</label>
                <select
                  value={uploadCategory}
                  onChange={e => setUploadCategory(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                >
                  {allCategoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Ticker</label>
                <input
                  type="text" spellCheck={true}
                  value={uploadTicker}
                  onChange={e => setUploadTicker(e.target.value.toUpperCase())}
                  placeholder="e.g. AAPL"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all uppercase"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Notes</label>
                <input
                  type="text" spellCheck={true}
                  value={uploadNotes}
                  onChange={e => setUploadNotes(e.target.value)}
                  placeholder="Quick note..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-6 py-2.5 rounded-xl transition-colors"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    Upload {pendingFiles.length > 1 ? `${pendingFiles.length} files` : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main layout: sidebar + content */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 animate-fade-in-up stagger-2">
        {/* Sidebar */}
        <div className="space-y-6 animate-fade-in-up stagger-3">
          {/* Category nav */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
            <button
              onClick={() => setFilterCategory('')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                !filterCategory ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <FolderOpen size={15} />
                All Documents
              </div>
              <span className={`text-xs font-bold ${!filterCategory ? 'text-gray-400' : 'text-gray-400'}`}>{documents.length}</span>
            </button>

            <div className="mt-1 space-y-0.5">
              {categories.map(cat => {
                const count = categoryCounts[cat.value] || 0;
                const colors = COLOR_MAP[cat.color] || COLOR_MAP.gray;
                const isActive = filterCategory === cat.value;
                const isSubActive = cat.subs && cat.subs.some(s => filterCategory === s.value);
                const Icon = iconFor(cat.icon);
                const showSubs = cat.subs && (isActive || isSubActive);
                return (
                  <div key={cat.value}>
                    <button
                      onClick={() => setFilterCategory(prev => prev === cat.value ? '' : cat.value)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isActive ? `${colors.active} border` : isSubActive ? `text-emerald-700 ${colors.hover} border border-transparent` : `text-gray-600 ${colors.hover} border border-transparent`
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {cat.subs ? (
                          <ChevronRight size={13} className={`transition-transform duration-200 ${showSubs ? 'rotate-90' : ''} ${isActive || isSubActive ? '' : 'text-gray-400'}`} />
                        ) : (
                          <Icon size={15} className={isActive ? '' : 'text-gray-400'} />
                        )}
                        <span className="truncate">{cat.label}</span>
                      </div>
                      {count > 0 && (
                        <span className={`text-xs font-bold ${isActive || isSubActive ? '' : 'text-gray-400'}`}>{count}</span>
                      )}
                    </button>
                    {showSubs && (
                      <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-emerald-100 pl-2">
                        {cat.subs.map(sub => {
                          const subCount = categoryCounts[sub.value] || 0;
                          const subActive = filterCategory === sub.value;
                          return (
                            <button
                              key={sub.value}
                              onClick={() => setFilterCategory(prev => prev === sub.value ? cat.value : sub.value)}
                              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all ${
                                subActive ? `${colors.active} border` : `text-gray-500 hover:text-gray-700 hover:bg-emerald-50/50 border border-transparent`
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
                              {subCount > 0 && (
                                <span className={`text-[11px] font-bold ${subActive ? '' : 'text-gray-400'}`}>{subCount}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Manage section types */}
            <button
              onClick={() => setManageOpen(true)}
              className="w-full mt-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-gray-700 hover:bg-gray-50 border border-transparent transition-all"
            >
              <Settings2 size={15} />
              Manage sections
            </button>
          </div>

          {/* Ticker dropdown */}
          {tickerChips.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3" ref={tickerDropdownRef}>
              <div className="relative">
                <button
                  onClick={() => setTickerDropdownOpen(o => !o)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    filterTicker ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>{filterTicker || 'All Tickers'}</span>
                  <div className="flex items-center gap-1.5">
                    {filterTicker && (
                      <span
                        onClick={(e) => { e.stopPropagation(); setFilterTicker(''); setTickerDropdownOpen(false); }}
                        className="text-gray-400 hover:text-white"
                      >
                        <X size={12} />
                      </span>
                    )}
                    <ChevronDown size={13} className={`transition-transform duration-200 ${tickerDropdownOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {tickerDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
                    {tickerChips.map(([ticker, count]) => (
                      <button
                        key={ticker}
                        onClick={() => { setFilterTicker(prev => prev === ticker ? '' : ticker); setTickerDropdownOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                          filterTicker === ticker ? 'text-emerald-700 bg-emerald-50 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-mono font-semibold">{ticker}</span>
                        <span className="text-xs text-gray-400">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div>
          {/* Search bar */}
          <div className="relative mb-6">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" spellCheck={true}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search documents, tickers, notes..."
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 shadow-sm transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Document list */}
          {visibleDocs.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
                <FolderOpen size={28} className="text-gray-300" />
              </div>
              <h3 className="text-base font-semibold text-gray-500">
                {documents.length === 0 ? 'No documents yet' : 'No matches'}
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                {documents.length === 0 ? 'Drag and drop files or click Upload to get started' : 'Try a different search or category'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleDocs.map((doc, idx) => {
                let cat = categories.find(c => c.value === doc.category);
                let subLabel = null;
                if (!cat) {
                  // Check if it's a subcategory
                  for (const c of categories) {
                    if (c.subs) {
                      const sub = c.subs.find(s => s.value === doc.category);
                      if (sub) { cat = c; subLabel = sub.label; break; }
                    }
                  }
                }
                const colors = COLOR_MAP[cat?.color || 'gray'] || COLOR_MAP.gray;
                const isDeleting = confirmDeleteId === doc.id;
                const isEditing = editingId === doc.id;
                const fileVisual = fileIcon(doc);

                return (
                  <div
                    key={doc.id}
                    style={{ animationDelay: `${idx * 30}ms` }}
                    className={`${exitingIds.has(doc.id) ? 'doc-row-exit' : 'doc-row-enter'} group bg-white rounded-2xl border shadow-sm transition-all ${
                      isEditing ? 'border-emerald-200 shadow-md' : 'border-gray-100 hover:border-gray-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-center gap-4 px-5 py-4">
                      {/* File icon */}
                      <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${fileVisual.wrapperClass}`}>
                        {fileVisual.icon}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-gray-900 truncate hover:text-emerald-700 transition-colors"
                          >
                            {doc.title || doc.file_name}
                          </a>
                          {doc.ticker && (
                            <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
                              {doc.ticker}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                            {subLabel || cat?.label || doc.category}
                          </span>
                          {doc.notes && (
                            <span className="text-xs text-gray-400 truncate max-w-[200px]">{doc.notes}</span>
                          )}
                        </div>
                      </div>

                      {/* Right side — actions + date/size */}
                      <div className="flex items-center flex-shrink-0 ml-auto">
                        <div className={`flex items-center gap-0.5 transition-all duration-200 overflow-hidden ${
                          isDeleting || deletingId === doc.id ? 'max-w-[200px] opacity-100 mr-3' : 'max-w-0 opacity-0 group-hover:max-w-[200px] group-hover:opacity-100 group-hover:mr-3'
                        }`}>
                          <button
                            onClick={() => isEditing ? setEditingId(null) : startEditing(doc)}
                            className={`p-2 rounded-lg transition-colors ${
                              isEditing ? 'text-emerald-600 bg-emerald-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                            }`}
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDownload(doc)}
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Download"
                          >
                            <Download size={14} />
                          </button>
                          {isDeleting ? (
                            <div className="flex items-center gap-1 ml-1">
                              {deletingId === doc.id ? (
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-500 px-2.5 py-1.5">
                                  <div className="w-3.5 h-3.5 border-2 border-red-200 border-t-red-500 rounded-full animate-spin" />
                                  Deleting...
                                </div>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                                  >
                                    No
                                  </button>
                                  <button
                                    onClick={() => handleDelete(doc.id)}
                                    className="text-[11px] font-semibold text-white bg-red-500 px-2.5 py-1.5 rounded-lg hover:bg-red-600 transition-colors"
                                  >
                                    Yes
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(doc.id)}
                              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500 font-medium">{formatDate(doc.uploaded_at)}</p>
                          <p className="text-[11px] text-gray-400">{formatFileSize(doc.file_size)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Expandable edit panel */}
                    {isEditing && (
                      <div className="px-5 pb-4 pt-0">
                        <div className="border-t border-gray-100 pt-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <div>
                              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Title</label>
                              <input
                                type="text" spellCheck={true}
                                value={editForm.title}
                                onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                                autoFocus
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Category</label>
                              <select
                                value={editForm.category}
                                onChange={(e) => setEditForm(f => ({ ...f, category: e.target.value }))}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                              >
                                {allCategoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Ticker</label>
                              <input
                                type="text" spellCheck={true}
                                value={editForm.ticker}
                                onChange={(e) => setEditForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                                placeholder="e.g. AAPL"
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all uppercase"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider block mb-1">Notes</label>
                              <input
                                type="text" spellCheck={true}
                                value={editForm.notes}
                                onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="Quick note..."
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 mt-3">
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs font-semibold text-gray-500 bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(doc.id)}
                              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors"
                            >
                              <Check size={12} />
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {manageOpen && (
        <ManageSectionsModal
          initial={categories}
          counts={categoryCounts}
          onClose={() => setManageOpen(false)}
          onSave={saveCategories}
        />
      )}
    </div>
  );
}
