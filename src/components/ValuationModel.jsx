'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useImperativeHandle, useRef, forwardRef } from 'react';

// useLayoutEffect on the client, useEffect on the server — lets us measure & flip the
// popover before paint without React's SSR "useLayoutEffect does nothing" warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { RefreshCw, Save, CheckCircle, Plus, Trash2, Settings2, ArrowUp, ArrowDown, Copy, TrendingUp, Percent, PencilLine, Sigma, Divide, Link2, RotateCcw, Building2, X, Check } from 'lucide-react';
import {
  DEFAULT_VALUATION_INPUTS,
  computeValuationModel,
  makeDefaultInputs,
  migrateInputs,
} from '@/lib/valuationModel';

function fmt(v, decimals = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(v, decimals = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toFixed(decimals) + '%';
}

function formatEditableNumber(value, decimals = 6) {
  if (value === '' || value === undefined || value === null) return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return typeof value === 'string' ? value : '';
  return num.toFixed(decimals).replace(/\.?0+$/, '');
}

const uid = () => 'r' + Math.random().toString(36).slice(2, 9);

// Presets used when adding a row, so it arrives ready to use.
const PRESETS = [
  { key: 'growth', label: 'Growth line', desc: 'Compounds at a fixed %', Icon: TrendingUp },
  { key: 'pctOf', label: '% of revenue', desc: 'Tracks revenue to a target %', Icon: Percent },
  { key: 'manual', label: 'Manual line', desc: 'Type each year directly', Icon: PencilLine },
  { key: 'subtotal', label: 'Subtotal', desc: 'Sum of the rows above', Icon: Sigma },
  { key: 'margin', label: 'Margin %', desc: 'A row as % of revenue', Icon: Divide },
];

function makePresetRow(key) {
  switch (key) {
    case 'pctOf': return { id: uid(), name: 'New Line', type: 'line', sign: -1, method: 'pctOf', refId: 'revenue', base: '', target: '', ramp: true, format: 'money', dec: 3 };
    case 'manual': return { id: uid(), name: 'New Line', type: 'line', sign: -1, method: 'manual', values: ['', '', '', '', '', ''], format: 'money', dec: 3 };
    case 'subtotal': return { id: uid(), name: 'Subtotal', type: 'subtotal', format: 'money', dec: 3, bold: true };
    case 'margin': return { id: uid(), name: 'Margin', type: 'margin', refId: 'revenue', format: 'pct', dec: 2 };
    case 'growth':
    default: return { id: uid(), name: 'New Line', type: 'line', sign: -1, method: 'growth', base: '', rate: '', format: 'money', dec: 3 };
  }
}

function InputCell({ value, onChange, onBlur, pct = false, dollar = false, suffix = '', placeholder, className = '', bare = false, textSize = 'vm-num' }) {
  const formattedValue = pct && value !== '' && value !== undefined
    ? formatEditableNumber(Number(value) * 100)
    : formatEditableNumber(value);
  const [draftValue, setDraftValue] = useState(formattedValue);

  useEffect(() => {
    setDraftValue(formattedValue);
  }, [formattedValue]);

  const hasSuffix = pct || suffix;
  const handleChange = e => {
    const raw = e.target.value;
    if (!/^-?\d*\.?\d*$/.test(raw)) return;
    setDraftValue(raw);
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      onChange(raw === '-' ? '-' : '');
      return;
    }
    if (raw.endsWith('.')) {
      onChange(pct ? Number(raw.slice(0, -1)) / 100 : Number(raw.slice(0, -1)));
      return;
    }
    onChange(pct ? Number(raw) / 100 : Number(raw));
  };
  const handleBlur = () => { setDraftValue(formattedValue); onBlur?.(); };
  const inputBase = 'font-semibold text-gray-900 outline-none tabular-nums placeholder:text-gray-300 placeholder:font-normal';

  // ── Tile (bare) variant ──────────────────────────────────────────────────────
  // Left-aligned and sized to its own value, so the number reads as the headline
  // sitting just under the label — no dead space, and the unit ($, %, x) hugs the
  // digits at the matching size instead of being pinned to a far edge. The input
  // auto-widens to the typed value (in `ch`, which tracks the tabular digit width).
  // textSize lives on the wrapper so the input inherits it and the units can be a
  // fixed fraction of it via `em`.
  if (bare) {
    const chars = Math.max((draftValue?.length || 0), (placeholder?.length || 0), 2);
    const affix = 'text-[0.72em] font-semibold text-gray-400';
    return (
      <div className={`flex items-baseline ${textSize}`}>
        {dollar && <span className={`${affix} mr-px`}>$</span>}
        <input
          type="text"
          inputMode="decimal"
          value={draftValue ?? ''}
          onChange={handleChange}
          placeholder={placeholder}
          onBlur={handleBlur}
          style={{ width: `${chars}ch` }}
          className={`max-w-full bg-transparent border-0 p-0 text-right transition-all ${inputBase} ${className}`}
        />
        {pct && <span className={`${affix} ml-1`}>%</span>}
        {!pct && suffix && <span className={`${affix} ml-1`}>{suffix}</span>}
      </div>
    );
  }

  // ── Standalone (table) variant — keeps its own blue field chrome ──────────────
  const padL = dollar ? 'pl-6' : 'pl-2.5';
  const padR = hasSuffix ? 'pr-6' : 'pr-2.5';
  return (
    <div className="relative flex items-center">
      {dollar && <span className="absolute text-[11px] font-medium text-gray-400 pointer-events-none left-2.5">$</span>}
      <input
        type="text"
        inputMode="decimal"
        value={draftValue ?? ''}
        onChange={handleChange}
        placeholder={placeholder}
        onBlur={handleBlur}
        className={`w-full bg-sky-50/80 border border-sky-200/60 rounded-md py-1.5 focus:ring-1.5 focus:ring-sky-400 focus:border-sky-400 focus:bg-white transition-all text-right ${textSize} ${inputBase} ${padL} ${padR} ${className}`}
      />
      {pct && <span className="absolute text-[11px] font-medium text-gray-400 pointer-events-none right-2.5">%</span>}
      {!pct && suffix && <span className="absolute text-[11px] font-medium text-gray-400 pointer-events-none right-2.5">{suffix}</span>}
    </div>
  );
}

