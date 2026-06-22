'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ThumbsUp, Meh, CloudRain, AlertTriangle,
  Scissors, Plus, LogOut as ExitIcon, FileText, ArrowRight,
  BarChart3, Shield, X, RefreshCw, Crosshair, ChevronUp, ChevronDown, ClipboardList, Target,
  FlaskConical, Trash2,
} from 'lucide-react';
import TaskBoardPage from '../tasks/page';
import { getValuationExpectedReturn } from '@/lib/valuationModel';

/* ── helpers ── */
const fmt$ = v => {
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};
const pct = v => (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';

const SENTIMENTS = [
  { value: 'uneasy', label: 'Uneasy', color: 'red', icon: CloudRain },
  { value: 'neutral', label: 'Neutral', color: 'amber', icon: Meh },
  { value: 'feeling_good', label: 'Feeling Good', color: 'emerald', icon: ThumbsUp },
];

const ACTIONS = [
  { value: 'exit', label: 'Exit', icon: ExitIcon, color: 'darkred' },
  { value: 'trim', label: 'Trim', icon: Scissors, color: 'red' },
  { value: 'hold', label: 'Hold', icon: Shield, color: 'amber' },
  { value: 'add', label: 'Add', icon: Plus, color: 'emerald' },
];

const CONVICTION_LABELS = ['', 'Very Low', 'Low', 'Medium', 'High', 'Very High'];

function SentimentBadge({ sentiment }) {
  const s = SENTIMENTS.find(x => x.value === sentiment) || SENTIMENTS[1];
  const colorMap = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${colorMap[s.color]}`}>
      <Icon size={11} /> {s.label}
    </span>
  );
}

function ActionBadge({ action }) {
  const a = ACTIONS.find(x => x.value === action) || ACTIONS[0];
  const colorMap = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-600',
    darkred: 'bg-red-200 text-red-800',
  };
  const Icon = a.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${colorMap[a.color]}`}>
      <Icon size={11} /> {a.label}
    </span>
  );
}

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-emerald-100 text-emerald-600' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-600' },
  { value: 'high', label: 'High', color: 'bg-red-100 text-red-700' },
  { value: 'urgent', label: 'Urgent', color: 'bg-gray-900 text-red-500' },
];

function PriorityBadge({ priority }) {
  const p = PRIORITIES.find(x => x.value === priority) || PRIORITIES[2];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.color}`}>
      {p.label}
    </span>
  );
}

const CANDIDATE_STATUSES = [
  { value: 'researching', label: 'Researching', color: 'bg-blue-100 text-blue-700' },
  { value: 'watching', label: 'Watching', color: 'bg-amber-100 text-amber-700' },
  { value: 'ready', label: 'Ready to Buy', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'passed', label: 'Passed', color: 'bg-gray-100 text-gray-500' },
];

function StatusBadge({ status }) {
  const s = CANDIDATE_STATUSES.find(x => x.value === status) || CANDIDATE_STATUSES[0];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.color}`}>
      {s.label}
    </span>
  );
}

const CONVICTION_COLORS = {
  1: { dot: 'bg-red-700', badge: 'bg-red-200 text-red-800 border-red-400', btn: 'bg-red-100 text-red-700 border-red-300' },
  2: { dot: 'bg-red-400', badge: 'bg-red-100 text-red-600 border-red-300', btn: 'bg-red-50 text-red-600 border-red-200' },
  3: { dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700 border-amber-300', btn: 'bg-amber-100 text-amber-700 border-amber-300' },
  4: { dot: 'bg-emerald-400', badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', btn: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  5: { dot: 'bg-emerald-600', badge: 'bg-emerald-200 text-emerald-800 border-emerald-400', btn: 'bg-emerald-200 text-emerald-800 border-emerald-400' },
};

function ConvictionDots({ level }) {
  const dotColors = ['', 'bg-red-700', 'bg-red-400', 'bg-amber-400', 'bg-green-600', 'bg-emerald-700'];
  return (
    <div className="flex items-center gap-1" title={`Conviction: ${CONVICTION_LABELS[level] || ''}`}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className={`w-2.5 h-2.5 rounded-full ${i <= level ? dotColors[level] : 'bg-gray-200'}`} />
      ))}
    </div>
  );
}


