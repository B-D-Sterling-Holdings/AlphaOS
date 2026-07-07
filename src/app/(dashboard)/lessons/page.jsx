'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GraduationCap, Plus, Search, Trash2, X, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, TrendingUp, BookOpen, Layers, ListChecks,
  Tag as TagIcon, Link2, Lightbulb, Check, RotateCcw, ArrowLeft,
} from 'lucide-react';
import Toast from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import RichTextArea from '@/components/RichTextArea';
import LessonComments from '@/components/LessonComments';
import {
  LESSON_TYPES, OUTCOMES, CATEGORIES, SEVERITY,
  DETAIL_SECTIONS, LESSON_TEMPLATES, optionsFrom, labelOf, emptyDetail, blocksToPlain,
} from '@/lib/lessons';
import { saveWithOCC } from '@/lib/occClient';

const TEMPLATE_ICONS = { AlertTriangle, CheckCircle2, TrendingUp, BookOpen };
const todayISO = () => new Date().toISOString().slice(0, 10);

// Union two comment-thread arrays by id (local first, then server-only), so a
// concurrent comment on the same lesson is never lost when reconciling a conflict.
function unionCommentsById(localArr = [], serverArr = []) {
  const byId = new Map();
  for (const c of localArr || []) if (c?.id != null) byId.set(c.id, c);
  for (const c of serverArr || []) if (c?.id != null && !byId.has(c.id)) byId.set(c.id, c);
  return [...byId.values()];
}

/* ── Small shared UI ───────────────────────────────────────────── */

function Badge({ map, value, className = '' }) {
  if (!value) return null;
  const cfg = map[value];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset ${cfg.badge || 'bg-gray-100 text-gray-600 ring-gray-200'} ${className}`}>
      {cfg.label}
    </span>
  );
}

// Auto-growing textarea used throughout the detail editor.
function AutoTextarea({ value, onChange, placeholder, minRows = 2, className = '' }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, minRows * 22) + 'px';
  }, [minRows]);
  useEffect(() => { resize(); }, [resize, value]);
  return (
    <textarea
      ref={ref}
      value={value || ''}
      onChange={e => { onChange(e.target.value); }}
      onInput={resize}
      placeholder={placeholder}
      rows={minRows}
      spellCheck
      className={`w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all resize-none overflow-hidden placeholder:text-gray-300 ${className}`}
    />
  );
}

// Compact labeled select that drives a badge field.
function FieldSelect({ label, value, onChange, options, allowEmpty }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{label}</span>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] font-medium text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all cursor-pointer"
      >
        {allowEmpty && <option value="">—</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function CollapsibleSection({ title, subtitle, accent, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-2xl border ${accent ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-100 bg-gray-50/40'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          {accent && <Lightbulb size={15} className="text-emerald-600" />}
          <div>
            <h3 className={`text-[13px] font-bold ${accent ? 'text-emerald-800' : 'text-gray-800'}`}>{title}</h3>
            {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3.5">{children}</div>}
    </div>
  );
}

/* ── Tags ──────────────────────────────────────────────────────── */

function TagEditor({ tags = [], onChange }) {
  const [input, setInput] = useState('');
  const add = () => {
    const t = input.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200">
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} className="text-gray-400 hover:text-gray-700">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder="add tag…"
        className="text-[12px] bg-transparent outline-none placeholder:text-gray-300 w-24 py-0.5"
      />
    </div>
  );
}

/* ── Lesson list item (left column) ────────────────────────────── */

function LessonListItem({ lesson, active, onClick }) {
  const key = blocksToPlain(lesson.detail?.lesson) || blocksToPlain(lesson.detail?.setup);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-3.5 transition-all duration-200 ${
        active
          ? 'border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200 shadow-sm'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {lesson.ticker && (
              <span className="text-[12px] font-bold tracking-wide text-gray-900">{lesson.ticker}</span>
            )}
            <Badge map={LESSON_TYPES} value={lesson.type} />
          </div>
          <p className={`text-[13.5px] font-semibold leading-snug mt-1 ${active ? 'text-emerald-900' : 'text-gray-800'} line-clamp-2`}>
            {lesson.title || 'Untitled lesson'}
          </p>
        </div>
        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY[lesson.severity]?.dot || 'bg-gray-300'}`} title={`Severity: ${labelOf(SEVERITY, lesson.severity)}`} />
      </div>
      {key && <p className="text-[11.5px] text-gray-400 mt-1.5 line-clamp-2">{key}</p>}
      {(lesson.category || lesson.outcome) && (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {lesson.category && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200">
              {labelOf(CATEGORIES, lesson.category)}
            </span>
          )}
          <Badge map={OUTCOMES} value={lesson.outcome} />
        </div>
      )}
    </button>
  );
}

