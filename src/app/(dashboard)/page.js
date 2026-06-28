'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Chart, registerables } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip as ChartTooltip, Legend } from 'chart.js';
import {
  Circle, ArrowUpRight, ArrowDownRight, RefreshCw, X, AlertTriangle, CheckCircle,
} from 'lucide-react';

ChartJS.register(ArcElement, ChartTooltip, Legend);

Chart.register(...registerables);

const TIMEFRAMES = [
  { label: 'MTD', days: 'mtd' },
  { label: 'YTD', days: 'ytd' },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: null },
];

const fmt$ = (v) => '$' + Number(v).toFixed(2);
const fmtBig = (v) => {
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return fmt$(n);
};

export default function DashboardPage() {
  const router = useRouter();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const dragState = useRef({ dragging: false, startIdx: null, endIdx: null });
  const [dragInfo, setDragInfo] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const hoverIdx = useRef(null);
  const [navData, setNavData] = useState(null);
  const [timeframe, setTimeframe] = useState('All');
  const [loading, setLoading] = useState(true);

  // Dashboard data
  const [portfolio, setPortfolio] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [riskFreeRate, setRiskFreeRate] = useState(4);
  const highSectionRef = useRef(null);
  const tasksPanelRef = useRef(null);
  const [otherTasksLimit, setOtherTasksLimit] = useState(3);

  // Macro regime signal
  const [macroSignal, setMacroSignal] = useState(null);

  // NAV Update modal state
  const [showNavUpdate, setShowNavUpdate] = useState(false);
  const [navUpdateInput, setNavUpdateInput] = useState('');
  const [navUpdateLoading, setNavUpdateLoading] = useState(false);
  const [navUpdateResult, setNavUpdateResult] = useState(null);
  const [navUpdateError, setNavUpdateError] = useState('');

  const handleNavUpdate = async () => {
    setNavUpdateError('');
    setNavUpdateResult(null);
    setNavUpdateLoading(true);

    try {
      // Parse the input
      const lines = navUpdateInput.trim().split('\n').filter(l => l.trim());
      const entries = [];

      for (const line of lines) {
        const cleaned = line.replace(/"/g, '').trim();
        const parts = cleaned.split(/[,\t]+/).map(s => s.trim()).filter(Boolean);
        if (parts.length < 2) {
          setNavUpdateError(`Could not parse line: "${line.trim()}"`);
          setNavUpdateLoading(false);
          return;
        }
        const date = parts[0];
        const aum = parseFloat(parts[1]);
        if (isNaN(aum)) {
          setNavUpdateError(`Invalid AUM value on line: "${line.trim()}"`);
          setNavUpdateLoading(false);
          return;
        }
        entries.push({ date, aum });
      }

      if (entries.length === 0) {
        setNavUpdateError('No entries to process.');
        setNavUpdateLoading(false);
        return;
      }

      const res = await fetch('/api/fund-nav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });

      const data = await res.json();
      if (!res.ok) {
        setNavUpdateError(data.error || 'Failed to update');
        setNavUpdateLoading(false);
        return;
      }

      setNavUpdateResult(data);

      // Refresh chart data
      const refreshRes = await fetch('/api/fund-nav');
      const refreshData = await refreshRes.json();
      if (Array.isArray(refreshData)) setNavData(refreshData);

    } catch (err) {
      setNavUpdateError(err.message || 'Something went wrong');
    } finally {
      setNavUpdateLoading(false);
    }
  };

  useEffect(() => {
    // Fetch all dashboard data in parallel
    fetch('/api/fund-nav')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setNavData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch('/api/portfolio')
      .then(r => r.json())
      .then(d => {
        setPortfolio(d);
        // Fetch quotes for holdings
        const tickers = d?.holdings?.map(h => h.ticker).join(',');
        if (tickers) {
          fetch(`/api/quotes?tickers=${tickers}`)
            .then(r => r.json())
            .then(q => setQuotes(q.quotes || q))
            .catch(() => {});
        }
      })
      .catch(() => {});

    // Fetch risk-free rate from allocation settings
    fetch('/api/allocation')
      .then(r => r.json())
      .then(({ config }) => {
        if (config?.riskFreeRate !== undefined) setRiskFreeRate(Number(config.riskFreeRate));
      })
      .catch(() => {});

    // Fetch macro regime signal
    fetch('/api/macro-regime/predict')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setMacroSignal(d); })
      .catch(() => {});

    // Fetch first board's tasks
    fetch('/api/task-boards')
      .then(r => r.json())
      .then(({ boards }) => {
        const firstId = boards?.[0]?.id || 'default';
        return fetch(`/api/tasks?board_id=${firstId}`);
      })
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setTasks(d); })
      .catch(() => {});
  }, []);

  // Derived portfolio data
  const holdingsData = (() => {
    if (!portfolio?.holdings || !quotes) return null;
    const rows = portfolio.holdings
      .map(h => {
        const q = quotes[h.ticker];
        if (!q) return null;
        const mktVal = h.shares * q.price;
        const costVal = h.shares * h.cost_basis;
        const gl = mktVal - costVal;
        const glPct = costVal > 0 ? (gl / costVal) * 100 : 0;
        return {
          ticker: h.ticker,
          shares: h.shares,
          price: q.price,
          dayChange: q.dayChangePct || 0,
          mktVal,
          gl,
          glPct,
          costBasis: h.cost_basis,
        };
      })
      .filter(Boolean);

    const totalMktVal = rows.reduce((s, r) => s + r.mktVal, 0);
    const totalCost = rows.reduce((s, r) => s + (r.shares * r.costBasis), 0);
    const totalGL = totalMktVal - totalCost;
    const totalGLPct = totalCost > 0 ? (totalGL / totalCost) * 100 : 0;
    const cash = portfolio.cash || 0;

    const winners = [...rows].filter(r => r.dayChange > 0).sort((a, b) => b.dayChange - a.dayChange).slice(0, 3);
    const losers = [...rows].filter(r => r.dayChange < 0).sort((a, b) => a.dayChange - b.dayChange).slice(0, 3);

    // Pie chart data — sorted by weight descending
    const totalWithCash = totalMktVal + cash;
    const sorted = [...rows].sort((a, b) => b.mktVal - a.mktVal);
    const pieItems = sorted.map(r => ({
      ticker: r.ticker,
      weight: totalWithCash > 0 ? (r.mktVal / totalWithCash) * 100 : 0,
    }));
    if (cash > 0) {
      pieItems.push({ ticker: 'Cash', weight: (cash / totalWithCash) * 100 });
    }

    return { rows, totalMktVal, totalCost, totalGL, totalGLPct, cash, winners, losers, pieItems, totalWithCash };
  })();

  // Task stats
  const taskData = (() => {
    if (!tasks) return null;
    const open = tasks.filter(t => !t.done);
    const high = open.filter(t => t.priority === 'highest' || t.priority === 'high');
    const medium = open.filter(t => t.priority === 'medium');
    const completed = tasks.filter(t => t.done);
    return { open, high, medium, completed, total: tasks.length };
  })();

  // Measure the tasks panel container and compute how many "other" tasks fit
  useEffect(() => {
    function measure() {
      const panel = tasksPanelRef.current;
      if (!panel) return;
      const panelH = panel.offsetHeight; // this is the grid-row height from siblings
      if (panelH <= 0) return;

      // Measure the high priority section
      const highH = highSectionRef.current?.offsetHeight || 0;
      // Fixed overhead: p-6 padding (48px) + header row (28px) + mb-3 gap (12px) + completion bar area (52px)
      const overhead = 48 + 28 + 12 + 52;
      // "Other Tasks" section header + border-top + margins (~44px)
      const otherSectionOverhead = 44;
      // "+N more" link (~24px)
      const moreLink = 24;

      const availableForOther = panelH - overhead - highH - otherSectionOverhead - moreLink;
      const taskRowH = 40; // each task row ~40px
      const maxTasks = Math.max(0, Math.floor(availableForOther / taskRowH));
      setOtherTasksLimit(maxTasks);
    }
    // Delay to let siblings render and set the grid row height
    const t = setTimeout(measure, 150);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); };
  }, [holdingsData, taskData]);

  // Period returns computed from full navData
  const periodReturns = (() => {
    if (!navData || !navData.length) return null;
    const last = navData[navData.length - 1];
    const prev = navData.length >= 2 ? navData[navData.length - 2] : last;
    const first = navData[0];

    function findByDaysAgo(days) {
      // Anchor the lookback to the latest data point's date, not wall-clock
      // today. NAV is entered periodically, so the most recent row usually
      // lags behind today; anchoring to `new Date()` made short windows fall
      // off the end of the data and default to inception (== cumulative).
      const anchor = new Date(last.date + 'T00:00:00');
      anchor.setDate(anchor.getDate() - days);
      const cutoffStr = anchor.toISOString().slice(0, 10);
      // Use the first entry on or after the cutoff — this matches the chart's
      // `filtered[0]` for the same window so the cards and the chart timeframe
      // stats always agree. Falls back to inception if history is shorter.
      return navData.find(d => d.date >= cutoffStr) || navData[0];
    }

    function calcReturn(start, end) {
      return { fund: ((end.fund_nav - start.fund_nav) / start.fund_nav) * 100, sp: ((end.sp500_nav - start.sp500_nav) / start.sp500_nav) * 100 };
    }

    const yearStart = `${new Date(last.date + 'T00:00:00').getFullYear()}-01-01`;
    const ytdStart = navData.find(d => d.date >= yearStart) || navData[0];

    const dayReturn = calcReturn(prev, last);
    const m1 = calcReturn(findByDaysAgo(30), last);
    const ytd = calcReturn(ytdStart, last);
    const y1 = calcReturn(findByDaysAgo(365), last);
    const cum = calcReturn(first, last);

    return { day: dayReturn, '1M': m1, ytd, '1Y': y1, cumulative: cum };
  })();

  // ── Chart logic (same as before) ──

  const filtered = useMemo(() => {
    if (!navData || !navData.length) return [];
    const tf = TIMEFRAMES.find(t => t.label === timeframe);
    if (!tf || tf.days === null) return navData;
    // Anchor windows to the latest data point's date, not wall-clock today —
    // NAV rows lag behind today, so anchoring to `new Date()` filtered short
    // windows past the end of the data and returned nothing.
    const anchor = new Date(navData[navData.length - 1].date + 'T00:00:00');
    if (tf.days === 'ytd') {
      const yearStart = new Date(anchor.getFullYear(), 0, 1).toISOString().slice(0, 10);
      return navData.filter(d => d.date >= yearStart);
    }
    if (tf.days === 'mtd') {
      const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1).toISOString().slice(0, 10);
      return navData.filter(d => d.date >= monthStart);
    }
    const cutoff = new Date(anchor);
    cutoff.setDate(cutoff.getDate() - tf.days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return navData.filter(d => d.date >= cutoffStr);
  }, [navData, timeframe]);

  const stats = (() => {
    if (!filtered.length) return null;
    const first = filtered[0];
    const last = filtered[filtered.length - 1];
    const fundReturn = ((last.fund_nav - first.fund_nav) / first.fund_nav * 100);
    const spReturn = ((last.sp500_nav - first.sp500_nav) / first.sp500_nav * 100);
    const alpha = fundReturn - spReturn;
    return { fundNav: fmt$(last.fund_nav), spNav: fmt$(last.sp500_nav), fundReturn, spReturn, alpha };
  })();

  const labels = filtered.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  });
  const fundValues = filtered.map(d => Number(d.fund_nav));
  const spValues = filtered.map(d => Number(d.sp500_nav));

  // Rebase both series to 100 at the first point of the selected window so all
  // timeframes start at the same level and relative performance is directly comparable.
  const fundBase = fundValues[0] || 1;
  const spBase = spValues[0] || 1;
  const fundValuesChart = fundValues.map(v => (v / fundBase) * 100);
  const spValuesChart = spValues.map(v => (v / spBase) * 100);

  function getIndexFromClientX(clientX) {
    const chart = chartRef.current;
    if (!chart || !canvasRef.current) return null;
    const meta = chart.getDatasetMeta(0);
    if (!meta.data.length) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const { left, right } = chart.chartArea;
    if (mouseX >= right) return meta.data.length - 1;
    if (mouseX <= left) return 0;
    let closest = 0, closestDist = Infinity;
    for (let i = 0; i < meta.data.length; i++) {
      const dist = Math.abs(meta.data[i].x - mouseX);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    }
    return closest;
  }

  function updateDragInfo(idx, clientX, clientY) {
    const ds = dragState.current;
    const sIdx = ds.startIdx;
    const fundStart = fundValues[sIdx], fundEnd = fundValues[idx];
    const spStart = spValues[sIdx], spEnd = spValues[idx];
    if (fundStart == null || fundEnd == null) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setDragInfo({
      fundPct: ((fundEnd - fundStart) / fundStart) * 100,
      spPct: ((spEnd - spStart) / spStart) * 100,
      fundStart: fmt$(fundStart), fundEnd: fmt$(fundEnd),
      spStart: fmt$(spStart), spEnd: fmt$(spEnd),
      startLabel: labels[sIdx], endLabel: labels[idx],
      x: clientX - rect.left, y: clientY - rect.top,
    });
  }

  useEffect(() => {
    if (fundValues.length) {
      const i = fundValues.length - 1;
      setHoverInfo({ date: labels[i], fund: fmt$(fundValues[i]), sp: fmt$(spValues[i]) });
    }
  }, [filtered]);

  function handleMouseDown(e) {
    const idx = getIndexFromClientX(e.clientX);
    if (idx === null) return;
    dragState.current = { dragging: true, startIdx: idx, endIdx: idx };
    hoverIdx.current = null;
    setDragInfo(null);
  }

  function handleMouseMove(e) {
    const idx = getIndexFromClientX(e.clientX);
    if (idx === null) return;
    if (dragState.current.dragging) {
      dragState.current.endIdx = idx;
      updateDragInfo(idx, e.clientX, e.clientY);
      hoverIdx.current = null;
      if (chartRef.current) chartRef.current.draw();
      return;
    }
    hoverIdx.current = idx;
    setHoverInfo({ date: labels[idx], fund: fmt$(fundValues[idx]), sp: fmt$(spValues[idx]) });
  }

  function handleMouseLeave() {
    if (dragState.current.dragging) return;
    hoverIdx.current = null;
    if (fundValues.length) {
      const i = fundValues.length - 1;
      setHoverInfo({ date: labels[i], fund: fmt$(fundValues[i]), sp: fmt$(spValues[i]) });
    }
  }

  const endDrag = useCallback(() => {
    if (!dragState.current.dragging) return;
    dragState.current = { dragging: false, startIdx: null, endIdx: null };
    setDragInfo(null);
    if (chartRef.current) chartRef.current.draw();
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag]);

  useEffect(() => {
    if (!canvasRef.current || !filtered.length) return;
    if (chartRef.current) chartRef.current.destroy();
    const ctx = canvasRef.current.getContext('2d');
    const fundGradient = ctx.createLinearGradient(0, 0, 0, 320);
    fundGradient.addColorStop(0, 'rgba(16, 185, 129, 0.12)');
    fundGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    const overlayPlugin = {
      id: 'overlayPlugin',
      afterDraw(chart) {
        const { ctx: drawCtx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta.data.length) return;
        const ds = dragState.current;
        if (ds.dragging && ds.startIdx !== null && ds.endIdx !== null) {
          const minIdx = Math.min(ds.startIdx, ds.endIdx);
          const maxIdx = Math.max(ds.startIdx, ds.endIdx);
          const startX = meta.data[minIdx]?.x, endX = meta.data[maxIdx]?.x;
          if (startX != null && endX != null) {
            drawCtx.save();
            drawCtx.fillStyle = 'rgba(16, 185, 129, 0.08)';
            drawCtx.fillRect(startX, chartArea.top, endX - startX, chartArea.bottom - chartArea.top);
            drawCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
            drawCtx.lineWidth = 1;
            drawCtx.setLineDash([4, 3]);
            drawCtx.beginPath();
            drawCtx.moveTo(startX, chartArea.top); drawCtx.lineTo(startX, chartArea.bottom);
            drawCtx.moveTo(endX, chartArea.top); drawCtx.lineTo(endX, chartArea.bottom);
            drawCtx.stroke();
            drawCtx.setLineDash([]);
            drawCtx.restore();
          }
        }
      },
    };

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Fund NAV', data: fundValuesChart, borderColor: '#10b981',
            backgroundColor: fundGradient, borderWidth: 2.5, fill: true,
            tension: 0.3, pointRadius: 0, pointHoverRadius: 0,
          },
          {
            label: 'S&P 500 NAV', data: spValuesChart, borderColor: '#6b7280',
            backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 3],
            fill: false, tension: 0.3, pointRadius: 0, pointHoverRadius: 0,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        transitions: {
          active: { animation: { duration: 0 } },
        },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            grid: { color: '#f9fafb' },
            ticks: { color: '#b0b5bd', maxTicksLimit: 8, font: { size: 9, family: 'Plus Jakarta Sans' } },
            border: { color: '#f3f4f6' },
          },
          y: {
            grid: { color: '#f9fafb' },
            ticks: { color: '#9ca3af', font: { size: 10, family: 'Plus Jakarta Sans' }, callback: v => Number(v).toFixed(1) },
            border: { color: '#f3f4f6' },
          },
        },
      },
      plugins: [overlayPlugin],
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [filtered]);

  // ── Render ──

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16 space-y-6">

      {/* ── NAV Chart ── */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Fund Performance</h2>
            {stats && (
              <div className="flex items-center gap-6 mt-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-0.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="text-xs text-gray-500">Fund NAV</span>
                  <span className="text-sm font-bold text-gray-900">{stats.fundNav}</span>
                  <span className={`text-xs font-semibold ${stats.fundReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {stats.fundReturn >= 0 ? '+' : ''}{stats.fundReturn.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-0.5 rounded-full bg-gray-400 inline-block" style={{ borderTop: '2px dashed #9ca3af', height: 0 }} />
                  <span className="text-xs text-gray-500">S&P 500</span>
                  <span className="text-sm font-bold text-gray-900">{stats.spNav}</span>
                  <span className={`text-xs font-semibold ${stats.spReturn >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {stats.spReturn >= 0 ? '+' : ''}{stats.spReturn.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Alpha</span>
                  <span className={`text-xs font-bold ${stats.alpha >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {stats.alpha >= 0 ? '+' : ''}{stats.alpha.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowNavUpdate(true); setNavUpdateResult(null); setNavUpdateError(''); }}
              className="p-2 rounded-xl text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
              title="Update NAV data"
            >
              <RefreshCw size={15} />
            </button>
            <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1">
              {TIMEFRAMES.map(tf => (
                <button key={tf.label} onClick={() => setTimeframe(tf.label)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${timeframe === tf.label ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-600'}`}>
                  {tf.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {hoverInfo && (
          <div className="flex items-center justify-end gap-4 mt-2 mb-1 text-right">
            <div className="text-[11px] font-medium text-gray-400">{hoverInfo.date}</div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              <span className="text-xs text-gray-500">Fund</span>
              <span className="text-xs font-bold text-gray-900">{hoverInfo.fund}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
              <span className="text-xs text-gray-500">S&P</span>
              <span className="text-xs font-bold text-gray-900">{hoverInfo.sp}</span>
            </div>
          </div>
        )}
        <div className="mt-2 relative select-none" style={{ height: 320, cursor: 'crosshair' }}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length ? (
            <>
              <canvas ref={canvasRef} />
              {dragInfo && (
                <div className="absolute pointer-events-none z-10"
                  style={{ left: Math.min(dragInfo.x + 12, canvasRef.current?.offsetWidth - 200 || 0), top: Math.max(dragInfo.y - 90, 4) }}>
                  <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3 py-2.5 min-w-[170px]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      <span className="text-[10px] text-gray-500">Fund</span>
                      <span className={`text-sm font-bold ml-auto ${dragInfo.fundPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {dragInfo.fundPct >= 0 ? '+' : ''}{dragInfo.fundPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 ml-3.5 mb-2">{dragInfo.fundStart} → {dragInfo.fundEnd}</div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />
                      <span className="text-[10px] text-gray-500">S&P 500</span>
                      <span className={`text-sm font-bold ml-auto ${dragInfo.spPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {dragInfo.spPct >= 0 ? '+' : ''}{dragInfo.spPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 ml-3.5 mb-1.5">{dragInfo.spStart} → {dragInfo.spEnd}</div>
                    <div className="text-[10px] text-gray-500 border-t border-gray-100 pt-1.5">{dragInfo.startLabel} → {dragInfo.endLabel}</div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">No data available</div>
          )}
        </div>

        {/* NAV Update Modal */}
        {showNavUpdate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowNavUpdate(false); }}>
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg mx-4 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <RefreshCw size={16} className="text-emerald-600" />
                  <h3 className="text-sm font-bold text-gray-900">Update NAV Data</h3>
                </div>
                <button onClick={() => setShowNavUpdate(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 py-4 space-y-3">
                {navData && navData.length > 0 && (() => {
                  const last = navData[navData.length - 1];
                  const dt = new Date(last.date + 'T00:00:00');
                  const formatted = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
                  return (
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                      Last saved date: <span className="font-semibold text-gray-900">{formatted}</span>
                    </div>
                  );
                })()}
                <p className="text-xs text-gray-500">
                  Paste dates and portfolio AUM values. NAV per share and S&P 500 benchmark will be calculated automatically.
                </p>
                <textarea spellCheck={true}
                  value={navUpdateInput}
                  onChange={e => setNavUpdateInput(e.target.value)}
                  placeholder={'"03/23/2026","46554.253681603"\n"03/24/2026","45817.583681603"\n"03/25/2026","46113.083681603"'}
                  rows={6}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono text-gray-800 placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all resize-y"
                />

                {navUpdateError && (
                  <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> {navUpdateError}
                  </div>
                )}

                {navUpdateResult && (
                  <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle size={12} /> Updated {navUpdateResult.inserted} date{navUpdateResult.inserted !== 1 ? 's' : ''} successfully. Chart refreshed.
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleNavUpdate}
                    disabled={navUpdateLoading || !navUpdateInput.trim()}
                    className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-xl shadow-sm hover:shadow-md hover:from-emerald-700 hover:to-emerald-600 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {navUpdateLoading && <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {navUpdateLoading ? 'Processing...' : 'Update'}
                  </button>
                  <button
                    onClick={() => setShowNavUpdate(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Period Returns ── */}
      {periodReturns && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Today', data: periodReturns.day },
            { label: '1 Month', data: periodReturns['1M'] },
            { label: 'YTD', data: periodReturns.ytd },
            { label: '1 Year', data: periodReturns['1Y'] },
            { label: 'Cumulative', data: periodReturns.cumulative },
          ].map(({ label, data }) => {
            const alpha = data.fund - data.sp;
            return (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 px-4 py-3.5 shadow-sm">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-500">Fund</span>
                  <span className={`text-sm font-bold tabular-nums ${data.fund >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {data.fund >= 0 ? '+' : ''}{data.fund.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-gray-500">S&P 500</span>
                  <span className={`text-xs font-semibold tabular-nums ${data.sp >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {data.sp >= 0 ? '+' : ''}{data.sp.toFixed(2)}%
                  </span>
                </div>
                <div className="border-t border-gray-50 pt-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">Alpha</span>
                  <span className={`text-[11px] font-bold tabular-nums ${alpha >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {alpha >= 0 ? '+' : ''}{alpha.toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Portfolio Snapshot + Today's Movers ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Portfolio Summary */}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm transition-all duration-300 hover:border-emerald-200 hover:shadow-emerald-100/50 hover:shadow-lg">
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">Portfolio</h3>
          {holdingsData ? (() => {
            const top7 = holdingsData.pieItems.slice(0, 7);
            const rest = holdingsData.pieItems.slice(7);
            const otherWeight = rest.reduce((s, p) => s + p.weight, 0);
            const display = otherWeight > 0
              ? [...top7, { ticker: `Other (${rest.length})`, weight: otherWeight, isOther: true }]
              : top7;
            const PIE_COLORS = ['#2563EB','#DC2626','#16A34A','#7C3AED','#0891B2','#EA580C','#C026D3'];
            const colors = display.map((p, i) =>
              p.isOther || p.ticker === 'Cash' ? '#d1d5db' : PIE_COLORS[i % PIE_COLORS.length]
            );
            return (
              <div className="flex flex-col gap-6">
                {/* Donut with center label */}
                <div className="relative w-52 h-52 mx-auto" style={{ zIndex: 2 }}>
                  <Doughnut
                    data={{
                      labels: display.map(p => p.ticker),
                      datasets: [{
                        data: display.map(p => p.weight),
                        backgroundColor: colors,
                        borderWidth: 2,
                        borderColor: '#fff',
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: true,
                      cutout: '68%',
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          enabled: false,
                          external: function(context) {
                            let el = document.getElementById('pie-tooltip');
                            if (!el) {
                              el = document.createElement('div');
                              el.id = 'pie-tooltip';
                              el.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;box-shadow:0 4px 20px rgba(0,0,0,0.12);font-size:13px;font-weight:600;color:#111827;transition:opacity 0.15s;white-space:nowrap;';
                              document.body.appendChild(el);
                            }
                            const tooltip = context.tooltip;
                            if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }
                            const pos = context.chart.canvas.getBoundingClientRect();
                            el.style.opacity = '1';
                            el.style.left = pos.left + tooltip.caretX + 'px';
                            el.style.top = pos.top + tooltip.caretY - 40 + 'px';
                            el.style.transform = 'translateX(-50%)';
                            if (tooltip.body) {
                              const item = tooltip.dataPoints[0];
                              el.innerHTML = '<span style="color:#6b7280;font-weight:500">' + item.label + '</span> <span style="margin-left:6px">' + item.parsed.toFixed(1) + '%</span>';
                            }
                          },
                        },
                      },
                    }}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-xl font-bold text-gray-900 leading-none">{fmtBig(holdingsData.totalWithCash)}</div>
                    <div className={`text-xs font-semibold mt-1 ${holdingsData.totalGL >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {holdingsData.totalGL >= 0 ? '+' : ''}{fmtBig(holdingsData.totalGL)} ({holdingsData.totalGLPct >= 0 ? '+' : ''}{holdingsData.totalGLPct.toFixed(1)}%)
                    </div>
                    <div className="text-[11px] text-gray-500">unrealized</div>
                  </div>
                </div>

                {/* Holdings grid — matches pie slices */}
                <div className="grid grid-cols-2 gap-x-5 gap-y-4 flex-1">
                  {display.map((p, i) => (
                    <div key={p.ticker} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colors[i] }} />
                        <span className={`text-[13px] font-semibold truncate ${p.isOther ? 'text-gray-500' : 'text-gray-800'}`}>{p.ticker}</span>
                      </div>
                      <span className={`text-[13px] tabular-nums font-medium shrink-0 ${p.isOther ? 'text-gray-500' : 'text-gray-600'}`}>{p.weight.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })() : (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-8 rounded-lg skeleton" />)}
            </div>
          )}
        </div>

        {/* Today's Movers */}
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm transition-all duration-300 hover:border-emerald-200 hover:shadow-emerald-100/50 hover:shadow-lg">
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-4">Today&apos;s Movers</h3>
          {holdingsData ? (
            <div className="space-y-4">
              {/* Winners */}
              <div>
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <ArrowUpRight size={12} className="text-emerald-500" />
                  <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Best</span>
                </div>
                <div className="space-y-0.5">
                  {holdingsData.winners.map(h => (
                    <button key={h.ticker} onClick={() => router.push(`/position-review?ticker=${h.ticker}`)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-emerald-50/50 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                          <ArrowUpRight size={13} className="text-emerald-700" />
                        </div>
                        <div className="text-left">
                          <div className="text-xs font-bold text-gray-900">{h.ticker}</div>
                          <div className="text-[10px] text-gray-500">{fmt$(h.price)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-emerald-600">+{h.dayChange.toFixed(2)}%</div>
                      </div>
                    </button>
                  ))}
                  {holdingsData.winners.length === 0 && (
                    <div className="text-[10px] text-gray-500 text-center py-2">No gainers today</div>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100" />

              {/* Losers */}
              <div>
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <ArrowDownRight size={12} className="text-red-400" />
                  <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Worst</span>
                </div>
                <div className="space-y-0.5">
                  {holdingsData.losers.map(h => (
                    <button key={h.ticker} onClick={() => router.push(`/position-review?ticker=${h.ticker}`)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-red-50/50 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                          <ArrowDownRight size={13} className="text-red-600" />
                        </div>
                        <div className="text-left">
                          <div className="text-xs font-bold text-gray-900">{h.ticker}</div>
                          <div className="text-[10px] text-gray-500">{fmt$(h.price)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-red-500">{h.dayChange.toFixed(2)}%</div>
                      </div>
                    </button>
                  ))}
                  {holdingsData.losers.length === 0 && (
                    <div className="text-[10px] text-gray-500 text-center py-2">No losers today</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-9 rounded-lg skeleton" />)}
            </div>
          )}
        </div>

        {/* Tasks */}
        {/* Tasks — wrapper is relative with no content height so Portfolio/Movers drive the row */}
        <div className="relative min-h-[200px]">
        <div ref={tasksPanelRef} className="absolute inset-0 bg-white rounded-3xl border border-gray-100 p-6 shadow-sm flex flex-col overflow-hidden transition-all duration-300 hover:border-emerald-200 hover:shadow-emerald-100/50 hover:shadow-lg">
          {taskData ? (
            <div className="flex flex-col flex-1">
              {/* High Priority */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">High Priority</h3>
                <span className="text-[10px] font-semibold text-red-400 bg-red-50 rounded-full px-2 py-0.5">
                  {taskData.high.length}
                </span>
              </div>
              <div ref={highSectionRef} className="space-y-0.5">
                {taskData.high.map(task => (
                  <button key={task.id} onClick={() => router.push('/tasks')}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left">
                    <Circle size={14} className="mt-0.5 shrink-0 text-red-400" strokeWidth={2.5} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-900 truncate">{task.title}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.status === 'working' && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-full px-1.5">Working on it</span>}
                        {task.status === 'stuck' && <span className="text-[10px] font-semibold text-red-600 bg-red-50 rounded-full px-1.5">Stuck</span>}
                        {task.status === 'waiting' && <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 rounded-full px-1.5">Waiting</span>}
                        {task.status === 'review' && <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 rounded-full px-1.5">In review</span>}
                        {task.assignee && <span className="text-[10px] text-gray-500">{task.assignee}</span>}
                        {task.subtasks?.length > 0 && (
                          <span className="text-[10px] text-gray-500">
                            {task.subtasks.filter(s => s.done).length}/{task.subtasks.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {taskData.high.length === 0 && (
                  <div className="text-[10px] text-gray-500 text-center py-3">No high priority tasks</div>
                )}
              </div>

              {/* Medium + Low */}
              {(() => {
                const otherTasks = [...taskData.medium, ...taskData.open.filter(t => t.priority === 'low')];
                if (otherTasks.length === 0 || otherTasksLimit <= 0) return null;
                const visible = otherTasks.slice(0, otherTasksLimit);
                const hidden = otherTasks.length - visible.length;
                return (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Other Tasks</h3>
                    <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                      {otherTasks.length}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {visible.map(task => (
                      <button key={task.id} onClick={() => router.push('/tasks')}
                        className="w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-gray-50 transition-colors text-left">
                        <Circle size={12} className={`mt-0.5 shrink-0 ${task.priority === 'medium' ? 'text-amber-400' : 'text-gray-500'}`} strokeWidth={2.5} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-gray-700 truncate">{task.title}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[9px] font-bold uppercase tracking-wider ${task.priority === 'medium' ? 'text-amber-400' : 'text-gray-500'}`}>
                              {task.priority}
                            </span>
                            {task.status === 'working' && <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 rounded-full px-1.5">Working on it</span>}
                            {task.status === 'stuck' && <span className="text-[9px] font-semibold text-red-600 bg-red-50 rounded-full px-1.5">Stuck</span>}
                            {task.status === 'waiting' && <span className="text-[9px] font-semibold text-violet-600 bg-violet-50 rounded-full px-1.5">Waiting</span>}
                            {task.status === 'review' && <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 rounded-full px-1.5">In review</span>}
                            {task.assignee && <span className="text-[10px] text-gray-500">{task.assignee}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                    {hidden > 0 && (
                      <button onClick={() => router.push('/tasks')}
                        className="w-full text-center text-[10px] font-medium text-gray-500 hover:text-gray-600 pt-1.5 transition-colors">
                        +{hidden} more in task board
                      </button>
                    )}
                  </div>
                </div>
                );
              })()}

              {/* Completion bar */}
              {taskData.total > 0 && (
                <div className="pt-3 mt-auto border-t border-gray-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-gray-500">{taskData.completed.length} of {taskData.total} done</span>
                    <span className="text-[10px] font-semibold text-gray-500">
                      {Math.round((taskData.completed.length / taskData.total) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${(taskData.completed.length / taskData.total) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-9 rounded-lg skeleton" />)}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Macro Regime Signal ── */}
      {macroSignal && (() => {
        const eqPct = Math.round((macroSignal.equityWeight || 0) * 100);
        const regime = macroSignal.regime || 'CAUTIOUS';
        const regimeColor = macroSignal.regimeColor || 'amber';
        const colorMap = {
          emerald: { ring: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
          amber: { ring: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
          red: { ring: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
        };
        const c = colorMap[regimeColor] || colorMap.amber;

        const ms = macroSignal.marketSignals || {};

        // All 12 model features with descriptions
        const allFeatures = [
          { key: 'inflation_yoy', label: 'Inflation YoY', desc: 'CPI annual change', unit: '%' },
          { key: 'inflation_impulse', label: 'Inflation Impulse', desc: '3M annualized vs YoY gap', unit: '%' },
          { key: 'unemployment_rate', label: 'Unemployment', desc: 'U.S. unemployment rate', unit: '%' },
          { key: 'credit_spread_level', label: 'Credit Spread', desc: 'High-yield bond spread', unit: '%' },
          { key: 'credit_spread_3m_change', label: 'Credit Spd 3M', desc: '3M spread change', unit: '%', signed: true },
          { key: 'real_fed_funds', label: 'Real Fed Funds', desc: 'Fed funds minus inflation', unit: '%', signed: true },
          { key: 'yield_curve_slope', label: 'Yield Curve', desc: '10Y minus 2Y Treasury', unit: '%', signed: true },
          { key: 'vix_1m_change', label: 'VIX 1M Change', desc: 'Monthly volatility shift', unit: 'pts', signed: true },
          { key: 'vix_term_structure', label: 'VIX Term Structure', desc: 'VIX / VIX3M ratio', unit: 'x' },
          { key: 'equity_momentum_3m', label: 'Equity Momentum', desc: '3M price return', unit: '%', signed: true },
          { key: 'equity_vol_3m', label: 'Equity Volatility', desc: '3M annualized vol', unit: '%' },
          { key: 'equity_drawdown_from_high', label: 'Drawdown', desc: 'Drop from peak in past 1Y', unit: '%' },
        ];
        const fmtFeature = (f, v) => {
          if (v == null) return '—';
          const num = f.unit === 'x' ? v.toFixed(3) : v.toFixed(2);
          const sign = f.signed && v > 0 ? '+' : '';
          const suffix = f.unit === 'x' ? '' : f.unit === 'pts' ? '' : '%';
          return sign + num + suffix;
        };

        const doughnutData = {
          datasets: [{
            data: [eqPct, 100 - eqPct],
            backgroundColor: [c.ring, '#e5e7eb'],
            borderWidth: 0,
            cutout: '75%',
          }],
        };
        const doughnutOpts = {
          responsive: true,
          maintainAspectRatio: true,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        };

        return (
          <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Market Confidence</h3>
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                {macroSignal.dataAsOf && <span>Data thru {macroSignal.dataAsOf}</span>}
                {macroSignal.allocationFor && <span className="text-gray-300">|</span>}
                {macroSignal.allocationFor && <span>Signal for {macroSignal.allocationFor}</span>}
                {macroSignal.overlay && macroSignal.overlay !== 'none' && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-red-50 rounded-md text-red-600 font-medium">
                    <AlertTriangle size={10} /> {macroSignal.overlay}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-start gap-6">
              {/* Doughnut — pinned left */}
              <div className="flex-shrink-0 relative self-stretch flex items-center">
                <div className="w-44 h-44 relative">
                  <Doughnut data={doughnutData} options={{ ...doughnutOpts, maintainAspectRatio: false }} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-1">
                    <span className="text-2xl font-extrabold text-gray-900">{eqPct}%</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>
                      {regime}
                    </span>
                  </div>
                </div>
              </div>

              {/* 12-feature grid — fills right */}
              <div className="flex-1 min-w-0 grid grid-cols-4 gap-2.5" style={{ gridAutoRows: '1fr' }}>
                {allFeatures.map(f => {
                  const v = ms[f.key];
                  const hasValue = v != null && Number.isFinite(v);
                  return (
                    <div key={f.key} className="px-3 py-2.5 bg-gray-50 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-gray-700">{f.label}</div>
                        <div className="text-[11px] text-gray-400">{f.desc}</div>
                      </div>
                      <span className={`text-sm font-bold font-mono flex-shrink-0 ml-2 ${hasValue ? 'text-gray-900' : 'text-gray-300'}`}>
                        {fmtFeature(f, v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Fund Analytics ── */}
      {navData && navData.length > 1 && (() => {
        const n = navData.length;
        const fundPrices = navData.map(d => Number(d.fund_nav));
        const spPrices = navData.map(d => Number(d.sp500_nav));

        // Daily returns
        const fundReturns = [];
        const spReturns = [];
        for (let i = 1; i < n; i++) {
          fundReturns.push((fundPrices[i] - fundPrices[i - 1]) / fundPrices[i - 1]);
          spReturns.push((spPrices[i] - spPrices[i - 1]) / spPrices[i - 1]);
        }

        const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
        const std = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };

        // Annualized return
        const totalReturn = (fundPrices[n - 1] / fundPrices[0]) - 1;
        const years = n / 252;
        const annReturn = (Math.pow(1 + totalReturn, 1 / years) - 1) * 100;

        // Annualized volatility
        const annVol = std(fundReturns) * Math.sqrt(252) * 100;

        // Sharpe Ratio
        const rf = riskFreeRate;
        const sharpe = (annReturn - rf) / annVol;

        // Max Drawdown
        let peak = fundPrices[0], maxDD = 0;
        for (let i = 1; i < n; i++) {
          if (fundPrices[i] > peak) peak = fundPrices[i];
          const dd = (peak - fundPrices[i]) / peak;
          if (dd > maxDD) maxDD = dd;
        }

        // Beta vs S&P
        const mf = mean(fundReturns), ms = mean(spReturns);
        let cov = 0, varS = 0;
        for (let i = 0; i < fundReturns.length; i++) {
          cov += (fundReturns[i] - mf) * (spReturns[i] - ms);
          varS += (spReturns[i] - ms) ** 2;
        }
        const beta = varS > 0 ? cov / varS : 0;

        // Alpha (Jensen's)
        const spTotal = (spPrices[n - 1] / spPrices[0]) - 1;
        const spAnnReturn = (Math.pow(1 + spTotal, 1 / years) - 1) * 100;
        const alpha = annReturn - (rf + beta * (spAnnReturn - rf));

        // Tracking Error
        const excessReturns = fundReturns.map((r, i) => r - spReturns[i]);
        const trackingError = std(excessReturns) * Math.sqrt(252) * 100;

        // Win Rate (days beating S&P)
        const wins = fundReturns.filter((r, i) => r > spReturns[i]).length;
        const winRate = (wins / fundReturns.length) * 100;

        const metrics = [
          { label: 'Annualized Return', value: `${annReturn >= 0 ? '+' : ''}${annReturn.toFixed(2)}%`, color: annReturn >= 0 ? 'emerald' : 'red',
            sub: 'Compound annual growth rate', bar: Math.min(Math.abs(annReturn) / 30 * 100, 100) },
          { label: 'Annualized Volatility', value: `${annVol.toFixed(2)}%`, color: annVol < 20 ? 'emerald' : annVol < 30 ? 'amber' : 'red',
            sub: 'Std deviation of returns (ann.)', bar: Math.min(annVol / 40 * 100, 100) },
          { label: 'Sharpe Ratio', value: sharpe.toFixed(2), color: sharpe > 1 ? 'emerald' : sharpe > 0.5 ? 'amber' : 'red',
            sub: `Risk-adjusted return (rf=${rf}%)`, bar: Math.min(Math.max(sharpe, 0) / 3 * 100, 100) },
          { label: 'Max Drawdown', value: `${(maxDD * 100).toFixed(2)}%`, color: maxDD < 0.1 ? 'emerald' : maxDD < 0.2 ? 'amber' : 'red',
            sub: 'Largest peak-to-trough decline', bar: Math.min(maxDD * 100 / 50 * 100, 100) },
          { label: 'Beta', value: beta.toFixed(2), color: beta < 1.1 && beta > 0.9 ? 'amber' : beta < 1 ? 'emerald' : 'red',
            sub: `Sensitivity to S&P 500 moves`, bar: Math.min(Math.abs(beta) / 2 * 100, 100) },
          { label: "Jensen's Alpha", value: `${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`, color: alpha >= 0 ? 'emerald' : 'red',
            sub: 'Excess return vs expected (CAPM)', bar: Math.min(Math.abs(alpha) / 20 * 100, 100) },
          { label: 'Tracking Error', value: `${trackingError.toFixed(2)}%`, color: trackingError < 5 ? 'emerald' : trackingError < 10 ? 'amber' : 'red',
            sub: 'Volatility of excess returns', bar: Math.min(trackingError / 20 * 100, 100) },
          { label: 'Win Rate vs S&P', value: `${winRate.toFixed(1)}%`, color: winRate > 52 ? 'emerald' : winRate > 48 ? 'amber' : 'red',
            sub: `${wins} of ${fundReturns.length} trading days`, bar: winRate },
        ];

        const colorMap = {
          emerald: { text: 'text-emerald-600', bg: 'bg-emerald-500', bgLight: 'bg-emerald-50', dot: 'bg-emerald-400', hoverBorder: 'hover:border-emerald-200', hoverShadow: 'hover:shadow-emerald-100/50' },
          red: { text: 'text-red-500', bg: 'bg-red-500', bgLight: 'bg-red-50', dot: 'bg-red-400', hoverBorder: 'hover:border-red-200', hoverShadow: 'hover:shadow-red-100/50' },
          amber: { text: 'text-amber-600', bg: 'bg-amber-500', bgLight: 'bg-amber-50', dot: 'bg-amber-400', hoverBorder: 'hover:border-amber-200', hoverShadow: 'hover:shadow-amber-100/50' },
        };

        return (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Fund Analytics</h3>
              <span className="text-[10px] text-gray-500">{n} trading days</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {metrics.map(m => {
                const c = colorMap[m.color];
                return (
                  <div key={m.label} className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-sm transition-all duration-300 hover:shadow-lg ${c.hoverBorder} ${c.hoverShadow} group`}>
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{m.label}</span>
                      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                    </div>
                    <div className={`text-2xl font-bold tabular-nums ${c.text} mb-1`}>{m.value}</div>
                    <div className="text-[10px] text-gray-500 mb-3">{m.sub}</div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${c.bg} transition-all duration-700`}
                        style={{ width: `${m.bar}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
