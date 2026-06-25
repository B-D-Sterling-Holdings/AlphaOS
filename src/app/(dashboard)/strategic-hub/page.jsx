'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ThumbsUp, Meh, CloudRain,
  Scissors, Plus, LogOut as ExitIcon, ArrowLeft, ArrowRight,
  Shield, X, ChevronUp, ChevronDown,
  FlaskConical, FileText, MessagesSquare, Search, CheckSquare, Star, User,
} from 'lucide-react';
import { getValuationExpectedReturn } from '@/lib/valuationModel';
import {
  normalizeStage, persistStageMove, withStageChange, writeWatchlistCache,
} from '@/lib/stageMove';
import { computeResearchProgress, draftReviewStatus, checklistStatus } from '@/lib/researchProgress';
import { useCache } from '@/lib/CacheContext';

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

const CONVICTION_COLORS = {
  1: { dot: 'bg-red-700', badge: 'bg-red-200 text-red-800 border-red-400', btn: 'bg-red-100 text-red-700 border-red-300' },
  2: { dot: 'bg-red-400', badge: 'bg-red-100 text-red-600 border-red-300', btn: 'bg-red-50 text-red-600 border-red-200' },
  3: { dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700 border-amber-300', btn: 'bg-amber-100 text-amber-700 border-amber-300' },
  4: { dot: 'bg-emerald-400', badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', btn: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  5: { dot: 'bg-emerald-600', badge: 'bg-emerald-200 text-emerald-800 border-emerald-400', btn: 'bg-emerald-200 text-emerald-800 border-emerald-400' },
};

function ConvictionDots({ level }) {
  const dotColors = ['', 'bg-red-700', 'bg-red-400', 'bg-amber-400', 'bg-green-600', 'bg-emerald-700'];
  const lvl = level || 0;
  return (
    <div className="flex items-center gap-1" title={`Conviction: ${CONVICTION_LABELS[lvl] || '—'}`}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className={`w-2.5 h-2.5 rounded-full ${i <= lvl ? dotColors[lvl] : 'bg-gray-200'}`} />
      ))}
    </div>
  );
}

// Small neutral metadata chip used inside the research cards.
function MetaChip({ icon: Icon, label, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-50 text-gray-500 border-gray-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {Icon && <Icon size={10} />}{label}
    </span>
  );
}

// Short labels printed under each segment of the research bar.
const SECTION_SHORT = {
  fundamentals: 'Fundamentals', thesis: 'Thesis', diligence: 'DD', valuation: 'Value',
  review: 'Review', news: 'News', decision: 'Rating',
};