function CalcCell({ value, format = 'number', decimals = 2, bold = false }) {
  let display;
  if (format === 'pct') display = fmtPct(value, decimals);
  else if (format === 'money') display = value != null && !isNaN(value) ? `$${fmt(value, decimals)}` : '—';
  else display = fmt(value, decimals);
  return (
    <span className={`vm-num tabular-nums ${bold ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
      {display}
    </span>
  );
}

// A group of assumptions as a clean, self-contained card: a small uppercase heading
// over a list of label→value rows separated by hairlines. Sits flush in the
// responsive .vm-assume grid and hugs its own content height.
function GroupCard({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl bg-white border border-gray-100 shadow-sm px-3.5">
      <header className="flex items-center gap-1.5 pt-2.5 pb-1.5 border-b border-gray-100">
        {Icon && <Icon size={11} className="text-gray-400" />}
        <span className="text-[9.5px] font-bold uppercase tracking-widest text-gray-400">{title}</span>
      </header>
      <div className="divide-y divide-gray-100">{children}</div>
    </section>
  );
}

// One label→value line. The label sits muted on the left; the value (editable field
// or derived figure) is pushed to the right by justify-between, reading as a clean
// right-aligned figure without needing a box around it.
function FieldRow({ label, icon: Icon, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[7px]">
      <span className="flex items-center gap-1.5 min-w-0 vm-label font-medium text-gray-600">
        {Icon && <Icon size={12} className="text-sky-400 shrink-0" />}
        <span className="truncate" title={typeof label === 'string' ? label : undefined}>{label}</span>
      </span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Wraps an editable value so it reads as tappable — a faint sky tint on hover, and a
// white field with a sky ring on focus (the same "blue = editable" language as the
// table cells), without the heavy always-on box.
function EditValue({ children }) {
  return (
    <div className="rounded-md -mr-1.5 px-1.5 py-0.5 cursor-text hover:bg-sky-50 focus-within:bg-white focus-within:ring-1 focus-within:ring-sky-300 transition-colors">
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange, size = 'md' }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 ${size === 'sm' ? 'text-[10.5px] px-1.5 py-1' : 'text-[11px] px-2 py-1.5'} font-semibold rounded-md transition-all ${value === o.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      {label && <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">{label}</div>}
      {children}
    </div>
  );
}

const selectCls = 'w-full text-[12.5px] font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:border-sky-400 focus:bg-white transition-colors cursor-pointer';

const ValuationModel = forwardRef(function ValuationModel({ ticker, livePrice, embedded = false }, ref) {
  const [inputs, setInputs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // menu = { rowId | '__end__', kind: 'config' | 'insert', x, y }
  const [menu, setMenu] = useState(null);
  const [insertPos, setInsertPos] = useState('below');
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  // ── Scenarios (tabs) ─────────────────────────────────────────────────────────
  // Each tab is an independent valuation (bull / bear / base …). The ACTIVE tab's
  // model lives in `inputs` (so every existing edit path is unchanged); the other
  // tabs' data sit in `stashRef` until selected. On save the active scenario is
  // written flat at the top level (backward compatible — other readers still see a
  // normal model) plus a `__scenarios` list the engine ignores. See save/buildPayload.
  const [tabs, setTabs] = useState([]);           // [{ id, name }]
  const [activeId, setActiveId] = useState(null);
  const stashRef = useRef({});                     // id -> inputs for inactive tabs
  // Optimistic-concurrency token for this ticker's model row (see migration 030 /
  // src/lib/concurrency.js). Sent as baseVersion on save; a mismatch means someone
  // else saved first, so we reload their model instead of overwriting it. Bumping
  // reloadNonce re-runs the load effect.
  const versionRef = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [editingTabId, setEditingTabId] = useState(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [confirmDeleteTabId, setConfirmDeleteTabId] = useState(null);
  const deepCopy = (x) => JSON.parse(JSON.stringify(x));

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setDirty(false);
    setMenu(null);
    setEditingTabId(null);
    setConfirmDeleteTabId(null);
    // Normalise one scenario's stored data into a ready-to-edit model.
    const prep = (d) => {
      const { __scenarios, __activeId, ...rest } = d || {};
      return { ...DEFAULT_VALUATION_INPUTS, ...migrateInputs(rest), ticker, ...(livePrice ? { sharePrice: livePrice } : {}) };
    };
    const seedFresh = () => {
      const id = uid();
      stashRef.current = {};
      versionRef.current = 0; // no row yet → next save inserts
      setTabs([{ id, name: 'Base case' }]);
      setActiveId(id);
      setInputs({ ...makeDefaultInputs(ticker), sharePrice: livePrice || '' });
    };
    fetch(`/api/model/${ticker}`)
      .then(r => r.json())
      .then(result => {
        versionRef.current = result.version;
        if (!result.exists || !result.inputs) { seedFresh(); return; }
        const raw = result.inputs;
        const list = Array.isArray(raw.__scenarios) ? raw.__scenarios.filter(s => s && s.id && s.data) : null;
        if (list && list.length) {
          const aId = raw.__activeId && list.some(s => s.id === raw.__activeId) ? raw.__activeId : list[0].id;
          const stash = {};
          for (const s of list) if (s.id !== aId) stash[s.id] = prep(s.data);
          stashRef.current = stash;
          setTabs(list.map(s => ({ id: s.id, name: s.name || 'Scenario' })));
          setActiveId(aId);
          setInputs(prep(list.find(s => s.id === aId).data));
        } else {
          // Legacy single model → wrap it as the one and only tab.
          const id = uid();
          stashRef.current = {};
          setTabs([{ id, name: 'Base case' }]);
          setActiveId(id);
          setInputs(prep(raw));
        }
      })
      .catch(() => seedFresh())
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, reloadNonce]);

  // Always keep the model's share price on the live market price for THIS ticker. The
  // host page's livePrice (if any) seeds it instantly to avoid a flash, but we also
  // fetch the authoritative quote for the ticker so the price is never stale or carried
  // over from another name — no matter where the model is embedded.
  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    const apply = (price) => {
      const n = Number(price);
      if (cancelled || !Number.isFinite(n) || n <= 0) return;
      setInputs(prev => prev ? { ...prev, sharePrice: n } : prev);
      // Share price is ticker-level — keep every scenario (not just the active one) on it.
      const stash = stashRef.current;
      for (const k of Object.keys(stash)) if (stash[k]) stash[k] = { ...stash[k], sharePrice: n };
    };
    if (livePrice) apply(livePrice);
    fetch(`/api/quotes?tickers=${ticker}`)
      .then(r => r.json())
      .then(d => apply(d.quotes?.[ticker]?.price))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticker, livePrice]);

  const update = useCallback((field, value) => {
    setInputs(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  }, []);

  const updateRow = useCallback((id, patch) => {
    setInputs(prev => ({ ...prev, rows: prev.rows.map(r => r.id === id ? { ...r, ...patch } : r) }));
    setDirty(true);
  }, []);

  const updateRowValue = useCallback((id, yearIdx, value) => {
    setInputs(prev => ({
      ...prev,
      rows: prev.rows.map(r => {
        if (r.id !== id) return r;
        const values = [...(r.values || ['', '', '', '', '', ''])];
        values[yearIdx] = value;
        return { ...r, values };
      }),
    }));
    setDirty(true);
  }, []);

  const insertPreset = useCallback((key) => {
    setInputs(prev => {
      const rows = [...prev.rows];
      let index;
      if (!menu || menu.rowId === '__end__') {
        const ni = rows.findIndex(r => r.role === 'netIncome');
        index = ni >= 0 ? ni : rows.length;
      } else {
        const i = rows.findIndex(r => r.id === menu.rowId);
        index = insertPos === 'above' ? i : i + 1;
      }
      rows.splice(Math.max(0, Math.min(index, rows.length)), 0, makePresetRow(key));
      return { ...prev, rows };
    });
    setDirty(true);
    setMenu(null);
  }, [menu, insertPos]);

  const duplicateRow = useCallback((id) => {
    setInputs(prev => {
      const rows = [...prev.rows];
      const i = rows.findIndex(r => r.id === id);
      if (i < 0) return prev;
      const copy = { ...rows[i], id: uid(), name: `${rows[i].name} copy`, role: null };
      rows.splice(i + 1, 0, copy);
      return { ...prev, rows };
    });
    setDirty(true);
    setMenu(null);
  }, []);

  const deleteRow = useCallback((id) => {
    setInputs(prev => ({ ...prev, rows: prev.rows.filter(r => r.id !== id) }));
    setDirty(true);
    setMenu(null);
  }, []);

  const moveRow = useCallback((id, dir) => {
    setInputs(prev => {
      const rows = [...prev.rows];
      const i = rows.findIndex(r => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return prev;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { ...prev, rows };
    });
    setDirty(true);
  }, []);

  // The single POST path. Wraps the model for storage: the given active scenario flat
  // at the top (so other readers see a normal model) plus the full scenario list under
  // `__scenarios`. Takes the tab set + active id explicitly so callers that have just
  // changed them (e.g. delete) can persist the post-change state without waiting for a
  // state flush — the upsert overwrites `inputs` wholesale, so a removed tab is gone.
  const persist = useCallback(async (activeData, tabsList, activeIdVal) => {
    if (!ticker || !activeData) return;
    const list = tabsList
      .map(t => ({ id: t.id, name: t.name, data: t.id === activeIdVal ? activeData : stashRef.current[t.id] }))
      .filter(s => s.data);
    setSaving(true);
    try {
      const res = await fetch(`/api/model/${ticker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: { ...activeData, __scenarios: list, __activeId: activeIdVal },
          baseVersion: versionRef.current,
        }),
      });
      const result = await res.json();
      if (res.status === 409) {
        // Someone saved this model first — don't clobber it. Adopt their version
        // and reload their model (the local edit is surfaced by the value snapping
        // to server state, never silently discarded on the server).
        versionRef.current = result.version;
        setReloadNonce(n => n + 1);
        return;
      }
      if (result.success) {
        versionRef.current = result.version ?? versionRef.current;
        setDirty(false);
      }
    } catch {} finally { setSaving(false); }
  }, [ticker]);

  const save = useCallback(async () => {
    if (!inputs || !dirty) return;
    await persist(inputs, tabs, activeId);
  }, [inputs, dirty, tabs, activeId, persist]);

  // Reset just the ACTIVE scenario to the default template (other tabs are untouched),
  // persisting immediately so it survives a reload.
  const resetToDefault = useCallback(async () => {
    if (!ticker) return;
    const fresh = { ...makeDefaultInputs(ticker), sharePrice: livePrice || inputs?.sharePrice || '' };
    setInputs(fresh);
    setConfirmReset(false);
    setMenu(null);
    await persist(fresh, tabs, activeId);
  }, [ticker, livePrice, inputs, tabs, activeId, persist]);

  // ── Tab actions ──────────────────────────────────────────────────────────────
  const selectTab = useCallback((id) => {
    if (id === activeId) return;
    if (activeId) stashRef.current[activeId] = inputs; // park the current scenario
    const target = stashRef.current[id];
    if (target) { delete stashRef.current[id]; setInputs(target); }
    setActiveId(id);
    setMenu(null);
    setEditingTabId(null);
  }, [activeId, inputs]);

  // The "+" duplicates the scenario you're on into a new tab and switches to it.
  const addTab = useCallback(() => {
    if (!inputs) return;
    if (activeId) stashRef.current[activeId] = inputs;
    const id = uid();
    setTabs(prev => [...prev, { id, name: `Scenario ${prev.length + 1}` }]);
    setActiveId(id);
    setInputs(deepCopy(inputs));
    setDirty(true);
    setMenu(null);
  }, [inputs, activeId]);

  const renameTab = useCallback((id, name) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, name: name || 'Scenario' } : t));
    setDirty(true);
  }, []);

  const deleteTab = useCallback((id) => {
    if (tabs.length <= 1) return; // never remove the last scenario
    const idx = tabs.findIndex(t => t.id === id);
    const remaining = tabs.filter(t => t.id !== id);
    let nextActiveId = activeId;
    let nextActiveData = inputs;
    if (id === activeId) {
      const neighbor = remaining[Math.max(0, idx - 1)] || remaining[0];
      nextActiveId = neighbor.id;
      nextActiveData = stashRef.current[neighbor.id] || inputs;
      delete stashRef.current[neighbor.id]; // it becomes the active scenario
      setInputs(nextActiveData);
      setActiveId(nextActiveId);
    }
    delete stashRef.current[id];
    setTabs(remaining);
    setConfirmDeleteTabId(null);
    // Persist the deletion straight away so it's gone from Supabase, not just locally.
    persist(nextActiveData, remaining, nextActiveId);
  }, [tabs, activeId, inputs, persist]);

  const model = useMemo(() => {
    if (!inputs) return null;
    return computeValuationModel(inputs);
  }, [inputs]);

  useImperativeHandle(ref, () => ({
    getModelData: () => ({ inputs, computed: model }),
  }), [inputs, model]);

  const placeFor = (el) => {
    const r = el.getBoundingClientRect();
    const width = 268;
    const margin = 12;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const x = Math.max(margin, Math.min(r.right - width, vw - width - margin));
    // Prefer opening downward from the button; if the popover would run off the
    // bottom and there's more room above, flip it upward (like a context menu). The
    // height is known once it has rendered — until then we drop below and the layout
    // effect re-places it with the measured height.
    const h = popoverRef.current?.offsetHeight || 0;
    const spaceBelow = vh - r.bottom - margin;
    const spaceAbove = r.top - margin;
    let y;
    if (h && h > spaceBelow && spaceAbove > spaceBelow) {
      y = Math.max(margin, r.top - 6 - h); // flip above
    } else {
      y = r.bottom + 6;
      if (h) y = Math.min(y, Math.max(margin, vh - margin - h)); // keep on-screen
    }
    return { x, y };
  };

  const openMenu = (kind, rowId, e) => {
    const btn = e.currentTarget;
    if (menu && menu.rowId === rowId && menu.kind === kind) { setMenu(null); triggerRef.current = null; return; }
    triggerRef.current = btn;
    if (kind === 'insert') setInsertPos('below');
    setMenu({ kind, rowId, ...placeFor(btn) });
  };

  // Keep the popover stuck to its trigger button while the page scrolls/resizes.
  useEffect(() => {
    if (!menu) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const btn = triggerRef.current;
        if (!btn || !btn.isConnected) return;
        setMenu(prev => prev ? { ...prev, ...placeFor(btn) } : prev);
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    // Re-place when the popover itself grows/shrinks (e.g. expanding margin config),
    // so it can flip up if it would now overflow the bottom.
    let ro;
    if (typeof ResizeObserver !== 'undefined' && popoverRef.current) {
      ro = new ResizeObserver(reposition);
      ro.observe(popoverRef.current);
    }
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.rowId, menu?.kind]);

  // Once the popover has rendered we know its real height — re-run placement so it can
  // flip upward if opening below would overflow the bottom of the screen.
  useIsomorphicLayoutEffect(() => {
    if (!menu) return;
    const btn = triggerRef.current;
    if (!btn || !btn.isConnected) return;
    const next = placeFor(btn);
    setMenu(prev => (prev && (prev.x !== next.x || prev.y !== next.y) ? { ...prev, ...next } : prev));
  }, [menu?.rowId, menu?.kind]);

  if (loading || !inputs || !model) {
    return <div className="skeleton h-80 rounded-2xl" />;
  }

  const years5 = [0, 1, 2, 3, 4, 5];
  const computedById = Object.fromEntries(model.rows.map(r => [r.id, r]));
  const protectedRow = (row) => row.role === 'revenue' || row.role === 'netIncome';

  // Coupling: which lines are held to a target by a margin row. lineId → the margin
  // row. This keys purely off the link (driverId), the same condition the top target
  // tile and the link icon use, so linking/unlinking flips all three together — the
  // line leaves the Growth list, shows the link, and the margin's target appears up
  // top to be filled in (the engine starts solving once that target has a value).
  const drivenBy = {};
  for (const r of inputs.rows) {
    if (r.type === 'margin' && r.driverId) drivenBy[r.driverId] = r;
  }

  // Growth-rate (CAGR) lines surface their rate up in the assumptions area — but a line
  // a margin is driving ignores its own rate, so don't offer one.
  const growthRows = inputs.rows.filter(r => r.type === 'line' && r.method === 'growth' && r.role !== 'tax' && !drivenBy[r.id]);

  // Margin rows that drive an expense surface their target up in the assumptions, next
  // to the growth rates, so every key projection lever lives in one place.
  const targetMarginRows = inputs.rows.filter(r => r.type === 'margin' && r.driverId);

  const cellFor = (row, i) => {
    const cr = computedById[row.id];
    const isMoney = row.format !== 'pct';
    // A driven line: its year-0 value (base) anchors the ramp; later years are solved.
    if (row.type === 'line' && drivenBy[row.id]) {
      return i === 0
        ? <InputCell value={row.base} onChange={v => updateRow(row.id, { base: v })} dollar={isMoney} />
        : <CalcCell value={cr?.values[i]} format={row.format} decimals={row.dec} bold={row.bold} />;
    }
    if (row.type === 'line' && row.method === 'manual') {
      return <InputCell value={(row.values || [])[i]} onChange={v => updateRowValue(row.id, i, v)} dollar={isMoney} />;
    }
    if (row.type === 'line' && i === 0 && (row.method === 'growth' || row.method === 'pctOf' || row.method === 'tax' || row.method === 'plug' || row.role === 'tax')) {
      return <InputCell value={row.base} onChange={v => updateRow(row.id, { base: v })} dollar={isMoney} />;
    }
    return <CalcCell value={cr?.values[i]} format={row.format} decimals={row.dec} bold={row.bold} />;
  };

  const highlightBg = (h) => h === 'emerald' ? 'bg-emerald-50/50'
    : h === 'violet' ? 'bg-violet-50/50'
    : h === 'sky' ? 'bg-sky-50/40' : '';

  const signDot = (row) => {
    if (row.type !== 'line' || row.method === 'plug') {
      return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-gray-200" />;
    }
    const expense = row.sign === -1;
    return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${expense ? 'bg-rose-400' : 'bg-emerald-400'}`} title={expense ? 'Subtracted in subtotals' : 'Added in subtotals'} />;
  };

  const tailRows = [
    { label: 'Outstanding Shares', kind: 'sharesBase', dec: 4, suffix: 'B' },
    { label: 'Earnings per Share', data: model.eps, format: 'money', dec: 2, bold: true, highlight: 'violet' },
    { label: 'Share Price (at Tgt P/E)', data: model.priceArr, format: 'money', dec: 2, bold: true, highlight: 'sky' },
    { label: 'Extra Shares w/ Div Reinvested', data: model.divShares, format: 'number', dec: 4 },
  ];

  const menuRow = menu && menu.rowId !== '__end__' ? inputs.rows.find(r => r.id === menu.rowId) : null;

  // ── Sleek config panel ───────────────────────────────────────────────────────
  const renderConfig = (row) => {
    const refOptions = inputs.rows.filter(r => r.id !== row.id);
    const u = (patch) => updateRow(row.id, patch);
    const setMethod = (method) => {
      const patch = { method, role: method === 'tax' ? 'tax' : (row.role === 'tax' ? null : row.role) };
      if (method === 'pctOf') { patch.refId = row.refId || 'revenue'; if (row.ramp === undefined) patch.ramp = true; }
      if (method === 'tax') patch.refId = row.refId || 'revenue';
      u(patch);
    };
    const methodVal = row.role === 'tax' ? 'tax' : row.method;

    // The margin row (if any) that is currently driving THIS line.
    const driver = row.type === 'line' ? drivenBy[row.id] : null;

    // Margin-row coupling helpers.
    const driverLineOptions = inputs.rows.filter(r => r.type === 'line' && r.role !== 'revenue');
    const defaultDriverId = () => {
      const subIdx = inputs.rows.findIndex(r => r.id === row.refId);
      for (let i = subIdx - 1; i >= 0; i--) {
        const c = inputs.rows[i];
        if (c.type === 'line' && c.role !== 'revenue') return c.id;
      }
      return driverLineOptions[0]?.id || '';
    };
    const setDriverLine = (lineId) => {
      u({ driverId: lineId || null });
      if (lineId) updateRow(lineId, { sign: -1 }); // a driven line is always an expense
    };

    return (
      <div className="space-y-3.5">
        <Field label="Type">
          <Segmented size="sm" value={row.type} onChange={(type) => {
            const patch = { type };
            if (type === 'margin') { patch.format = 'pct'; patch.dec = 2; if (!row.refId) patch.refId = 'revenue'; }
            else { patch.format = 'money'; patch.dec = 3; patch.driverId = undefined; patch.target = undefined; }
            if (type === 'line' && !row.method) patch.method = 'growth';
            u(patch);
          }} options={[{ value: 'line', label: 'Line' }, { value: 'subtotal', label: 'Subtotal' }, { value: 'margin', label: 'Margin' }]} />
        </Field>

        {/* A line being driven by a margin row — coupling is owned over there. */}
        {row.type === 'line' && driver && (
          <>
            <div className="flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-2">
              <Link2 size={14} className="text-sky-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-sky-700 leading-snug">
                Back-solved each year to hit <span className="font-semibold">{driver.name || 'a target margin'}</span>. Set the target on that row. Type this line&apos;s <span className="font-semibold">year-0 value</span> in the table — later years are solved for you.
              </p>
            </div>
            <button
              onClick={() => updateRow(driver.id, { driverId: null })}
              className="w-full text-[11px] font-semibold text-gray-500 hover:text-rose-600 border border-gray-200 hover:border-rose-200 rounded-lg py-1.5 transition-colors"
            >Release coupling</button>
          </>
        )}

        {row.type === 'line' && !driver && (
          <>
            <Field label="Projects by">
              <select className={selectCls} value={methodVal} onChange={e => setMethod(e.target.value)}>
                <option value="growth">Growth rate (CAGR)</option>
                <option value="pctOf">% of another row</option>
                <option value="manual">Manual (per year)</option>
                <option value="tax">Tax (× tax rate)</option>
              </select>
            </Field>

            <Field label="Counts as">
              <div className="flex gap-1.5">
                <button onClick={() => u({ sign: 1 })} className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg border transition-all ${row.sign !== -1 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Income</button>
                <button onClick={() => u({ sign: -1 })} className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg border transition-all ${row.sign === -1 ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Expense</button>
              </div>
            </Field>

            {row.method === 'growth' && (
              <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2">
                <TrendingUp size={14} className="text-gray-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-gray-500 leading-snug">Set this line&apos;s growth rate under <span className="font-semibold text-gray-600">Growth Rates</span> in the assumptions at the top.</p>
              </div>
            )}

            {row.method === 'pctOf' && (
              <>
                <Field label="% of which row">
                  <select className={selectCls} value={row.refId || 'revenue'} onChange={e => u({ refId: e.target.value })}>
                    {refOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Target % (yr 5)"><InputCell value={row.target} onChange={v => u({ target: v })} pct /></Field>
                  <Field label="From today"><Segmented size="sm" value={row.ramp === false ? 'flat' : 'ramp'} onChange={(v) => u({ ramp: v === 'ramp' })} options={[{ value: 'ramp', label: 'Ramp' }, { value: 'flat', label: 'Flat' }]} /></Field>
                </div>
              </>
            )}

            {(row.method === 'tax' || row.role === 'tax') && (
              <Field label="Applied to (× global tax rate)">
                <select className={selectCls} value={row.refId || 'revenue'} onChange={e => u({ refId: e.target.value })}>
                  {refOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
          </>
        )}

        {row.type === 'subtotal' && (
          <div className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2">
            <Sigma size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-gray-500 leading-snug">Adds up every line between this row and the subtotal above it.</p>
          </div>
        )}

        {row.type === 'margin' && (
          <>
            <Field label="Shows this row ÷ revenue">
              <select className={selectCls} value={row.refId || 'revenue'} onChange={e => u({ refId: e.target.value })}>
                {refOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>

            {/* Coupling lives here: this margin can back-solve an expense to hit a target. */}
            <Field label="Hold an expense to a target?">
              <Segmented size="sm" value={row.driverId ? 'yes' : 'no'} onChange={(v) => (v === 'yes' ? setDriverLine(defaultDriverId()) : u({ driverId: null }))} options={[{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }]} />
            </Field>

            {row.driverId && (
              <>
                <Field label="Back-solve which expense">
                  <select className={selectCls} value={row.driverId} onChange={e => setDriverLine(e.target.value)}>
                    {driverLineOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                {/* Target % is set up top in Growth Assumptions; only the ramp shape lives here. */}
                <Field label="From today"><Segmented size="sm" value={row.ramp === false ? 'flat' : 'ramp'} onChange={(v) => u({ ramp: v === 'ramp' })} options={[{ value: 'ramp', label: 'Ramp' }, { value: 'flat', label: 'Flat' }]} /></Field>
                <div className="flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-2">
                  <Link2 size={14} className="text-sky-500 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-sky-700 leading-snug">The chosen expense is solved each year so this margin ramps to the target. Set the target up top under Growth Assumptions.</p>
                </div>
              </>
            )}
          </>
        )}

        <div className="flex items-center gap-1 pt-2.5 border-t border-gray-100">
          <button onClick={() => moveRow(row.id, -1)} title="Move up" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"><ArrowUp size={14} /></button>
          <button onClick={() => moveRow(row.id, 1)} title="Move down" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"><ArrowDown size={14} /></button>
          <button onClick={() => duplicateRow(row.id)} title="Duplicate" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors"><Copy size={14} /></button>
          {!protectedRow(row) && (
            <button onClick={() => deleteRow(row.id)} title="Delete" className="ml-auto p-1.5 rounded-lg text-rose-400 hover:text-white hover:bg-rose-500 transition-colors"><Trash2 size={14} /></button>
          )}
        </div>
      </div>
    );
  };

  // ── Insert / add panel with presets ──────────────────────────────────────────
  const renderInsert = (showPos) => (
    <div className="space-y-2.5">
      {showPos && (
        <Segmented size="sm" value={insertPos} onChange={setInsertPos} options={[{ value: 'above', label: 'Insert above' }, { value: 'below', label: 'Insert below' }]} />
      )}
      <div className="flex flex-col gap-0.5">
        {PRESETS.map(({ key, label, desc, Icon }) => (
          <button key={key} onClick={() => insertPreset(key)}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-sky-50 transition-colors text-left group/p">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 text-gray-500 group-hover/p:bg-sky-100 group-hover/p:text-sky-600 transition-colors shrink-0"><Icon size={14} /></span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-semibold text-gray-800 leading-tight">{label}</span>
              <span className="block text-[10.5px] text-gray-400 leading-tight">{desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  // Embedded (inside the Draft & Review left panel) drops the outer card chrome and
  // side padding so it sits flush in the parent Card; standalone (Research / Position
  // Review) keeps its own card and full-bleed section bands.
  const px = embedded ? 'px-0' : 'px-6';
  const band = embedded ? '' : 'bg-gray-50/30';
  // Numbers scale off the whole model's width (one query container on the root, see
  // .vm-scale in globals.css): both the assumption tiles and the income-statement
  // table jump between a compact and a roomy size together, so a half-width panel and
  // a full-width one each read consistently instead of the two areas disagreeing.
  const tileNum = 'vm-tile';
  const tickerNum = 'vm-ticker';

  return (
    <div className={embedded ? '' : 'bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden'} onBlur={save}>
      {/* vm-scale is the query container the number sizes read off (see globals.css).
          It wraps the content only — NOT the fixed-position popover below, since
          container-type makes an element a containing block for fixed descendants,
          which would otherwise re-anchor the popover off its viewport coordinates. */}
      <div className="vm-scale">
      {/* ── Scenario tabs ── one valuation per tab (bull / bear / base …); the "+"
          duplicates the current scenario. Double-click a tab to rename it. */}
      <div className={`flex items-center gap-0.5 overflow-x-auto ${embedded ? 'mb-3' : 'px-4 pt-3'}`}>
        {tabs.map(t => {
          const isActive = t.id === activeId;
          if (editingTabId === t.id) {
            return (
              <input
                key={t.id}
                autoFocus
                value={editingTabName}
                onChange={e => setEditingTabName(e.target.value)}
                onBlur={() => { renameTab(t.id, editingTabName.trim()); setEditingTabId(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameTab(t.id, editingTabName.trim()); setEditingTabId(null); }
                  if (e.key === 'Escape') setEditingTabId(null);
                }}
                className="shrink-0 px-2.5 py-1.5 text-xs font-semibold bg-white rounded-lg outline-none ring-2 ring-emerald-500 min-w-[80px] max-w-[160px]"
              />
            );
          }
          return (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              onDoubleClick={() => { setEditingTabId(t.id); setEditingTabName(t.name); setConfirmDeleteTabId(null); }}
              title="Double-click to rename"
              className={`group/vtab shrink-0 flex items-center gap-1.5 pl-3 ${tabs.length > 1 ? 'pr-1.5' : 'pr-3'} py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                isActive ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/70' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/70'
              }`}
            >
              <span className="max-w-[160px] truncate">{t.name}</span>
              {tabs.length > 1 && (confirmDeleteTabId === t.id ? (
                <span className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                  <span role="button" title="Delete scenario" onClick={(e) => { e.stopPropagation(); deleteTab(t.id); }} className="p-0.5 rounded text-rose-500 hover:bg-rose-100"><Check size={11} strokeWidth={3} /></span>
                  <span role="button" title="Cancel" onClick={(e) => { e.stopPropagation(); setConfirmDeleteTabId(null); }} className="p-0.5 rounded text-gray-400 hover:bg-gray-100"><X size={11} strokeWidth={3} /></span>
                </span>
              ) : (
                <span
                  role="button"
                  title="Delete scenario"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteTabId(t.id); }}
                  className={`p-0.5 rounded transition-all hover:bg-rose-100 hover:text-rose-500 ${isActive ? 'text-gray-400' : 'text-gray-300'}`}
                >
                  <X size={10} />
                </span>
              ))}
            </button>
          );
        })}
        <button
          onClick={addTab}
          title="Duplicate this scenario into a new tab"
          className="shrink-0 p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-gray-100/70 rounded-lg transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Header */}
      <div className={`flex items-center justify-between gap-3 border-b border-gray-100 ${embedded ? 'pb-3 mb-4' : 'px-6 py-4'}`}>
        <div className="min-w-0">
          {!embedded && <h2 className="text-base font-bold text-gray-900">Valuation Model</h2>}
          <p className={`text-[11px] text-gray-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${embedded ? '' : 'mt-0.5'}`}>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 bg-sky-100 border border-sky-300 rounded-sm" /> blue cells are editable</span>
            <span className="text-gray-200">·</span>
            <span className="inline-flex items-center gap-0.5">hover a row for <Settings2 size={11} /> &amp; <Plus size={11} /></span>
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {confirmReset ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-gray-500 hidden sm:inline">Reset everything?</span>
              <button
                onClick={resetToDefault}
                className="flex items-center gap-1 px-2.5 py-2 text-xs font-semibold rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors"
              ><RotateCcw size={12} /> Reset</button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-2.5 py-2 text-xs font-semibold rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              >Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              title="Reset this model to the default template (clears everything)"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-gray-500 border border-gray-200 hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50 transition-colors"
            ><RotateCcw size={12} /> Reset</button>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-all duration-200 ${
              dirty
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-sm hover:from-emerald-700 hover:to-emerald-600 hover:shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? <RefreshCw size={12} className="animate-spin" /> : dirty ? <Save size={12} /> : <CheckCircle size={12} />}
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* ── Assumptions ── three clean cards (Setup, Growth, Shareholder Returns) that
          flow into 1/2/3 columns with the panel width. Each is a list of label→value
          rows; editable values lift on hover/focus. */}
      <div className={`${px} ${embedded ? 'py-4' : 'py-5'} ${band} ${embedded ? 'rounded-2xl bg-gray-50/50 !px-3' : 'border-b border-gray-100'}`}>
        <div className="vm-assume">
          {/* Setup & Returns — the company knobs (ticker, price, base year) and the
              shareholder-return assumptions (dilution, dividend) in one card. */}
          <GroupCard icon={Building2} title="Setup & Returns">
            <FieldRow label="Ticker">
              <span className={`${tickerNum} font-extrabold text-gray-900 tracking-wide`}>{ticker || '—'}</span>
            </FieldRow>
            <FieldRow label="Share Price">
              <EditValue><InputCell value={inputs.sharePrice} onChange={v => update('sharePrice', v)} placeholder="0.00" dollar bare textSize={tileNum} /></EditValue>
            </FieldRow>
            <FieldRow label="Base Year">
              <EditValue><InputCell value={inputs.baseYear} onChange={v => update('baseYear', v)} bare textSize={tileNum} /></EditValue>
            </FieldRow>
            <FieldRow label="Net Dilution">
              <EditValue><InputCell value={inputs.netShareDilution} onChange={v => update('netShareDilution', v)} pct bare textSize={tileNum} /></EditValue>
            </FieldRow>
            <FieldRow label="Dividend Growth">
              <EditValue><InputCell value={inputs.dividendGrowth} onChange={v => update('dividendGrowth', v)} pct bare textSize={tileNum} /></EditValue>
            </FieldRow>
            <FieldRow label="Current Dividend">
              <EditValue><InputCell value={inputs.currentDividend} onChange={v => update('currentDividend', v)} dollar bare textSize={tileNum} /></EditValue>
            </FieldRow>
          </GroupCard>

          {/* Growth — user-set rates & target margins first, then the derived EPS
              growth and the valuation knobs (tax, target P/E) in the same list. */}
          <GroupCard icon={TrendingUp} title="Growth Assumptions">
            {growthRows.map(r => (
              <FieldRow key={r.id} label={r.name || 'Line'}>
                <EditValue><InputCell value={r.rate} onChange={v => updateRow(r.id, { rate: v })} pct bare textSize={tileNum} /></EditValue>
              </FieldRow>
            ))}
            {targetMarginRows.map(r => (
              <FieldRow key={r.id} label={r.name || 'Margin'} icon={Link2}>
                <EditValue><InputCell value={r.target} onChange={v => updateRow(r.id, { target: v })} pct bare textSize={tileNum} /></EditValue>
              </FieldRow>
            ))}
            <FieldRow label="EPS Growth">
              <span className={`${tileNum} font-semibold text-emerald-600 tabular-nums`}>{fmtPct(model.epsGrowth, 2)}</span>
            </FieldRow>
            <FieldRow label="Tax Rate">
              <EditValue><InputCell value={inputs.taxRate} onChange={v => update('taxRate', v)} pct bare textSize={tileNum} /></EditValue>
            </FieldRow>
            <FieldRow label="Target P/E">
              <EditValue><InputCell value={inputs.targetPE} onChange={v => update('targetPE', v)} suffix="x" bare textSize={tileNum} /></EditValue>
            </FieldRow>
          </GroupCard>
        </div>
      </div>

      {/* ── Projection Table ── only this scrolls horizontally; the year columns can't
          collapse below a usable width. */}
      <div className={`overflow-x-auto ${embedded ? 'mt-4' : ''}`}>
        <table className="w-full border-collapse min-w-[660px]">
          <thead>
            <tr className="bg-gray-50/80">
              <th className="text-left px-4 py-2.5 text-[10px] text-gray-400 font-bold uppercase tracking-widest border-b border-gray-200 w-56">Income Statement</th>
              {model.yearLabels.map((y, i) => (
                <th key={y} className="text-right px-3 py-2.5 border-b border-gray-200">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${i === 0 ? 'text-gray-400' : 'text-gray-500'}`}>{i === 0 ? 'TTM' : y}</span>
                  {i > 0 && <span className="block text-[9px] text-gray-300 font-medium">Yr {i}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inputs.rows.map((row) => {
              const active = menu?.rowId === row.id;
              return (
                <tr key={row.id} className={`group/row transition-colors ${highlightBg(row.highlight)} ${active ? 'bg-sky-50/40' : !row.highlight ? 'hover:bg-gray-50/60' : ''}`}>
                  <td className="px-4 vm-cell-pad border-b border-gray-50 w-56">
                    <div className="flex items-center gap-2">
                      {signDot(row)}
                      <input
                        type="text"
                        value={row.name}
                        onChange={e => updateRow(row.id, { name: e.target.value })}
                        className={`min-w-0 flex-1 bg-transparent vm-num outline-none focus:bg-sky-50/70 rounded px-1 -ml-1 py-0.5 ${row.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}
                      />
                      {(drivenBy[row.id] || (row.type === 'margin' && row.driverId)) && (
                        <Link2
                          size={12}
                          className="shrink-0 text-sky-400"
                          title={drivenBy[row.id]
                            ? `Back-solved to hit ${drivenBy[row.id].name || 'a target margin'}`
                            : `Drives ${inputs.rows.find(r => r.id === row.driverId)?.name || 'an expense'} to this target`}
                        />
                      )}
                      <button
                        onClick={(e) => openMenu('config', row.id, e)}
                        className={`shrink-0 rounded-md p-1 transition-all ${active && menu?.kind === 'config' ? 'bg-sky-100 text-sky-600' : 'text-gray-300 hover:text-gray-600 hover:bg-gray-100 opacity-40 group-hover/row:opacity-100'}`}
                        title="Row settings"
                      ><Settings2 size={14} /></button>
                      <button
                        onClick={(e) => openMenu('insert', row.id, e)}
                        className={`shrink-0 rounded-md p-1 transition-all ${active && menu?.kind === 'insert' ? 'bg-sky-100 text-sky-600' : 'text-gray-300 hover:text-sky-600 hover:bg-sky-50 opacity-0 group-hover/row:opacity-100'}`}
                        title="Insert row above / below"
                      ><Plus size={14} /></button>
                    </div>
                  </td>
                  {years5.map(i => (
                    <td key={i} className="px-3 vm-cell-pad text-right border-b border-gray-50">
                      {cellFor(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Bottom add */}
            <tr>
              <td colSpan={7} className="px-4 py-2 border-b border-gray-100">
                <button
                  onClick={(e) => openMenu('insert', '__end__', e)}
                  className={`flex items-center gap-1.5 text-[11px] font-medium border border-dashed rounded-md px-2.5 py-1 transition-colors ${menu?.rowId === '__end__' ? 'text-sky-700 bg-sky-50 border-sky-300' : 'text-gray-500 border-gray-300 hover:text-sky-700 hover:bg-sky-50 hover:border-sky-300'}`}
                ><Plus size={12} /> Add row</button>
              </td>
            </tr>

            {/* ── Fixed per-share & valuation tail ── */}
            <tr>
              <td colSpan={7} className="px-4 pt-4 pb-1.5">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Per-share &amp; valuation</span>
              </td>
            </tr>
            {tailRows.map((tr) => (
              <tr key={tr.label} className={`transition-colors ${highlightBg(tr.highlight)} ${!tr.highlight ? 'hover:bg-gray-50/60' : ''}`}>
                <td className={`px-4 py-2 vm-num whitespace-nowrap border-b border-gray-50 ${tr.bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                  {tr.label}
                </td>
                {years5.map(i => (
                  <td key={i} className="px-3 py-1.5 text-right border-b border-gray-50">
                    {tr.kind === 'sharesBase' && i === 0
                      ? <InputCell value={inputs.baseShares} onChange={v => update('baseShares', v)} suffix={tr.suffix} />
                      : <CalcCell value={(tr.kind === 'sharesBase' ? model.shares : tr.data)[i]} format={tr.format} decimals={tr.dec} bold={tr.bold} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Output Summary ── */}
      <div className={`${px} ${embedded ? 'pt-5' : 'py-5 border-t border-gray-200 bg-gradient-to-b from-gray-50/60 to-white'}`}>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { label: 'Expected CAGR', value: fmtPct(model.totalCAGRNoDivs, 2) },
            { label: 'Total CAGR (w/ Divs)', value: fmtPct(model.totalCAGR, 2) },
            { label: 'Price Target (2Y)', value: `$${fmt(model.priceTarget, 2)}` },
            { label: '5-Year Target Price', value: `$${fmt(model.targetPrice5, 2)}` },
          ].map(item => (
            <div key={item.label} className="bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1 truncate" title={item.label}>{item.label}</p>
              <p className="text-lg font-extrabold gradient-text">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Explanation ── why the assumptions are what they are. Saved as part of the
          model (inputs.explanation), so it persists per ticker and carries through the
          pipeline alongside the numbers. The root onBlur handles saving. */}
      <div className={`${px} ${embedded ? 'pt-5' : 'py-5 border-t border-gray-100 bg-gray-50/30'}`}>
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Explanation &amp; Key Assumptions</label>
        <textarea
          value={inputs.explanation || ''}
          onChange={(e) => update('explanation', e.target.value)}
          rows={5}
          placeholder="Explain the reasoning behind the model — why these growth rates, margins, the target multiple, share count, etc. Anything a reader needs to follow the assumptions and judge whether they're fair."
          className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm leading-relaxed text-gray-800 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-y min-h-[120px]"
        />
      </div>

      </div>{/* /vm-scale */}

      {/* ── Floating popover ── */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
          <div
            ref={popoverRef}
            className="fixed z-50 bg-white border border-gray-200/80 rounded-2xl shadow-xl ring-1 ring-black/5 p-4 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: menu.y, left: menu.x, width: 268 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5 mb-3">
              {menu.kind === 'config' ? <Settings2 size={12} className="text-gray-400" /> : <Plus size={12} className="text-gray-400" />}
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 truncate">
                {menu.kind === 'config' ? (menuRow?.name || 'Row') : 'Add a row'}
              </span>
            </div>
            {menu.kind === 'config' && menuRow ? renderConfig(menuRow) : renderInsert(menu.rowId !== '__end__')}
          </div>
        </>
      )}
    </div>
  );
});

export default ValuationModel;
