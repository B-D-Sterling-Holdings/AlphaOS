'use client';

// Shared UI helpers for the Macro Risk model surface. Used by both the standalone
// /macro-regime page and the Allocation → Macro Risk tab so the chart styling,
// config fields, and markdown rendering stay identical in both places.

import { useLayoutEffect, useRef } from 'react';

/* ── Chart.js option builders ─────────────────────────────────────── */

export function cOpts(yf) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 5, font: { size: 10 }, padding: 12, color: '#6b7280' } },
      tooltip: {
        backgroundColor: '#fff', titleColor: '#111', bodyColor: '#6b7280', borderColor: '#e5e7eb', borderWidth: 1, padding: 8,
        callbacks: { label: ctx => {
          const v = ctx.parsed.y;
          return yf === 'pct' ? `${ctx.dataset.label}: ${(v * 100).toFixed(1)}%` : yf === '$' ? `${ctx.dataset.label}: $${v.toFixed(0)}` : `${ctx.dataset.label}: ${v.toFixed(2)}`;
        }},
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 9 }, color: '#9ca3af' } },
      y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 9 }, color: '#9ca3af',
        callback: v => yf === 'pct' ? `${(v * 100).toFixed(0)}%` : yf === '$' ? `$${v}` : v.toFixed(1),
      }},
    },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0.3, borderWidth: 1.5 } },
  };
}

export function ds(label, data, color, fill, dash) {
  return { label, data, borderColor: color, backgroundColor: fill ? `${color}12` : 'transparent', fill: !!fill, borderDash: dash, borderWidth: 1.5 };
}

export const cOpts01 = o => ({ ...o, scales: { ...o.scales, y: { ...o.scales.y, min: 0, max: 1 } } });

/* ── FLIP reorder animation for weight grids ──────────────────────── */

export function useGridReorderAnimation(containerRef, itemIds, duration = 380) {
  const positionsRef = useRef(new Map());
  const orderRef = useRef([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = Array.from(container.querySelectorAll('[data-reorder-id]'));
    const nextPositions = new Map(
      items.map(el => [el.dataset.reorderId, el.getBoundingClientRect()]),
    );

    const prevOrder = orderRef.current;
    const orderChanged =
      prevOrder.length === itemIds.length && prevOrder.some((id, idx) => id !== itemIds[idx]);

    let cleanupTimer = null;
    let frame1 = null;
    let frame2 = null;

    if (positionsRef.current.size > 0 && orderChanged) {
      const moved = [];

      for (const el of items) {
        const id = el.dataset.reorderId;
        const prev = positionsRef.current.get(id);
        const next = nextPositions.get(id);
        if (!prev || !next) continue;

        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        moved.push(el);
      }

      if (moved.length > 0) {
        frame1 = requestAnimationFrame(() => {
          frame2 = requestAnimationFrame(() => {
            for (const el of moved) {
              el.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
              el.style.transform = 'translate(0px, 0px)';
            }
          });
        });

        cleanupTimer = window.setTimeout(() => {
          for (const el of moved) {
            el.style.transition = '';
            el.style.transform = '';
          }
        }, duration + 40);
      }
    }

    positionsRef.current = nextPositions;
    orderRef.current = [...itemIds];

    return () => {
      if (frame1 != null) cancelAnimationFrame(frame1);
      if (frame2 != null) cancelAnimationFrame(frame2);
      if (cleanupTimer != null) clearTimeout(cleanupTimer);
    };
  }, [containerRef, itemIds, duration]);
}

/* ── Config field ─────────────────────────────────────────────────── */

export function CfgField({ f, value, onChange }) {
  if (f.type === 'toggle') return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-[11px] text-gray-500">{f.label}</span>
      <button type="button" onClick={() => onChange(f.key, !value)}
        className={`relative h-4 w-7 rounded-full ${value ? 'bg-emerald-500' : 'bg-gray-200'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${value ? 'left-3.5' : 'left-0.5'}`} />
      </button>
    </label>
  );
  if (f.type === 'select') return (
    <div>
      <label className="mb-0.5 block text-[10px] text-gray-400" title={f.desc}>{f.label}</label>
      <select value={value || ''} onChange={e => onChange(f.key, e.target.value)}
        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none">{f.options.map(o => <option key={o}>{o}</option>)}</select>
    </div>
  );
  // A month picker shows/edits YYYY-MM but stores a full YYYY-MM-01 date, so the
  // value the Python pipeline reads (pd.Timestamp) is unchanged from the old text field.
  if (f.type === 'month') return (
    <div>
      <label className="mb-0.5 block text-[10px] text-gray-400" title={f.desc}>{f.label}</label>
      <input type="month" value={String(value ?? '').slice(0, 7)}
        onChange={e => onChange(f.key, e.target.value ? `${e.target.value}-01` : '')}
        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none" />
      {f.desc && <p className="mt-0.5 text-[9px] leading-tight text-gray-300">{f.desc}</p>}
    </div>
  );
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-gray-400" title={f.desc}>{f.label}</label>
      <div className="relative">
        <input type={f.type} value={value ?? ''} step={f.step}
          onChange={e => { let v = e.target.value; if (f.type === 'number' && v !== '') v = Number(v); onChange(f.key, v); }}
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 pr-7 text-[11px] text-gray-700 focus:border-gray-400 focus:outline-none" />
        {f.suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-gray-300">{f.suffix}</span>}
      </div>
    </div>
  );
}

/* ── Minimal markdown (headings, lists, tables) ───────────────────── */

export function MdRender({ content }) {
  if (!content) return null;
  const lines = content.split('\n'), out = []; let tbl = [], inTbl = false, k = 0;
  const flush = () => { if (!tbl.length) return; out.push(
    <div key={k++} className="my-2 overflow-x-auto"><table className="w-full text-[11px]">
      <thead><tr className="border-b border-gray-200">{tbl[0].map((c, i) => <th key={i} className="px-3 py-1.5 text-left text-[10px] text-gray-400">{c.trim()}</th>)}</tr></thead>
      <tbody>{tbl.slice(1).map((row, ri) => <tr key={ri} className="border-b border-gray-50">{row.map((c, ci) => <td key={ci} className="px-3 py-1.5 text-gray-500">{c.trim() || '--'}</td>)}</tr>)}</tbody>
    </table></div>); tbl = []; };
  for (const l of lines) {
    if (/^\|[\s:|-]+\|$/.test(l)) continue;
    if (l.startsWith('|') && l.endsWith('|')) { inTbl = true; tbl.push(l.slice(1, -1).split('|')); continue; }
    if (inTbl) { flush(); inTbl = false; }
    if (l.startsWith('# ')) out.push(<h1 key={k++} className="mb-2 mt-4 text-sm font-semibold text-gray-900">{l.slice(2)}</h1>);
    else if (l.startsWith('## ')) out.push(<h2 key={k++} className="mb-1 mt-3 text-xs font-semibold text-gray-700">{l.slice(3)}</h2>);
    else if (l.startsWith('- ')) out.push(<li key={k++} className="ml-4 list-disc text-[11px] text-gray-500">{l.slice(2)}</li>);
    else if (l.trim()) out.push(<p key={k++} className="mb-1 text-[11px] text-gray-500">{l}</p>);
  }
  if (inTbl) flush();
  return <div>{out}</div>;
}
