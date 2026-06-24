'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ─── Smooth sparkline SVG matching dashboard Chart.js style ─── */
function SparkPath({ points, width = 400, height = 140, color = '#10b981', filled = false, dashed = false, strokeW = 2.5, id = 'default', scaleMin, scaleMax }) {
  const min = scaleMin !== undefined ? scaleMin : Math.min(...points);
  const max = scaleMax !== undefined ? scaleMax : Math.max(...points);
  const range = max - min || 1;
  const padY = height * 0.1;
  const padX = 4;
  const innerW = width - 2 * padX;
  const step = innerW / (points.length - 1);
  const coords = points.map((p, i) => [
    padX + i * step,
    padY + (height - 2 * padY) * (1 - (p - min) / range),
  ]);

  // Catmull-Rom to cubic bezier for smooth curves (like tension: 0.3)
  const tension = 0.3;
  let d = `M${coords[0][0]},${coords[0][1]}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(i - 1, 0)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(i + 2, coords.length - 1)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension / 3;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension / 3;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension / 3;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension / 3;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }

  const last = coords[coords.length - 1];
  const fillD = `${d} L${last[0]},${height} L${coords[0][0]},${height} Z`;
  const gradId = `spark-grad-${id}`;

  // Y-axis grid lines
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount }, (_, i) => padY + ((height - 2 * padY) / (gridCount + 1)) * (i + 1));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        {filled && (
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        )}
      </defs>
      {/* Subtle grid lines */}
      {!dashed && gridLines.map((y, i) => (
        <line key={i} x1={padX} y1={y} x2={width - padX} y2={y} stroke="#f3f4f6" strokeWidth="1" />
      ))}
      {filled && <path d={fillD} fill={`url(#${gradId})`} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? '6 4' : 'none'}
      />
    </svg>
  );
}

/* ─── Mini donut SVG ─── */
function MiniDonut({ segments }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  // Each segment's start offset = sum of prior segment fractions (no render-scope
  // mutation, so it's safe under the React Compiler rules).
  const offsets = segments.map((_, i) =>
    segments.slice(0, i).reduce((s, seg) => s + seg.value / total, 0)
  );

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      {segments.map((seg, i) => {
        const pct = seg.value / total;
        const offset = offsets[i];
        return (
          <circle
            key={i}
            cx="50" cy="50" r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth="12"
            strokeDasharray={`${pct * circumference} ${circumference}`}
            strokeDashoffset={-offset * circumference}
            className="transition-all duration-700"
            style={{ transformOrigin: '50% 50%', transform: 'rotate(-90deg)' }}
          />
        );
      })}
      <circle cx="50" cy="50" r="30" fill="white" />
    </svg>
  );
}


/* ══════════════════════════════════════════════════
   WIDGET DEFINITIONS
   ══════════════════════════════════════════════════ */