/* ── Lesson detail editor (right column) ───────────────────────── */

function LessonDetail({ lesson, patterns, onChange, onDetailChange, onDelete }) {
  if (!lesson) return null;
  const linkedPatternIds = new Set(lesson.pattern_ids || []);
  const togglePattern = (pid) => {
    const next = new Set(linkedPatternIds);
    next.has(pid) ? next.delete(pid) : next.add(pid);
    onChange({ pattern_ids: [...next] });
  };

  return (
    <div className="space-y-4">
      {/* Identity header */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
        <div className="flex items-start gap-2">
          <input
            value={lesson.title || ''}
            onChange={e => onChange({ title: e.target.value })}
            placeholder="Lesson title — write it as a reusable principle"
            className="flex-1 text-lg font-bold text-gray-900 outline-none placeholder:text-gray-300 placeholder:font-semibold bg-transparent"
            autoFocus={!lesson.title}
          />
          <button onClick={onDelete} className="shrink-0 p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete lesson">
            <Trash2 size={16} />
          </button>
        </div>

        {/* Ticker + company */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Ticker</span>
            <input
              value={lesson.ticker || ''}
              onChange={e => onChange({ ticker: e.target.value.toUpperCase() })}
              placeholder="AAPL"
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] font-semibold tracking-wide text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Company</span>
            <input
              value={lesson.company || ''}
              onChange={e => onChange({ company: e.target.value })}
              placeholder="Apple Inc."
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
            />
          </label>
        </div>

        {/* A few optional tags — leave blank for full freedom */}
        <div className="flex flex-wrap items-center gap-2">
          <FieldSelect label="Type" value={lesson.type} onChange={v => onChange({ type: v })} options={optionsFrom(LESSON_TYPES)} allowEmpty />
          <FieldSelect label="Outcome" value={lesson.outcome} onChange={v => onChange({ outcome: v })} options={optionsFrom(OUTCOMES)} allowEmpty />
          <FieldSelect label="Category" value={lesson.category} onChange={v => onChange({ category: v })} options={optionsFrom(CATEGORIES)} allowEmpty />
          <FieldSelect label="Severity" value={lesson.severity} onChange={v => onChange({ severity: v })} options={optionsFrom(SEVERITY)} allowEmpty />
        </div>

        <div className="pt-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 flex items-center gap-1 mb-1.5"><TagIcon size={11} /> Tags</span>
          <TagEditor tags={lesson.tags || []} onChange={v => onChange({ tags: v })} />
        </div>
      </div>

      {/* One large rich-text editor per section, with example subheadings */}
      {DETAIL_SECTIONS.map(section => (
        <CollapsibleSection
          key={section.id}
          title={section.title}
          subtitle={section.subtitle}
          accent={section.accent}
          defaultOpen
        >
          <div className="mb-3">
            <p className="text-[12px] text-gray-500 leading-relaxed">{section.desc}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {section.guide.map(g => (
                <span key={g} className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-white text-gray-500 ring-1 ring-inset ring-gray-200">
                  {g}
                </span>
              ))}
            </div>
          </div>
          <RichTextArea
            value={lesson.detail?.[section.id] || ''}
            onChange={v => onDetailChange(section.id, v)}
            onBlur={v => onDetailChange(section.id, v)}
            onCommit={v => onDetailChange(section.id, v)}
            ticker={lesson.ticker}
            enableTables
            placeholder="Write freely — paste text, tables, or images. Use the suggestions above as a guide and add your own headings."
            rows={6}
            className="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-3 text-sm text-gray-800 leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all resize-none overflow-hidden"
          />
        </CollapsibleSection>
      ))}

      {/* Pattern links */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Layers size={15} className="text-gray-500" />
          <h3 className="text-[13px] font-bold text-gray-800">Linked patterns</h3>
          <span className="text-[11px] text-gray-400">— recurring themes this lesson belongs to</span>
        </div>
        {patterns.length === 0 ? (
          <p className="text-[12px] text-gray-400">No patterns yet. Create them in the Pattern Library tab.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {patterns.map(p => {
              const on = linkedPatternIds.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => togglePattern(p.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium ring-1 ring-inset transition-colors ${
                    on ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-gray-500 ring-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {on && <Check size={12} />} {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Pattern library ───────────────────────────────────────────── */

function PatternCard({ pattern, lessons, onSelect, active }) {
  const related = lessons.filter(l => (l.pattern_ids || []).includes(pattern.id));
  const tickers = [...new Set(related.map(l => l.ticker).filter(Boolean))];
  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-2xl border p-4 transition-all duration-200 ${
        active ? 'border-emerald-300 bg-emerald-50/40 ring-1 ring-emerald-200' : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-bold text-gray-900 leading-snug">{pattern.name}</h3>
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400">
          <Link2 size={12} /> {related.length}
        </span>
      </div>
      {pattern.description && <p className="text-[12px] text-gray-500 mt-1.5 line-clamp-2">{pattern.description}</p>}
      {tickers.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {tickers.slice(0, 6).map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded-md text-[10.5px] font-bold tracking-wide bg-gray-100 text-gray-600">{t}</span>
          ))}
        </div>
      )}
    </button>
  );
}

function TriggerQuestions({ questions = [], onChange }) {
  const [input, setInput] = useState('');
  const add = () => { const q = input.trim(); if (q) { onChange([...questions, q]); setInput(''); } };
  return (
    <div className="space-y-2">
      {questions.map((q, i) => (
        <div key={i} className="flex items-start gap-2 group">
          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          <input
            value={q}
            onChange={e => onChange(questions.map((x, j) => j === i ? e.target.value : x))}
            className="flex-1 text-[13px] text-gray-700 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          />
          <button onClick={() => onChange(questions.filter((_, j) => j !== i))} className="mt-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Plus size={14} className="text-gray-300" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Add a question this pattern should trigger in future research…"
          className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-gray-300 py-1.5"
        />
      </div>
    </div>
  );
}

function PatternDetail({ pattern, lessons, onChange, onDelete, onOpenLesson }) {
  if (!pattern) return null;
  const related = lessons.filter(l => (l.pattern_ids || []).includes(pattern.id));
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
        <div className="flex items-start gap-2">
          <input
            value={pattern.name || ''}
            onChange={e => onChange({ name: e.target.value })}
            placeholder="Pattern name"
            className="flex-1 text-lg font-bold text-gray-900 outline-none placeholder:text-gray-300 bg-transparent"
            autoFocus={!pattern.name}
          />
          <button onClick={onDelete} className="shrink-0 p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors" title="Delete pattern">
            <Trash2 size={16} />
          </button>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Description</label>
          <AutoTextarea value={pattern.description} onChange={v => onChange({ description: v })} placeholder="What is this recurring mistake or theme?" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Why it matters</label>
          <AutoTextarea value={pattern.why_it_matters} onChange={v => onChange({ why_it_matters: v })} placeholder="The cost of repeating this pattern." />
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks size={15} className="text-emerald-600" />
          <h3 className="text-[13px] font-bold text-emerald-800">Questions this pattern should trigger</h3>
        </div>
        <TriggerQuestions questions={pattern.checklist_questions || []} onChange={v => onChange({ checklist_questions: v })} />
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Link2 size={15} className="text-gray-500" />
          <h3 className="text-[13px] font-bold text-gray-800">Related lessons</h3>
          <span className="text-[11px] text-gray-400">({related.length})</span>
        </div>
        {related.length === 0 ? (
          <p className="text-[12px] text-gray-400">No lessons linked yet. Open a lesson and tag it with this pattern.</p>
        ) : (
          <div className="space-y-1.5">
            {related.map(l => (
              <button key={l.id} onClick={() => onOpenLesson(l.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/40 transition-colors text-left">
                <span className="flex items-center gap-2 min-w-0">
                  {l.ticker && <span className="text-[11px] font-bold text-gray-900 shrink-0">{l.ticker}</span>}
                  <span className="text-[13px] text-gray-700 truncate">{l.title || 'Untitled lesson'}</span>
                </span>
                <ChevronRight size={14} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

export default function LessonsPage() {
  const [lessons, setLessons] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('lessons'); // 'lessons' | 'patterns'
  const [selectedLessonId, setSelectedLessonId] = useState(null);
  const [selectedPatternId, setSelectedPatternId] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, id, name }
  const [quickOpen, setQuickOpen] = useState(false);

  const [filters, setFilters] = useState({ search: '', type: '', category: '', severity: '' });

  // Mirror latest collections so debounced saves read fresh data.
  const lessonsRef = useRef(lessons); lessonsRef.current = lessons;
  const patternsRef = useRef(patterns); patternsRef.current = patterns;
  const saveTimers = useRef({});
  const quickRef = useRef(null);

  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  /* ── Load ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lRes, pRes] = await Promise.all([fetch('/api/lessons'), fetch('/api/lesson-patterns')]);
        const [lData, pData] = await Promise.all([lRes.json(), pRes.json()]);
        if (!alive) return;
        if (Array.isArray(lData)) setLessons(lData);
        if (Array.isArray(pData)) setPatterns(pData);
      } catch {
        if (alive) showToast('Failed to load lessons', 'error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [showToast]);

  // Close quick-add menu on outside click.
  useEffect(() => {
    if (!quickOpen) return;
    const h = e => { if (quickRef.current && !quickRef.current.contains(e.target)) setQuickOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [quickOpen]);

  /* ── Debounced persistence (optimistic-concurrency guarded) ── */
  // Stamp the server's new version onto a row in state without disturbing edits the
  // user may have typed since the save was dispatched (content is local, version is
  // the server's) — so the next autosave guards against the right row.
  const stampVersion = useCallback((kind, id, version) => {
    if (typeof version !== 'number') return;
    const setter = kind === 'lesson' ? setLessons : setPatterns;
    setter(prev => prev.map(r => (r.id === id ? { ...r, version } : r)));
  }, []);

  const scheduleSave = useCallback((kind, id) => {
    const tkey = `${kind}:${id}`;
    clearTimeout(saveTimers.current[tkey]);
    setSaveState('saving');
    saveTimers.current[tkey] = setTimeout(async () => {
      const url = kind === 'lesson' ? '/api/lessons' : '/api/lesson-patterns';
      const row = (kind === 'lesson' ? lessonsRef.current : patternsRef.current).find(r => r.id === id);
      if (!row) return;
      // On a version conflict, keep the local scalar edits but UNION the comment
      // threads (lessons) so a teammate's concurrent comment survives, then retry.
      const result = await saveWithOCC({
        url,
        method: 'PUT',
        local: row,
        buildBody: (r) => ({ ...r, baseVersion: r.version }),
        merge: (local, server) => (kind === 'lesson'
          ? { ...server, ...local, comments: unionCommentsById(local.comments, server.comments), version: server.version }
          : { ...server, ...local, version: server.version }),
        retries: 3,
      });
      if (result.ok) {
        stampVersion(kind, id, result.data?.version);
        setSaveState('saved');
        setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1500);
      } else if (result.conflict) {
        // Couldn't land within the retry budget under heavy contention: apply the
        // merged row (nothing lost) and let the next edit/save flush it.
        const setter = kind === 'lesson' ? setLessons : setPatterns;
        if (result.merged) setter(prev => prev.map(r => (r.id === id ? { ...result.merged } : r)));
        setSaveState('idle');
        showToast('Merged a concurrent edit — save again to confirm', 'info');
      } else {
        setSaveState('idle');
        showToast('Save failed', 'error');
      }
    }, 700);
  }, [showToast, stampVersion]);

  /* ── Lesson mutations ── */
  const patchLesson = useCallback((id, patch) => {
    setLessons(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
    scheduleSave('lesson', id);
  }, [scheduleSave]);

  const patchLessonDetail = useCallback((id, key, value) => {
    setLessons(prev => prev.map(l => l.id === id ? { ...l, detail: { ...(l.detail || {}), [key]: value } } : l));
    scheduleSave('lesson', id);
  }, [scheduleSave]);

  const createLesson = useCallback(async (template) => {
    setQuickOpen(false);
    // Start blank for freedom; a template (if chosen) presets a few tags.
    const base = {
      title: '',
      ticker: '', company: '',
      type: '', outcome: '', category: '', severity: '',
      date_reviewed: todayISO(),
      tags: [], pattern_ids: [], detail: emptyDetail(),
      comments: [],
      ...(template?.defaults || {}),
    };
    try {
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, title: 'Untitled lesson' }),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error);
      // Keep an empty title locally so the placeholder + autofocus show.
      const local = { ...created, title: '' };
      setLessons(prev => [local, ...prev]);
      setTab('lessons');
      setSelectedLessonId(created.id);
    } catch {
      showToast('Could not create lesson', 'error');
    }
  }, [showToast]);

  const deleteLesson = useCallback(async (id) => {
    setLessons(prev => prev.filter(l => l.id !== id));
    if (selectedLessonId === id) setSelectedLessonId(null);
    try {
      await fetch(`/api/lessons?id=${id}`, { method: 'DELETE' });
      showToast('Lesson deleted', 'success');
    } catch { showToast('Delete failed', 'error'); }
  }, [selectedLessonId, showToast]);

  /* ── Pattern mutations ── */
  const patchPattern = useCallback((id, patch) => {
    setPatterns(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    scheduleSave('pattern', id);
  }, [scheduleSave]);

  const createPattern = useCallback(async () => {
    try {
      const res = await fetch('/api/lesson-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New pattern', description: '', why_it_matters: '', checklist_questions: [] }),
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error);
      setPatterns(prev => [...prev, { ...created, name: '' }].sort((a, b) => (a.name || '~').localeCompare(b.name || '~')));
      setSelectedPatternId(created.id);
    } catch { showToast('Could not create pattern', 'error'); }
  }, [showToast]);

  const deletePattern = useCallback(async (id) => {
    setPatterns(prev => prev.filter(p => p.id !== id));
    // Unlink from any lessons that referenced it.
    setLessons(prev => prev.map(l => (l.pattern_ids || []).includes(id)
      ? { ...l, pattern_ids: l.pattern_ids.filter(x => x !== id) } : l));
    if (selectedPatternId === id) setSelectedPatternId(null);
    try {
      await fetch(`/api/lesson-patterns?id=${id}`, { method: 'DELETE' });
      showToast('Pattern deleted', 'success');
    } catch { showToast('Delete failed', 'error'); }
  }, [selectedPatternId, showToast]);

  /* ── Derived ── */
  const filteredLessons = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return lessons.filter(l => {
      if (filters.type && l.type !== filters.type) return false;
      if (filters.category && l.category !== filters.category) return false;
      if (filters.severity && l.severity !== filters.severity) return false;
      if (q) {
        const hay = [
          l.title, l.ticker, l.company, (l.tags || []).join(' '),
          blocksToPlain(l.detail?.lesson), blocksToPlain(l.detail?.setup),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lessons, filters]);

  const metrics = useMemo(() => ({
    total: lessons.length,
    postMortems: lessons.filter(l => l.type === 'post_mortem').length,
    good: lessons.filter(l => l.type === 'good_decision').length,
    missed: lessons.filter(l => l.type === 'missed_opportunity').length,
    highSeverity: lessons.filter(l => l.severity === 'high').length,
  }), [lessons]);

  const selectedLesson = lessons.find(l => l.id === selectedLessonId) || null;
  const selectedPattern = patterns.find(p => p.id === selectedPatternId) || null;
  const hasActiveFilters = filters.search || filters.type || filters.category || filters.severity;

  /* ── Render ── */
  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header — title left, save state + tab switch right */}
      <div className="flex items-end justify-between gap-4 mb-5 animate-fade-in-up flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Lessons Learned</h1>
          <p className="text-sm text-gray-500 mt-1">Turn investment outcomes into repeatable process improvements.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[12px] font-medium flex items-center gap-1 transition-opacity duration-200 ${saveState === 'idle' ? 'opacity-0' : 'opacity-100'} ${saveState === 'saving' ? 'text-gray-400' : 'text-emerald-600'}`}>
            {saveState === 'saving' ? 'Saving…' : <><Check size={13} /> Saved</>}
          </span>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100/70 border border-gray-100">
            {[
              { id: 'lessons', label: 'Lessons', count: lessons.length },
              { id: 'patterns', label: 'Patterns', count: patterns.length },
            ].map(t => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${active ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                  {t.label}
                  <span className={`text-[11px] px-1.5 rounded-full ${active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-200/70 text-gray-500'}`}>{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Compact metric strip — doubles as one-click triage filters (lessons browse) */}
      {tab === 'lessons' && !loading && lessons.length > 0 && !selectedLessonId && (
        <MetricBar metrics={metrics} filters={filters} setFilters={setFilters} />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-28 rounded-2xl skeleton" />)}
        </div>
      ) : tab === 'lessons' ? (
        <LessonsTab
          lessons={lessons}
          filteredLessons={filteredLessons}
          patterns={patterns}
          filters={filters}
          setFilters={setFilters}
          hasActiveFilters={hasActiveFilters}
          selectedLesson={selectedLesson}
          selectedLessonId={selectedLessonId}
          setSelectedLessonId={setSelectedLessonId}
          patchLesson={patchLesson}
          patchLessonDetail={patchLessonDetail}
          createLesson={createLesson}
          requestDelete={(l) => setConfirm({ kind: 'lesson', id: l.id, name: l.title || 'this lesson' })}
          quickOpen={quickOpen}
          setQuickOpen={setQuickOpen}
          quickRef={quickRef}
        />
      ) : (
        <PatternsTab
          patterns={patterns}
          lessons={lessons}
          selectedPattern={selectedPattern}
          selectedPatternId={selectedPatternId}
          setSelectedPatternId={setSelectedPatternId}
          patchPattern={patchPattern}
          createPattern={createPattern}
          requestDelete={(p) => setConfirm({ kind: 'pattern', id: p.id, name: p.name || 'this pattern' })}
          openLesson={(id) => { setTab('lessons'); setSelectedLessonId(id); }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      {confirm && (
        <ConfirmModal
          title={`Delete ${confirm.kind}?`}
          message={`"${confirm.name}" will be permanently removed. This cannot be undone.`}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === 'lesson') deleteLesson(confirm.id);
            else deletePattern(confirm.id);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Metric strip / one-click triage filters ───────────────────── */

function MetricBar({ metrics, filters, setFilters }) {
  const chips = [
    { label: 'Total',          value: metrics.total,        filter: null,                            tone: 'text-gray-900' },
    { label: 'Post-mortems',   value: metrics.postMortems,  filter: { type: 'post_mortem' },         tone: 'text-rose-600' },
    { label: 'Good decisions', value: metrics.good,         filter: { type: 'good_decision' },       tone: 'text-emerald-600' },
    { label: 'Missed',         value: metrics.missed,       filter: { type: 'missed_opportunity' },  tone: 'text-amber-600' },
    { label: 'High severity',  value: metrics.highSeverity, filter: { severity: 'high' },            tone: 'text-rose-600' },
  ];
  const noneActive = !filters.type && !filters.severity && !filters.category && !filters.search;
  const isActive = (f) => f ? Object.entries(f).every(([k, v]) => filters[k] === v) : noneActive;
  const apply = (f) => {
    if (!f) { setFilters({ search: '', type: '', category: '', severity: '' }); return; }
    const active = isActive(f);
    setFilters(prev => {
      const next = { ...prev };
      for (const k of Object.keys(f)) next[k] = active ? '' : f[k];
      return next;
    });
  };

  return (
    <div className="flex flex-wrap items-stretch gap-2 mb-5 animate-fade-in-up">
      {chips.map(c => {
        const active = isActive(c.filter);
        return (
          <button
            key={c.label}
            onClick={() => apply(c.filter)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border transition-all duration-150 ${
              active ? 'bg-emerald-50/70 border-emerald-300 ring-1 ring-emerald-200' : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className={`text-lg font-bold leading-none tabular-nums ${c.tone}`}>{c.value}</span>
            <span className="text-[12.5px] font-medium text-gray-500 leading-none">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Lessons tab: full-width browse grid → full-page detail ─────── */

function LessonsTab({
  lessons, filteredLessons, patterns, filters, setFilters, hasActiveFilters,
  selectedLesson, setSelectedLessonId,
  patchLesson, patchLessonDetail, createLesson, requestDelete,
  quickOpen, setQuickOpen, quickRef,
}) {
  const setF = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  // ── Full-page detail (editor + discussion rail) ──
  if (selectedLesson) {
    return (
      <LessonDetailPage
        lesson={selectedLesson}
        patterns={patterns}
        onBack={() => setSelectedLessonId(null)}
        onChange={patch => patchLesson(selectedLesson.id, patch)}
        onDetailChange={(k, v) => patchLessonDetail(selectedLesson.id, k, v)}
        onDelete={() => requestDelete(selectedLesson)}
      />
    );
  }

  // ── Browse ──
  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Toolbar — search, filters, New */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={filters.search}
            onChange={e => setF('search', e.target.value)}
            placeholder="Search title, ticker, lesson…"
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 placeholder:text-gray-300"
          />
        </div>
        <FilterPill value={filters.type} onChange={v => setF('type', v)} placeholder="Type" options={optionsFrom(LESSON_TYPES)} />
        <FilterPill value={filters.category} onChange={v => setF('category', v)} placeholder="Category" options={optionsFrom(CATEGORIES)} />
        <FilterPill value={filters.severity} onChange={v => setF('severity', v)} placeholder="Severity" options={optionsFrom(SEVERITY)} />
        {hasActiveFilters && (
          <button onClick={() => setFilters({ search: '', type: '', category: '', severity: '' })}
            className="inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-700 px-1.5">
            <RotateCcw size={12} /> Clear
          </button>
        )}
        <div className="relative ml-auto" ref={quickRef}>
          <button
            onClick={() => setQuickOpen(o => !o)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 shadow-sm hover:shadow transition-all whitespace-nowrap"
          >
            <Plus size={16} /> New lesson
          </button>
          {quickOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-2xl shadow-2xl p-1.5 z-50 animate-scale-in" style={{ transformOrigin: 'top right' }}>
              <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Start from a template</div>
              {LESSON_TEMPLATES.map(t => {
                const Icon = TEMPLATE_ICONS[t.icon] || BookOpen;
                return (
                  <button key={t.id} onClick={() => createLesson(t)}
                    className="w-full flex items-start gap-3 px-2.5 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 text-gray-600 shrink-0"><Icon size={16} /></span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-gray-800">{t.label}</span>
                      <span className="block text-[11.5px] text-gray-400 leading-tight">{t.description}</span>
                    </span>
                  </button>
                );
              })}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button onClick={() => createLesson(null)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-gray-50 text-[13px] font-medium text-gray-600">
                  <Plus size={15} /> Blank lesson
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      {filteredLessons.length === 0 ? (
        lessons.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No lessons yet"
            body="Every closed position, missed name, or good call is a chance to improve your process. Click New lesson to capture your first post-mortem — pick a template to skip the blank page."
          />
        ) : (
          <div className="text-center text-sm text-gray-400 py-16">No lessons match these filters.</div>
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredLessons.map(l => (
            <LessonListItem key={l.id} lesson={l} onClick={() => setSelectedLessonId(l.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Full-page lesson detail: large editor + discussion side rail ─ */

function LessonDetailPage({ lesson, patterns, onBack, onChange, onDetailChange, onDelete }) {
  return (
    <div className="animate-fade-in-up">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gray-500 hover:text-emerald-700 transition-colors mb-4">
        <ArrowLeft size={15} /> All lessons
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <LessonDetail
          lesson={lesson}
          patterns={patterns}
          onChange={onChange}
          onDetailChange={onDetailChange}
          onDelete={onDelete}
        />
        <div className="xl:sticky xl:top-6">
          <LessonComments
            key={lesson.id}
            ticker={lesson.ticker}
            threads={lesson.comments || []}
            onChange={threads => onChange({ comments: threads })}
          />
        </div>
      </div>
    </div>
  );
}

function FilterPill({ value, onChange, placeholder, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`text-[12px] font-medium rounded-lg border px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-emerald-500/30 cursor-pointer transition-colors ${
        value ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-gray-500 border-gray-200'
      }`}
    >
      <option value="">{placeholder}: all</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ── Patterns tab ──────────────────────────────────────────────── */

function PatternsTab({
  patterns, lessons, selectedPattern, selectedPatternId, setSelectedPatternId,
  patchPattern, createPattern, requestDelete, openLesson,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr] gap-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-gray-500">Recurring themes across your lessons.</p>
          <button onClick={createPattern}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:from-emerald-700 hover:to-emerald-600 shadow-sm transition-all">
            <Plus size={15} /> New pattern
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2.5 lg:max-h-[calc(100vh-300px)] lg:overflow-y-auto lg:pr-1">
          {patterns.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No patterns yet"
              body="Patterns group recurring lessons across stocks — like “value trap” or “underestimated regulatory risk.” Create one, then link lessons to it so the same mistake gets caught earlier next time."
            />
          ) : (
            patterns.map(p => (
              <PatternCard key={p.id} pattern={p} lessons={lessons} active={p.id === selectedPatternId} onSelect={() => setSelectedPatternId(p.id)} />
            ))
          )}
        </div>
      </div>

      <div className="lg:max-h-[calc(100vh-280px)] lg:overflow-y-auto lg:pr-1">
        {selectedPattern ? (
          <PatternDetail
            pattern={selectedPattern}
            lessons={lessons}
            onChange={patch => patchPattern(selectedPattern.id, patch)}
            onDelete={() => requestDelete(selectedPattern)}
            onOpenLesson={openLesson}
          />
        ) : (
          <div className="h-full rounded-3xl border border-dashed border-gray-200 bg-gray-50/30 flex items-center justify-center min-h-[400px]">
            <div className="text-center max-w-xs px-6">
              <Layers size={28} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-500">Select a pattern</p>
              <p className="text-[12.5px] text-gray-400 mt-1">Open a pattern to edit its trigger questions and see every lesson linked to it.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────── */

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50/30 p-8 text-center">
      <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-500 mb-3"><Icon size={22} /></span>
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="text-[12.5px] text-gray-400 mt-1.5 leading-relaxed max-w-sm mx-auto">{body}</p>
    </div>
  );
}
