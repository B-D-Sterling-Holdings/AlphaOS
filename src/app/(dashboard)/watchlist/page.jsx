'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useCache } from '@/lib/CacheContext';
import { formatMoneyPrecise, formatPct, formatLargeNumber } from '@/lib/formatters';
import { Plus, X, ArrowRight, ArrowLeft, Eye, FlaskConical, TrendingUp, TrendingDown, Square, CheckSquare, ChevronDown, Pencil, Trash2, Check, List, ClipboardList, ChevronRight, ChevronLeft, Sparkles, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function autoExpand(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function normalizeQuestionItems(items) {
  return (items || []).map(item => {
    if (typeof item === 'string') {
      return { text: item, done: false, answer: '', subQuestions: [] };
    }
    return {
      text: item?.text || '',
      done: !!item?.done,
      answer: item?.answer ?? '',
      subQuestions: (item?.subQuestions || []).map(sq => ({
        text: sq?.text || '',
        done: !!sq?.done,
        answer: sq?.answer ?? '',
      })),
    };
  });
}

function orderStocks(stocks = []) {
  return stocks
    .map((stock, index) => ({ stock, index }))
    .sort((a, b) => {
      const aPos = Number.isFinite(a.stock?.position) ? a.stock.position : a.index;
      const bPos = Number.isFinite(b.stock?.position) ? b.stock.position : b.index;
      return aPos - bPos || a.index - b.index;
    })
    .map(({ stock }, position) => ({ ...stock, position }));
}

const DIP_PERIODS = [
  { key: '52w', label: '% from 52W High' },
  { key: '1d', label: '1D' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: '2y', label: '2Y' },
  { key: '5y', label: '5Y' },
];

const PERIOD_SUBTITLES = {
  '52w': '% off 52-week high',
  '1d': 'Price change for current trading day',
  '1mo': 'Price change over the last month',
  '3mo': 'Price change over the last 3 months',
  '6mo': 'Price change over the last 6 months',
  '1y': 'Price change over the last year',
  '2y': 'Price change over the last 2 years',
  '5y': 'Price change over the last 5 years',
};

/* ── Dip Finder Bar Chart (Chart.js) ──────────────────────────── */
function DipFinder({ stocks, quotes }) {
  const [period, setPeriod] = useState('52w');
  const [periodData, setPeriodData] = useState({});
  const [periodLoading, setPeriodLoading] = useState(false);
  const fetchedPeriods = useRef({});

  const tickers = useMemo(() => stocks.map(s => s.ticker).filter(Boolean), [stocks]);

  // Fetch period data when period changes
  useEffect(() => {
    if (period === '52w' || period === '1d' || tickers.length === 0) return;
    if (fetchedPeriods.current[period]) {
      setPeriodData(prev => ({ ...prev, [period]: fetchedPeriods.current[period] }));
      return;
    }
    setPeriodLoading(true);
    fetch(`/api/period-changes?tickers=${tickers.join(',')}&period=${period}`)
      .then(r => r.json())
      .then(data => {
        fetchedPeriods.current[period] = data.changes || {};
        setPeriodData(prev => ({ ...prev, [period]: data.changes || {} }));
      })
      .catch(() => {})
      .finally(() => setPeriodLoading(false));
  }, [period, tickers]);

  const items = useMemo(() => {
    if (period === '52w') {
      return stocks
        .map(s => {
          const q = quotes[s.ticker];
          if (!q?.price || !q?.fiftyTwoWeekHigh) return null;
          const pct = ((q.price - q.fiftyTwoWeekHigh) / q.fiftyTwoWeekHigh) * 100;
          return { ticker: s.ticker, pct };
        })
        .filter(Boolean)
        .sort((a, b) => b.pct - a.pct);
    }
    if (period === '1d') {
      return stocks
        .map(s => {
          const q = quotes[s.ticker];
          if (q?.dayChangePct == null) return null;
          return { ticker: s.ticker, pct: q.dayChangePct };
        })
        .filter(Boolean)
        .sort((a, b) => b.pct - a.pct);
    }
    // Other periods from fetched data
    const changes = periodData[period] || {};
    return stocks
      .map(s => {
        const pct = changes[s.ticker];
        if (pct == null) return null;
        return { ticker: s.ticker, pct };
      })
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct);
  }, [stocks, quotes, period, periodData]);

  const data = {
    labels: items.map(i => i.ticker),
    datasets: [
      {
        data: items.map(i => i.pct),
        backgroundColor: items.map(i =>
          i.pct >= 0 ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.90)'
        ),
        hoverBackgroundColor: items.map(i =>
          i.pct >= 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)'
        ),
        borderRadius: 4,
        barPercentage: 0.7,
        categoryPercentage: 0.8,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}%`,
        },
        backgroundColor: '#1f2937',
        titleFont: { size: 12, weight: 'bold' },
        bodyFont: { size: 12 },
        padding: 8,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { size: 11, weight: '600' },
          color: '#6b7280',
        },
        border: { display: false },
      },
      y: {
        grid: {
          color: 'rgba(0,0,0,0.05)',
          drawTicks: false,
        },
        ticks: {
          font: { size: 11 },
          color: '#9ca3af',
          callback: (v) => `${v}%`,
          padding: 8,
        },
        border: { display: false },
      },
    },
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Dip Finder</h2>
          <p className="text-xs text-gray-400">{PERIOD_SUBTITLES[period]}</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {DIP_PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all ${
                period === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {periodLoading ? (
        <div className="flex items-center justify-center" style={{ height: 260 }}>
          <div className="text-sm text-gray-400 animate-pulse">Loading data...</div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center" style={{ height: 260 }}>
          <div className="text-sm text-gray-400">No data available</div>
        </div>
      ) : (
        <div style={{ height: Math.max(260, items.length * 12 + 120) }}>
          <Bar data={data} options={options} />
        </div>
      )}
    </div>
  );
}

/* ── 52-Week Range Bar with Red→Green Gradient ────────────────── */
function RangeBar({ low, high, current }) {
  if (!low || !high || !current) return null;
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div className="mt-1">
      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
        <span>{formatMoneyPrecise(low)}</span>
        <span className="text-gray-500 font-medium text-[10px]">52W</span>
        <span>{formatMoneyPrecise(high)}</span>
      </div>
      <div
        className="relative h-1.5 rounded-full"
        style={{
          background: 'linear-gradient(90deg, #ef4444, #f59e0b, #22c55e)',
        }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-md"
          style={{
            left: `calc(${pct}% - 5px)`,
            backgroundColor: pct > 66 ? '#22c55e' : pct > 33 ? '#f59e0b' : '#ef4444',
          }}
        />
      </div>
    </div>
  );
}

const FUNDAMENTALS_BOXES = [
  { key: 'revenueGrowth', label: 'Revenue & Growth Profile', color: 'blue', placeholder: 'Revenue CAGR, Revenue Segments, Growth Drivers...' },
  { key: 'profitability', label: 'Profitability', color: 'emerald', placeholder: 'Margins, EPS, Operating Leverage, ROIC...' },
  { key: 'capitalReturn', label: 'Capital Returned to Shareholders', color: 'violet', placeholder: 'Buybacks, Dividends...' },
  { key: 'misc', label: 'Misc.', color: 'gray', placeholder: 'Non-recurring items, etc...' },
];

const BOX_STYLES = {
  blue:    { bg: 'bg-blue-50/50', border: 'border-blue-200/60', ring: 'focus:ring-blue-200 focus:border-blue-300', label: 'text-blue-600' },
  emerald: { bg: 'bg-emerald-50/50', border: 'border-emerald-200/60', ring: 'focus:ring-emerald-200 focus:border-emerald-300', label: 'text-emerald-600' },
  violet:  { bg: 'bg-violet-50/50', border: 'border-violet-200/60', ring: 'focus:ring-violet-200 focus:border-violet-300', label: 'text-violet-600' },
  gray:    { bg: 'bg-gray-50', border: 'border-gray-200', ring: 'focus:ring-gray-200 focus:border-gray-300', label: 'text-gray-600' },
};

/* ── Due Diligence Checklist ──────────────────────────────────── */
function DueDiligenceChecklist({ items, onUpdate }) {
  const [inputVal, setInputVal] = useState('');
  const [subInputs, setSubInputs] = useState({});
  const [expandedItems, setExpandedItems] = useState({});

  const addItem = () => {
    const text = inputVal.trim();
    if (!text) return;
    onUpdate([...items, { text, done: false, subQuestions: [] }]);
    setInputVal('');
  };

  const toggleItem = (idx) => {
    const updated = items.map((item, i) => i === idx ? { ...item, done: !item.done } : item);
    onUpdate(updated);
  };

  const removeItem = (idx) => {
    onUpdate(items.filter((_, i) => i !== idx));
  };

  const updateText = (idx, text) => {
    const updated = items.map((item, i) => i === idx ? { ...item, text } : item);
    onUpdate(updated);
  };

  const toggleExpanded = (idx) => {
    setExpandedItems(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const addSubQuestion = (parentIdx) => {
    const text = (subInputs[parentIdx] || '').trim();
    if (!text) return;
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      return { ...item, subQuestions: [...(item.subQuestions || []), { text, done: false }] };
    });
    onUpdate(updated);
    setSubInputs(prev => ({ ...prev, [parentIdx]: '' }));
  };

  const toggleSubQuestion = (parentIdx, subIdx) => {
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      const subs = (item.subQuestions || []).map((sq, si) =>
        si === subIdx ? { ...sq, done: !sq.done } : sq
      );
      return { ...item, subQuestions: subs };
    });
    onUpdate(updated);
  };

  const updateSubText = (parentIdx, subIdx, text) => {
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      const subs = (item.subQuestions || []).map((sq, si) =>
        si === subIdx ? { ...sq, text } : sq
      );
      return { ...item, subQuestions: subs };
    });
    onUpdate(updated);
  };

  const removeSubQuestion = (parentIdx, subIdx) => {
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      return { ...item, subQuestions: (item.subQuestions || []).filter((_, si) => si !== subIdx) };
    });
    onUpdate(updated);
  };

  return (
    <div>
      <label className="text-xs font-semibold text-blue-600 uppercase tracking-wide flex items-center gap-1.5">
        <ClipboardList size={12} />
        Due Diligence Questions
      </label>
      <div className="mt-2 space-y-1">
        {items.map((item, idx) => {
          const subs = item.subQuestions || [];
          const isExpanded = expandedItems[idx];
          return (
            <div key={idx}>
              <div className="flex items-start gap-2 group">
                <button
                  onClick={() => toggleExpanded(idx)}
                  className={`mt-1 flex-shrink-0 text-gray-400 hover:text-blue-500 transition-all ${isExpanded ? 'rotate-90' : ''}`}
                >
                  <ChevronRight size={12} />
                </button>
                <button
                  onClick={() => toggleItem(idx)}
                  className="mt-0.5 flex-shrink-0 text-blue-500 hover:text-blue-600 transition-colors"
                >
                  {item.done ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
                <input
                  defaultValue={item.text}
                  onBlur={(e) => updateText(idx, e.target.value)}
                  className={`flex-1 text-sm bg-transparent border-none outline-none py-0.5 ${
                    item.done ? 'line-through text-gray-400' : 'text-gray-700'
                  }`}
                />
                {subs.length > 0 && (
                  <span className="text-[10px] text-blue-400 font-medium mt-1">{subs.length}</span>
                )}
                <button
                  onClick={() => removeItem(idx)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                >
                  <X size={14} />
                </button>
              </div>
              {isExpanded && (
                <div className="ml-9 mt-1 mb-2 pl-3 border-l-2 border-blue-100 space-y-1">
                  {subs.map((sq, si) => (
                    <div key={si} className="flex items-start gap-2 group/sub">
                      <button
                        onClick={() => toggleSubQuestion(idx, si)}
                        className="mt-0.5 flex-shrink-0 text-blue-400 hover:text-blue-500 transition-colors"
                      >
                        {sq.done ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                      <input
                        defaultValue={sq.text}
                        onBlur={(e) => updateSubText(idx, si, e.target.value)}
                        className={`flex-1 text-xs bg-transparent border-none outline-none py-0.5 ${
                          sq.done ? 'line-through text-gray-400' : 'text-gray-600'
                        }`}
                      />
                      <button
                        onClick={() => removeSubQuestion(idx, si)}
                        className="opacity-0 group-hover/sub:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => { e.preventDefault(); addSubQuestion(idx); }}
                    className="flex items-center gap-1.5 mt-1"
                  >
                    <input
                      value={subInputs[idx] || ''}
                      onChange={(e) => setSubInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                      placeholder="Add sub-question..."
                      className="flex-1 text-xs text-gray-600 bg-blue-50/30 border border-blue-100/60 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-200 transition-all"
                    />
                    <button
                      type="submit"
                      className="text-[10px] font-semibold text-blue-500 hover:text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); addItem(); }}
        className="flex items-center gap-2 mt-2"
      >
        <input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Add a due diligence question..."
          className="flex-1 text-sm text-gray-700 bg-blue-50/50 border border-blue-200/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 transition-all"
        />
        <button
          type="submit"
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}

/* ── Dislocation Checklist ────────────────────────────────────── */
function DislocationChecklist({ items, onUpdate }) {
  const [inputVal, setInputVal] = useState('');
  const [subInputs, setSubInputs] = useState({});
  const [expandedItems, setExpandedItems] = useState({});

  const addItem = () => {
    const text = inputVal.trim();
    if (!text) return;
    onUpdate([...items, { text, done: false, subQuestions: [] }]);
    setInputVal('');
  };

  const toggleItem = (idx) => {
    const updated = items.map((item, i) => i === idx ? { ...item, done: !item.done } : item);
    onUpdate(updated);
  };

  const removeItem = (idx) => {
    onUpdate(items.filter((_, i) => i !== idx));
  };

  const updateText = (idx, text) => {
    const updated = items.map((item, i) => i === idx ? { ...item, text } : item);
    onUpdate(updated);
  };

  const toggleExpanded = (idx) => {
    setExpandedItems(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const addSubQuestion = (parentIdx) => {
    const text = (subInputs[parentIdx] || '').trim();
    if (!text) return;
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      return { ...item, subQuestions: [...(item.subQuestions || []), { text, done: false }] };
    });
    onUpdate(updated);
    setSubInputs(prev => ({ ...prev, [parentIdx]: '' }));
  };

  const toggleSubQuestion = (parentIdx, subIdx) => {
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      const subs = (item.subQuestions || []).map((sq, si) =>
        si === subIdx ? { ...sq, done: !sq.done } : sq
      );
      return { ...item, subQuestions: subs };
    });
    onUpdate(updated);
  };

  const updateSubText = (parentIdx, subIdx, text) => {
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      const subs = (item.subQuestions || []).map((sq, si) =>
        si === subIdx ? { ...sq, text } : sq
      );
      return { ...item, subQuestions: subs };
    });
    onUpdate(updated);
  };

  const removeSubQuestion = (parentIdx, subIdx) => {
    const updated = items.map((item, i) => {
      if (i !== parentIdx) return item;
      return { ...item, subQuestions: (item.subQuestions || []).filter((_, si) => si !== subIdx) };
    });
    onUpdate(updated);
  };

  return (
    <div>
      <label className="text-xs font-semibold text-amber-600 uppercase tracking-wide flex items-center gap-1.5">
        <FlaskConical size={12} />
        Dislocation Questions
      </label>
      <div className="mt-2 space-y-1">
        {items.map((item, idx) => {
          const subs = item.subQuestions || [];
          const isExpanded = expandedItems[idx];
          return (
            <div key={idx}>
              <div className="flex items-start gap-2 group">
                <button
                  onClick={() => toggleExpanded(idx)}
                  className={`mt-1 flex-shrink-0 text-gray-400 hover:text-amber-500 transition-all ${isExpanded ? 'rotate-90' : ''}`}
                >
                  <ChevronRight size={12} />
                </button>
                <button
                  onClick={() => toggleItem(idx)}
                  className="mt-0.5 flex-shrink-0 text-amber-500 hover:text-amber-600 transition-colors"
                >
                  {item.done ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
                <input
                  defaultValue={item.text}
                  onBlur={(e) => updateText(idx, e.target.value)}
                  className={`flex-1 text-sm bg-transparent border-none outline-none py-0.5 ${
                    item.done ? 'line-through text-gray-400' : 'text-gray-700'
                  }`}
                />
                {subs.length > 0 && (
                  <span className="text-[10px] text-amber-400 font-medium mt-1">{subs.length}</span>
                )}
                <button
                  onClick={() => removeItem(idx)}
                  className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                >
                  <X size={14} />
                </button>
              </div>
              {isExpanded && (
                <div className="ml-9 mt-1 mb-2 pl-3 border-l-2 border-amber-100 space-y-1">
                  {subs.map((sq, si) => (
                    <div key={si} className="flex items-start gap-2 group/sub">
                      <button
                        onClick={() => toggleSubQuestion(idx, si)}
                        className="mt-0.5 flex-shrink-0 text-amber-400 hover:text-amber-500 transition-colors"
                      >
                        {sq.done ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                      <input
                        defaultValue={sq.text}
                        onBlur={(e) => updateSubText(idx, si, e.target.value)}
                        className={`flex-1 text-xs bg-transparent border-none outline-none py-0.5 ${
                          sq.done ? 'line-through text-gray-400' : 'text-gray-600'
                        }`}
                      />
                      <button
                        onClick={() => removeSubQuestion(idx, si)}
                        className="opacity-0 group-hover/sub:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => { e.preventDefault(); addSubQuestion(idx); }}
                    className="flex items-center gap-1.5 mt-1"
                  >
                    <input
                      value={subInputs[idx] || ''}
                      onChange={(e) => setSubInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                      placeholder="Add sub-question..."
                      className="flex-1 text-xs text-gray-600 bg-amber-50/30 border border-amber-100/60 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-200 transition-all"
                    />
                    <button
                      type="submit"
                      className="text-[10px] font-semibold text-amber-500 hover:text-amber-600 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-md transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); addItem(); }}
        className="flex items-center gap-2 mt-2"
      >
        <input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder="Add a question..."
          className="flex-1 text-sm text-gray-700 bg-amber-50/50 border border-amber-200/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition-all"
        />
        <button
          type="submit"
          className="text-xs font-semibold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}

/* ── AI Perspective (DHQ triage) ──────────────────────────────── */
const DHQ_FIT_STYLES = {
  GREEN: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'DHQ FIT' },
  AMBER: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'MIXED' },
  RED:   { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'FAILS DHQ' },
};

const VERDICT_STYLES = {
  PASS:           'bg-emerald-100 text-emerald-700',
  TEMPORARY:      'bg-emerald-100 text-emerald-700',
  SOFT_FAIL:      'bg-amber-100 text-amber-700',
  HARD_FAIL:      'bg-red-100 text-red-700',
  STRUCTURAL:     'bg-red-100 text-red-700',
  NO_DISLOCATION: 'bg-gray-100 text-gray-600',
  NONE:           'bg-gray-100 text-gray-600',
  UNCLEAR:        'bg-gray-100 text-gray-500',
};

function verdictStyle(v) {
  return VERDICT_STYLES[String(v || '').toUpperCase()] || 'bg-gray-100 text-gray-500';
}

function DHQChip({ fit }) {
  const s = DHQ_FIT_STYLES[String(fit || '').toUpperCase()];
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide border px-2 py-0.5 rounded-full ${s.chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function Gate({ title, verdict, headline, factors }) {
  return (
    <div className="bg-gray-50/70 border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{title}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${verdictStyle(verdict)}`}>
          {String(verdict || 'UNCLEAR').replace(/_/g, ' ')}
        </span>
      </div>
      {headline && <p className="mt-1.5 text-xs font-medium text-gray-700">{headline}</p>}
      {Array.isArray(factors) && factors.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {factors.map((f, i) => (
            <li key={i} className="text-[11px] text-gray-500 flex gap-1.5">
              <span className="text-gray-300 mt-0.5">•</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AIPerspectivePanel({ stock, onGenerate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const perspective = stock.aiPerspective;

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      await onGenerate(stock.ticker);
    } catch (e) {
      setError(e?.message || 'Could not generate AI perspective.');
    } finally {
      setLoading(false);
    }
  };

  const generatedAt = perspective?.generatedAt
    ? new Date(perspective.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-violet-600 uppercase tracking-wide flex items-center gap-1.5">
          <Sparkles size={12} />
          AI Perspective
        </label>
        {perspective ? (
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1 text-[11px] font-semibold text-violet-500 hover:text-violet-700 disabled:opacity-50 transition-colors"
            title="Regenerate"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={11} />}
            {loading ? 'Analyzing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {!perspective && !loading && (
        <button
          onClick={run}
          className="mt-2 w-full flex items-center justify-center gap-2 text-xs font-semibold text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200/60 rounded-lg px-3 py-2 transition-colors"
        >
          <Sparkles size={13} />
          Get a DHQ read on {stock.ticker}
        </button>
      )}

      {loading && !perspective && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3">
          <Loader2 size={14} className="animate-spin text-violet-500" />
          Running quality &amp; dislocation gates…
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {perspective && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <DHQChip fit={perspective.dhq_fit} />
            {generatedAt && (
              <span className="text-[10px] text-gray-400">
                {generatedAt}{perspective.model ? ` · ${perspective.model}` : ''}
              </span>
            )}
          </div>
          {perspective.variant_view && (
            <div className="bg-violet-50/70 border border-violet-200/70 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-600">
                <Sparkles size={11} />
                Variant View
              </div>
              <p className="mt-1 text-xs text-gray-700 leading-relaxed">{perspective.variant_view}</p>
            </div>
          )}
          {perspective.key_question && (
            <div className="flex items-start gap-2 bg-blue-50/60 border border-blue-200/60 rounded-xl p-3">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-blue-500" />
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Check Next</span>
                <p className="mt-0.5 text-xs text-gray-700 leading-relaxed">{perspective.key_question}</p>
              </div>
            </div>
          )}
          {perspective.summary && (
            <p className="text-xs text-gray-600 leading-relaxed">{perspective.summary}</p>
          )}
          <Gate
            title="Quality"
            verdict={perspective.quality?.verdict}
            headline={perspective.quality?.headline}
            factors={perspective.quality?.deciding_factors}
          />
          <Gate
            title="Dislocation"
            verdict={perspective.dislocation?.verdict}
            headline={perspective.dislocation?.headline}
            factors={perspective.dislocation?.deciding_factors}
          />
          <p className="text-[10px] text-gray-400 italic">
            First-pass triage, not underwriting. Verify before acting.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Stock Card ───────────────────────────────────────────────── */
function StockCard({
  stock,
  quote,
  onRemove,
  onMove,
  onMoveOrder,
  onUpdateNote,
  onUpdateResearch,
  onGeneratePerspective,
  onSyncNoteRows,
  canMoveLeft = false,
  canMoveRight = false,
}) {
  const isResearching = stock.stage === 'researching';
  const isInResearch = stock.stage === 'research';
  const fundamentals = stock.fundamentals || {};
  const dislocationItems = stock.dislocationItems || [];
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div data-stock-ticker={stock.ticker} className="relative h-full flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5">
      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm font-semibold text-gray-800">
            Remove <span className="text-red-500">{stock.ticker}</span> from watchlist?
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-1.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onRemove(stock.ticker)}
              className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-4 py-1.5 rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-gray-900">{stock.ticker}</span>
            {quote?.shortName && (
              <span className="text-sm text-gray-400 font-medium">({quote.shortName})</span>
            )}
            {isResearching && (
              <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                RESEARCHING
              </span>
            )}
            {isInResearch && (
              <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                IN RESEARCH
              </span>
            )}
            {stock.aiPerspective?.dhq_fit && <DHQChip fit={stock.aiPerspective.dhq_fit} />}
          </div>
          {quote?.price && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xl font-semibold text-gray-800">
                {formatMoneyPrecise(quote.price)}
              </span>
              {quote.dayChange != null && (
                <span className={`flex items-center gap-0.5 text-sm font-medium ${
                  quote.dayChange >= 0 ? 'text-emerald-600' : 'text-red-500'
                }`}>
                  {quote.dayChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {formatPct(quote.dayChangePct)}
                </span>
              )}
            </div>
          )}
          {!quote?.price && (
            <div className="h-7 w-24 bg-gray-100 rounded animate-pulse mt-1" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onMoveOrder(stock.ticker, 'left')}
            disabled={!canMoveLeft}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-25 disabled:hover:text-gray-300 transition-colors p-1"
            title="Move left"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onMoveOrder(stock.ticker, 'right')}
            disabled={!canMoveRight}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-25 disabled:hover:text-gray-300 transition-colors p-1"
            title="Move right"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-red-400 hover:text-red-600 transition-colors p-1"
            title="Remove"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 52-week range */}
      {quote && (
        <RangeBar low={quote.fiftyTwoWeekLow} high={quote.fiftyTwoWeekHigh} current={quote.price} />
      )}

      {/* Key metrics row */}
      {quote?.price && (
        <div className="flex gap-3 mt-3 text-[11px] text-gray-500">
          {quote.marketCap && <span>MCap {formatLargeNumber(quote.marketCap)}</span>}
          {quote.trailingPE && <span>PE {quote.trailingPE.toFixed(1)}</span>}
          {quote.forwardPE && <span>Fwd PE {quote.forwardPE.toFixed(1)}</span>}
        </div>
      )}

      {/* Why I'm interested */}
      <div className="mt-4">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Why I&apos;m Interested
        </label>
        <textarea spellCheck={true}
          data-watchlist-note
          defaultValue={stock.note || ''}
          placeholder="Quick note on why this stock is interesting..."
          className="mt-1 w-full min-h-[68px] text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
          rows={2}
          ref={(el) => { if (el) { autoExpand(el); onSyncNoteRows(); } }}
          onInput={(e) => {
            autoExpand(e.target);
            onSyncNoteRows();
          }}
          onBlur={(e) => onUpdateNote(stock.ticker, e.target.value)}
        />
      </div>

      {/* AI Perspective — DHQ triage */}
      <AIPerspectivePanel stock={stock} onGenerate={onGeneratePerspective} />

      {/* Researching sections */}
      {isResearching && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {/* Fundamentals at a Glance — 4 boxes */}
          <div>
            <label className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2 block">
              Fundamentals at a Glance
            </label>
            <div className="grid grid-cols-2 gap-2">
              {FUNDAMENTALS_BOXES.map(({ key, label, color, placeholder }) => {
                const s = BOX_STYLES[color];
                return (
                  <div key={key} className={`${s.bg} border ${s.border} rounded-xl p-3`}>
                    <label className={`text-[10px] font-bold uppercase tracking-wider ${s.label}`}>
                      {label}
                    </label>
                    <textarea spellCheck={true}
                      defaultValue={fundamentals[key] || ''}
                      placeholder={placeholder}
                      className={`mt-1 w-full text-xs text-gray-700 bg-transparent border-none resize-none focus:outline-none p-0`}
                      rows={2}
                      onInput={(e) => autoExpand(e.target)}
                      onBlur={(e) => onUpdateResearch(stock.ticker, 'fundamentals', {
                        ...fundamentals,
                        [key]: e.target.value,
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Due Diligence Questions — checklist */}
          <DueDiligenceChecklist
            items={stock.dueDiligenceItems || []}
            onUpdate={(items) => onUpdateResearch(stock.ticker, 'dueDiligenceItems', items)}
          />

          {/* Dislocation Questions — checklist */}
          <DislocationChecklist
            items={dislocationItems}
            onUpdate={(items) => onUpdateResearch(stock.ticker, 'dislocationItems', items)}
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex justify-end">
        {stock.stage === 'watching' ? (
          <button
            onClick={() => onMove(stock.ticker, 'researching')}
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            Move to Researching <ArrowRight size={13} />
          </button>
        ) : stock.stage === 'researching' ? (
          <div className="flex gap-2">
            <button
              onClick={() => onMove(stock.ticker, 'watching')}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <ArrowLeft size={13} /> Back to Watching
            </button>
            <button
              onClick={() => onMove(stock.ticker, 'research')}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              Move to Research <ArrowRight size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onMove(stock.ticker, 'researching')}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            <ArrowLeft size={13} /> Back to Queue
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Watchlist Selector Dropdown ──────────────────────────────── */
function WatchlistSelector({ watchlists, activeId, onSwitch, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const dropdownRef = useRef(null);

  const activeList = watchlists.find(w => w.id === activeId);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
        setCreatingNew(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setCreatingNew(false);
  };

  const handleRename = (id) => {
    const name = renameValue.trim();
    if (!name) return;
    onRename(id, name);
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="relative z-50" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-2 transition-colors shadow-sm"
      >
        <List size={15} className="text-gray-400" />
        <span className="max-w-[200px] truncate">{activeList?.name || 'Watchlist'}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {watchlists.map(wl => (
              <div
                key={wl.id}
                role="button"
                onClick={() => {
                  if (renamingId === wl.id || confirmDeleteId === wl.id) return;
                  onSwitch(wl.id);
                  setOpen(false);
                }}
                className={`flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer ${
                  wl.id === activeId ? 'bg-emerald-50/60' : ''
                }`}
              >
                {renamingId === wl.id ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleRename(wl.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 flex items-center gap-1.5"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-300"
                      onKeyDown={(e) => { if (e.key === 'Escape') { setRenamingId(null); } }}
                    />
                    <button type="submit" className="text-emerald-600 hover:text-emerald-700 p-0.5">
                      <Check size={14} />
                    </button>
                  </form>
                ) : confirmDeleteId === wl.id ? (
                  <div className="flex-1 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-red-600 font-medium">Delete &ldquo;{wl.name}&rdquo;?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 px-2 py-0.5 rounded"
                      >
                        No
                      </button>
                      <button
                        onClick={() => { onDelete(wl.id); setConfirmDeleteId(null); }}
                        className="text-[11px] font-semibold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded"
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-left text-sm text-gray-800 font-medium truncate">
                      {wl.name}
                      <span className="text-xs text-gray-400 ml-2">
                        {wl.stocks.length} stock{wl.stocks.length !== 1 ? 's' : ''}
                      </span>
                    </span>
                    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setRenamingId(wl.id); setRenameValue(wl.name); }}
                        className="text-gray-300 hover:text-gray-500 p-1 rounded transition-colors"
                        title="Rename"
                      >
                        <Pencil size={13} />
                      </button>
                      {watchlists.length > 1 && (
                        <button
                          onClick={() => setConfirmDeleteId(wl.id)}
                          className="text-gray-300 hover:text-red-400 p-1 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Create new watchlist */}
          <div className="border-t border-gray-100 px-3 py-2.5">
            {creatingNew ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
                className="flex items-center gap-1.5"
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Watchlist name..."
                  className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-300"
                  onKeyDown={(e) => { if (e.key === 'Escape') { setCreatingNew(false); setNewName(''); } }}
                />
                <button type="submit" className="text-emerald-600 hover:text-emerald-700 p-0.5">
                  <Check size={14} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setCreatingNew(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors w-full"
              >
                <Plus size={14} />
                New Watchlist
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function WatchlistPage() {
  const cache = useCache();
  const [allData, setAllData] = useState(null); // { watchlists: [...], activeWatchlistId }
  const [quotes, setQuotes] = useState({});
  const [tickerInput, setTickerInput] = useState('');
  const [loading, setLoading] = useState(true);
  const stockAreaRef = useRef(null);
  const prevPositionsRef = useRef(new Map());
  const movedTickersRef = useRef(new Set());
  const noteRowsFrameRef = useRef(null);
  const pendingScrollRef = useRef(null);
  const shouldAnimateRef = useRef(false);

  const watchlists = (allData?.watchlists || []).toSorted((a, b) => {
    const aMain = a.name?.toLowerCase().includes('b.d. sterling') || a.name?.toLowerCase().includes('bd sterling') ? 0 : 1;
    const bMain = b.name?.toLowerCase().includes('b.d. sterling') || b.name?.toLowerCase().includes('bd sterling') ? 0 : 1;
    return aMain - bMain;
  });
  const activeId = allData?.activeWatchlistId || 'default';
  const activeWatchlist = watchlists.find(w => w.id === activeId);
  const stocks = useMemo(() => orderStocks(activeWatchlist?.stocks || []), [activeWatchlist]);

  // Load watchlist
  const loadData = useCallback(async () => {
    try {
      const cached = cache.get('watchlist_data');
      if (cached?.watchlists) {
        setAllData(cached);
        setLoading(false);
        return cached;
      }
      const res = await fetch('/api/watchlist');
      const data = await res.json();
      setAllData(data);
      cache.set('watchlist_data', data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
      return null;
    }
  }, [cache]);

  // Save all data
  const saveData = useCallback(async (updatedData) => {
    setAllData(updatedData);
    cache.set('watchlist_data', updatedData);
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData),
    });
  }, [cache]);

  // Helper: update active watchlist's stocks and save
  const saveStocks = useCallback(async (updatedStocks) => {
    const orderedStocks = orderStocks(updatedStocks);
    const updatedData = {
      ...allData,
      watchlists: allData.watchlists.map(wl =>
        wl.id === activeId ? { ...wl, stocks: orderedStocks } : wl
      ),
    };
    await saveData(updatedData);
  }, [allData, activeId, saveData]);

  // Fetch quotes
  const fetchQuotes = useCallback(async (stockList) => {
    const tickers = stockList.map(s => s.ticker).filter(Boolean);
    if (tickers.length === 0) return;
    try {
      const cachedQuotes = cache.get('watchlist_quotes');
      if (cachedQuotes) {
        setQuotes(cachedQuotes);
        return;
      }
      const res = await fetch(`/api/quotes?tickers=${tickers.join(',')}`);
      const data = await res.json();
      setQuotes(data.quotes || {});
      cache.set('watchlist_quotes', data.quotes || {});
    } catch {
      // silent
    }
  }, [cache]);

  useEffect(() => {
    let cancelled = false;

    async function syncWatchlist() {
      const data = await loadData();
      if (!data || cancelled) return;

      const allStocks = (data.watchlists || []).flatMap(wl => wl.stocks || []);
      if (allStocks.length > 0) fetchQuotes(allStocks);
    }

    syncWatchlist();

    return () => {
      cancelled = true;
    };
  }, [loadData, fetchQuotes]);

  // ── Watchlist management ──

  const switchWatchlist = async (id) => {
    const updatedData = { ...allData, activeWatchlistId: id };
    await saveData(updatedData);
    // Fetch quotes for any new tickers
    const wl = updatedData.watchlists.find(w => w.id === id);
    if (wl) {
      const newTickers = wl.stocks.filter(s => !quotes[s.ticker]);
      if (newTickers.length > 0) {
        try {
          const res = await fetch(`/api/quotes?tickers=${newTickers.map(s => s.ticker).join(',')}`);
          const data = await res.json();
          if (data.quotes) {
            setQuotes(prev => {
              const merged = { ...prev, ...data.quotes };
              cache.set('watchlist_quotes', merged);
              return merged;
            });
          }
        } catch {}
      }
    }
  };

  const createWatchlist = async (name) => {
    const id = `wl_${Date.now()}`;
    const newWl = { id, name, stocks: [] };
    const updatedData = {
      ...allData,
      watchlists: [...allData.watchlists, newWl],
      activeWatchlistId: id,
    };
    await saveData(updatedData);
  };

  const renameWatchlist = async (id, name) => {
    const updatedData = {
      ...allData,
      watchlists: allData.watchlists.map(wl =>
        wl.id === id ? { ...wl, name } : wl
      ),
    };
    await saveData(updatedData);
  };

  const deleteWatchlist = async (id) => {
    const remaining = allData.watchlists.filter(wl => wl.id !== id);
    if (remaining.length === 0) return;
    const updatedData = {
      ...allData,
      watchlists: remaining,
      activeWatchlistId: allData.activeWatchlistId === id ? remaining[0].id : allData.activeWatchlistId,
    };
    await saveData(updatedData);
  };

  // ── Stock operations (scoped to active watchlist) ──

  const addStock = async () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (!ticker || stocks.some(s => s.ticker === ticker)) {
      setTickerInput('');
      return;
    }
    const newStock = {
      ticker,
      stage: 'watching',
      note: '',
      fundamentals: { revenueGrowth: '', profitability: '', capitalReturn: '', misc: '' },
      dislocationItems: [],
      addedAt: new Date().toISOString(),
    };
    const updated = [...stocks, newStock];
    setTickerInput('');
    await saveStocks(updated);
    // Fetch quote for new ticker
    try {
      const res = await fetch(`/api/quotes?tickers=${ticker}`);
      const data = await res.json();
      if (data.quotes) {
        setQuotes(prev => {
          const merged = { ...prev, ...data.quotes };
          cache.set('watchlist_quotes', merged);
          return merged;
        });
      }
    } catch {}
  };

  const removeStock = async (ticker) => {
    await saveStocks(stocks.filter(s => s.ticker !== ticker));
  };

  const moveStock = async (ticker, newStage) => {
    const stock = stocks.find(s => s.ticker === ticker);
    const updatedStocks = stocks.map(s =>
      s.ticker === ticker ? { ...s, stage: newStage } : s
    );

    await saveStocks(updatedStocks);

    if (newStage !== 'research' || !stock) return;

    try {
      const thesisRes = await fetch(`/api/thesis/${ticker}`);
      const thesis = await thesisRes.json();
      const researchWorkspace = {
        note: stock.note || '',
        fundamentals: {
          revenueGrowth: stock.fundamentals?.revenueGrowth || '',
          profitability: stock.fundamentals?.profitability || '',
          capitalReturn: stock.fundamentals?.capitalReturn || '',
          misc: stock.fundamentals?.misc || '',
        },
        dueDiligenceItems: normalizeQuestionItems(stock.dueDiligenceItems || []),
        dislocationItems: normalizeQuestionItems(stock.dislocationItems || []),
      };

      const updatedThesis = {
        ...thesis,
        underwriting: {
          ...(thesis.underwriting || {}),
          researchWorkspace,
        },
      };

      await fetch(`/api/thesis/${ticker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedThesis),
      });
    } catch {}
  };

  const moveStockOrder = async (ticker, direction) => {
    const clicked = stocks.find(s => s.ticker === ticker);
    if (!clicked) return;

    const sameStage = stocks.filter(s => s.stage === clicked.stage);
    const displayIdx = sameStage.findIndex(s => s.ticker === ticker);
    if (displayIdx < 0) return;

    const neighborIdx = direction === 'left' ? displayIdx - 1 : displayIdx + 1;
    const neighbor = sameStage[neighborIdx];
    if (!neighbor) return;

    const updated = [...stocks];
    const aIdx = updated.findIndex(s => s.ticker === ticker);
    const bIdx = updated.findIndex(s => s.ticker === neighbor.ticker);
    if (aIdx < 0 || bIdx < 0) return;

    const area = stockAreaRef.current;
    if (area) {
      const currentPositions = new Map();
      area.querySelectorAll('[data-stock-ticker]').forEach(el => {
        const cardTicker = el.getAttribute('data-stock-ticker');
        const rect = el.getBoundingClientRect();
        currentPositions.set(cardTicker, { x: rect.left, y: rect.top });
      });
      prevPositionsRef.current = currentPositions;
    }

    [updated[aIdx], updated[bIdx]] = [updated[bIdx], updated[aIdx]];
    const renumbered = updated.map((stock, position) => ({ ...stock, position }));

    movedTickersRef.current = new Set([ticker, neighbor.ticker]);
    pendingScrollRef.current = { x: window.scrollX, y: window.scrollY };
    shouldAnimateRef.current = true;
    await saveStocks(renumbered);
  };

  const updateNote = async (ticker, note) => {
    await saveStocks(stocks.map(s =>
      s.ticker === ticker ? { ...s, note } : s
    ));
  };

  const updateResearch = async (ticker, field, value) => {
    await saveStocks(stocks.map(s =>
      s.ticker === ticker ? { ...s, [field]: value } : s
    ));
  };

  const generatePerspective = useCallback(async (ticker) => {
    const stock = stocks.find(s => s.ticker === ticker);
    // Hand the model the analyst's actual work — boxes + open questions — so it
    // reacts to a real thesis instead of guessing from price alone.
    const flattenQuestions = (items) =>
      normalizeQuestionItems(items)
        .map(q => ({
          question: q.text,
          answer: q.answer || '',
          subQuestions: (q.subQuestions || []).map(sq => sq.text).filter(Boolean),
        }))
        .filter(q => q.question);
    const analystResearch = {
      fundamentals: stock?.fundamentals || {},
      dueDiligence: flattenQuestions(stock?.dueDiligenceItems),
      dislocationQuestions: flattenQuestions(stock?.dislocationItems),
    };
    const res = await fetch('/api/watchlist/ai-perspective', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker,
        quote: quotes[ticker] || {},
        note: stock?.note || '',
        analystResearch,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Could not generate AI perspective.');
    }
    const aiPerspective = {
      ...data.perspective,
      model: data.model,
      generatedAt: data.generatedAt,
    };
    await saveStocks(stocks.map(s =>
      s.ticker === ticker ? { ...s, aiPerspective } : s
    ));
  }, [stocks, quotes, saveStocks]);

  const watching = stocks.filter(s => s.stage === 'watching');
  const researching = stocks.filter(s => s.stage === 'researching');
  const research = stocks.filter(s => s.stage === 'research');

  const syncNoteRows = useCallback(() => {
    if (noteRowsFrameRef.current) return;
    noteRowsFrameRef.current = requestAnimationFrame(() => {
      noteRowsFrameRef.current = null;
      const area = stockAreaRef.current;
      if (!area) return;

      const grids = [...area.querySelectorAll('[data-stock-grid]')];
      grids.forEach(grid => {
        const cards = [...grid.querySelectorAll('[data-stock-ticker]')];
        const rowGroups = [];

        cards.forEach(card => {
          const note = card.querySelector('[data-watchlist-note]');
          if (!note) return;
          note.style.height = 'auto';
        });

        cards.forEach(card => {
          const note = card.querySelector('[data-watchlist-note]');
          if (!note) return;

          const top = card.getBoundingClientRect().top;
          let row = rowGroups.find(group => Math.abs(group.top - top) < 2);
          if (!row) {
            row = { top, notes: [] };
            rowGroups.push(row);
          }
          row.notes.push(note);
        });

        rowGroups.forEach(row => {
          const rowHeight = Math.max(68, ...row.notes.map(note => note.scrollHeight));
          row.notes.forEach(note => {
            note.style.height = `${rowHeight}px`;
          });
        });
      });
    });
  }, []);

  useEffect(() => {
    syncNoteRows();
    window.addEventListener('resize', syncNoteRows);
    return () => {
      window.removeEventListener('resize', syncNoteRows);
      if (noteRowsFrameRef.current) {
        cancelAnimationFrame(noteRowsFrameRef.current);
        noteRowsFrameRef.current = null;
      }
    };
  }, [syncNoteRows, stocks.length, activeId]);

  useLayoutEffect(() => {
    syncNoteRows();

    const area = stockAreaRef.current;
    if (!area) return;
    const pendingScroll = pendingScrollRef.current;
    if (shouldAnimateRef.current && pendingScroll) {
      window.scrollTo(pendingScroll.x, pendingScroll.y);
    }
    const cards = area.querySelectorAll('[data-stock-ticker]');
    const newPositions = new Map();
    cards.forEach(el => {
      const ticker = el.getAttribute('data-stock-ticker');
      const rect = el.getBoundingClientRect();
      newPositions.set(ticker, { x: rect.left, y: rect.top });
      if (shouldAnimateRef.current && movedTickersRef.current.has(ticker)) {
        const prev = prevPositionsRef.current.get(ticker);
        if (prev && (prev.x !== rect.left || prev.y !== rect.top)) {
          const dx = prev.x - rect.left;
          const dy = prev.y - rect.top;
          try {
            el.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0px, 0px)' },
              ],
              { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }
            );
          } catch {}
        }
      }
    });
    if (shouldAnimateRef.current && pendingScroll) {
      requestAnimationFrame(() => window.scrollTo(pendingScroll.x, pendingScroll.y));
    }
    prevPositionsRef.current = newPositions;
    movedTickersRef.current = new Set();
    pendingScrollRef.current = null;
    shouldAnimateRef.current = false;
  });

  if (loading) {
    return (
      <div className="min-h-screen px-6 lg:px-12">
        <div className="max-w-7xl mx-auto">
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-48 bg-white rounded-2xl border border-gray-200 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 lg:px-12 pb-16">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in-up relative z-20">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
              <p className="text-sm text-gray-500 mt-1">
                {stocks.length} stock{stocks.length !== 1 ? 's' : ''} tracked
              </p>
            </div>
            <WatchlistSelector
              watchlists={watchlists}
              activeId={activeId}
              onSwitch={switchWatchlist}
              onCreate={createWatchlist}
              onRename={renameWatchlist}
              onDelete={deleteWatchlist}
            />
          </div>

          {/* Add stock */}
          <form
            onSubmit={(e) => { e.preventDefault(); addStock(); }}
            className="flex items-center gap-2"
          >
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="TICKER"
              className="w-28 text-sm font-semibold text-gray-800 bg-white border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 uppercase placeholder:text-gray-400 placeholder:font-normal"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <Plus size={15} />
              Add
            </button>
          </form>
        </div>

        {stocks.length === 0 && (
          <div className="text-center py-24">
            <Eye size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-500">No stocks on your watchlist</h3>
            <p className="text-sm text-gray-400 mt-1">Add a ticker above to start tracking</p>
          </div>
        )}

        {/* Dip Finder */}
        {stocks.length > 0 && Object.keys(quotes).length > 0 && (
          <div className="animate-fade-in-up stagger-2">
            <DipFinder stocks={stocks} quotes={quotes} />
          </div>
        )}

        <div ref={stockAreaRef}>
          {/* Watching Section */}
          {watching.length > 0 && (
            <section className="mb-12 animate-fade-in-up stagger-4">
              <div className="flex items-center gap-2 mb-4">
                <Eye size={18} className="text-emerald-600" />
                <h2 className="text-lg font-bold text-gray-800">Watching</h2>
                <span className="text-xs text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">
                  {watching.length}
                </span>
              </div>
              <div data-stock-grid="watching" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {watching.map((stock, index) => (
                  <StockCard
                    key={stock.ticker}
                    stock={stock}
                    quote={quotes[stock.ticker]}
                    onRemove={removeStock}
                    onMove={moveStock}
                    onMoveOrder={moveStockOrder}
                    onUpdateNote={updateNote}
                    onUpdateResearch={updateResearch}
                    onGeneratePerspective={generatePerspective}
                    onSyncNoteRows={syncNoteRows}
                    canMoveLeft={index > 0}
                    canMoveRight={index < watching.length - 1}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Currently Researching Section */}
          {researching.length > 0 && (
            <section className="animate-fade-in-up stagger-6">
              <div className="flex items-center gap-2 mb-4">
                <FlaskConical size={18} className="text-amber-600" />
                <h2 className="text-lg font-bold text-gray-800">On Queue for Researching</h2>
                <span className="text-xs text-gray-400 font-medium bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
                  {researching.length}
                </span>
              </div>
              <div data-stock-grid="researching" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {researching.map((stock, index) => (
                  <StockCard
                    key={stock.ticker}
                    stock={stock}
                    quote={quotes[stock.ticker]}
                    onRemove={removeStock}
                    onMove={moveStock}
                    onMoveOrder={moveStockOrder}
                    onUpdateNote={updateNote}
                    onUpdateResearch={updateResearch}
                    onGeneratePerspective={generatePerspective}
                    onSyncNoteRows={syncNoteRows}
                    canMoveLeft={index > 0}
                    canMoveRight={index < researching.length - 1}
                  />
                ))}
              </div>
            </section>
          )}

          {research.length > 0 && (
            <section className="mt-12 animate-fade-in-up stagger-8">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardList size={18} className="text-blue-600" />
                <h2 className="text-lg font-bold text-gray-800">Research</h2>
                <span className="text-xs text-gray-400 font-medium bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                  {research.length}
                </span>
              </div>
              <div data-stock-grid="research" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {research.map((stock, index) => (
                  <StockCard
                    key={stock.ticker}
                    stock={stock}
                    quote={quotes[stock.ticker]}
                    onRemove={removeStock}
                    onMove={moveStock}
                    onMoveOrder={moveStockOrder}
                    onUpdateNote={updateNote}
                    onUpdateResearch={updateResearch}
                    onGeneratePerspective={generatePerspective}
                    onSyncNoteRows={syncNoteRows}
                    canMoveLeft={index > 0}
                    canMoveRight={index < research.length - 1}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