/* ── Edit Modal ── */
function EditModal({ holding, onSave, onClose }) {
  const [form, setForm] = useState({
    sentiment: holding.sentiment || 'neutral',
    conviction: holding.conviction ?? 3,
    action: holding.action || 'hold',
    action_reason: holding.actionReason || '',
    notes: holding.strategicNotes || '',
    priority: holding.attentionPriority ?? 'normal',
  });
  const formRef = useRef(form);

  const set = (k, v) => setForm(prev => {
    const next = { ...prev, [k]: v };
    formRef.current = next;
    return next;
  });

  // Auto-save on unmount (clicking off)
  useEffect(() => {
    return () => { onSave(holding.ticker, formRef.current); };
  }, [holding.ticker, onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900">{holding.ticker}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Priority */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => {
                const active = form.priority === p.value;
                return (
                  <button key={p.value} onClick={() => set('priority', p.value)}
                    className={`flex-1 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      active ? `${p.color} border-current` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sentiment */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Sentiment</label>
            <div className="flex gap-2">
              {SENTIMENTS.map(s => {
                const active = form.sentiment === s.value;
                const Icon = s.icon;
                const colors = {
                  emerald: active ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'border-gray-200 text-gray-500 hover:border-emerald-200',
                  amber: active ? 'bg-amber-100 text-amber-700 border-amber-300' : 'border-gray-200 text-gray-500 hover:border-amber-200',
                  red: active ? 'bg-red-100 text-red-700 border-red-300' : 'border-gray-200 text-gray-500 hover:border-red-200',
                };
                return (
                  <button key={s.value} onClick={() => set('sentiment', s.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${colors[s.color]}`}>
                    <Icon size={13} /> {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conviction */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Conviction</label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(level => {
                const active = form.conviction === level;
                const c = CONVICTION_COLORS[level];
                return (
                  <button key={level} onClick={() => set('conviction', level)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      active ? c.btn : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>
                    {CONVICTION_LABELS[level]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Notes</label>
            <textarea spellCheck={true} value={form.notes} onChange={e => set('notes', e.target.value)}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
              rows={3} placeholder="Key observations, catalysts, risks..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 resize-none overflow-hidden" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Candidate (Research Pipeline) Modal ── */
function CandidateModal({ candidate, onSave, onDelete, onClose }) {
  const isNew = !candidate.id;
  const [form, setForm] = useState({
    id: candidate.id || null,
    ticker: candidate.ticker || '',
    status: candidate.status || 'researching',
    sentiment: candidate.sentiment || 'neutral',
    conviction: candidate.conviction ?? 3,
    priority: candidate.priority || 'normal',
    target_weight: candidate.target_weight ?? '',
    notes: candidate.notes || '',
  });
  const formRef = useRef(form);

  const set = (k, v) => setForm(prev => {
    const next = { ...prev, [k]: v };
    formRef.current = next;
    return next;
  });

  // Auto-save on unmount (clicking off) — only if a ticker was entered
  useEffect(() => {
    return () => {
      const f = formRef.current;
      if (f.ticker && f.ticker.trim()) onSave(f);
    };
  }, [onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FlaskConical size={15} className="text-blue-500" />
            <h3 className="text-sm font-bold text-gray-900">{isNew ? 'New Candidate' : form.ticker}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Ticker */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Ticker</label>
            <input value={form.ticker} onChange={e => set('ticker', e.target.value.toUpperCase())}
              autoFocus={isNew} placeholder="e.g. NVDA"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-800 uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
          </div>

          {/* Status */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {CANDIDATE_STATUSES.map(s => {
                const active = form.status === s.value;
                return (
                  <button key={s.value} onClick={() => set('status', s.value)}
                    className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      active ? `${s.color} border-current` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sentiment */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Sentiment</label>
            <div className="flex gap-2">
              {SENTIMENTS.map(s => {
                const active = form.sentiment === s.value;
                const Icon = s.icon;
                const colors = {
                  emerald: active ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'border-gray-200 text-gray-500 hover:border-emerald-200',
                  amber: active ? 'bg-amber-100 text-amber-700 border-amber-300' : 'border-gray-200 text-gray-500 hover:border-amber-200',
                  red: active ? 'bg-red-100 text-red-700 border-red-300' : 'border-gray-200 text-gray-500 hover:border-red-200',
                };
                return (
                  <button key={s.value} onClick={() => set('sentiment', s.value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${colors[s.color]}`}>
                    <Icon size={13} /> {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conviction */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Conviction</label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(level => {
                const active = form.conviction === level;
                const c = CONVICTION_COLORS[level];
                return (
                  <button key={level} onClick={() => set('conviction', level)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      active ? c.btn : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>
                    {CONVICTION_LABELS[level]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority + Target Weight */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Target Wt %</label>
              <input type="number" step="0.1" value={form.target_weight}
                onChange={e => set('target_weight', e.target.value)} placeholder="—"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Notes</label>
            <textarea spellCheck={true} value={form.notes} onChange={e => set('notes', e.target.value)}
              ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
              rows={3} placeholder="Why it's interesting, what to research, valuation read..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none overflow-hidden" />
          </div>
        </div>
        {!isNew && (
          <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
            <button
              onClick={() => { formRef.current = { ...formRef.current, ticker: '' }; onDelete(candidate.id); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 size={13} /> Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function StrategicHubPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editTicker, setEditTicker] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [editCandidate, setEditCandidate] = useState(null); // candidate object (or {id:null,...} for new)
  const [sortBy, setSortBy] = useState('priority'); // priority | weight | completeness | sentiment | action
  const [filterAction, setFilterAction] = useState('all');
  const [filterSentiment, setFilterSentiment] = useState('all');
  const [tab, setTab] = useState('hub');
  const [portfolioNotes, setPortfolioNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimer = useRef(null);

  useEffect(() => {
    fetch('/api/strategic-notes').then(r => r.json()).then(rows => {
      const row = (rows || []).find(r => r.ticker === '_PORTFOLIO');
      if (row?.notes) setPortfolioNotes(row.notes);
    }).catch(() => {});
  }, []);

  const handleNotesChange = (val) => {
    setPortfolioNotes(val);
    setNotesSaved(false);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      await fetch('/api/strategic-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: '_PORTFOLIO', notes: val }),
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 1500);
    }, 600);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/strategic-hub');
      const d = await res.json();
      setData(d);

      // Fetch quotes for live prices
      if (d.holdings?.length) {
        const tickers = d.holdings.map(h => h.ticker).join(',');
        const qRes = await fetch(`/api/quotes?tickers=${tickers}`);
        const qData = await qRes.json();
        setQuotes(qData.quotes || qData);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await fetch('/api/strategic-candidates');
      const rows = await res.json();
      setCandidates(Array.isArray(rows) ? rows : []);
    } catch {}
  }, []);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  const handleSaveCandidate = useCallback(async (form) => {
    await fetch('/api/strategic-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    await loadCandidates();
  }, [loadCandidates]);

  const handleDeleteCandidate = useCallback(async (id) => {
    setEditCandidate(null);
    await fetch('/api/strategic-candidates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadCandidates();
  }, [loadCandidates]);

  const handleSaveNote = useCallback(async (ticker, form) => {
    await fetch('/api/strategic-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, ...form }),
    });
    // Refresh data
    const res = await fetch('/api/strategic-hub');
    const d = await res.json();
    setData(d);
  }, []);

  const moveRef = useRef({ displayed: [] });
  const rowRefs = useRef({});
  const handleMove = useCallback(async (ticker, direction) => {
    const displayedList = moveRef.current.displayed;
    const idx = displayedList.findIndex(h => h.ticker === ticker);
    if (idx < 0) return;
    const cur = displayedList[idx];
    let swapIdx = -1;
    if (direction === 'up') {
      for (let i = idx - 1; i >= 0; i--) {
        if (displayedList[i].attentionPriority === cur.attentionPriority) { swapIdx = i; break; }
      }
    } else {
      for (let i = idx + 1; i < displayedList.length; i++) {
        if (displayedList[i].attentionPriority === cur.attentionPriority) { swapIdx = i; break; }
      }
    }
    if (swapIdx < 0) return;
    const other = displayedList[swapIdx];
    const a = cur.sortOrder ?? 0;
    const b = other.sortOrder ?? 0;
    const newA = b === a ? (direction === 'up' ? a - 1 : a + 1) : b;
    const newB = a;

    // Animate the swap
    const curEl = rowRefs.current[cur.ticker];
    const otherEl = rowRefs.current[other.ticker];
    if (curEl && otherEl) {
      const curRect = curEl.getBoundingClientRect();
      const otherRect = otherEl.getBoundingClientRect();
      const dy = otherRect.top - curRect.top;
      curEl.style.transition = 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)';
      otherEl.style.transition = 'transform 320ms ease-out';
      curEl.style.transform = `translateY(${dy * 0.6}px) scale(1.02)`;
      otherEl.style.transform = `translateY(${-dy}px)`;
      curEl.style.zIndex = '5';
      curEl.style.position = 'relative';
      curEl.style.boxShadow = '0 6px 16px -8px rgba(16,185,129,0.4)';
      await new Promise(r => setTimeout(r, 200));
    }

    setData(prev => {
      if (!prev?.holdings) return prev;
      return {
        ...prev,
        holdings: prev.holdings.map(h => {
          if (h.ticker === cur.ticker) return { ...h, sortOrder: newA };
          if (h.ticker === other.ticker) return { ...h, sortOrder: newB };
          return h;
        }),
      };
    });

    // Reset styles next tick after re-render
    requestAnimationFrame(() => {
      if (curEl) {
        curEl.style.transition = '';
        curEl.style.transform = '';
        curEl.style.zIndex = '';
        curEl.style.position = '';
        curEl.style.boxShadow = '';
      }
      if (otherEl) {
        otherEl.style.transition = '';
        otherEl.style.transform = '';
      }
    });

    await Promise.all([
      fetch('/api/strategic-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: cur.ticker, sentiment: cur.sentiment, conviction: cur.conviction, action: cur.action, notes: cur.strategicNotes, priority: cur.attentionPriority, sort_order: newA }),
      }),
      fetch('/api/strategic-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: other.ticker, sentiment: other.sentiment, conviction: other.conviction, action: other.action, notes: other.strategicNotes, priority: other.attentionPriority, sort_order: newB }),
      }),
    ]);
  }, []);

  // Enriched holdings with live quote data
  const enriched = useMemo(() => {
    if (!data?.holdings) return [];
    return data.holdings.map(h => {
      const q = quotes?.[h.ticker];
      const price = q?.price || 0;
      const valuationExpectedReturn = getValuationExpectedReturn(h.valuationInputs, q?.price);
      const mktVal = h.shares * price;
      const costVal = h.shares * h.costBasis;
      const gl = mktVal - costVal;
      const glPct = costVal > 0 ? (gl / costVal) * 100 : 0;
      const dayChange = q?.dayChangePct || 0;
      return {
        ...h,
        price,
        mktVal,
        costVal,
        gl,
        glPct,
        dayChange,
        sector: q?.sector || '',
        expectedReturn: valuationExpectedReturn == null ? null : valuationExpectedReturn * 100,
      };
    });
  }, [data, quotes]);

  // Total portfolio value
  const totalValue = useMemo(() => {
    return enriched.reduce((s, h) => s + h.mktVal, 0) + (data?.cash || 0);
  }, [enriched, data]);

  // Add current weight to each holding
  const withWeights = useMemo(() => {
    return enriched.map(h => ({
      ...h,
      currentWeight: totalValue > 0 ? (h.mktVal / totalValue) * 100 : 0,
      weightDelta: h.targetWeight != null && totalValue > 0
        ? (h.mktVal / totalValue) * 100 - h.targetWeight
        : null,
    }));
  }, [enriched, totalValue]);

  // Filter & sort
  const displayed = useMemo(() => {
    let arr = [...withWeights];
    if (filterAction !== 'all') arr = arr.filter(h => h.action === filterAction);
    if (filterSentiment !== 'all') arr = arr.filter(h => h.sentiment === filterSentiment);

    const sorters = {
      priority: (a, b) => {
        const order = { urgent: 0, high: 1, normal: 2, low: 3 };
        const d = (order[a.attentionPriority] ?? 2) - (order[b.attentionPriority] ?? 2);
        if (d !== 0) return d;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      },
      weight: (a, b) => b.currentWeight - a.currentWeight,
      completeness: (a, b) => a.completeness - b.completeness,
      sentiment: (a, b) => {
        const order = { uneasy: 0, neutral: 1, feeling_good: 2 };
        return (order[a.sentiment] ?? 1) - (order[b.sentiment] ?? 1);
      },
      action: (a, b) => {
        const order = { exit: 0, trim: 1, watch: 2, hold: 3, add: 4 };
        return (order[a.action] ?? 3) - (order[b.action] ?? 3);
      },
      gl: (a, b) => a.glPct - b.glPct,
    };
    arr.sort(sorters[sortBy] || sorters.priority);
    return arr;
  }, [withWeights, sortBy, filterAction, filterSentiment]);

  moveRef.current.displayed = displayed;

  const editHolding = editTicker ? withWeights.find(h => h.ticker === editTicker) : null;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="flex items-center justify-center h-64">
          <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16 space-y-6 animate-hub-fade-in relative">
      <style jsx global>{`
        @keyframes hubFadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .animate-hub-fade-in { animation: hubFadeIn 0.5s ease-out both; }
      `}</style>
      {/* ── Header ── */}
      <div className="absolute right-6 lg:right-12 top-1 z-20 flex items-center gap-1 bg-gray-100 rounded-xl p-1">
        <button onClick={() => setTab('hub')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === 'hub' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <Target size={13} /> Strategic Hub
        </button>
        <button onClick={() => setTab('tasks')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === 'tasks' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <ClipboardList size={13} /> Task Board
        </button>
      </div>

      {tab === 'tasks' ? (
        <div key="tasks" className="-mx-6 lg:-mx-12 animate-hub-fade-in"><TaskBoardPage /></div>
      ) : (<div key="hub" className="space-y-6 animate-hub-fade-in">
      <h1 className="text-3xl font-bold text-gray-900">Strategic Hub</h1>

      {/* ── Full Position Grid ── */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
            Position Overview
          </h2>
          <div className="flex items-center gap-2">
            {/* Filters */}
            <select value={filterSentiment} onChange={e => setFilterSentiment(e.target.value)}
              className="text-[11px] font-medium text-gray-600 bg-gray-50 border-0 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-emerald-500/30">
              <option value="all">All Sentiment</option>
              <option value="feeling_good">Feeling Good</option>
              <option value="neutral">Neutral</option>
              <option value="uneasy">Uneasy</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="text-[11px] font-medium text-gray-600 bg-gray-50 border-0 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-emerald-500/30">
              <option value="priority">Sort: Priority</option>
              <option value="weight">Sort: Weight</option>
              <option value="gl">Sort: P&L</option>
              <option value="sentiment">Sort: Sentiment</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2 pl-2">Ticker</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Priority</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Sentiment</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Conv.</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Weight</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Exp. Return</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">P&L</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2 pl-8 pr-2" style={{ width: '260px' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(h => (
                <tr key={h.ticker}
                  ref={el => { if (el) rowRefs.current[h.ticker] = el; }}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  onClick={() => setEditTicker(h.ticker)}>
                  <td className="py-3 pl-2">
                    <div className="flex items-center gap-2">
                      {sortBy === 'priority' && (
                        <div className="flex flex-col -my-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); handleMove(h.ticker, 'up'); }}
                            className="p-0.5 text-gray-400 hover:text-gray-700">
                            <ChevronUp size={11} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleMove(h.ticker, 'down'); }}
                            className="p-0.5 text-gray-400 hover:text-gray-700">
                            <ChevronDown size={11} />
                          </button>
                        </div>
                      )}
                      <span className="text-xs font-bold text-gray-900">{h.ticker}</span>
                      <span className="text-[10px] text-gray-400">{fmt$(h.mktVal)}</span>
                    </div>
                  </td>
                  <td className="py-3"><PriorityBadge priority={h.attentionPriority} /></td>
                  <td className="py-3"><SentimentBadge sentiment={h.sentiment} /></td>
                  <td className="py-3"><ConvictionDots level={h.conviction} /></td>
                  <td className="py-3 text-right">
                    <span className="text-xs font-semibold text-gray-800 tabular-nums">{h.currentWeight.toFixed(1)}%</span>
                  </td>
                  <td className="py-3 text-right">
                    {h.expectedReturn != null ? (
                      <span className={`text-xs font-semibold tabular-nums ${
                        h.expectedReturn < 5 ? 'text-red-500'
                        : h.expectedReturn < 10 ? 'text-amber-500'
                        : h.expectedReturn <= 15 ? 'text-green-600'
                        : 'text-emerald-700 font-bold'
                      }`}>
                        {pct(h.expectedReturn)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <span className={`text-xs font-semibold tabular-nums ${h.glPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pct(h.glPct)}
                    </span>
                  </td>
                  <td className="py-3 pl-8 pr-2" style={{ width: '260px', maxWidth: '260px' }}>
                    {h.strategicNotes ? (
                      <div className="text-[11px] text-gray-500 truncate" style={{ width: '240px' }} title={h.strategicNotes}>{h.strategicNotes}</div>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {displayed.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-gray-400">
                    No holdings yet. Add positions on the Holdings page to see them here.
                  </td>
                </tr>
              )}

              {/* ── Research Pipeline (candidates) — same table so columns align ── */}
              <tr>
                <td colSpan={8} className="pt-7 pb-2">
                  <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                    <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                      Research Pipeline
                    </h3>
                    <button
                      onClick={() => setEditCandidate({ id: null, ticker: '', status: 'researching', conviction: 3, priority: 'normal', target_weight: '', notes: '' })}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-blue-600 transition-colors">
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </td>
              </tr>

              {/* Column labels for the candidate rows (align with positions above) */}
              <tr className="border-b border-gray-100">
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2 pl-2">Ticker</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Priority</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Sentiment</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Conv.</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Tgt Weight</th>
                <th className="pb-2"></th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Status</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2 pl-8 pr-2">Notes</th>
              </tr>

              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-3 pl-2">
                    <button
                      onClick={() => setEditCandidate({ id: null, ticker: '', status: 'researching', conviction: 3, priority: 'normal', target_weight: '', notes: '' })}
                      className="text-[11px] text-gray-300 hover:text-blue-500 transition-colors">
                      + Add a name you&apos;re researching
                    </button>
                  </td>
                </tr>
              ) : candidates.map(c => (
                <tr key={c.id}
                  className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer group"
                  onClick={() => setEditCandidate(c)}>
                  <td className="py-3 pl-2">
                    <span className="text-xs font-bold text-gray-900">{c.ticker}</span>
                  </td>
                  <td className="py-3"><PriorityBadge priority={c.priority} /></td>
                  <td className="py-3"><SentimentBadge sentiment={c.sentiment} /></td>
                  <td className="py-3"><ConvictionDots level={c.conviction} /></td>
                  <td className="py-3 text-right">
                    {c.target_weight != null ? (
                      <span className="text-xs font-semibold text-gray-800 tabular-nums">{Number(c.target_weight).toFixed(1)}%</span>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right"></td>
                  <td className="py-3 text-right"><StatusBadge status={c.status} /></td>
                  <td className="py-3 pl-8 pr-2" style={{ width: '260px', maxWidth: '260px' }}>
                    {c.notes ? (
                      <div className="text-[11px] text-gray-500 truncate" style={{ width: '240px' }} title={c.notes}>{c.notes}</div>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Portfolio Notes ── */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Portfolio Notes</h2>
          <span className={`text-[10px] text-emerald-600 transition-opacity ${notesSaved ? 'opacity-100' : 'opacity-0'}`}>Saved</span>
        </div>
        <textarea spellCheck={true}
          value={portfolioNotes}
          onChange={e => handleNotesChange(e.target.value)}
          ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
          placeholder="Overall thoughts on the portfolio, market, themes, ideas to revisit..."
          rows={6}
          className="w-full border-0 bg-transparent text-sm text-gray-700 placeholder-gray-300 focus:outline-none resize-none leading-relaxed overflow-hidden"
        />
      </div>

      </div>)}

      {/* ── Edit Modal ── */}
      {editHolding && (
        <EditModal holding={editHolding} onSave={handleSaveNote} onClose={() => setEditTicker(null)} />
      )}

      {/* ── Candidate Modal ── */}
      {editCandidate && (
        <CandidateModal
          candidate={editCandidate}
          onSave={handleSaveCandidate}
          onDelete={handleDeleteCandidate}
          onClose={() => setEditCandidate(null)}
        />
      )}
    </div>
  );
}
