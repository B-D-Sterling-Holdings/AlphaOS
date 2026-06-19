'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Plus, Trash2, RefreshCw, Pencil, Check, X } from 'lucide-react';
import Card from '@/components/Card';
import StatCard from '@/components/StatCard';
import Treemap from '@/components/Treemap';
import Toast from '@/components/Toast';
import { formatMoney, formatMoneyPrecise, formatPct, formatLargeNumber } from '@/lib/formatters';
import { useCache } from '@/lib/CacheContext';
import { Doughnut, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const BENCHMARK_TICKER = 'SPY';

export default function HoldingsPage() {
  const cache = useCache();
  const searchParams = useSearchParams();
  const [portfolio, setPortfolio] = useState(() => cache.get('holdings_portfolio') || null);
  const [quotes, setQuotes] = useState(() => cache.get('holdings_quotes') || {});
  const [loading, setLoading] = useState(() => !cache.get('holdings_portfolio'));
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [treemapMode, setTreemapMode] = useState('alltime');
  const initialTab = searchParams.get('tab');
  const [activeSubTab, setActiveSubTab] = useState(
    initialTab && ['summary', 'risk', 'factors'].includes(initialTab) ? initialTab : 'summary'
  );

  // Risk & Factors state
  const [riskData, setRiskData] = useState(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [fundamentalsData, setFundamentalsData] = useState(null);
  const [fundamentalsLoading, setFundamentalsLoading] = useState(false);
  const [fundamentalsSearch, setFundamentalsSearch] = useState('');

  // Factor config state
  const [factorConfig, setFactorConfig] = useState(null);
  const [editingFactorExposures, setEditingFactorExposures] = useState({});
  const [newFactorName, setNewFactorName] = useState('');
  const [editingWeights, setEditingWeights] = useState({});

  // Sector label overrides
  const [sectorConfig, setSectorConfig] = useState({});
  const [editingSector, setEditingSector] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [colorPickSector, setColorPickSector] = useState(null);
  const [colorPickPos, setColorPickPos] = useState({ top: 0, left: 0 });
  const colorPickRef = useRef(null);
  const editInputRef = useRef(null);

  // Form state
  const [ticker, setTicker] = useState('');
  const [shares, setShares] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [cash, setCash] = useState('');
  const [search, setSearch] = useState('');

  // Inline edit state
  const [editingTicker, setEditingTicker] = useState(null);
  const [editShares, setEditShares] = useState('');
  const [editCostBasis, setEditCostBasis] = useState('');

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      setPortfolio(data);
      cache.set('holdings_portfolio', data);
      setCash(String(data.cash || 0));
      return data;
    } catch (e) {
      setToast({ message: 'Failed to load portfolio', type: 'error' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [cache]);

  const [quotesError, setQuotesError] = useState(null);

  const loadQuotes = useCallback(async (holdings) => {
    if (!holdings?.length) return;
    setQuotesLoading(true);
    setQuotesError(null);
    try {
      const tickers = Array.from(new Set([...holdings.map(h => h.ticker), BENCHMARK_TICKER])).join(',');
      const res = await fetch(`/api/quotes?tickers=${tickers}`);
      const data = await res.json();
      if (data.quotes) {
        // Check which holding tickers failed to get a real price
        const failedTickers = holdings
          .map(h => h.ticker)
          .filter(t => !data.quotes[t]?.price);
        if (failedTickers.length > 0) {
          setQuotesError(`Failed to load live prices for: ${failedTickers.join(', ')}. Please reload the page.`);
        }
        setQuotes(data.quotes);
        cache.set('holdings_quotes', data.quotes);
      } else {
        setQuotesError('Failed to load quotes. Please reload the page.');
      }
    } catch (e) {
      setQuotesError('Failed to load quotes. Please reload the page.');
    } finally {
      setQuotesLoading(false);
    }
  }, [cache]);

  const loadRisk = useCallback(async (holdings) => {
    if (!holdings?.length) return;
    setRiskLoading(true);
    try {
      const holdingsWithPrices = holdings.map(h => ({
        ticker: h.ticker,
        shares: h.shares,
        cost_basis: h.cost_basis,
        price: quotes[h.ticker]?.price || h.cost_basis,
      }));
      const res = await fetch('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings: holdingsWithPrices }),
      });
      const data = await res.json();
      setRiskData(data);
    } catch (e) {
      setToast({ message: 'Failed to load risk data', type: 'error' });
    } finally {
      setRiskLoading(false);
    }
  }, [quotes]);

  const loadFundamentals = useCallback(async (holdings) => {
    if (!holdings?.length) return;
    setFundamentalsLoading(true);
    try {
      const tickers = holdings.map(h => h.ticker).join(',');
      const res = await fetch(`/api/fundamentals?tickers=${tickers}`);
      const data = await res.json();
      if (data.fundamentals) setFundamentalsData(data.fundamentals);
    } catch (e) {
      setToast({ message: 'Failed to load fundamentals', type: 'error' });
    } finally {
      setFundamentalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPortfolio().then(data => {
      const cachedQuotes = cache.get('holdings_quotes');
      const missingBenchmarkQuote = !cachedQuotes?.[BENCHMARK_TICKER];
      // Refresh quotes when cache is missing or predates the benchmark quote.
      if (data?.holdings?.length && (!cachedQuotes || missingBenchmarkQuote)) {
        loadQuotes(data.holdings);
      }
    });
  }, [loadPortfolio, loadQuotes, cache]);

  // Close color picker on click outside
  useEffect(() => {
    if (!colorPickSector) return;
    const handler = (e) => {
      if (colorPickRef.current && !colorPickRef.current.contains(e.target)) {
        setColorPickSector(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickSector]);

  // Sync tab from URL when search params change
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['summary', 'risk', 'factors'].includes(tab)) {
      setActiveSubTab(tab);
    } else {
      setActiveSubTab('summary');
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeSubTab === 'risk' && !riskData && !riskLoading && portfolio?.holdings?.length) {
      loadRisk(portfolio.holdings);
    }
    if (activeSubTab === 'factors' && !fundamentalsData && !fundamentalsLoading && portfolio?.holdings?.length) {
      loadFundamentals(portfolio.holdings);
    }
    // Also load risk data for weighted correlation metric in factors tab
    if (activeSubTab === 'factors' && !riskData && !riskLoading && portfolio?.holdings?.length) {
      loadRisk(portfolio.holdings);
    }
  }, [activeSubTab, riskData, riskLoading, fundamentalsData, fundamentalsLoading, portfolio, loadRisk, loadFundamentals]);

  // Load sector config (labels + colors)
  useEffect(() => {
    fetch('/api/sector-labels').then(r => r.json()).then(setSectorConfig).catch(() => {});
  }, []);

  // Load factor config
  useEffect(() => {
    fetch('/api/factor-config').then(r => r.json()).then(setFactorConfig).catch(() => {});
  }, []);

  const saveFactorConfig = async (updates) => {
    try {
      const res = await fetch('/api/factor-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      setFactorConfig(data);
      return data;
    } catch {
      setToast({ message: 'Failed to save factor config', type: 'error' });
    }
  };

  const saveExposure = async (ticker, factor, value) => {
    const val = Math.max(0, Math.min(1, parseFloat(value) || 0));
    const current = factorConfig?.exposures || {};
    const tickerExposures = { ...(current[ticker] || {}), [factor]: val };
    await saveFactorConfig({ exposures: { [ticker]: tickerExposures } });
  };

  const addFactor = async (name) => {
    if (!name.trim()) return;
    const factors = [...(factorConfig?.factors || []), name.trim()];
    const iw = { ...(factorConfig?.importanceWeights || {}), [name.trim()]: 0.5 };
    await saveFactorConfig({ factors, importanceWeights: iw });
    setNewFactorName('');
  };

  const removeFactor = async (name) => {
    const factors = (factorConfig?.factors || []).filter(f => f !== name);
    const iw = { ...(factorConfig?.importanceWeights || {}) };
    delete iw[name];
    // Remove from all exposures
    const exposures = { ...(factorConfig?.exposures || {}) };
    for (const t of Object.keys(exposures)) {
      if (exposures[t][name] !== undefined) {
        exposures[t] = { ...exposures[t] };
        delete exposures[t][name];
      }
    }
    await saveFactorConfig({ factors, importanceWeights: iw, exposures });
  };

  const saveImportanceWeight = async (factor, value) => {
    const val = Math.max(0, Math.min(1, parseFloat(value) || 0));
    const iw = { ...(factorConfig?.importanceWeights || {}), [factor]: val };
    await saveFactorConfig({ importanceWeights: iw });
  };

  const getSectorLabel = (sector) => sectorConfig[sector]?.label || sector;
  const getSectorColor = (sector, fallback) => sectorConfig[sector]?.color || fallback;

  const saveSectorLabel = async (sector, label) => {
    try {
      const res = await fetch('/api/sector-labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector, label }),
      });
      setSectorConfig(await res.json());
    } catch {}
    setEditingSector(null);
  };

  const saveSectorColor = async (sector, color) => {
    try {
      const res = await fetch('/api/sector-labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector, color }),
      });
      setSectorConfig(await res.json());
    } catch {}
    setColorPickSector(null);
  };

  const refreshAll = async () => {
    cache.set('holdings_quotes', null);
    const data = await loadPortfolio();
    if (data?.holdings?.length) {
      loadQuotes(data.holdings);
      if (activeSubTab === 'risk') { setRiskData(null); loadRisk(data.holdings); }
      if (activeSubTab === 'factors') { setFundamentalsData(null); loadFundamentals(data.holdings); }
    }
  };

  const addHolding = async (e) => {
    e.preventDefault();
    if (!ticker) { setToast({ message: 'Please enter a ticker symbol', type: 'error' }); return; }
    if (!shares || Number(shares) <= 0) { setToast({ message: 'Please enter a valid number of shares', type: 'error' }); return; }
    if (!costBasis) return;
    try {
      const res = await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, shares: Number(shares), cost_basis: Number(costBasis) }),
      });
      const data = await res.json();
      if (data.success) {
        setPortfolio(data.portfolio);
        setTicker(''); setShares(''); setCostBasis('');
        setToast({ message: `${ticker.toUpperCase()} added to portfolio`, type: 'success' });
        loadQuotes(data.portfolio.holdings);
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (e) {
      setToast({ message: 'Failed to add holding', type: 'error' });
    }
  };

  const removeHolding = async (t) => {
    try {
      const res = await fetch(`/api/holdings?ticker=${t}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setPortfolio(data.portfolio);
        setToast({ message: `${t} removed from portfolio`, type: 'success' });
      }
    } catch (e) {
      setToast({ message: 'Failed to remove holding', type: 'error' });
    }
    setDeleteConfirm(null);
  };

  const startEdit = (p) => {
    setEditingTicker(p.ticker);
    setEditShares(String(p.shares));
    setEditCostBasis(String(p.costBasis));
  };

  const cancelEdit = () => {
    setEditingTicker(null);
    setEditShares('');
    setEditCostBasis('');
  };

  const saveEdit = async () => {
    if (!editShares || Number(editShares) <= 0) { setToast({ message: 'Enter valid shares', type: 'error' }); return; }
    if (!editCostBasis || Number(editCostBasis) <= 0) { setToast({ message: 'Enter valid cost basis', type: 'error' }); return; }
    try {
      const res = await fetch('/api/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: editingTicker, shares: Number(editShares), cost_basis: Number(editCostBasis) }),
      });
      const data = await res.json();
      if (data.success) {
        setPortfolio(data.portfolio);
        setToast({ message: `${editingTicker} updated`, type: 'success' });
        loadQuotes(data.portfolio.holdings);
      } else {
        setToast({ message: data.error, type: 'error' });
      }
    } catch (e) {
      setToast({ message: 'Failed to update holding', type: 'error' });
    }
    cancelEdit();
  };

  const saveCash = async () => {
    try {
      const res = await fetch('/api/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cash: Number(cash) }),
      });
      const data = await res.json();
      if (data.success) {
        setPortfolio(data.portfolio);
        setToast({ message: 'Cash balance updated', type: 'success' });
      }
    } catch (e) {
      setToast({ message: 'Failed to update cash', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="grid grid-cols-3 gap-6 mb-8">
          {[1,2,3].map(i => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
        <div className="skeleton h-72 rounded-3xl" />
      </div>
    );
  }

  const holdings = portfolio?.holdings || [];
  const cashVal = portfolio?.cash || 0;

  const positions = holdings.map(h => {
    const quote = quotes[h.ticker];
    const price = quote?.price || h.cost_basis;
    const dayChange = quote?.dayChange || 0;
    const value = h.shares * price;
    const cost = h.shares * h.cost_basis;
    const unrealizedPnl = value - cost;
    const unrealizedPnlPct = cost > 0 ? (unrealizedPnl / cost) * 100 : 0;
    const dayChangePct = quote?.dayChangePct || 0;
    const dailyPnl = h.shares * dayChange;
    return { ticker: h.ticker, shares: h.shares, costBasis: h.cost_basis, price, value, cost, unrealizedPnl, unrealizedPnlPct, dayChange, dayChangePct, dailyPnl };
  });

  const quotesLoaded = !quotesLoading && Object.keys(quotes).length > 0;

  const nav = positions.reduce((s, p) => s + p.value, 0);
  const totalAum = nav + cashVal;
  const totalCost = positions.reduce((s, p) => s + p.cost, 0);
  const totalUnrealizedPnl = nav - totalCost;
  const totalDailyChange = positions.reduce((s, p) => s + p.dailyPnl, 0);
  const previousTotalAum = totalAum - totalDailyChange;
  const totalDailyChangePct = previousTotalAum > 0 ? (totalDailyChange / previousTotalAum) * 100 : 0;
  const benchmarkDayChangePct = quotes[BENCHMARK_TICKER]?.dayChangePct;
  const dailyMoveSub = quotesLoaded
    ? `${formatPct(totalDailyChangePct, 2)} vs S&P's ${benchmarkDayChangePct == null ? '—' : formatPct(benchmarkDayChangePct, 2)}`
    : undefined;

  const treemapPositions = positions.map(p => ({
    ticker: p.ticker, value: p.value, pnlPct: p.unrealizedPnlPct, dayChangePct: p.dayChangePct,
  }));

  const filtered = positions
    .filter(p => !search || p.ticker.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.value - a.value);

  const inputCls = "w-full bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200";

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 animate-fade-in-up">
        <h1 className="text-3xl font-bold text-gray-900">Our Holdings</h1>
        <button
          onClick={refreshAll}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-white border border-gray-200 rounded-2xl text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 hover:shadow-md transition-all duration-200"
        >
          <RefreshCw size={14} className={quotesLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-8 bg-gray-100/80 rounded-xl p-1 w-fit animate-fade-in-up stagger-2">
        {[
          { key: 'summary', label: 'Summary' },
          { key: 'risk', label: 'Risk' },
          { key: 'factors', label: 'Sector' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              activeSubTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quote fetch error banner */}
      {quotesError && (
        <div className="mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 animate-fade-in-up">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <span className="text-amber-600 text-sm font-bold">!</span>
          </div>
          <p className="text-amber-800 text-sm flex-1">{quotesError}</p>
          <button onClick={refreshAll} className="text-amber-700 hover:text-amber-900 text-sm font-semibold underline flex-shrink-0">
            Reload
          </button>
        </div>
      )}

      {/* ===== SUMMARY TAB ===== */}
      {activeSubTab === 'summary' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8 animate-fade-in-up stagger-3">
            <StatCard label="Total AUM" value={quotesLoaded ? formatMoney(totalAum) : <div className="h-8 w-28 rounded-lg skeleton" />} />
            <StatCard label="Positions" value={holdings.length} />
            <StatCard
              label="Today's Move"
              sub={dailyMoveSub}
              variant={quotesLoaded ? (totalDailyChange >= 0 ? 'positive' : 'negative') : 'default'}
              value={quotesLoaded ? (
                <>
                  {totalDailyChange >= 0 ? '+' : ''}{formatMoney(totalDailyChange)}
                </>
              ) : <div className="h-8 w-28 rounded-lg skeleton" />}
            />
            <StatCard
              label="Unrealized P&L"
              sub="*from Jan 1st 2026"
              variant={quotesLoaded ? (totalUnrealizedPnl >= 0 ? 'positive' : 'negative') : 'default'}
              value={quotesLoaded ? (
                <>
                  {totalUnrealizedPnl >= 0 ? '+' : ''}{formatMoney(totalUnrealizedPnl)}
                </>
              ) : <div className="h-8 w-28 rounded-lg skeleton" />}
            />
          </div>

          {/* Treemap */}
          <Card
            title="Position Heatmap"
            actions={
              <div className="flex gap-1 bg-gray-100 rounded-xl p-0.5">
                <button
                  onClick={() => setTreemapMode('alltime')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-200 ${treemapMode === 'alltime' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  All Time
                </button>
                <button
                  onClick={() => setTreemapMode('day')}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-200 ${treemapMode === 'day' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Day Change
                </button>
              </div>
            }
            className="mb-6 animate-fade-in-up stagger-5"
          >
            {quotesLoaded ? (
              <Treemap positions={treemapPositions} mode={treemapMode} />
            ) : (
              <div className="h-64 w-full rounded-2xl skeleton" />
            )}
          </Card>

          {/* Positions Table */}
          <Card
            title="Positions"
            className="animate-fade-in-up stagger-7"
            actions={
              <input
                type="text" spellCheck={true} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search ticker..."
                className="w-44 bg-gray-50/50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
              />
            }
          >
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No holdings yet. Add your first position above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Symbol', '% AUM', 'Mkt Value', 'Avg Cost', 'Qty', 'Price', 'Daily P&L', 'Unreal P&L', ''].map((col, i) => (
                        <th key={i} className={`py-3 px-3 text-xs text-gray-400 uppercase tracking-wider font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => {
                      const weight = totalAum > 0 ? (p.value / totalAum) * 100 : 0;
                      const dayIsPos = p.dailyPnl >= 0;
                      const pnlIsPos = p.unrealizedPnl >= 0;
                      const isEditing = editingTicker === p.ticker;
                      return (
                        <tr key={p.ticker} className="border-b border-gray-50 hover:bg-white hover:shadow-[0_2px_16px_rgba(0,0,0,0.08)] hover:border-transparent relative hover:z-10 transition-all duration-200 cursor-default">
                          <td className="py-3.5 px-3">
                            <span className="bg-emerald-50 text-emerald-700 font-bold text-xs px-2.5 py-1 rounded-lg">
                              {p.ticker}
                            </span>
                          </td>
                          <td className="text-right py-3.5 px-3 text-gray-500">
                            {quotesLoaded ? `${weight.toFixed(2)}%` : <div className="h-5 w-12 rounded skeleton ml-auto" />}
                          </td>
                          <td className="text-right py-3.5 px-3 text-gray-900 font-semibold">
                            {quotesLoaded ? formatMoney(p.value) : <div className="h-5 w-20 rounded skeleton ml-auto" />}
                          </td>
                          <td className="text-right py-3.5 px-3 text-gray-700">
                            {isEditing ? (
                              <input type="number" value={editCostBasis} onChange={e => setEditCostBasis(e.target.value)} step="0.01" min="0"
                                className="w-24 bg-white border border-emerald-300 rounded-lg px-2 py-1 text-right text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500" autoFocus />
                            ) : formatMoneyPrecise(p.costBasis)}
                          </td>
                          <td className="text-right py-3.5 px-3 text-gray-700">
                            {isEditing ? (
                              <input type="number" value={editShares} onChange={e => setEditShares(e.target.value)} step="0.01" min="0"
                                className="w-24 bg-white border border-emerald-300 rounded-lg px-2 py-1 text-right text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500" />
                            ) : p.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                          </td>
                          <td className="text-right py-3.5 px-3 text-gray-900 font-medium">
                            {quotesLoaded ? formatMoneyPrecise(p.price) : <div className="h-5 w-16 rounded skeleton ml-auto" />}
                          </td>
                          <td className="text-right py-3.5 px-3">
                            {quotesLoaded ? (
                              <span className={`font-semibold ${dayIsPos ? 'text-emerald-600' : 'text-red-500'}`}>
                                {formatPct(p.dayChangePct, 1)}
                                <span className="text-xs ml-1 opacity-75">({dayIsPos ? '+' : ''}{formatMoneyPrecise(p.dailyPnl)})</span>
                              </span>
                            ) : <div className="h-5 w-28 rounded skeleton ml-auto" />}
                          </td>
                          <td className="text-right py-3.5 px-3">
                            {quotesLoaded ? (
                              <span className={`font-semibold ${pnlIsPos ? 'text-emerald-600' : 'text-red-500'}`}>
                                {formatPct(p.unrealizedPnlPct, 1)}
                                <span className="text-xs ml-1 opacity-75">({pnlIsPos ? '+' : ''}{formatMoneyPrecise(p.unrealizedPnl)})</span>
                              </span>
                            ) : <div className="h-5 w-28 rounded skeleton ml-auto" />}
                          </td>
                          <td className="text-right py-3.5 px-3">
                            <div className="flex items-center justify-end gap-0.5">
                              {isEditing ? (
                                <>
                                  <button onClick={saveEdit} className="text-emerald-500 hover:text-emerald-700 transition-colors p-1" title="Save">
                                    <Check size={14} />
                                  </button>
                                  <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 transition-colors p-1" title="Cancel">
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEdit(p)} className="text-gray-300 hover:text-emerald-500 transition-colors p-1" title="Edit">
                                    <Pencil size={14} />
                                  </button>
                                  <button onClick={() => setDeleteConfirm(p.ticker)} className="text-gray-300 hover:text-red-500 transition-colors p-1" title="Remove">
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Cash Row */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50/50">
                      <td className="py-3.5 px-3">
                        <span className="bg-gray-200 text-gray-600 font-bold text-xs px-2.5 py-1 rounded-lg">CASH</span>
                      </td>
                      <td className="text-right py-3.5 px-3 text-gray-500">
                        {quotesLoaded ? `${totalAum > 0 ? ((parseFloat(cash) || 0) / totalAum * 100).toFixed(2) : '0.00'}%` : <div className="h-5 w-12 rounded skeleton ml-auto" />}
                      </td>
                      <td className="text-right py-3.5 px-3 text-gray-900 font-semibold">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-gray-400 text-xs">$</span>
                          <input
                            type="number" value={cash} onChange={e => setCash(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveCash()} onBlur={saveCash}
                            placeholder="0.00" step="0.01" min="0"
                            className="w-28 bg-transparent text-right text-sm text-gray-900 font-semibold outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 rounded-lg px-2 py-0.5 transition-all duration-200"
                          />
                        </div>
                      </td>
                      <td className="text-right py-3.5 px-3 text-gray-400">—</td>
                      <td className="text-right py-3.5 px-3 text-gray-400">—</td>
                      <td className="text-right py-3.5 px-3 text-gray-400">—</td>
                      <td className="text-right py-3.5 px-3 text-gray-400">—</td>
                      <td className="text-right py-3.5 px-3 text-gray-400">—</td>
                      <td className="text-right py-3.5 px-3"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Add Holding Form */}
          <Card title="Add Position" className="mt-6 mb-6">
            <form onSubmit={addHolding} className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold block mb-1.5">Ticker Symbol</label>
                <input type="text" spellCheck={true} value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="e.g., AAPL" className={inputCls} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold block mb-1.5">Shares</label>
                <input type="number" value={shares} onChange={e => setShares(e.target.value)} placeholder="100" step="0.01" min="0" className={inputCls} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold block mb-1.5">Cost Basis ($)</label>
                <input type="number" value={costBasis} onChange={e => setCostBasis(e.target.value)} placeholder="150.00" step="0.01" min="0" className={inputCls} />
              </div>
              <button type="submit" className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-sm font-semibold rounded-xl hover:from-emerald-700 hover:to-emerald-600 shadow-md hover:shadow-lg hover:shadow-emerald-200/50 transition-all duration-200">
                <Plus size={14} />
                Add
              </button>
            </form>
          </Card>
        </>
      )}

      {/* ===== RISK TAB ===== */}
      {activeSubTab === 'risk' && (
        <>
          {riskLoading ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-28 rounded-2xl" />)}
              </div>
              <div className="skeleton h-72 rounded-3xl" />
            </div>
          ) : !riskData?.metrics ? (
            <Card className="text-center py-16">
              <p className="text-gray-400">{riskData?.error || 'Need at least 2 positions with price history to compute risk metrics.'}</p>
            </Card>
          ) : (() => {
            const m = riskData.metrics;
            const ra = riskData.riskAttribution;
            const stocks = ra?.stocks || [];
            const summary = ra?.summary || {};
            const factorProfile = riskData.portfolioFactorProfile || {};
            const allFactors = riskData.allFactors || [];
            const manualFactors = factorConfig?.factors || [];
            const importanceWeights = factorConfig?.importanceWeights || {};
            const overlap = riskData.overlap;

            // Factor color map
            const factorColors = { Volatility: '#6366f1', Regulatory: '#f59e0b', Disruption: '#ef4444', Valuation: '#06b6d4', 'Earnings Quality': '#10b981' };
            const getFColor = (f) => factorColors[f] || '#94a3b8';

            return (
              <>
                <p className="text-xs text-gray-400 mb-6 font-medium animate-fade-in-up">
                  Underwritten factor model · {m.daysUsed} trading days
                </p>

                {/* ── Top metric cards ── */}
                {stocks.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 animate-fade-in-up stagger-2">
                      <Card>
                        <div className="text-2xl font-bold text-gray-900">{m.observedVol != null ? `${m.observedVol}%` : '—'}</div>
                        <div className="text-xs text-gray-400 mt-1">Portfolio Volatility</div>
                      </Card>
                      <Card>
                        <div className="text-2xl font-bold text-gray-900">{m.var95Pct != null ? `${m.var95Pct}%` : '—'}</div>
                        <div className="text-xs text-gray-400 mt-1">95% VaR (Daily)</div>
                      </Card>
                      <Card>
                        <div className="text-2xl font-bold text-gray-900">{summary.top5RiskPct}%</div>
                        <div className="text-xs text-gray-400 mt-1">Top 5 Risk Contribution</div>
                      </Card>
                      <Card>
                        <div className="text-2xl font-bold text-gray-900 truncate">{summary.highestLoadFactor ?? '—'}</div>
                        <div className="text-xs text-gray-400 mt-1">Highest Factor Load <span className="text-[10px] tabular-nums">({summary.highestLoadValue?.toFixed(3)})</span></div>
                      </Card>
                    </div>

                    {/* ── Portfolio Risk Profile ── */}
                    <Card title="Portfolio Risk Profile" className="mb-6 animate-fade-in-up stagger-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                        {allFactors.map(f => {
                          const val = factorProfile[f] ?? 0;
                          const pct = Math.round(val * 100);
                          return (
                            <div key={f} className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-gray-600">{f}</span>
                                <span className="text-[12px] font-bold text-gray-900 tabular-nums">{val.toFixed(2)}</span>
                              </div>
                              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: getFColor(f) }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>

                    {/* ── Chart + Overlap side by side ── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 items-stretch animate-fade-in-up stagger-6">
                      {/* Underwritten Risk Contribution by Stock */}
                      <Card title="Composite Risk Contribution" className="flex flex-col">
                        <div className="flex-1" style={{ minHeight: Math.max(200, stocks.length * 32) }}>
                          <Bar
                            data={{
                              labels: stocks.map(s => s.ticker),
                              datasets: [
                                {
                                  label: '% Underwritten Risk',
                                  data: stocks.map(s => s.pctOfRisk),
                                  backgroundColor: stocks.map(s =>
                                    s.riskLabel === 'over contributing' ? 'rgba(239,68,68,0.7)' :
                                    s.riskLabel === 'under contributing' ? 'rgba(16,185,129,0.7)' :
                                    'rgba(59,130,246,0.7)'
                                  ),
                                  borderRadius: 4,
                                },
                                {
                                  label: 'Weight',
                                  data: stocks.map(s => s.weight),
                                  backgroundColor: 'rgba(0,0,128,0.15)',
                                  borderColor: 'rgba(0,0,128,0.3)',
                                  borderWidth: 1,
                                  borderRadius: 4,
                                },
                              ],
                            }}
                            options={{
                              indexAxis: 'y',
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                                tooltip: {
                                  backgroundColor: 'rgba(255,255,255,0.95)',
                                  titleColor: '#111827', bodyColor: '#6b7280',
                                  borderColor: '#e5e7eb', borderWidth: 1, cornerRadius: 8, padding: 10,
                                  callbacks: {
                                    afterBody: (items) => {
                                      const idx = items[0]?.dataIndex;
                                      if (idx == null) return '';
                                      const s = stocks[idx];
                                      const lines = [
                                        `Score: ${s.compositeScore?.toFixed(2) ?? '—'}`,
                                        `Vol: ${s.standaloneVol}%`,
                                        `Excess vs Wt: ${s.excessVsWeight >= 0 ? '+' : ''}${s.excessVsWeight?.toFixed(2)}%`,
                                        '',
                                      ];
                                      if (s.factorContribs) {
                                        lines.push('Factor breakdown:');
                                        Object.entries(s.factorContribs).forEach(([f, v]) => {
                                          if (v > 0.0001) lines.push(`  ${f}: ${v.toFixed(4)}`);
                                        });
                                      }
                                      return lines;
                                    },
                                    label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}%`,
                                  },
                                },
                              },
                              scales: {
                                x: { grid: { display: false }, ticks: { callback: v => `${v}%`, font: { size: 11 } } },
                                y: { grid: { display: false }, ticks: { font: { size: 11, weight: '600' } } },
                              },
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500 justify-center flex-wrap">
                          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: 'rgba(0,0,128,0.25)' }} /> Weight</span>
                          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-red-400 inline-block" /> Over contributing</span>
                          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-blue-400 inline-block" /> In line</span>
                          <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-emerald-400 inline-block" /> Under contributing</span>
                        </div>
                      </Card>

                      {/* Factor Profile Overlap (descriptive only) */}
                      {overlap && overlap.tickers?.length >= 2 && (
                        <Card title="Factor Profile Overlap" className="flex flex-col">
                          <div className="w-full flex-1 flex items-center">
                            <div className="w-full grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(${overlap.tickers.length}, 1fr)` }}>
                              <div />
                              {overlap.tickers.map(t => (
                                <div key={`h-${t}`} className="text-center text-[10px] font-bold text-gray-700 py-1 truncate">{t}</div>
                              ))}
                              {overlap.tickers.map((rowTicker, i) => (
                                <React.Fragment key={`row-${rowTicker}`}>
                                  <div className="text-[10px] font-bold text-gray-700 flex items-center justify-center truncate">{rowTicker}</div>
                                  {overlap.matrix[i].map((val, j) => {
                                    const isDiag = i === j;
                                    const absVal = Math.abs(val);
                                    let bg;
                                    if (isDiag) bg = '#e5e7eb';
                                    else if (val >= 0) bg = `rgba(16, 185, 129, ${0.1 + absVal * 0.5})`;
                                    else bg = `rgba(239, 68, 68, ${0.1 + absVal * 0.5})`;
                                    return (
                                      <div key={`${i}-${j}`} className={`flex items-center justify-center text-[10px] font-bold rounded ${isDiag ? 'text-gray-500' : val >= 0 ? 'text-emerald-800' : 'text-red-800'}`} style={{ background: bg, aspectRatio: '1', minHeight: 28 }}>
                                        {val.toFixed(2)}
                                      </div>
                                    );
                                  })}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-2 text-center">Descriptive only — does not drive risk contribution</p>
                        </Card>
                      )}
                    </div>

                    {/* ── Stock-Level Risk Attribution Table ── */}
                    <Card title="Stock-Level Risk Attribution" className="mb-6 animate-fade-in-up stagger-8">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100">
                              {['Ticker', 'Weight', 'Realized Vol', '% of Risk', 'Score', 'Status'].map(col => (
                                <th key={col} className="text-right py-3 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider first:text-left">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {stocks.map(s => (
                              <React.Fragment key={s.ticker}>
                                <tr className="hover:bg-gray-50/50 transition-colors">
                                  <td className="pt-3 pb-1 px-2 font-bold text-gray-900">{s.ticker}</td>
                                  <td className="text-right pt-3 pb-1 px-2 text-gray-600 tabular-nums">{s.weight.toFixed(2)}%</td>
                                  <td className="text-right pt-3 pb-1 px-2 text-gray-600 tabular-nums">{s.standaloneVol.toFixed(2)}%</td>
                                  <td className={`text-right pt-3 pb-1 px-2 font-semibold tabular-nums ${
                                    s.riskLabel === 'over contributing' ? 'text-red-600' :
                                    s.riskLabel === 'under contributing' ? 'text-emerald-600' :
                                    'text-blue-600'
                                  }`}>{s.pctOfRisk.toFixed(2)}%</td>
                                  <td className="text-right pt-3 pb-1 px-2 text-gray-600 tabular-nums">{s.compositeScore?.toFixed(2) ?? '—'}</td>
                                  <td className="text-right pt-3 pb-1 px-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                      s.riskLabel === 'over contributing' ? 'bg-red-50 text-red-600' :
                                      s.riskLabel === 'under contributing' ? 'bg-emerald-50 text-emerald-600' :
                                      'bg-blue-50 text-blue-600'
                                    }`}>
                                      {s.riskLabel}
                                    </span>
                                  </td>
                                </tr>
                                {/* Factor stacking row */}
                                {s.factorExposures && (() => {
                                  // piece_ik = a_k * x_ik, same basis as Score numerator
                                  const pieces = allFactors.map(f => (importanceWeights[f] ?? 0.5) * (s.factorExposures[f] ?? 0));
                                  const total = pieces.reduce((a, b) => a + b, 0);
                                  if (total < 1e-8) return null;
                                  return (
                                    <tr className="border-b border-gray-100">
                                      <td colSpan={6} className="pt-0.5 pb-2.5 px-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {allFactors.map((f, k) => {
                                            const chipPct = (pieces[k] / total) * 100;
                                            if (chipPct < 0.5) return null;
                                            return (
                                              <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-50 text-gray-600 border border-gray-100">
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getFColor(f) }} />
                                                {f} <span className="text-gray-400 tabular-nums">{Math.round(chipPct)}%</span>
                                              </span>
                                            );
                                          })}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })()}
                              </React.Fragment>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 font-bold text-gray-900">
                              <td className="py-3 px-2">Total</td>
                              <td className="text-right py-3 px-2 tabular-nums">100.00%</td>
                              <td className="text-right py-3 px-2" />
                              <td className="text-right py-3 px-2 tabular-nums">100.00%</td>
                              <td className="text-right py-3 px-2" />
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </Card>

                    {/* ── Factor Model Configuration ── */}
                    <Card title="Factor Model Configuration" className="mb-6 animate-fade-in-up stagger-10">
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Factors & Importance Weights</h3>
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 bg-gray-50/80 rounded-xl px-3 py-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#6366f1' }} />
                              <span className="text-sm font-semibold text-gray-700 flex-1">Volatility <span className="text-[10px] text-indigo-500 font-medium ml-1">auto</span></span>
                              <input
                                type="number" step="0.1" min="0" max="1"
                                className="w-16 text-sm text-center bg-white border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-400 tabular-nums"
                                value={editingWeights['Volatility'] ?? importanceWeights['Volatility'] ?? 0.9}
                                onChange={e => setEditingWeights(p => ({ ...p, Volatility: e.target.value }))}
                                onBlur={e => { saveImportanceWeight('Volatility', e.target.value); setEditingWeights(p => { const n = { ...p }; delete n['Volatility']; return n; }); }}
                              />
                            </div>
                            {manualFactors.map(f => (
                              <div key={f} className="flex items-center gap-3 bg-gray-50/80 rounded-xl px-3 py-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getFColor(f) }} />
                                <span className="text-sm font-semibold text-gray-700 flex-1">{f}</span>
                                <input
                                  type="number" step="0.1" min="0" max="1"
                                  className="w-16 text-sm text-center bg-white border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-emerald-400 tabular-nums"
                                  value={editingWeights[f] ?? importanceWeights[f] ?? 0.5}
                                  onChange={e => setEditingWeights(p => ({ ...p, [f]: e.target.value }))}
                                  onBlur={e => { saveImportanceWeight(f, e.target.value); setEditingWeights(p => { const n = { ...p }; delete n[f]; return n; }); }}
                                />
                                <button onClick={() => removeFactor(f)} className="text-gray-300 hover:text-red-500 transition-colors p-1" title="Remove factor">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <form className="flex items-center gap-2 mt-3" onSubmit={e => { e.preventDefault(); addFactor(newFactorName); }}>
                            <input
                              type="text" spellCheck={true} value={newFactorName} onChange={e => setNewFactorName(e.target.value)}
                              placeholder="Add new factor..."
                              className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-1 focus:ring-emerald-400"
                            />
                            <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded-xl transition-colors">
                              <Plus size={14} />
                            </button>
                          </form>
                        </div>

                        {manualFactors.length > 0 && (
                          <div>
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Stock Factor Exposures (0–1)</h3>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Ticker</th>
                                    {manualFactors.map(f => (
                                      <th key={f} className="text-center py-2 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider">{f}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {stocks.map(s => (
                                    <tr key={s.ticker} className="border-b border-gray-50">
                                      <td className="py-2 px-2 font-bold text-gray-900">{s.ticker}</td>
                                      {manualFactors.map(f => {
                                        const key = `${s.ticker}_${f}`;
                                        const currentVal = factorConfig?.exposures?.[s.ticker]?.[f] ?? 0;
                                        return (
                                          <td key={f} className="text-center py-2 px-2">
                                            <input
                                              type="number" step="0.05" min="0" max="1"
                                              className="w-16 text-sm text-center bg-gray-50 border border-gray-200 rounded-lg px-1 py-1 outline-none focus:ring-1 focus:ring-emerald-400 tabular-nums"
                                              value={editingFactorExposures[key] ?? currentVal}
                                              onChange={e => setEditingFactorExposures(p => ({ ...p, [key]: e.target.value }))}
                                              onBlur={e => {
                                                saveExposure(s.ticker, f, e.target.value);
                                                setEditingFactorExposures(p => { const n = { ...p }; delete n[key]; return n; });
                                              }}
                                            />
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => { setRiskData(null); loadRisk(portfolio.holdings); }}
                            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
                          >
                            <RefreshCw size={14} /> Recalculate Risk
                          </button>
                        </div>
                      </div>
                    </Card>
                  </>
                )}

              </>
            );
          })()}
        </>
      )}

      {/* ===== FACTORS TAB ===== */}
      {activeSubTab === 'factors' && (
        <>
          {fundamentalsLoading || !quotesLoaded ? (
            <div className="space-y-6">
              <div className="skeleton h-52 rounded-3xl" />
              <div className="skeleton h-72 rounded-3xl" />
            </div>
          ) : !fundamentalsData ? (
            <Card className="text-center py-16">
              <p className="text-gray-400">No fundamental data available.</p>
            </Card>
          ) : (
            <>
              {(() => {
                  const sectors = {};
                  positions.forEach(p => {
                    const f = fundamentalsData[p.ticker];
                    const sector = f?.sector || 'Unknown';
                    if (!sectors[sector]) sectors[sector] = { weight: 0, value: 0, count: 0 };
                    const w = totalAum > 0 ? (p.value / totalAum) * 100 : 0;
                    sectors[sector].weight += w;
                    sectors[sector].value += p.value;
                    sectors[sector].count += 1;
                  });
                  const sorted = Object.entries(sectors).sort((a, b) => b[1].weight - a[1].weight);

                  const sectorColors = {
                    'Technology': '#10b981', 'Communication Services': '#06b6d4',
                    'Consumer Cyclical': '#f59e0b', 'Financial Services': '#059669',
                    'Healthcare': '#ef4444', 'Consumer Defensive': '#0891b2',
                    'Industrials': '#8b5cf6', 'Energy': '#f97316',
                    'Basic Materials': '#84cc16', 'Real Estate': '#ec4899',
                    'Utilities': '#14b8a6', 'Commodities': '#d97706',
                    'Fixed Income': '#64748b', 'Broad Market': '#0ea5e9',
                    'ETF': '#a855f7', 'Fund': '#a855f7',
                    'Unknown': '#9ca3af',
                  };

                  const labels = sorted.map(([s]) => getSectorLabel(s));
                  const weights = sorted.map(([, d]) => d.weight);
                  const colors = sorted.map(([s]) => getSectorColor(s, sectorColors[s] || '#10b981'));

                  const chartData = {
                    labels,
                    datasets: [{
                      data: weights,
                      backgroundColor: colors,
                      borderColor: '#fff',
                      borderWidth: 2,
                      hoverBorderWidth: 3,
                      hoverOffset: 6,
                    }],
                  };

                  const chartOptions = {
                    cutout: '62%',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        titleColor: '#111827',
                        bodyColor: '#6b7280',
                        borderColor: '#e5e7eb',
                        borderWidth: 1,
                        cornerRadius: 12,
                        padding: 12,
                        titleFont: { weight: '700', size: 13 },
                        bodyFont: { size: 12 },
                        callbacks: {
                          label: (ctx) => {
                            const d = sorted[ctx.dataIndex][1];
                            return ` ${ctx.parsed.toFixed(1)}%  ·  ${formatMoney(d.value)}  ·  ${d.count} pos`;
                          },
                        },
                      },
                    },
                  };

                  // Concentration metrics
                  const sortedPositions = [...positions].sort((a, b) => b.value - a.value);
                  const top5Value = sortedPositions.slice(0, 5).reduce((s, p) => s + p.value, 0);
                  const top5Pct = totalAum > 0 ? (top5Value / totalAum) * 100 : 0;
                  const largestPct = totalAum > 0 && sortedPositions.length > 0 ? (sortedPositions[0].value / totalAum) * 100 : 0;
                  const portfolioCorr = riskData?.metrics?.portfolioCorrelation ?? null;

                  // Sector performance (avg day change by sector)
                  const sectorPerf = {};
                  positions.forEach(p => {
                    const f = fundamentalsData[p.ticker];
                    const sector = f?.sector || 'Unknown';
                    if (!sectorPerf[sector]) sectorPerf[sector] = { totalDayChange: 0, totalWeight: 0 };
                    const w = totalAum > 0 ? (p.value / totalAum) * 100 : 0;
                    sectorPerf[sector].totalDayChange += p.dayChangePct * w;
                    sectorPerf[sector].totalWeight += w;
                  });
                  const sectorPerfSorted = Object.entries(sectorPerf)
                    .map(([s, d]) => ({ sector: s, avgChange: d.totalWeight > 0 ? d.totalDayChange / d.totalWeight : 0, weight: d.totalWeight }))
                    .sort((a, b) => b.avgChange - a.avgChange);
                  const maxAbsChange = Math.max(...sectorPerfSorted.map(s => Math.abs(s.avgChange)), 0.01);

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 animate-fade-in-up stagger-2">
                      {/* Sector Exposure */}
                      <Card title="Sector Exposure">
                        {sorted.length === 0 ? (
                          <p className="text-gray-400 text-sm text-center py-6">No sector data</p>
                        ) : (
                          <div className="flex flex-col items-center gap-6">
                            <div className="w-[200px] h-[200px] shrink-0">
                              <Doughnut data={chartData} options={chartOptions} />
                            </div>
                            <div className="w-full space-y-1">
                              {sorted.map(([sector, data]) => {
                                const displayName = getSectorLabel(sector);
                                const isEditing = editingSector === sector;

                                const currentColor = getSectorColor(sector, sectorColors[sector] || '#10b981');
                                const PALETTE = ['#10b981','#06b6d4','#f59e0b','#059669','#ef4444','#0891b2','#8b5cf6','#f97316','#84cc16','#ec4899','#14b8a6','#3b82f6','#e11d48','#a855f7','#64748b'];

                                return (
                                  <div key={sector} className="relative flex items-center gap-2 group">
                                    <span
                                      className="w-3 h-3 rounded-full shrink-0 cursor-pointer ring-2 ring-transparent hover:ring-gray-300 transition-all"
                                      style={{ backgroundColor: currentColor }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (colorPickSector === sector) {
                                          setColorPickSector(null);
                                        } else {
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setColorPickPos({ top: rect.bottom + 4, left: rect.left });
                                          setColorPickSector(sector);
                                        }
                                      }}
                                      title="Click to change color"
                                    />
                                    {colorPickSector === sector && createPortal(
                                      <div ref={colorPickRef} className="fixed z-[9999] bg-white border border-gray-200 rounded-xl shadow-lg p-2 flex flex-wrap gap-1.5 w-[160px]" style={{ top: colorPickPos.top, left: colorPickPos.left }}>
                                        {PALETTE.map(c => (
                                          <button
                                            key={c}
                                            className={`w-5 h-5 rounded-full transition-all hover:scale-125 ${c === currentColor ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                                            style={{ backgroundColor: c }}
                                            onClick={(e) => { e.stopPropagation(); saveSectorColor(sector, c); }}
                                          />
                                        ))}
                                      </div>,
                                      document.body
                                    )}
                                    {isEditing ? (
                                      <form
                                        className="flex items-center gap-1 flex-1 min-w-0"
                                        onSubmit={(e) => { e.preventDefault(); saveSectorLabel(sector, editValue); }}
                                      >
                                        <input
                                          ref={editInputRef}
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          className="flex-1 min-w-0 text-[13px] text-gray-900 bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                                          autoFocus
                                        />
                                        <button type="submit" className="text-emerald-500 hover:text-emerald-700 p-0.5"><Check size={12} /></button>
                                        <button type="button" onClick={() => setEditingSector(null)} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={12} /></button>
                                      </form>
                                    ) : (
                                      <span
                                        className="text-[13px] text-gray-600 flex-1 truncate cursor-pointer hover:text-gray-900 transition-colors"
                                        onClick={() => { setEditingSector(sector); setEditValue(displayName); }}
                                        title="Click to rename"
                                      >
                                        {displayName}
                                        <Pencil size={10} className="inline ml-1 opacity-0 group-hover:opacity-40 transition-opacity" />
                                      </span>
                                    )}
                                    <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{data.weight.toFixed(1)}%</span>
                                    <span className="text-[11px] text-gray-400 tabular-nums w-[72px] text-right">{formatMoney(data.value)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </Card>

                      {/* Concentration + Sector Performance */}
                      <div className="flex flex-col gap-6">
                        <Card title="Concentration">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-gray-50/80 rounded-xl p-3">
                              <div className="text-lg font-bold text-gray-900 tabular-nums">{largestPct.toFixed(1)}%</div>
                              <div className="text-[11px] text-gray-400 mt-0.5">Largest Position</div>
                            </div>
                            <div className="bg-gray-50/80 rounded-xl p-3">
                              <div className="text-lg font-bold text-gray-900 tabular-nums">{top5Pct.toFixed(1)}%</div>
                              <div className="text-[11px] text-gray-400 mt-0.5">Top 5 Weight</div>
                            </div>
                            <div className="bg-gray-50/80 rounded-xl p-3">
                              <div className={`text-lg font-bold tabular-nums ${portfolioCorr === null ? 'text-gray-400' : portfolioCorr >= 0.5 ? 'text-red-500' : portfolioCorr >= 0.3 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                {portfolioCorr !== null ? portfolioCorr.toFixed(2) : '—'}
                              </div>
                              <div className="text-[11px] text-gray-400 mt-0.5">Portfolio Corr</div>
                            </div>
                          </div>
                        </Card>

                        <Card title="Sector Performance Today" className="flex-1">
                          <div className="space-y-2.5">
                            {sectorPerfSorted.map(({ sector, avgChange }) => (
                              <div key={sector} className="flex items-center gap-2">
                                <span className="text-[12px] text-gray-500 w-[130px] truncate">{getSectorLabel(sector)}</span>
                                <div className="flex-1 h-5 flex items-center">
                                  <div className="w-full relative h-[6px] rounded-full bg-gray-100">
                                    {avgChange >= 0 ? (
                                      <div
                                        className="absolute left-1/2 h-full rounded-full bg-emerald-400"
                                        style={{ width: `${(avgChange / maxAbsChange) * 50}%` }}
                                      />
                                    ) : (
                                      <div
                                        className="absolute right-1/2 h-full rounded-full bg-red-400"
                                        style={{ width: `${(Math.abs(avgChange) / maxAbsChange) * 50}%` }}
                                      />
                                    )}
                                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-300" />
                                  </div>
                                </div>
                                <span className={`text-[12px] font-semibold tabular-nums w-[50px] text-right ${avgChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {avgChange >= 0 ? '+' : ''}{avgChange.toFixed(2)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </Card>
                      </div>
                    </div>
                  );
                })()}

              {/* Position Fundamentals Table */}
              <div className="animate-fade-in-up stagger-6">
              <Card
                title="Position Fundamentals"
                actions={
                  <input type="text" spellCheck={true} value={fundamentalsSearch} onChange={e => setFundamentalsSearch(e.target.value)}
                    placeholder="Search symbol or sector..."
                    className="w-56 bg-gray-50/50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                  />
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Symbol', 'Sector', 'Industry', 'Mkt Value', 'Mkt Cap', 'P/E', 'Fwd P/E', 'P/S', 'EV/EBITDA', 'EV/REV', 'Beta'].map((col, i) => (
                          <th key={col} className={`py-3 px-2 text-[0.65rem] text-gray-400 uppercase tracking-wider font-semibold whitespace-nowrap ${i < 3 ? 'text-left' : 'text-center'}`}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...positions]
                        .sort((a, b) => b.value - a.value)
                        .filter(p => {
                          if (!fundamentalsSearch) return true;
                          const q = fundamentalsSearch.toLowerCase();
                          const f = fundamentalsData[p.ticker];
                          return p.ticker.toLowerCase().includes(q) || getSectorLabel(f?.sector || '').toLowerCase().includes(q) || (f?.industry || '').toLowerCase().includes(q);
                        })
                        .map(p => {
                          const f = fundamentalsData[p.ticker] || {};
                          const fmtVal = (v) => {
                            if (v == null) return '—';
                            if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
                            if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
                            if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
                            return Number(v).toFixed(2);
                          };
                          return (
                            <tr key={p.ticker} className="border-b border-gray-50 hover:bg-white hover:shadow-[0_2px_16px_rgba(0,0,0,0.08)] hover:border-transparent relative hover:z-10 transition-all duration-200 cursor-default">
                              <td className="py-3 px-2"><span className="bg-emerald-50 text-emerald-700 font-bold text-xs px-2 py-0.5 rounded-lg">{p.ticker}</span></td>
                              <td className="text-left py-3 px-2 text-gray-500 text-xs">{f.sector ? getSectorLabel(f.sector) : '—'}</td>
                              <td className="text-left py-3 px-2 text-gray-500 text-xs whitespace-nowrap">{f.industry || '—'}</td>
                              <td className="text-center py-3 px-2 text-gray-900 font-medium">{formatMoney(p.value)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.marketCap)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.pe)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.forwardPe)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.ps)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.evEbitda)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.evRevenue)}</td>
                              <td className="text-center py-3 px-2 text-gray-700">{fmtVal(f.beta)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </Card>
              </div>
            </>
          )}
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-gray-900 font-semibold text-base">Remove Position</h3>
                <p className="text-gray-500 text-sm">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-6">
              Are you sure you want to remove <span className="font-semibold text-gray-900">{deleteConfirm}</span> from your portfolio?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => removeHolding(deleteConfirm)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-sm hover:shadow-md transition-all"
              >
                Remove
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
