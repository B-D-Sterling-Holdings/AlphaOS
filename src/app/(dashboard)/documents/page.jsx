'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FolderOpen, Upload, Trash2, Search, FileText, File, X,
  Image as ImageIcon, UploadCloud, ChevronRight, ExternalLink,
  FileSpreadsheet, BookOpen, Mail, Archive, Scale, Pencil, Check, ChevronDown, Download,
} from 'lucide-react';

const EQUITY_RESEARCH_SUBS = [
  { value: 'equity_research_report', label: 'Research Reports' },
  { value: 'equity_primer', label: 'Equity Primers' },
  { value: 'position_review_report', label: 'Position Review Reports' },
  { value: 'equity_research_other', label: 'Other Research' },
];

const EQUITY_RESEARCH_VALUES = new Set(EQUITY_RESEARCH_SUBS.map(s => s.value).concat('equity_research'));

const CATEGORIES = [
  { value: 'shareholder_letter', label: 'Shareholder Letters', icon: Mail, color: 'blue' },
  { value: 'equity_research', label: 'Equity Research', icon: BookOpen, color: 'emerald', subs: EQUITY_RESEARCH_SUBS },
  { value: 'investor_memo', label: 'Investor Memos', icon: FileText, color: 'violet' },
  { value: 'financial_model', label: 'Financial Models', icon: FileSpreadsheet, color: 'amber' },
  { value: 'legal', label: 'Legal', icon: Scale, color: 'indigo' },
  { value: 'tax', label: 'Tax', icon: FileText, color: 'rose' },
  { value: 'other', label: 'Other', icon: Archive, color: 'gray' },
];

// All flat category values for selects
const ALL_CATEGORY_OPTIONS = CATEGORIES.flatMap(c =>
  c.subs ? c.subs.map(s => ({ value: s.value, label: `${c.label} — ${s.label}` })) : [{ value: c.value, label: c.label }]
);

const COLOR_MAP = {
  blue:    { badge: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', hover: 'hover:bg-blue-50', active: 'bg-blue-50 border-blue-200 text-blue-700' },
  emerald: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', hover: 'hover:bg-emerald-50', active: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  violet:  { badge: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500', hover: 'hover:bg-violet-50', active: 'bg-violet-50 border-violet-200 text-violet-700' },
  amber:   { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', hover: 'hover:bg-amber-50', active: 'bg-amber-50 border-amber-200 text-amber-700' },
  indigo:  { badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500', hover: 'hover:bg-indigo-50', active: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  rose:    { badge: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500', hover: 'hover:bg-rose-50', active: 'bg-rose-50 border-rose-200 text-rose-700' },
  gray:    { badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400', hover: 'hover:bg-gray-50', active: 'bg-gray-100 border-gray-300 text-gray-700' },
};

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

  // Upload form state
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('other');
  const [uploadTicker, setUploadTicker] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const fileInputRef = useRef(null);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const handleFilesSelected = (files) => {
    if (!files?.length) return;
    setUploadError('');
    setPendingFiles(Array.from(files));
    setUploadTitle(files.length === 1 ? files[0].name.replace(/\.[^/.]+$/, '') : '');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFilesSelected(e.dataTransfer.files);
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
    setUploading(false);
  };

  const cancelUpload = () => {
    setPendingFiles([]);
    setUploadTitle('');
    setUploadCategory('other');
    setUploadTicker('');
    setUploadNotes('');
    if (fileInputRef.current) fileInputRef.current.value = '';
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
            <p className="text-lg font-bold text-gray-900">Drop files here</p>
            <p className="text-sm text-gray-500 mt-1">They&apos;ll be added to your document hub</p>
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
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 px-5 py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md"
        >
          <Upload size={15} />
          Upload
        </button>
        <input
          ref={fileInputRef}
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
                  <File size={14} className="text-gray-400" />
                  <span className="text-gray-700 font-medium truncate max-w-[200px]">{f.name}</span>
                  <span className="text-gray-400 text-xs">{formatFileSize(f.size)}</span>
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
                  {ALL_CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
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
              {CATEGORIES.map(cat => {
                const count = categoryCounts[cat.value] || 0;
                const colors = COLOR_MAP[cat.color];
                const isActive = filterCategory === cat.value;
                const isSubActive = cat.subs && cat.subs.some(s => filterCategory === s.value);
                const Icon = cat.icon;
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
                let cat = CATEGORIES.find(c => c.value === doc.category);
                let subLabel = null;
                if (!cat) {
                  // Check if it's a subcategory
                  for (const c of CATEGORIES) {
                    if (c.subs) {
                      const sub = c.subs.find(s => s.value === doc.category);
                      if (sub) { cat = c; subLabel = sub.label; break; }
                    }
                  }
                }
                const colors = COLOR_MAP[cat?.color || 'gray'];
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
                                {ALL_CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
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
    </div>
  );
}