// Sleek segmented bar — one segment per research section, coloured by its state and
// labelled with the section name underneath.
function SectionBar({ steps }) {
  const tone = { done: 'bg-emerald-400', partial: 'bg-amber-400', todo: 'bg-gray-200' };
  const textTone = { done: 'text-emerald-600', partial: 'text-amber-600', todo: 'text-gray-300' };
  return (
    <div className="flex gap-1">
      {steps.map(s => (
        <div key={s.key} className="min-w-0 flex-1"
          title={`${s.label}${s.detail ? ` · ${s.detail}` : ''} — ${s.state === 'done' ? 'complete' : s.state === 'partial' ? 'in progress' : 'not started'}`}>
          <div className={`h-1.5 rounded-full ${tone[s.state]}`} />
          <div className={`mt-1 truncate text-center text-[8px] font-semibold leading-none ${textTone[s.state]}`}>
            {SECTION_SHORT[s.key] || s.label}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ── Edit Modal (judgment editor for ANY ticker — holding or pipeline name) ── */
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

/* ── Research Pipeline ──
   Focused workflow control for the two middle stages — Draft & Review and Research.
   Each row carries the CIO judgment (priority / sentiment / conviction, click to edit)
   plus the stage-specific progress, and the hover arrows move a name straight between
   stages (Draft ⇄ Research, and Research → Position to graduate it). */
const DRAFT_GROUP = {
  key: 'draft', label: 'Draft & Review', icon: MessagesSquare,
  text: 'text-amber-600', border: 'border-amber-100', bg: 'bg-amber-50/40',
  href: t => `/draft-review?ticker=${t}`,
};
const RESEARCH_GROUP = {
  key: 'research', label: 'Research', icon: Search,
  text: 'text-blue-600', border: 'border-blue-100', bg: 'bg-blue-50/40',
  href: t => `/research?ticker=${t}`,
};

// Mirrors the Draft & Review page's role accents so a comment preview reads the same
// way here (reviewer = red, author = emerald).
const ROLE_META = {
  reviewer: { label: 'Reviewer', text: 'text-red-600', bar: 'bg-red-300' },
  author: { label: 'Author', text: 'text-emerald-600', bar: 'bg-emerald-300' },
};

// Flatten a comment body (rich-text block array or HTML string) to a one-line preview.
function plainText(v) {
  const raw = Array.isArray(v)
    ? v.map(b => (typeof b === 'string' ? b : (b?.value || ''))).join(' ')
    : (typeof v === 'string' ? v : '');
  return raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Compact conic-gradient progress ring for a Research card.
function ProgressRing({ percent, size = 38 }) {
  const deg = Math.max(0, Math.min(100, percent)) * 3.6;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(#3b82f6 ${deg}deg, #eef2f6 0deg)` }} />
      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white">
        <span className="text-[10px] font-bold leading-none tabular-nums text-gray-700">{percent}</span>
      </div>
    </div>
  );
}

// One name as a card. The data shown is research-native — drawn straight from the
// thesis (paper/review status, checklist, section progress, diligence, rating) — not
// the CIO judgment used on the Position Overview. Click opens the deep page; the
// footer button advances the name to the next stage.
function NameCard({ stock, group, theses, onMove }) {
  const router = useRouter();
  const t = stock.ticker;
  const wlId = stock.watchlistId;
  const th = theses[t];
  const author = (th?.underwriting?.draftReview?.author?.name || '').trim();

  let body;
  if (group.key === 'draft') {
    const ds = draftReviewStatus(th);
    const cl = checklistStatus(th);
    const openThreads = (th?.underwriting?.draftReview?.threads || []).filter(x => !x?.resolved);
    const extra = openThreads.length - 3;
    const review = !ds.hasPaper
      ? { label: 'No draft yet', tone: 'gray' }
      : ds.total === 0
        ? { label: 'Awaiting review', tone: 'blue' }
        : ds.open === 0
          ? { label: 'Review complete', tone: 'green' }
          : { label: 'In review', tone: 'amber' };
    const resolvedPct = ds.total > 0 ? Math.round((ds.resolved / ds.total) * 100) : 0;
    body = (
      <>
        <div className="mt-3 flex items-center justify-between gap-2">
          <MetaChip icon={FileText} label={review.label} tone={review.tone} />
          {ds.total > 0 && <span className="text-[10px] font-semibold tabular-nums text-gray-400">{ds.resolved}/{ds.total} resolved</span>}
        </div>
        {ds.total > 0 && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${resolvedPct}%` }} />
          </div>
        )}

        {openThreads.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {openThreads.slice(0, 3).map((thr, i) => {
              const msgs = thr.messages || [];
              const last = msgs[msgs.length - 1];
              const pending = last ? (last.role === 'reviewer' ? 'author' : 'reviewer') : 'reviewer';
              const meta = ROLE_META[pending];
              const text = (thr.title || '').trim() || plainText(last?.body) || 'Untitled comment';
              return (
                <div key={thr.id} className="relative flex items-center gap-1.5 rounded-md bg-gray-50/80 py-1 pl-2.5 pr-2">
                  <span className={`absolute inset-y-1 left-0 w-[2px] rounded-full ${meta.bar}`} />
                  <span className="shrink-0 text-[9px] font-bold tabular-nums text-gray-300">{i + 1}</span>
                  <span className="truncate text-[11px] text-gray-700" title={text}>{text}</span>
                  <span className={`ml-auto shrink-0 whitespace-nowrap text-[9px] font-semibold ${meta.text}`} title={`Waiting on ${meta.label}`}>{meta.label} to respond</span>
                </div>
              );
            })}
            {extra > 0 && (
              <button
                onClick={e => { e.stopPropagation(); router.push(group.href(t)); }}
                className="pl-2.5 text-[10px] font-semibold text-gray-400 transition-colors hover:text-gray-700">
                +{extra} more comment{extra !== 1 ? 's' : ''} →
              </button>
            )}
          </div>
        )}

        {cl.total > 0 && (
          <div className="mt-2.5">
            <MetaChip icon={CheckSquare} label={`${cl.done}/${cl.total} checks`} tone={cl.done === cl.total ? 'green' : 'gray'} />
          </div>
        )}
      </>
    );
  } else {
    const pr = computeResearchProgress(th);
    const rating = th?.underwriting?.equityRating || 0;
    const dilig = pr.steps.find(s => s.key === 'diligence');
    const valStep = pr.steps.find(s => s.key === 'valuation');
    const newsStep = pr.steps.find(s => s.key === 'news');
    const next = pr.steps.find(s => s.state !== 'done');
    const hasChips = rating > 0 || dilig?.detail || valStep?.state === 'done' || newsStep?.detail;
    body = (
      <>
        <div className="mt-3 flex items-center gap-3">
          <ProgressRing percent={pr.percent} />
          <div className="min-w-0 leading-tight">
            <div className="text-[12px] font-semibold text-gray-700">{pr.doneCount} of {pr.total} sections done</div>
            {next ? (
              <div className="mt-0.5 text-[10px] text-gray-400">Up next · <span className="font-semibold text-blue-600">{next.label}</span></div>
            ) : (
              <div className="mt-0.5 text-[10px] font-semibold text-emerald-600">Ready for decision</div>
            )}
          </div>
        </div>
        <div className="mt-2.5"><SectionBar steps={pr.steps} /></div>
        {hasChips && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {rating > 0 && <MetaChip icon={Star} label={`Rated ${rating}/5`} tone="violet" />}
            {valStep?.state === 'done' && <MetaChip label="Valued" tone="green" />}
            {dilig?.detail && <MetaChip icon={CheckSquare} label={`Diligence ${dilig.detail}`} tone="gray" />}
            {newsStep?.detail && <MetaChip label={`${newsStep.detail} news`} tone="blue" />}
          </div>
        )}
      </>
    );
  }

  return (
    <div onClick={() => router.push(group.href(t))}
      className="group cursor-pointer rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm transition-all hover:border-gray-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-bold text-gray-900">{t}</span>
          {author && (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">
              <User size={9} className="shrink-0" /> <span className="truncate">{author}</span>
            </span>
          )}
        </div>
        <Link href={group.href(t)} onClick={e => e.stopPropagation()}
          className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-gray-300 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100">
          Open →
        </Link>
      </div>

      {body}

      <div className="mt-3 flex items-center gap-1.5 border-t border-gray-50 pt-2.5">
        {group.key === 'research' && (
          <button onClick={e => { e.stopPropagation(); onMove(t, wlId, 'draft'); }} title="Move back to Draft & Review"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
            <ArrowLeft size={13} />
          </button>
        )}
        {group.key === 'draft' ? (
          <button onClick={e => { e.stopPropagation(); onMove(t, wlId, 'research'); }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 transition-all hover:bg-blue-100">
            Send to Research <ArrowRight size={12} />
          </button>
        ) : (
          <button onClick={e => { e.stopPropagation(); onMove(t, wlId, 'position'); }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100">
            Promote to Position <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// One stage column — a soft-tinted lane holding its name cards.
function PipelineColumn({ group, names, theses, onMove }) {
  const Icon = group.icon;
  return (
    <div className={`rounded-2xl border ${group.border} ${group.bg} p-3.5`}>
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <Icon size={14} className={group.text} />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{group.label}</h3>
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-bold tabular-nums text-gray-500">{names.length}</span>
      </div>
      {names.length ? (
        <div className="space-y-2.5">
          {names.map(s => (
            <NameCard key={s.ticker} stock={s} group={group} theses={theses} onMove={onMove} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 px-3 py-8 text-center text-[11px] text-gray-400">
          {group.key === 'draft' ? 'No drafts in progress.' : 'Nothing in deep research yet.'}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function StrategicHubPage() {
  const cache = useCache();
  const [data, setData] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editTicker, setEditTicker] = useState(null);
  const [sortBy, setSortBy] = useState('priority'); // priority | weight | gl | sentiment
  const [filterSentiment, setFilterSentiment] = useState('all');
  const [portfolioNotes, setPortfolioNotes] = useState('');
  // Watchlist + pipeline source (shared scope)
  const [watchlistData, setWatchlistData] = useState(() => cache.get('workflow_watchlist') || null);
  const [activeWlId, setActiveWlId] = useState(null);
  const [theses, setTheses] = useState(() => cache.get('workflow_theses') || {});
  const [notesRows, setNotesRows] = useState([]); // raw strategic_notes — judgment overlay
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimer = useRef(null);

  const loadNotes = useCallback(async () => {
    try {
      const rows = await fetch('/api/strategic-notes').then(r => r.json());
      const list = Array.isArray(rows) ? rows : [];
      setNotesRows(list);
      const portfolio = list.find(r => r.ticker === '_PORTFOLIO');
      if (portfolio?.notes != null) setPortfolioNotes(portfolio.notes);
    } catch {}
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

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

  // ── Watchlist (drives the pipeline + the watchlist review) ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/watchlist');
        const d = await res.json();
        setWatchlistData(d);
        writeWatchlistCache(cache, d);
        setActiveWlId(prev => prev || d.activeWatchlistId || d.watchlists?.[0]?.id || null);
      } catch {}
    })();
  }, [cache]);

  const activeWatchlist = watchlistData?.watchlists?.find(w => w.id === activeWlId) || null;
  const activeStocks = useMemo(() => activeWatchlist?.stocks || [], [activeWatchlist]);

  // Names in the two pipeline stages this card manages.
  const draftNames = useMemo(() => activeStocks.filter(s => normalizeStage(s.stage) === 'draft').map(s => ({ ...s, watchlistId: activeWlId })), [activeStocks, activeWlId]);
  const researchNames = useMemo(() => activeStocks.filter(s => normalizeStage(s.stage) === 'research').map(s => ({ ...s, watchlistId: activeWlId })), [activeStocks, activeWlId]);

  // Lazy-load a thesis for every Draft / Research name (for progress).
  useEffect(() => {
    const tickers = [...draftNames, ...researchNames].map(s => s.ticker);
    const missing = [...new Set(tickers)].filter(t => !theses[t]);
    if (!missing.length) return;
    let alive = true;
    Promise.all(missing.map(t =>
      fetch(`/api/thesis/${t}`).then(r => r.json()).then(d => [t, d]).catch(() => [t, null])
    )).then(entries => {
      if (!alive) return;
      setTheses(prev => {
        const next = { ...prev };
        for (const [t, d] of entries) if (d) next[t] = d;
        cache.set('workflow_theses', next);
        return next;
      });
    });
    return () => { alive = false; };
  }, [draftNames, researchNames, theses, cache]);

  // Move a name between pipeline stages — optimistic, then persist (seeds the
  // research workspace one-time when entering Research). Never destroys data.
  const handleMove = useCallback(async (ticker, watchlistId, newStage) => {
    if (!watchlistData) return;
    const optimistic = withStageChange(watchlistData, watchlistId, ticker, newStage);
    setWatchlistData(optimistic);
    writeWatchlistCache(cache, optimistic);
    try {
      const { thesis } = await persistStageMove({ watchlistData, watchlistId, ticker, newStage });
      if (thesis) {
        setTheses(prev => {
          const n = { ...prev, [ticker]: thesis };
          cache.set('workflow_theses', n);
          return n;
        });
      }
    } catch {}
  }, [watchlistData, cache]);

  const handleSaveNote = useCallback(async (ticker, form) => {
    await fetch('/api/strategic-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, ...form }),
    });
    await Promise.all([
      fetch('/api/strategic-hub').then(r => r.json()).then(setData).catch(() => {}),
      loadNotes(),
    ]);
  }, [loadNotes]);

  const moveRef = useRef({ displayed: [] });
  const rowRefs = useRef({});
  const handleMoveOrder = useCallback(async (ticker, direction) => {
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
    if (filterSentiment !== 'all') arr = arr.filter(h => h.sentiment === filterSentiment);

    const sorters = {
      priority: (a, b) => {
        const order = { urgent: 0, high: 1, normal: 2, low: 3 };
        const d = (order[a.attentionPriority] ?? 2) - (order[b.attentionPriority] ?? 2);
        if (d !== 0) return d;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      },
      weight: (a, b) => b.currentWeight - a.currentWeight,
      sentiment: (a, b) => {
        const order = { uneasy: 0, neutral: 1, feeling_good: 2 };
        return (order[a.sentiment] ?? 1) - (order[b.sentiment] ?? 1);
      },
      gl: (a, b) => a.glPct - b.glPct,
    };
    arr.sort(sorters[sortBy] || sorters.priority);
    return arr;
  }, [withWeights, sortBy, filterSentiment]);

  moveRef.current.displayed = displayed;

  // Judgment subject for the editor — a holding if we have one, else a pipeline name
  // backed by its strategic_notes row (or a fresh neutral default).
  const editSubject = useMemo(() => {
    if (!editTicker) return null;
    const holding = withWeights.find(h => h.ticker === editTicker);
    if (holding) return holding;
    const row = notesRows.find(r => r.ticker === editTicker);
    return {
      ticker: editTicker,
      sentiment: row?.sentiment || 'neutral',
      conviction: row?.conviction ?? 3,
      action: row?.action || 'hold',
      actionReason: row?.action_reason || '',
      strategicNotes: row?.notes || '',
      attentionPriority: row?.priority || 'normal',
    };
  }, [editTicker, withWeights, notesRows]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="flex items-center justify-center h-64">
          <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // ── Position Overview card (unchanged) ──
  const positionOverviewCard = (
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
                          <button onClick={(e) => { e.stopPropagation(); handleMoveOrder(h.ticker, 'up'); }}
                            className="p-0.5 text-gray-400 hover:text-gray-700">
                            <ChevronUp size={11} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleMoveOrder(h.ticker, 'down'); }}
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
            </tbody>
          </table>
      </div>
    </div>
  );

  // ── Research Pipeline card (Draft & Review → Research, as a two-lane board) ──
  const researchPipelineCard = (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
      <div className="mb-1">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
          <FlaskConical size={13} className="text-blue-500" /> Research Pipeline
        </h2>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">Drafting &amp; deep research in flight — move a name across when it&apos;s ready.</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PipelineColumn group={DRAFT_GROUP} names={draftNames} theses={theses} onMove={handleMove} />
        <PipelineColumn group={RESEARCH_GROUP} names={researchNames} theses={theses} onMove={handleMove} />
      </div>
    </div>
  );

  const hasPipeline = draftNames.length > 0 || researchNames.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16 space-y-6 animate-hub-fade-in relative">
      <style jsx global>{`
        @keyframes hubFadeIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .animate-hub-fade-in { animation: hubFadeIn 0.5s ease-out both; }
      `}</style>

      <div key="hub" className="space-y-6 animate-hub-fade-in">
      <h1 className="text-3xl font-bold text-gray-900">Strategic Hub</h1>

      {/* When there's work in the pipeline, surface Research above the book;
          otherwise keep Position Overview first and the pipeline below. */}
      {hasPipeline ? (
        <>{researchPipelineCard}{positionOverviewCard}</>
      ) : (
        <>{positionOverviewCard}{researchPipelineCard}</>
      )}

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

      </div>

      {/* ── Edit Modal ── */}
      {editSubject && (
        <EditModal holding={editSubject} onSave={handleSaveNote} onClose={() => setEditTicker(null)} />
      )}
    </div>
  );
}
