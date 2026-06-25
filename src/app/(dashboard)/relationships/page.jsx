'use client';

/* eslint-disable react-hooks/refs -- The zone-bubble layout deliberately reads and
   writes prevPositionsRef during render to remember each contact's last position, so
   bubbles that drop out of the active filter animate out from where they were. The
   React Compiler rule is too conservative for this intentional cross-render layout
   memory; a state/effect rewrite would either lag the first paint or re-pack bubbles
   on every filter change. */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Users, Plus, Phone, Mail,
  Search, X, Trash2,
} from 'lucide-react';
import Toast from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';

/* ─── helpers ─── */
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
const fmtShort = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const ahead = (n) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); };
const seeded = (s) => (hash(s) % 10000) / 10000;

/* Urgency score: 0 (chill) → 1 (urgent). Drives bubble color. */
const getUrgency = (c) => {
  const d = daysSince(c.last_contacted_at);
  const overdue = c.follow_up_date && new Date(c.follow_up_date) <= new Date();
  const imp = c.importance || 3;
  // Never contacted = high urgency
  if (d === null) return Math.min(1, 0.5 + imp * 0.1);
  // Overdue follow-up = very urgent
  if (overdue) return Math.min(1, 0.7 + imp * 0.06);
  // Scale by days since contact + importance
  const dayFactor = Math.min(1, d / 45); // 0 at 0 days, 1 at 45+ days
  return Math.min(1, dayFactor * (0.5 + imp * 0.1));
};
/* Urgency → color: green(chill) → yellow → orange → red(urgent) */
const urgencyColor = (u) => {
  if (u < 0.25) return '#22c55e'; // green — chilling
  if (u < 0.45) return '#84cc16'; // lime
  if (u < 0.6) return '#eab308';  // yellow — should reach out soon
  if (u < 0.75) return '#f97316'; // orange
  return '#ef4444';                // red — urgent
};
const urgencyLabel = (u) => {
  if (u < 0.25) return 'Chilling';
  if (u < 0.45) return 'Low';
  if (u < 0.6) return 'Moderate';
  if (u < 0.75) return 'High';
  return 'Urgent';
};
const urgencyBg = (u) => {
  if (u < 0.25) return 'bg-green-100 text-green-700';
  if (u < 0.45) return 'bg-lime-100 text-lime-700';
  if (u < 0.6) return 'bg-yellow-100 text-yellow-700';
  if (u < 0.75) return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-700';
};

/* Zone by follow-up date: ≤1 day or overdue → high, ≤5 days → medium, >5 days or no date → low */
const daysUntilFollowUp = (c) => {
  if (!c.follow_up_date) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const fu = new Date(c.follow_up_date); fu.setHours(0,0,0,0);
  return Math.ceil((fu - now) / 86400000);
};
const getUrgencyGroup = (c) => {
  const days = daysUntilFollowUp(c);
  if (days === null) return 'low'; // no follow-up date = no urgency
  if (days <= 1) return 'high';    // 1 day or overdue
  if (days <= 5) return 'medium';  // 2-5 days
  return 'low';                    // 6+ days away
};
/* Suggest a follow-up date that would place contact in a target zone */
const suggestDateForZone = (zoneKey) => {
  const now = new Date(); now.setHours(0,0,0,0);
  if (zoneKey === 'high') return new Date(now.getTime() + 1 * 86400000).toISOString().split('T')[0]; // tomorrow
  if (zoneKey === 'medium') return new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0]; // 3 days
  return new Date(now.getTime() + 14 * 86400000).toISOString().split('T')[0]; // 2 weeks
};

const ZONES = [
  { key: 'low', label: 'No Need to Contact', color: '#22c55e', bg: 'from-emerald-50/60 to-green-50/40', border: 'border-emerald-200/60', headerBg: 'bg-emerald-50', headerText: 'text-emerald-700' },
  { key: 'medium', label: 'Should Contact Soon', color: '#eab308', bg: 'from-yellow-50/60 to-amber-50/40', border: 'border-yellow-200/60', headerBg: 'bg-yellow-50', headerText: 'text-yellow-700' },
  { key: 'high', label: 'Urgently Contact', color: '#ef4444', bg: 'from-red-50/60 to-orange-50/40', border: 'border-red-200/60', headerBg: 'bg-red-50', headerText: 'text-red-700' },
];