function FundPerformanceWidget() {
  // Realistic fund curve: choppy start, dip, then strong rally. S&P: slow grind up with a dip.
  // Both start at 100, fund pulls away steadily with a mid dip, ends ~147
  const fundData = [
    100, 101, 102, 104, 106, 105, 108, 110, 109, 112, 114, 113, 116, 118,
    117, 120, 122, 121, 124, 126, 125, 128, 130, 128, 126, 123, 121, 119,
    120, 122, 125, 127, 129, 131, 130, 133, 135, 134, 137, 139, 138, 140,
    142, 141, 143, 144, 143, 145, 146, 145, 147, 148, 147, 148, 147,
  ];
  const spData = [
    100, 100, 100, 101, 101, 101, 102, 102, 102, 103, 103, 103, 103, 104,
    104, 104, 104, 105, 105, 105, 106, 106, 106, 106, 105, 105, 105, 104,
    105, 105, 106, 106, 107, 107, 107, 108, 108, 108, 109, 109, 109, 110,
    110, 110, 111, 111, 111, 112, 112, 112, 113, 113, 114, 114, 115,
  ];
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Fund Performance</h3>
        <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-0.5">
          {['1M', '3M', '6M', 'YTD', '1Y', 'All'].map((t, i) => (
            <span key={t} className={`text-[9px] px-2 py-1 rounded-lg cursor-default transition-all ${i === 5 ? 'bg-white text-gray-900 font-semibold shadow-sm' : 'text-gray-500'}`}>{t}</span>
          ))}
        </div>
      </div>
      {/* Legend row like dashboard */}
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-[2px] rounded-full bg-emerald-500 inline-block" />
          <span className="text-[10px] text-gray-500">Fund NAV</span>
          <span className="text-xs font-bold text-gray-900">$147.00</span>
          <span className="text-[10px] font-semibold text-emerald-600">+47.0%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-[2px] rounded-full inline-block" style={{ borderTop: '2px dashed #9ca3af', height: 0 }} />
          <span className="text-[10px] text-gray-500">S&P 500</span>
          <span className="text-xs font-bold text-gray-900">$115.00</span>
          <span className="text-[10px] font-semibold text-emerald-600">+15.0%</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">Alpha</span>
          <span className="text-[10px] font-bold text-emerald-600">+32.0%</span>
        </div>
      </div>
      <div className="flex-1 relative min-h-0">
        {(() => {
          const allMin = Math.min(...fundData, ...spData) - 5;
          const allMax = Math.max(...fundData, ...spData) + 5;
          return (
            <div className="relative w-full h-full">
              <SparkPath points={fundData} color="#10b981" filled id="fund" scaleMin={allMin} scaleMax={allMax} />
              <div className="absolute inset-0">
                <SparkPath points={spData} color="#6b7280" dashed strokeW={2} id="sp" scaleMin={allMin} scaleMax={allMax} />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function PortfolioWidget() {
  const holdings = [
    { name: 'GOOGL', weight: 16, color: '#3b82f6' },
    { name: 'MSFT', weight: 13, color: '#10b981' },
    { name: 'MA', weight: 12, color: '#ef4444'  },
    { name: 'META', weight: 11, color: '#8b5cf6' },
    { name: 'NVDA', weight: 9, color: '#ec4899' },
    { name: 'AAPL', weight: 7, color: '#06b6d4' },
    { name: 'AMZN', weight: 5, color: '#f59e0b' },
    { name: 'Other', weight: 27, color: '#d1d5db' },
  ];
  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-3">Portfolio Allocation</h3>
      <div className="flex items-center gap-6 flex-1 min-h-0">
        <div className="w-44 h-44 flex-shrink-0">
          <MiniDonut segments={holdings.map(h => ({ value: h.weight, color: h.color }))} />
        </div>
        <div className="flex-1 space-y-2">
          {holdings.map(h => (
            <div key={h.name} className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} />
              <span className="text-sm text-gray-600 flex-1 font-medium">{h.name}</span>
              <span className="text-sm font-bold text-gray-800">{h.weight}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total Value</p>
          <p className="text-xl font-bold text-gray-900">$1.24B</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Unrealized P&L</p>
          <p className="text-xl font-bold text-emerald-600">+$142.8M</p>
        </div>
      </div>
    </div>
  );
}

function MoversWidget() {
  const best = [
    { ticker: 'MA', price: '$501.90', change: '+2.19%', total: '+54.0% total' },
    { ticker: 'GOOGL', price: '$178.34', change: '+1.82%', total: '-7.0% total' },
    { ticker: 'ADBE', price: '$249.28', change: '+1.34%', total: '+26.0% total' },
  ];
  const worst = [
    { ticker: 'TSLA', price: '$175.20', change: '-3.41%', total: '-32.0% total' },
    { ticker: 'PLTR', price: '$87.65', change: '-2.76%', total: '-10.0% total' },
    { ticker: 'ASML', price: '$1322.95', change: '-1.92%', total: '+12.0% total' },
  ];

  const ArrowUpRight = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-emerald-700">
      <path d="M7 17L17 7M17 7H7M17 7v10" />
    </svg>
  );
  const ArrowDownRight = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-red-600">
      <path d="M7 7l10 10M17 17H7M17 17V7" />
    </svg>
  );

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Today&apos;s Movers</h3>

      {/* Best */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
          <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Best</span>
        </div>
        <div className="space-y-0">
          {best.map(s => (
            <div key={s.ticker} className="flex items-center justify-between px-2.5 py-[7px] rounded-xl hover:bg-emerald-50/50 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-[26px] h-[26px] rounded-lg bg-emerald-100 flex items-center justify-center">
                  <ArrowUpRight />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-gray-900">{s.ticker}</div>
                  <div className="text-[9.5px] text-gray-500">{s.price}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold text-emerald-600">{s.change}</div>
                <div className={`text-[9.5px] ${s.total.startsWith('-') ? 'text-red-400' : 'text-emerald-500'}`}>{s.total}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 my-2" />

      {/* Worst */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><path d="M7 7l10 10M17 17H7M17 17V7" /></svg>
          <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Worst</span>
        </div>
        <div className="space-y-0">
          {worst.map(s => (
            <div key={s.ticker} className="flex items-center justify-between px-2.5 py-[7px] rounded-xl hover:bg-red-50/50 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-[26px] h-[26px] rounded-lg bg-red-100 flex items-center justify-center">
                  <ArrowDownRight />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-gray-900">{s.ticker}</div>
                  <div className="text-[9.5px] text-gray-500">{s.price}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold text-red-500">{s.change}</div>
                <div className={`text-[9.5px] ${s.total.startsWith('-') ? 'text-red-400' : 'text-emerald-500'}`}>{s.total}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyticsWidget() {
  const metrics = [
    { label: 'Annualized Return', value: '+41.29%', desc: 'Compound annual growth rate', dot: 'bg-emerald-500', bar: 'bg-emerald-500', barW: 85, valueColor: 'text-emerald-600' },
    { label: 'Annualized Volatility', value: '22.97%', desc: 'Std deviation of returns (ann.)', dot: 'bg-amber-400', bar: 'bg-amber-400', barW: 60, valueColor: 'text-amber-500' },
    { label: 'Sharpe Ratio', value: '1.62', desc: 'Risk-adjusted return (rf=4%)', dot: 'bg-emerald-500', bar: 'bg-emerald-500', barW: 70, valueColor: 'text-gray-900' },
    { label: 'Max Drawdown', value: '23.08%', desc: 'Largest peak-to-trough decline', dot: 'bg-red-400', bar: 'bg-red-400', barW: 50, valueColor: 'text-red-500' },
    { label: 'Beta', value: '1.09', desc: 'Sensitivity to S&P 500 moves', dot: 'bg-amber-400', bar: 'bg-amber-400', barW: 55, valueColor: 'text-amber-500' },
    { label: "Jensen's Alpha", value: '+30.30%', desc: 'Excess return vs expected (CAPM)', dot: 'bg-emerald-500', bar: 'bg-emerald-500', barW: 80, valueColor: 'text-emerald-600' },
    { label: 'Tracking Error', value: '12.63%', desc: 'Volatility of excess returns', dot: 'bg-red-400', bar: 'bg-red-400', barW: 45, valueColor: 'text-red-500' },
    { label: 'Win Rate vs S&P', value: '57.3%', desc: '205 of 358 trading days', dot: 'bg-emerald-500', bar: 'bg-emerald-500', barW: 57, valueColor: 'text-emerald-600' },
  ];
  return (
    <div className="h-full flex flex-col">
      <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Fund Analytics</h3>
      <div className="grid grid-cols-2 gap-2.5 flex-1 min-h-0">
        {metrics.map(m => (
          <div key={m.label} className="bg-gray-50/80 rounded-xl p-2.5 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider leading-tight">{m.label}</span>
              <div className={`w-1.5 h-1.5 rounded-full ${m.dot} flex-shrink-0 mt-0.5`} />
            </div>
            <p className={`text-base font-bold ${m.valueColor} leading-none mt-1`}>{m.value}</p>
            <p className="text-[7px] text-gray-400 mt-0.5 leading-tight">{m.desc}</p>
            <div className="h-1 rounded-full bg-gray-200/60 mt-1.5">
              <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${m.barW}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DipFinderWidget() {
  const data = [
    { label: 'ISRG', value: 20 },
    { label: 'MCO', value: 12 },
    { label: 'SPGI', value: 1 },
    { label: 'MSFT', value: -5 },
    { label: 'FICO', value: -5 },
    { label: 'ADP', value: -14 },
    { label: 'NOW', value: -24 },
    { label: 'CNSWF', value: -27 },
  ];

  const maxAbs = 40;
  const gridLines = [30, 20, 10, 0, -10, -20, -30, -40];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Dip Finder</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Price change over the last 2 years</p>
        </div>
        <div className="flex items-center gap-0.5 bg-gray-50 rounded-lg p-0.5">
          {['52W', '1D', '1M', '3M', '6M', '1Y', '2Y', '5Y'].map((t, i) => (
            <span key={t} className={`text-[8px] px-1.5 py-0.5 rounded cursor-default ${i === 6 ? 'bg-white text-gray-900 font-semibold shadow-sm' : 'text-gray-400'}`}>{t}</span>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 flex">
        {/* Y-axis labels */}
        <div className="flex flex-col justify-between pr-1.5 py-0" style={{ width: '32px' }}>
          {gridLines.map(v => (
            <span key={v} className="text-[8px] text-gray-400 text-right leading-none">{v}%</span>
          ))}
        </div>

        {/* Bars area */}
        <div className="flex-1 relative border-l border-gray-100">
          {/* Horizontal grid lines */}
          {gridLines.map((v, i) => (
            <div
              key={v}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: `${(i / (gridLines.length - 1)) * 100}%` }}
            />
          ))}

          {/* Zero line */}
          <div
            className="absolute left-0 right-0 border-t border-gray-300"
            style={{ top: `${((maxAbs) / (2 * maxAbs)) * 100}%` }}
          />

          {/* Bars */}
          <div className="absolute inset-0 flex items-stretch px-1">
            {data.map((d, i) => {
              const isPositive = d.value >= 0;
              const barH = (Math.abs(d.value) / (2 * maxAbs)) * 100;
              const zeroPos = (maxAbs / (2 * maxAbs)) * 100;

              return (
                <div key={i} className="flex-1 flex flex-col items-center relative">
                  {/* Bar */}
                  <div
                    className={`absolute left-1 right-1 rounded-sm ${isPositive ? 'bg-emerald-400' : 'bg-red-400'}`}
                    style={isPositive
                      ? { bottom: `${100 - zeroPos}%`, height: `${barH}%` }
                      : { top: `${zeroPos}%`, height: `${barH}%` }
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex pl-8 pr-0 mt-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[8px] text-gray-500 font-medium">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasksWidget() {
  const sections = [
    {
      label: 'High Priority',
      dot: 'bg-red-400',
      count: '3 / 3',
      countStyle: 'bg-red-50 text-red-500',
      tasks: [
        { title: 'Review Q4 portfolio rebalancing plan', sub: '2/4' },
        { title: 'Prepare investor quarterly update letter', sub: '0/3' },
        { title: 'Complete compliance audit documentation', sub: null },
      ],
    },
    {
      label: 'Medium Priority',
      dot: 'bg-amber-400',
      count: '2 / 5',
      countStyle: 'bg-amber-50 text-amber-600',
      tasks: [
        { title: 'Update risk exposure models for new positions', sub: null },
        { title: 'Schedule meetings with LP advisory board', sub: null },
      ],
    },
    {
      label: 'Low Priority',
      dot: 'bg-emerald-400',
      count: '4',
      countStyle: 'bg-emerald-50 text-emerald-600',
      tasks: [
        { title: 'Research emerging market ETF options', sub: null },
        { title: 'Review fee structure benchmarks', sub: null },
      ],
    },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Tasks</h3>
      <div className="flex-1 min-h-0 space-y-2.5 overflow-hidden">
        {sections.map((s, si) => (
          <div key={si} className="bg-gray-50/60 rounded-xl border border-gray-100 px-3 py-2">
            {/* Section header */}
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-[9px] font-bold text-gray-700 uppercase tracking-wider">{s.label}</span>
              <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-md ${s.countStyle}`}>{s.count}</span>
            </div>
            {/* Tasks */}
            <div className="space-y-0">
              {s.tasks.map((t, ti) => (
                <div key={ti} className="flex items-center gap-2 py-1.5 border-t border-gray-100 first:border-t-0">
                  {/* Drag handle dots */}
                  <svg width="8" height="8" viewBox="0 0 8 8" className="text-gray-300 flex-shrink-0">
                    <circle cx="2" cy="2" r="1" fill="currentColor" /><circle cx="6" cy="2" r="1" fill="currentColor" />
                    <circle cx="2" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="6" r="1" fill="currentColor" />
                  </svg>
                  {/* Checkbox */}
                  <div className="w-3.5 h-3.5 rounded border border-gray-300 flex-shrink-0" />
                  <span className="text-[10px] text-gray-700 flex-1 truncate">{t.title}</span>
                  {t.sub && <span className="text-[9px] text-gray-400 flex-shrink-0">{t.sub}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelationshipsWidget() {
  // All bubbles laid out in one wide SVG, split into 3 zone columns
  // viewBox is 300x130 — each zone is ~100 wide
  const zones = [
    { label: 'No Need to Contact', dot: '#10b981', stroke: '#34d399', fill: '#ecfdf5', x: 0 },
    { label: 'Should Contact Soon', dot: '#f59e0b', stroke: '#fbbf24', fill: '#fffbeb', x: 100 },
    { label: 'Urgently Contact', dot: '#ef4444', stroke: '#f87171', fill: '#fef2f2', x: 200 },
  ];
  const bubbles = [
    // Green zone (x offset 0)
    { name: 'Alex Rivera', cx: 25, cy: 35, r: 16, zone: 0 },
    { name: 'Sarah Kim', cx: 65, cy: 28, r: 13, zone: 0 },
    { name: 'Mark Chen', cx: 45, cy: 62, r: 14, zone: 0 },
    { name: 'Tom Hayes', cx: 18, cy: 75, r: 10, zone: 0 },
    { name: 'Lisa Park', cx: 78, cy: 68, r: 12, zone: 0 },
    { name: 'Joel Hart', cx: 50, cy: 92, r: 11, zone: 0 },
    // Amber zone (x offset 100)
    { name: 'James Wu', cx: 30, cy: 30, r: 16, zone: 1 },
    { name: 'Nina Patel', cx: 70, cy: 35, r: 12, zone: 1 },
    { name: 'Ryan Costa', cx: 50, cy: 65, r: 18, zone: 1 },
    { name: 'Emma Bell', cx: 22, cy: 72, r: 11, zone: 1 },
    { name: 'Marc Webb', cx: 75, cy: 80, r: 13, zone: 1 },
    // Red zone (x offset 200)
    { name: 'Dan Moore', cx: 28, cy: 32, r: 15, zone: 2, badge: true },
    { name: 'Chris Vale', cx: 72, cy: 28, r: 14, zone: 2, badge: true },
    { name: 'Kate Ross', cx: 50, cy: 60, r: 17, zone: 2 },
    { name: 'Phil Nash', cx: 22, cy: 78, r: 11, zone: 2 },
    { name: 'Amy Grant', cx: 76, cy: 72, r: 12, zone: 2 },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Relationships</h3>
        <span className="text-[8px] text-gray-400">Bubble size = importance</span>
      </div>
      {/* Zone labels */}
      <div className="grid grid-cols-3 gap-2 mb-1">
        {zones.map((z, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: z.dot }} />
            <span className="text-[8px] font-semibold text-gray-600 truncate">{z.label}</span>
          </div>
        ))}
      </div>
      {/* SVG canvas */}
      <div className="flex-1 min-h-0">
        <svg viewBox="0 0 300 110" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          {/* Zone backgrounds */}
          {zones.map((z, i) => (
            <g key={`zone-${i}`}>
              <rect x={i * 100 + 1} y="0" width="98" height="110" rx="6" fill={z.fill} fillOpacity="0.5" stroke={z.stroke} strokeOpacity="0.3" strokeWidth="0.5" />
            </g>
          ))}
          {/* Zone divider lines */}
          <line x1="100" y1="0" x2="100" y2="110" stroke="#e5e7eb" strokeWidth="0.5" />
          <line x1="200" y1="0" x2="200" y2="110" stroke="#e5e7eb" strokeWidth="0.5" />
          {/* Bubbles */}
          {bubbles.map((b, i) => {
            const z = zones[b.zone];
            const offsetX = b.zone * 100;
            const cx = offsetX + b.cx;
            const names = b.name.split(' ');
            return (
              <g key={i}>
                <circle cx={cx} cy={b.cy} r={b.r} fill={z.fill} stroke={z.stroke} strokeWidth="1.2" />
                {b.badge && (
                  <>
                    <circle cx={cx + b.r * 0.7} cy={b.cy - b.r * 0.7} r="3.5" fill="#ef4444" stroke="white" strokeWidth="0.8" />
                    <text x={cx + b.r * 0.7} y={b.cy - b.r * 0.7 + 1.3} textAnchor="middle" fill="white" fontSize="3.5" fontWeight="bold">!</text>
                  </>
                )}
                <text x={cx} y={b.cy - 1} textAnchor="middle" fill="#374151" fontSize={b.r > 14 ? '4.5' : '4'} fontWeight="600" fontFamily="Plus Jakarta Sans, sans-serif">
                  {names[0]}
                </text>
                <text x={cx} y={b.cy + 4.5} textAnchor="middle" fill="#6b7280" fontSize={b.r > 14 ? '4' : '3.5'} fontWeight="500" fontFamily="Plus Jakarta Sans, sans-serif">
                  {names[1]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   MAIN SHOWCASE CAROUSEL
   ══════════════════════════════════════════════════ */

const widgets = [
  { component: FundPerformanceWidget, label: 'Performance' },
  { component: PortfolioWidget, label: 'Portfolio' },
  { component: MoversWidget, label: 'Movers' },
  { component: AnalyticsWidget, label: 'Analytics' },
  { component: DipFinderWidget, label: 'Watchlist' },
  { component: TasksWidget, label: 'Tasks' },
];

export default function ShowcaseWidgets() {
  const [active, setActive] = useState(0);
  const timerRef = useRef(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive(prev => (prev + 1) % widgets.length);
    }, 5000);
  }, []);

  useEffect(() => {
    resetTimer();
    return () => clearInterval(timerRef.current);
  }, [resetTimer]);

  function goTo(i) {
    setActive(i);
    resetTimer();
  }

  function goPrev() {
    setActive(prev => (prev - 1 + widgets.length) % widgets.length);
    resetTimer();
  }

  function goNext() {
    setActive(prev => (prev + 1) % widgets.length);
    resetTimer();
  }

  const Widget = widgets[active].component;

  return (
    <div className="h-full flex flex-col">
      {/* Widget card */}
      <div className="flex-1 min-h-0 relative">
        <div
          key={active}
          className="absolute inset-0 bg-white rounded-2xl border border-gray-200/80 shadow-xl shadow-gray-200/50 p-6 animate-fade-in-up"
          style={{ animationDuration: '0.35s' }}
        >
          <Widget />
        </div>
      </div>

      {/* Navigation: arrows + dots */}
      <div className="flex items-center justify-center gap-3 mt-5">
        <button
          onClick={goPrev}
          className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          aria-label="Previous"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="flex items-center gap-1.5">
          {widgets.map((w, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`transition-all duration-300 rounded-full ${
                i === active
                  ? 'w-6 h-2 bg-emerald-500'
                  : 'w-2 h-2 bg-gray-300 hover:bg-gray-400 hover:scale-150'
              }`}
              aria-label={w.label}
            />
          ))}
        </div>

        <button
          onClick={goNext}
          className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          aria-label="Next"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Label */}
      <p className="text-center text-[10px] text-gray-400 mt-2 tracking-wide">
        {widgets[active].label}
      </p>
    </div>
  );
}