const IMPORTANCE_LABELS = { 1: 'Low', 2: 'Minor', 3: 'Normal', 4: 'High', 5: 'Critical' };

const STRENGTHS = ['strong', 'warm', 'developing'];
const STATUSES = ['active', 'nurturing', 'cold', 'dormant'];
const sBadge = (s) => ({ strong: 'bg-emerald-100 text-emerald-700', warm: 'bg-amber-100 text-amber-700', developing: 'bg-blue-100 text-blue-700' }[s] || 'bg-gray-100 text-gray-600');


/* ─── force-directed bubble layout (per zone) ─── */
function computeZoneLayout(contacts, w, h, isHighZone) {
  if (!contacts.length) return {};

  const n = contacts.length;
  // Auto-scale radii so total bubble area fits ~55% of panel
  const baseRadii = contacts.map(c => 26 + (c.importance || 3) * 7);
  const totalArea = baseRadii.reduce((s, r) => s + Math.PI * (r + 12) * (r + 12), 0);
  const scale = Math.sqrt((w * h * 0.55) / totalArea);
  const gap = Math.max(10, 22 * scale);
  const pad = 10;

  // Seed positions using golden-angle spiral for natural, non-grid distribution
  const nodes = contacts.map((c, i) => {
    const imp = c.importance || 3;
    const r = (26 + imp * 7) * scale;
    const hasBadge = isHighZone && imp >= 4;
    const effectiveR = hasBadge ? r + 10 * scale : r;
    // Golden angle spiral + per-contact jitter for organic initial placement
    const golden = 2.399963; // radians
    const angle = i * golden + seeded(c.id + 'a') * 0.8;
    const dist = 0.25 + (i / Math.max(1, n - 1)) * 0.45 + seeded(c.id + 'd') * 0.15;
    return {
      id: c.id, r, effectiveR,
      x: w / 2 + Math.cos(angle) * dist * (w / 2 - effectiveR - pad),
      y: h / 2 + Math.sin(angle) * dist * (h / 2 - effectiveR - pad),
    };
  });

  // Simulation: resolve overlaps organically
  const iters = n > 15 ? 400 : 250;
  for (let iter = 0; iter < iters; iter++) {
    const t = iter / iters;
    // Gentle center gravity that fades out
    const gravity = 0.008 * (1 - t);
    nodes.forEach(nd => {
      nd.x += (w / 2 - nd.x) * gravity;
      nd.y += (h / 2 - nd.y) * gravity;
    });
    // Collision avoidance with per-pair randomized gap to prevent grid settling
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Vary gap per pair so distances aren't uniform
        const pairJitter = gap * (0.8 + seeded(nodes[i].id + nodes[j].id) * 0.6);
        const minDist = nodes[i].effectiveR + nodes[j].effectiveR + pairJitter;
        if (dist < minDist) {
          const f = (minDist - dist) / dist * 0.4;
          // Asymmetric push — smaller bubble moves more
          const ratio = nodes[j].r / (nodes[i].r + nodes[j].r);
          nodes[i].x -= dx * f * ratio; nodes[i].y -= dy * f * ratio;
          nodes[j].x += dx * f * (1 - ratio); nodes[j].y += dy * f * (1 - ratio);
        }
      }
    }
    // Soft boundary
    nodes.forEach(nd => {
      const minX = nd.effectiveR + pad, maxX = w - nd.effectiveR - pad;
      const minY = nd.effectiveR + pad, maxY = h - nd.effectiveR - pad;
      if (nd.x < minX) nd.x += (minX - nd.x) * 0.5;
      else if (nd.x > maxX) nd.x += (maxX - nd.x) * 0.5;
      if (nd.y < minY) nd.y += (minY - nd.y) * 0.5;
      else if (nd.y > maxY) nd.y += (maxY - nd.y) * 0.5;
    });
  }

  // Final hard clamp to ensure nothing is out of bounds
  nodes.forEach(nd => {
    nd.x = Math.max(nd.effectiveR + pad, Math.min(w - nd.effectiveR - pad, nd.x));
    nd.y = Math.max(nd.effectiveR + pad, Math.min(h - nd.effectiveR - pad, nd.y));
  });

  return Object.fromEntries(nodes.map(nd => [nd.id, { x: nd.x, y: nd.y, r: nd.r }]));
}

/* ─── contact tags (multi-select) ─── */
const CONTACT_TAGS = [
  { key: 'mailing_list', label: 'Mailing List' },
];
const hasTag = (c, tag) => Array.isArray(c.tags) && c.tags.includes(tag);
const toggleTag = (tags, tag) => {
  const arr = Array.isArray(tags) ? [...tags] : [];
  return arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag];
};


/* ═══════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════ */
/* ─── Input (for modals) ─── */
function Inp({ label, value, onChange, placeholder, type = 'text', autoFocus }) {
  return (
    <div>
      {label && <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-0.5">{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all" />
    </div>
  );
}

/* ─── Inline editable field (double-click to edit) ─── */
function InlineField({ value, field, contactId, onSave, placeholder, className, type = 'text', displayValue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  const save = () => {
    setEditing(false);
    if (draft !== (value || '')) onSave(contactId, { [field]: draft || (type === 'date' ? null : '') });
  };

  if (editing) {
    return (
      <input
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
        className={`${className} bg-transparent outline-none border-b border-emerald-400 w-full`}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      onDoubleClick={() => { setDraft(value || ''); setEditing(true); }}
      className={`${className} cursor-text hover:bg-gray-50 rounded px-0.5 -mx-0.5 transition-colors ${!value ? 'text-gray-300' : ''}`}
      title="Double-click to edit"
    >
      {displayValue || value || placeholder || '—'}
    </div>
  );
}

export default function RelationshipsPage() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const [selId, setSelId] = useState(null);
  const [displayId, setDisplayId] = useState(null); // lags behind selId for animation
  const [panelAnim, setPanelAnim] = useState(false);
  const animTimer = useRef(null);
  const closeTimer = useRef(null);
  const panelRef = useRef(null);
  const displayIdRef = useRef(null);
  const zoneRef = useRef(null); // ref to measure actual zone dimensions
  const [zoneDims, setZoneDims] = useState({ w: 400, h: 600 }); // actual zone pixel dimensions

  useEffect(() => {
    if (animTimer.current) clearTimeout(animTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const prevDisplayId = displayIdRef.current;

    if (!selId) {
      // Closing — keep displayId so content stays visible during slide-out
      // Clear it after the slide-out animation finishes
      closeTimer.current = setTimeout(() => {
        setDisplayId(null);
        displayIdRef.current = null;
      }, 400);
    } else if (!prevDisplayId) {
      // Opening fresh
      setDisplayId(selId);
      displayIdRef.current = selId;
      setPanelAnim(false);
    } else if (selId !== prevDisplayId) {
      // Switching between bubbles — fade out old, swap, fade in new
      setPanelAnim(true);
      animTimer.current = setTimeout(() => {
        setDisplayId(selId);
        displayIdRef.current = selId;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setPanelAnim(false);
          });
        });
      }, 250);
    }
    return () => {
      if (animTimer.current) clearTimeout(animTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [selId]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [addingToZone, setAddingToZone] = useState(null);

  const [dragOverZone, setDragOverZone] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [pendingDrop, setPendingDrop] = useState(null); // { contactId, targetZone, suggestedDate }

  const emptyC = { name: '', company: '', role: '', importance: 3, contact_method: 'email', contact_value: '', city: '', summary: '', tags: [] };
  const [cf, setCf] = useState(emptyC);

  const sel = contacts.find(c => c.id === displayId); // use displayId so old content stays during fade-out

  // Click anywhere outside the detail panel to close it
  useEffect(() => {
    if (!selId) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setSelId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selId]);

  /* ─── data ─── */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/contacts');
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d)) setContacts(d);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  /* ─── measure actual zone dimensions for responsive scaling ─── */
  useEffect(() => {
    if (!zoneRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setZoneDims({ w: width, h: height });
    });
    ro.observe(zoneRef.current);
    return () => ro.disconnect();
  }, []);

  /* ─── filtered + grouped + positioned ─── */
  const getZone = useCallback((c) => getUrgencyGroup(c), []);

  // All contacts grouped by zone (for rendering all bubbles)
  const allGrouped = useMemo(() => {
    const g = { low: [], medium: [], high: [] };
    contacts.forEach(c => { const zone = getZone(c); g[zone].push(c); });
    return g;
  }, [contacts, getZone]);

  // Filtered contacts (for layout computation — only matching contacts get positions)
  const filtered = useMemo(() => {
    let list = contacts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.name?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q) || c.role?.toLowerCase().includes(q) || c.city?.toLowerCase().includes(q));
    }
    if (filter !== 'all') list = list.filter(c => hasTag(c, filter));
    return list;
  }, [contacts, search, filter, getZone]);

  const matchIds = useMemo(() => new Set(filtered.map(c => c.id)), [filtered]);

  const grouped = useMemo(() => {
    const g = { low: [], medium: [], high: [] };
    filtered.forEach(c => { const zone = getZone(c); g[zone].push(c); });
    return g;
  }, [filtered, getZone]);

  // Use actual measured zone dimensions for layout computation
  const { w: ZONE_W, h: ZONE_H } = zoneDims;
  // Cache previous positions so non-matching bubbles can pop out from where they were
  const prevPositionsRef = useRef({ low: {}, medium: {}, high: {} });
  const zonePositions = useMemo(() => {
    const toPercent = (layout) => {
      const result = {};
      for (const [id, { x, y, r }] of Object.entries(layout)) {
        result[id] = { xPct: (x / ZONE_W) * 100, yPct: (y / ZONE_H) * 100, r };
      }
      return result;
    };
    const fresh = {
      low: toPercent(computeZoneLayout(grouped.low, ZONE_W, ZONE_H, false)),
      medium: toPercent(computeZoneLayout(grouped.medium, ZONE_W, ZONE_H, false)),
      high: toPercent(computeZoneLayout(grouped.high, ZONE_W, ZONE_H, true)),
    };
    // Merge: keep old positions for contacts that are no longer in the layout, so
    // bubbles that drop out of the active filter animate out from where they were.
    // This intentionally carries position memory across renders via a ref (see the
    // file-level react-hooks/refs disable above).
    const prev = prevPositionsRef.current;
    const merged = {};
    for (const key of ['low', 'medium', 'high']) {
      merged[key] = { ...prev[key], ...fresh[key] };
    }
    prevPositionsRef.current = merged;
    return merged;
  }, [grouped, ZONE_W, ZONE_H]);

  /* ─── drag and drop ─── */
  const onDragStart = useCallback((e, contactId) => {
    e.dataTransfer.setData('text/plain', contactId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(contactId);
  }, []);
  const onDragOver = useCallback((e, zoneKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZone(zoneKey);
  }, []);
  const onDragLeave = useCallback(() => setDragOverZone(null), []);
  const onDrop = useCallback((e, zoneKey) => {
    e.preventDefault();
    setDragOverZone(null);
    setDraggingId(null);
    const contactId = e.dataTransfer.getData('text/plain');
    if (!contactId) return;
    // Check if already in this zone
    const contact = contacts.find(c => c.id === contactId);
    if (!contact || getZone(contact) === zoneKey) return;
    // Show date change popup
    setPendingDrop({ contactId, targetZone: zoneKey, suggestedDate: suggestDateForZone(zoneKey) });
  }, [contacts, getZone]);
  const onDragEnd = useCallback(() => { setDraggingId(null); setDragOverZone(null); }, []);

  /* ─── CRUD ─── */
  const create = async () => {
    if (!cf.name.trim()) return;
    try {
      const r = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cf) });
      if (r.ok) {
        let d = await r.json();
        if (addingToZone) {
          // Set follow-up date so it lands in the correct zone
          const fuDate = suggestDateForZone(addingToZone);
          await update(d.id, { follow_up_date: fuDate });
          d = { ...d, follow_up_date: fuDate };
        }
        setContacts(p => [d, ...p]); setAdding(false); setAddingToZone(null); setCf(emptyC); setToast({ message: `Added ${d.name}`, type: 'success' });
      }
    } catch { setToast({ message: 'Failed', type: 'error' }); }
  };
  const update = async (id, u) => {
    try {
      const r = await fetch('/api/contacts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...u }) });
      if (r.ok) { const d = await r.json(); setContacts(p => p.map(c => c.id === id ? d : c)); }
    } catch { setToast({ message: 'Failed', type: 'error' }); }
  };
  const del = async (id) => {
    try {
      const r = await fetch(`/api/contacts?id=${id}`, { method: 'DELETE' });
      if (r.ok) { setContacts(p => p.filter(c => c.id !== id)); if (selId === id) setSelId(null); setToast({ message: 'Deleted', type: 'success' }); }
    } catch { setToast({ message: 'Failed', type: 'error' }); }
  };

  /* ─── render ─── */
  return (
    <div className="px-6 lg:px-12 -mt-3 py-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 animate-fade-in-up">
        <div className="flex items-center gap-2.5">
          <Users size={18} className="text-emerald-600" />
          <h1 className="text-lg font-bold text-gray-900">Relationships</h1>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{contacts.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts..."
              className="pl-8 pr-8 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 w-52 transition-all" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={12} /></button>}
          </div>
        </div>
      </div>

      {/* Tag Filter Tabs */}
      <div className="flex items-center gap-1.5 mb-3 animate-fade-in-up stagger-2">
        <button onClick={() => setFilter('all')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
            filter === 'all' ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          All
          <span className="opacity-60">({contacts.length})</span>
        </button>
        {CONTACT_TAGS.map(t => {
          const count = contacts.filter(c => hasTag(c, t.key)).length;
          return (
            <button key={t.key} onClick={() => setFilter(filter === t.key ? 'all' : t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                filter === t.key ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {t.label}
              <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Add Contact Modal */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => { setAdding(false); setAddingToZone(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">New Contact</h2>
              <button onClick={() => { setAdding(false); setAddingToZone(null); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp placeholder="Name *" value={cf.name} onChange={v => setCf({ ...cf, name: v })} autoFocus />
              <Inp placeholder="Company" value={cf.company} onChange={v => setCf({ ...cf, company: v })} />
              <Inp placeholder="Role" value={cf.role} onChange={v => setCf({ ...cf, role: v })} />
              <Inp placeholder="Email / Phone / LinkedIn" value={cf.contact_value} onChange={v => setCf({ ...cf, contact_value: v })} />
              <Inp placeholder="City" value={cf.city} onChange={v => setCf({ ...cf, city: v })} />
            </div>
            <div className="mt-3">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Importance</label>
              <div className="flex gap-1.5">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setCf({ ...cf, importance: n })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      cf.importance === n ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {n} — {IMPORTANCE_LABELS[n]}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {CONTACT_TAGS.map(t => (
                  <button key={t.key} type="button" onClick={() => setCf({ ...cf, tags: toggleTag(cf.tags, t.key) })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      (cf.tags || []).includes(t.key) ? 'bg-gray-900 text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end mt-4 gap-2">
              <button onClick={() => { setAdding(false); setAddingToZone(null); }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
              <button onClick={create} disabled={!cf.name.trim()} className="px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-lg hover:bg-emerald-600 disabled:opacity-40 shadow-sm transition-colors">Add Contact</button>
            </div>
          </div>
        </div>
      )}

      {/* Change Follow-Up Date Modal (when dragging to another zone) */}
      {pendingDrop && (() => {
        const dropContact = contacts.find(c => c.id === pendingDrop.contactId);
        const targetZone = ZONES.find(z => z.key === pendingDrop.targetZone);
        if (!dropContact || !targetZone) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm" onClick={() => setPendingDrop(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-900">Change Follow-Up Date</h2>
                <button onClick={() => setPendingDrop(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                To move <span className="font-semibold text-gray-700">{dropContact.name}</span> to <span className="font-semibold" style={{ color: targetZone.color }}>{targetZone.label}</span>, update the follow-up date:
              </p>
              <input
                type="date"
                defaultValue={pendingDrop.suggestedDate}
                onChange={e => setPendingDrop(prev => ({ ...prev, suggestedDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
              />
              <div className="flex justify-end mt-4 gap-2">
                <button onClick={() => setPendingDrop(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                <button
                  onClick={async () => {
                    await update(pendingDrop.contactId, { follow_up_date: pendingDrop.suggestedDate });
                    setToast({ message: `Moved ${dropContact.name} — follow-up: ${fmtShort(pendingDrop.suggestedDate)}`, type: 'success' });
                    setPendingDrop(null);
                  }}
                  className="px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-lg hover:bg-emerald-600 shadow-sm transition-colors"
                >
                  Confirm Move
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Main area — 3 zone columns + detail panel overlay */}
      <div className="relative" style={{ height: 'calc(100vh - 200px)' }}>
        <div className="flex gap-3 h-full">
          {ZONES.map((zone, zoneIdx) => {
            const zContacts = allGrouped[zone.key] || [];
            const zFilteredCount = (grouped[zone.key] || []).length;
            const zPos = zonePositions[zone.key] || {};
            const isOver = dragOverZone === zone.key;

            return (
              <div
                key={zone.key}
                className={`flex-1 flex flex-col rounded-2xl border overflow-hidden transition-all duration-200 animate-fade-in-up ${zone.border} ${isOver ? 'scale-[1.01]' : ''}`}
                style={{ animationDelay: `${0.1 + zoneIdx * 0.08}s`, ...(isOver ? { boxShadow: `0 0 0 3px ${zone.color}40`, transform: 'scale(1.01)' } : {}) }}
                onDragOver={e => onDragOver(e, zone.key)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e, zone.key)}
              >
                {/* Zone header */}
                <div className={`px-4 py-2.5 ${zone.headerBg} border-b ${zone.border} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: zone.color }} />
                    <span className={`text-xs font-bold ${zone.headerText}`}>{zone.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-gray-400 bg-white/60 px-2 py-0.5 rounded-full">{search ? `${zFilteredCount}/${zContacts.length}` : zContacts.length}</span>
                    <button onClick={() => { setCf(emptyC); setAddingToZone(zone.key); setAdding(true); }}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/60 transition-all duration-150"
                      title={`Add contact to ${zone.label}`}>
                      <Plus size={12} />
                    </button>
                  </div>
                </div>

                {/* Bubble area */}
                <div ref={zoneIdx === 0 ? zoneRef : undefined} className={`flex-1 relative bg-gradient-to-br ${zone.bg} overflow-hidden`}>
                  {/* Subtle dot grid */}
                  <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #64748b 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

                  {/* Render bubbles */}
                  <div className="relative w-full h-full">
                    {zContacts.map(c => {
                      const pos = zPos[c.id];
                      const isMatch = matchIds.has(c.id);
                      const imp = c.importance || 3;
                      const r = pos ? pos.r : 26 + imp * 7;
                      // Non-matching bubbles: pop to scale(0); matching without pos: skip
                      if (!isMatch && !pos) {
                        // Render a ghost at center so it can pop out
                        return (
                          <div key={c.id} className="absolute rounded-full" style={{
                            left: '50%', top: '50%', width: r * 2, height: r * 2,
                            transform: 'scale(0)', opacity: 0,
                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
                          }} />
                        );
                      }
                      if (!pos) return null;
                      const isSelected = c.id === selId;
                      const isDrag = c.id === draggingId;
                      const zColor = zone.color;
                      const showAlert = zone.key === 'high' && imp >= 4;

                      return (
                        <div
                          key={c.id}
                          draggable={isMatch}
                          onDragStart={isMatch ? (e => onDragStart(e, c.id)) : undefined}
                          onDragEnd={isMatch ? onDragEnd : undefined}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={isMatch ? (() => setSelId(isSelected ? null : c.id)) : undefined}
                          className={`absolute rounded-full flex flex-col items-center justify-center select-none group ${isMatch ? 'cursor-grab' : 'pointer-events-none'} ${isDrag ? 'opacity-40' : ''}`}
                          style={{
                            left: `calc(${pos.xPct}% - ${pos.r}px)`, top: `calc(${pos.yPct}% - ${pos.r}px)`,
                            width: pos.r * 2, height: pos.r * 2,
                            background: `${zColor}12`,
                            border: `3px solid ${zColor}`,
                            boxShadow: isSelected
                              ? `0 0 0 3px ${zColor}35, 0 8px 30px rgba(0,0,0,0.12)`
                              : `0 0 12px ${zColor}18, 0 2px 10px rgba(0,0,0,0.05)`,
                            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                            transform: isMatch ? (isSelected ? 'scale(1.08)' : 'scale(1)') : 'scale(0)',
                            opacity: isMatch ? 1 : 0,
                          }}
                        >
                          <span className="font-bold text-gray-800 leading-tight text-center max-w-[90%]" style={{ fontSize: Math.max(6, Math.min(pos.r > 50 ? 13 : 11, (pos.r * 1.6) / Math.max(1, c.name.length * 0.42))) }}>
                            {c.name}
                          </span>
                          {pos.r > 36 && (
                            <span className="text-gray-400 truncate max-w-[80%] leading-tight text-center mt-0.5" style={{ fontSize: pos.r > 46 ? 7.5 : 6.5 }}>
                              {c.company}
                            </span>
                          )}
                          {pos.r > 40 && (
                            <div className="flex gap-px mt-0.5">
                              {[1,2,3,4,5].map(n => (
                                <div key={n} className="rounded-full" style={{ width: 3, height: 3, background: n <= imp ? zColor : '#e5e7eb' }} />
                              ))}
                            </div>
                          )}
                          <div className="absolute inset-[-4px] rounded-full border-2 border-transparent group-hover:border-current opacity-25 transition-all duration-200" style={{ color: zColor }} />
                          {showAlert && (
                            <div className="absolute -top-1 -right-1 bg-red-600 rounded-full border-2 border-white flex items-center justify-center shadow-md" style={{ width: 20, height: 20 }}>
                              <span className="text-white text-[9px] font-black">!</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Empty zone state */}
                  {zContacts.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-gray-300 text-xs font-medium">Drop contacts here</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail Panel — absolute overlay, slides in from right */}
        <div ref={panelRef} className={`absolute top-0 right-0 h-full w-[380px] z-20 transition-opacity ${selId ? 'opacity-100 duration-[400ms] ease-out' : 'opacity-0 pointer-events-none duration-[350ms] ease-in-out'}`}>
          {sel && (() => {
            const _d = daysSince(sel.last_contacted_at);
            const _zoneKey = getZone(sel);
            const _zColor = (ZONES.find(z => z.key === _zoneKey) || ZONES[0]).color;
            // Default follow-up: 2 weeks after last contact date
            const _defaultFollowUp = sel.last_contacted_at
              ? new Date(new Date(sel.last_contacted_at).getTime() + 14 * 86400000).toISOString().split('T')[0]
              : ahead(14);
            return (
              <div className={`h-full bg-white border border-gray-200 rounded-2xl flex flex-col overflow-hidden shadow-lg ${panelAnim ? 'opacity-0 transition-opacity duration-[220ms] ease-in' : 'opacity-100 transition-opacity duration-[350ms] ease-out'}`} style={{ maxHeight: 'calc(100vh - 200px)' }}>
                {/* Header */}
                <div className="p-5 border-b border-gray-100">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0 shadow-md" style={{ background: _zColor }}>
                        {sel.name?.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <InlineField onSave={update} value={sel.name} field="name" contactId={sel.id} className="text-base font-bold text-gray-900 leading-tight" />
                        <div className="flex items-center gap-1 mt-0.5">
                          <InlineField onSave={update} value={sel.role} field="role" contactId={sel.id} placeholder="Role" className="text-xs text-gray-500" />
                          {(sel.role && sel.company) && <span className="text-xs text-gray-300">·</span>}
                          <InlineField onSave={update} value={sel.company} field="company" contactId={sel.id} placeholder="Company" className="text-xs text-gray-500" />
                        </div>
                        <InlineField onSave={update} value={sel.city} field="city" contactId={sel.id} placeholder="City" className="text-xs text-gray-400 mt-0.5" />
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => setConfirm({ title: 'Delete Contact', message: `Delete ${sel.name}?`, onConfirm: () => { del(sel.id); setConfirm(null); }, onCancel: () => setConfirm(null) })}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      <button onClick={() => setSelId(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"><X size={14} /></button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                    <span className="font-semibold" style={{ color: _zColor }}>{_d === null ? 'Never contacted' : `${_d}d ago`}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    <div className="flex items-center gap-1">
                      <Phone size={9} />
                      <InlineField onSave={update} value={sel.phone} field="phone" contactId={sel.id} placeholder="Phone" className="text-xs text-gray-400" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Mail size={9} />
                      <InlineField onSave={update} value={sel.contact_value} field="contact_value" contactId={sel.id} placeholder="Email" className="text-xs text-gray-400" />
                    </div>
                  </div>
                  <InlineField onSave={update} value={sel.summary} field="summary" contactId={sel.id} placeholder="Add a summary..." className="text-xs text-gray-500 mt-2 italic" />
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* Importance */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-400">Importance</span>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} onClick={() => { update(sel.id, { importance: n }); }}
                          className={`w-5 h-5 rounded-full text-[9px] font-semibold transition-all ${
                            (sel.importance || 3) === n ? 'bg-emerald-500 text-white shadow-sm' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          }`}>{n}</button>
                      ))}
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <span className="text-[10px] text-gray-400">Tags</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {CONTACT_TAGS.map(t => (
                        <button key={t.key} onClick={() => update(sel.id, { tags: toggleTag(sel.tags, t.key) })}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                            hasTag(sel, t.key)
                              ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] text-gray-400 mb-0.5">Next action</div>
                      <InlineField onSave={update} value={sel.next_action} field="next_action" contactId={sel.id} placeholder="Set next action..." className="text-xs font-medium text-gray-700" />
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-400 mb-0.5">Follow-up</div>
                      <InlineField onSave={update} value={sel.follow_up_date || _defaultFollowUp} field="follow_up_date" contactId={sel.id} placeholder="Set date" type="date" className={`text-xs font-medium ${(sel.follow_up_date || _defaultFollowUp) && new Date(sel.follow_up_date || _defaultFollowUp) <= new Date() ? 'text-amber-600' : 'text-gray-700'}`} displayValue={fmtShort(sel.follow_up_date || _defaultFollowUp)} />
                    </div>
                  </div>

                  {/* Last meeting */}
                  <div>
                    <div className="text-[10px] text-gray-400 mb-0.5">Last meeting</div>
                    <InlineField onSave={update} value={sel.last_meeting_note} field="last_meeting_note" contactId={sel.id} placeholder="What was your last meeting about?" className="text-xs text-gray-700 leading-relaxed" />
                  </div>

                  {/* Notes */}
                  <div>
                    <div className="text-[10px] text-gray-400 mb-0.5">Notes</div>
                    <InlineField onSave={update} value={sel.notes} field="notes" contactId={sel.id} placeholder="Strategy notes, observations..." className="text-xs text-gray-600 leading-relaxed" />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2">
        <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Bubble size = Importance</span>
        <div className="w-px h-3 bg-gray-200" />
        <span className="text-[9px] text-gray-400">Drag bubbles between zones to override urgency</span>
      </div>

      {confirm && <ConfirmModal {...confirm} />}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );


}
