'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import { Settings, Target, Zap, X, SlidersHorizontal, RotateCcw, RefreshCw, Loader2, ArrowRight } from 'lucide-react';
import {
  DEFAULT_RISK_FACTOR_WEIGHTS,
  RISK_FACTORS,
  buildRebalancePlanFromRows,
  calculateVolatilityScores,
  calculateRebalanceTaxBreakdown,
  createAllocationRow,
  createAllocationScheme,
  createDefaultAllocations,
  createDefaultRebalanceHoldings,
  createRebalanceRow,
  createRebalanceTaxInputs,
  formatCurrency,
  parseNumber,
  runAllocationSimulation,
  schemeEffectiveWeights,
  updateRebalanceTaxInputValue,
} from '@/lib/allocationEngine';
import ConfidenceTab from './ConfidenceTab';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const riskFactors = RISK_FACTORS;
const defaultRiskFactorWeights = DEFAULT_RISK_FACTOR_WEIGHTS;

export default function AllocationPage() {
  const [allocations, setAllocations] = useState(createDefaultAllocations);
  const [riskFactorWeights, setRiskFactorWeights] = useState(defaultRiskFactorWeights);
  const [riskFreeRate, setRiskFreeRate] = useState('4');
  const [minWeight, setMinWeight] = useState('3');
  const [maxWeight, setMaxWeight] = useState('15');
  const [cashMinWeight, setCashMinWeight] = useState('1');
  const [cashMaxWeight, setCashMaxWeight] = useState('5');
  const [numPortfolios, setNumPortfolios] = useState('100000');
  const [covLambda, setCovLambda] = useState('0.3');
  const [simulationError, setSimulationError] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationChart, setSimulationChart] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('optimizer');
  const [rbHoldings, setRbHoldings] = useState([]);
  const [rbCash, setRbCash] = useState('');
  const [rbTargetCashPercent, setRbTargetCashPercent] = useState('0');
  const [rbTransactionCostPct] = useState('0');
  const [rbPlan, setRbPlan] = useState(null);
  const [rbError, setRbError] = useState('');
  const [rbTaxInputs, setRbTaxInputs] = useState({});
  const [rbLoadingPortfolio, setRbLoadingPortfolio] = useState(false);
  const [syncingWeights, setSyncingWeights] = useState(false);
  // Shared allocation scheme — the spine that flows Optimizer → Confidence → Rebalancer.
  const [scheme, setScheme] = useState(null);
  const [schemeError, setSchemeError] = useState('');
  const rbCostBasisRef = useRef({});
  const rbSavedTargetsRef = useRef(null);
  const saveTimer = useRef(null);
  const tableRef = useRef(null);
  const rbTableRef = useRef(null);

  // --- Auto-computed Vol Scores from realized volatility ---
  const [volScoresLoading, setVolScoresLoading] = useState({});  // { ticker: true }
  const volFetchTimer = useRef(null);
  const lastVolTickers = useRef('');

  // Derive a stable ticker-list string to avoid re-triggering on unrelated allocation changes
  const allocTickerKey = useMemo(() => {
    return allocations
      .map(r => r.ticker.trim().toUpperCase())
      .filter(t => t && t !== 'CASH')
      .sort()
      .join(',');
  }, [allocations]);

  useEffect(() => {
    if (!loaded || !allocTickerKey || allocTickerKey === lastVolTickers.current) return;

    if (volFetchTimer.current) clearTimeout(volFetchTimer.current);
    volFetchTimer.current = setTimeout(async () => {
      const tickers = allocTickerKey.split(',');
      lastVolTickers.current = allocTickerKey;
      // Mark all tickers as loading
      const loadingMap = {};
      tickers.forEach(t => { loadingMap[t] = true; });
      setVolScoresLoading(loadingMap);

      try {
        const res = await fetch(`/api/realized-vol?tickers=${tickers.join(',')}&days=252`);
        const { vols } = await res.json();
        if (!vols || Object.keys(vols).length === 0) {
          setVolScoresLoading({});
          return;
        }

        const scores = calculateVolatilityScores(vols);

        setAllocations(prev => prev.map(row => {
          const t = row.ticker.trim().toUpperCase();
          if (t === 'CASH' || scores[t] === undefined) return row;
          const exposures = [...row.factorExposures];
          exposures[0] = scores[t].toFixed(2);
          return { ...row, factorExposures: exposures };
        }));
      } catch (err) {
        console.error('Failed to compute vol scores:', err);
      } finally {
        setVolScoresLoading({});
      }
    }, 1000); // debounce 1s

    return () => { if (volFetchTimer.current) clearTimeout(volFetchTimer.current); };
  }, [loaded, allocTickerKey]);

  const handleColumnTab = (e, colName, rowIdx) => {
    if (e.key !== 'Tab') return;
    const nextIdx = e.shiftKey ? rowIdx - 1 : rowIdx + 1;
    if (nextIdx < 0 || nextIdx >= allocations.length) return;
    e.preventDefault();
    const next = tableRef.current?.querySelector(`[data-col="${colName}"][data-row="${nextIdx}"]`);
    if (next) next.focus();
  };

  const handleRbColumnTab = (e, colName, rowIdx) => {
    if (e.key !== 'Tab') return;
    const nextIdx = e.shiftKey ? rowIdx - 1 : rowIdx + 1;
    if (nextIdx < 0 || nextIdx >= rbHoldings.length) return;
    e.preventDefault();
    const next = rbTableRef.current?.querySelector(`[data-col="${colName}"][data-row="${nextIdx}"]`);
    if (next) next.focus();
  };

  // Load saved config on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/allocation');
        const { config } = await res.json();
        if (config) {
          if (config.allocations) setAllocations(config.allocations);
          if (config.riskFactorWeights) setRiskFactorWeights(config.riskFactorWeights);
          if (config.riskFreeRate !== undefined) setRiskFreeRate(config.riskFreeRate);
          if (config.minWeight !== undefined) setMinWeight(config.minWeight);
          if (config.maxWeight !== undefined) setMaxWeight(config.maxWeight);
          if (config.cashMinWeight !== undefined) setCashMinWeight(config.cashMinWeight);
          if (config.cashMaxWeight !== undefined) setCashMaxWeight(config.cashMaxWeight);
          if (config.numPortfolios !== undefined) setNumPortfolios(config.numPortfolios);
          if (config.covLambda !== undefined) setCovLambda(config.covLambda);
          if (config.rbTargetWeights) rbSavedTargetsRef.current = config.rbTargetWeights;
          if (config.rbTargetCashPercent !== undefined) setRbTargetCashPercent(config.rbTargetCashPercent);
          // Re-open the in-progress scheme so a refresh mid-workflow doesn't lose it.
          if (config.activeSchemeId) {
            try {
              const { schemes } = await fetch('/api/allocation/schemes').then((r) => r.json());
              const found = (schemes || []).find((s) => s.id === config.activeSchemeId);
              if (found) setScheme(found);
            } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        console.error('Failed to load allocation config:', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Load portfolio holdings into rebalancer
  const loadPortfolioIntoRebalancer = useCallback(async () => {
    setRbLoadingPortfolio(true);
    setRbPlan(null);
    setRbError('');
    try {
      const portfolioRes = await fetch('/api/portfolio');
      const portfolio = await portfolioRes.json();
      const holdings = portfolio.holdings || [];
      const cashVal = portfolio.cash || 0;

      if (holdings.length === 0) {
        setRbHoldings(createDefaultRebalanceHoldings());
        setRbCash('');
        return;
      }

      const tickers = holdings.map((h) => h.ticker).join(',');
      const quotesRes = await fetch(`/api/quotes?tickers=${tickers}`);
      const quotesData = await quotesRes.json();
      const quotes = quotesData.quotes || quotesData;

      const costBasisMap = {};
      const savedTargets = rbSavedTargetsRef.current;
      const rows = holdings.map((h) => {
        const quote = quotes[h.ticker];
        const price = quote?.price || 0;
        const value = h.shares * price;
        costBasisMap[h.ticker] = h.shares * (h.cost_basis || 0);
        return createRebalanceRow({
          ticker: h.ticker,
          currentValue: value > 0 ? value.toFixed(2) : '',
          targetWeight: savedTargets?.[h.ticker] ?? '',
        });
      });

      rbCostBasisRef.current = costBasisMap;
      setRbHoldings(rows);
      setRbCash(cashVal > 0 ? cashVal.toFixed(2) : '');
    } catch (err) {
      console.error('Failed to load portfolio for rebalancer:', err);
      setRbHoldings(createDefaultRebalanceHoldings());
      setRbCash('');
    } finally {
      setRbLoadingPortfolio(false);
    }
  }, []);

  // Reset button behaviour: the CURRENT VALUES (left side) snap back to what the
  // portfolio actually holds right now, while the TARGET WEIGHTS (right side) reset
  // to the active scheme's weights — not whatever targets happen to be saved from
  // the portfolio. Falls back to the saved targets only when there's no scheme.
  const resetRebalancerToScheme = useCallback(async () => {
    setRbLoadingPortfolio(true);
    setRbPlan(null);
    setRbError('');
    try {
      const eff = scheme ? schemeEffectiveWeights(scheme) : {};
      const hasScheme = Object.keys(eff).length > 0;
      const targetFor = (ticker) => {
        const t = (ticker || '').trim().toUpperCase();
        if (hasScheme) return eff[t] != null ? String(eff[t]) : '';
        return rbSavedTargetsRef.current?.[ticker] ?? '';
      };

      const portfolio = await fetch('/api/portfolio').then((r) => r.json());
      const holdings = portfolio.holdings || [];
      const cashVal = portfolio.cash || 0;

      // Seed rows from current holdings (values from the portfolio) with scheme targets.
      let rows = [];
      const costBasisMap = {};
      if (holdings.length > 0) {
        const tickers = holdings.map((h) => h.ticker).join(',');
        const quotesData = await fetch(`/api/quotes?tickers=${tickers}`).then((r) => r.json());
        const quotes = quotesData.quotes || quotesData;
        rows = holdings.map((h) => {
          const price = quotes[h.ticker]?.price || 0;
          const value = h.shares * price;
          costBasisMap[h.ticker] = h.shares * (h.cost_basis || 0);
          return createRebalanceRow({
            ticker: h.ticker,
            currentValue: value > 0 ? value.toFixed(2) : '',
            targetWeight: targetFor(h.ticker),
          });
        });
      }

      // Scheme names you don't currently hold → add as buy-from-zero rows.
      if (hasScheme) {
        const present = new Set(rows.map((r) => r.ticker.trim().toUpperCase()));
        const extras = Object.keys(eff)
          .filter((t) => t !== 'CASH' && !present.has(t) && (Number(eff[t]) || 0) > 0)
          .map((t) => createRebalanceRow({ ticker: t, currentValue: '', targetWeight: String(eff[t]) }));
        rows = [...rows, ...extras];
        if (eff.CASH != null) setRbTargetCashPercent(String(eff.CASH));
      }

      rbCostBasisRef.current = costBasisMap;
      setRbHoldings(rows.length ? rows : createDefaultRebalanceHoldings());
      setRbCash(cashVal > 0 ? cashVal.toFixed(2) : '');
    } catch (err) {
      console.error('Failed to reset rebalancer to scheme:', err);
    } finally {
      setRbLoadingPortfolio(false);
    }
  }, [scheme]);

  // Load portfolio into rebalancer on mount
  useEffect(() => {
    loadPortfolioIntoRebalancer();
  }, [loadPortfolioIntoRebalancer]);

  // --- Scheme workflow ---
  // Optimizer → save the typed weights as a scheme and move to Market Confidence.
  const handleSaveSchemeAndContinue = async () => {
    setSchemeError('');
    const newScheme = createAllocationScheme(allocations);
    const totalW = Object.values(newScheme.baseWeights).reduce((s, v) => s + (Number(v) || 0), 0);
    if (totalW <= 0) {
      setSchemeError('Enter target weights in the Weight column before saving a scheme.');
      return;
    }
    setScheme(newScheme);
    setActiveSubTab('confidence');
    try {
      await fetch('/api/allocation/schemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheme: newScheme }),
      });
    } catch (err) {
      console.error('Failed to save allocation scheme:', err);
    }
  };

  // Confidence → persist the regime-adjusted weights onto the scheme and move to Rebalancer.
  const handleConfidenceSaveContinue = async ({ baseWeights, adjustedWeights, regimeScore }) => {
    const updated = { ...scheme, baseWeights, adjustedWeights, regimeScore, stage: 'rebalancer' };
    setScheme(updated);
    setActiveSubTab('rebalancer');
    try {
      await fetch('/api/allocation/schemes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheme: updated }),
      });
    } catch (err) {
      console.error('Failed to update allocation scheme:', err);
    }
  };

  // Clear the active scheme and start over. Non-destructive: any saved snapshot stays
  // in the Strategic Hub history (delete those from the card there).
  const handleClearScheme = () => {
    setScheme(null);
    setSchemeError('');
    setActiveSubTab('optimizer');
  };

  // Overlay the active scheme's target weights onto the rebalancer rows (and add any
  // scheme-only tickers you don't yet hold, so they can be bought from zero).
  useEffect(() => {
    if (!scheme) return;
    const eff = schemeEffectiveWeights(scheme);
    setRbHoldings((prev) => {
      const rows = prev.map((row) => {
        const t = row.ticker.trim().toUpperCase();
        return eff[t] != null ? { ...row, targetWeight: String(eff[t]) } : row;
      });
      const present = new Set(rows.map((r) => r.ticker.trim().toUpperCase()));
      const extras = Object.keys(eff)
        .filter((t) => t !== 'CASH' && !present.has(t) && (Number(eff[t]) || 0) > 0)
        .map((t) => createRebalanceRow({ ticker: t, currentValue: '', targetWeight: String(eff[t]) }));
      return extras.length ? [...rows, ...extras] : rows;
    });
    if (eff.CASH != null) setRbTargetCashPercent(String(eff.CASH));
  }, [scheme]);

  // Auto-save with debounce whenever config changes
  const saveConfig = useCallback((config) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch('/api/allocation', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config }),
        });
      } catch (err) {
        console.error('Failed to save allocation config:', err);
      }
    }, 800);
  }, []);

  const rbTargetWeightsMap = useMemo(() => {
    const map = {};
    rbHoldings.forEach((row) => {
      const ticker = row.ticker.trim();
      if (ticker && row.targetWeight !== '') map[ticker] = row.targetWeight;
    });
    return map;
  }, [rbHoldings]);

  useEffect(() => {
    if (!loaded) return;
    saveConfig({
      allocations,
      riskFactorWeights,
      riskFreeRate,
      minWeight,
      maxWeight,
      cashMinWeight,
      cashMaxWeight,
      numPortfolios,
      covLambda,
      rbTargetWeights: rbTargetWeightsMap,
      rbTargetCashPercent,
      activeSchemeId: scheme?.id ?? null,
    });
  }, [loaded, allocations, riskFactorWeights, riskFreeRate, minWeight, maxWeight, cashMinWeight, cashMaxWeight, numPortfolios, covLambda, rbTargetWeightsMap, rbTargetCashPercent, scheme?.id, saveConfig]);

  const simulationChartOptions = useMemo(
    () => ({
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (context) => context.raw?.hoverLines || '',
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Composite Risk (0 to 1)' },
          min: 0,
          max: 1,
        },
        y: {
          title: { display: true, text: 'Expected Return' },
          ticks: {
            callback: (value) => `${(Number(value) * 100).toFixed(0)}%`,
          },
        },
      },
    }),
    []
  );

  const updateAllocation = (id, field, value) => {
    setAllocations((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const updateAllocationExposure = (id, index, value) => {
    setAllocations((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const exposures = [...row.factorExposures];
        exposures[index] = value;
        return { ...row, factorExposures: exposures };
      })
    );
  };

  const updateRiskFactorWeight = (index, value) => {
    setRiskFactorWeights((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const addAllocation = () => {
    setAllocations((prev) => [...prev, createAllocationRow()]);
  };

  const removeAllocation = (id) => {
    setAllocations((prev) => prev.filter((row) => row.id !== id));
  };

  const syncWeightsFromPortfolio = async () => {
    setSyncingWeights(true);
    try {
      const portfolioRes = await fetch('/api/portfolio');
      const portfolio = await portfolioRes.json();
      const holdings = portfolio.holdings || [];
      const cashVal = portfolio.cash || 0;

      if (holdings.length === 0) { setSyncingWeights(false); return; }

      const tickers = holdings.map(h => h.ticker).join(',');
      const quotesRes = await fetch(`/api/quotes?tickers=${tickers}`);
      const quotesData = await quotesRes.json();
      const quotes = quotesData.quotes || quotesData;

      // Compute current value per holding
      const values = {};
      let totalAum = cashVal;
      for (const h of holdings) {
        const price = quotes[h.ticker]?.price || h.cost_basis || 0;
        const val = h.shares * price;
        values[h.ticker] = val;
        totalAum += val;
      }

      if (totalAum <= 0) { setSyncingWeights(false); return; }

      // Compute weights and set on matching allocation rows
      const weightMap = {};
      for (const [ticker, val] of Object.entries(values)) {
        weightMap[ticker] = ((val / totalAum) * 100).toFixed(2);
      }
      // CASH weight from actual cash balance
      weightMap.CASH = ((cashVal / totalAum) * 100).toFixed(2);

      setAllocations(prev => prev.map(row => {
        const ticker = row.ticker.trim().toUpperCase();
        if (ticker && weightMap[ticker] !== undefined) {
          return { ...row, userWeight: weightMap[ticker] };
        }
        return row;
      }));
    } catch (err) {
      console.error('Failed to sync weights from portfolio:', err);
    }
    setSyncingWeights(false);
  };

  // --- Rebalancer functions ---
  const rbAumValue = rbPlan?.startingTotal || 0;

  const rbTaxBreakdown = useMemo(() => {
    return calculateRebalanceTaxBreakdown(rbPlan, rbTaxInputs);
  }, [rbPlan, rbTaxInputs]);

  const rbTaxOwedPctOfAum = rbAumValue ? (rbTaxBreakdown.totalTax / rbAumValue) * 100 : 0;

  const rbTotalTargetPercent = useMemo(() => {
    const holdingsTotal = rbHoldings.reduce((sum, row) => sum + parseNumber(row.targetWeight), 0);
    return holdingsTotal + parseNumber(rbTargetCashPercent);
  }, [rbHoldings, rbTargetCashPercent]);

  // Current allocation (taken from holdings) so you can see current-vs-target per row.
  const rbCurrentAum = useMemo(() => {
    const held = rbHoldings.reduce((sum, row) => sum + parseNumber(row.currentValue), 0);
    return held + parseNumber(rbCash);
  }, [rbHoldings, rbCash]);

  useEffect(() => {
    if (!rbPlan) { setRbTaxInputs({}); return; }
    setRbTaxInputs((prev) => {
      return createRebalanceTaxInputs(rbPlan, prev, rbCostBasisRef.current);
    });
  }, [rbPlan]);

  const updateRbTaxInput = (ticker, field, value) => {
    setRbTaxInputs((prev) => updateRebalanceTaxInputValue(prev, ticker, field, value));
  };

  const updateRbHolding = (id, field, value) => {
    setRbHoldings((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const removeRbHolding = (id) => {
    setRbHoldings((prev) => prev.filter((row) => row.id !== id));
  };

  const addRbHolding = () => {
    setRbHoldings((prev) => [...prev, createRebalanceRow()]);
  };

  const handleGenerateRbPlan = () => {
    setRbError('');
    setRbPlan(null);
    const { error, plan } = buildRebalancePlanFromRows({
      holdings: rbHoldings,
      cash: rbCash,
      targetCashPercent: rbTargetCashPercent,
      transactionCostPct: rbTransactionCostPct,
      totalTargetPercent: rbTotalTargetPercent,
    });
    if (error) { setRbError(error); return; }
    setRbPlan(plan);
  };

  const runMonteCarloSimulation = () => {
    setSimulationError('');
    setSimulationResult(null);
    setSimulationChart(null);
    setSimulating(true);
    // Defer heavy work so the loading state renders first
    setTimeout(() => _runSimulation(), 50);
  };

  const _runSimulation = async () => {
    const fetchReturnCovariance = async (tickers) => {
      const covRes = await fetch(`/api/return-covariance?tickers=${tickers.join(',')}&days=252`);
      return covRes.json();
    };

    const { error, result, chartData } = await runAllocationSimulation({
      allocations,
      riskFactorWeights,
      riskFreeRate,
      minWeight,
      maxWeight,
      cashMinWeight,
      cashMaxWeight,
      numPortfolios,
      covLambda,
      fetchReturnCovariance,
    });

    if (error) {
      setSimulationError(error);
      setSimulating(false);
      return;
    }

    setSimulationChart(chartData);
    setSimulationResult(result);
    setSimulating(false);
  };

  if (!loaded) {
    return (
      <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
        <div className="flex items-center justify-center py-24">
          <div className="text-sm text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-12 pb-16">
      {/* Settings slide-out panel */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setSettingsOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div
            className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl border-l border-gray-200 overflow-y-auto animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Settings</h2>
              <button onClick={() => setSettingsOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-8">
              {/* Portfolio Constraints */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Settings className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-semibold text-gray-900">Portfolio Constraints</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Risk-Free Rate (%)</label>
                    <input type="number" min="0" step="0.01" value={riskFreeRate} onChange={(e) => setRiskFreeRate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Portfolios</label>
                    <input type="number" min="100" step="100" value={numPortfolios} onChange={(e) => setNumPortfolios(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stock Min Weight (%)</label>
                    <input type="number" min="0" step="0.01" value={minWeight} onChange={(e) => setMinWeight(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stock Max Weight (%)</label>
                    <input type="number" min="0" step="0.01" value={maxWeight} onChange={(e) => setMaxWeight(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cash Min Weight (%)</label>
                    <input type="number" min="0" step="0.01" value={cashMinWeight} onChange={(e) => setCashMinWeight(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cash Max Weight (%)</label>
                    <input type="number" min="0" step="0.01" value={cashMaxWeight} onChange={(e) => setCashMaxWeight(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cov Blend Lambda <span className="text-gray-400 font-normal">(0=composite, 1=market)</span></label>
                    <input type="number" min="0" max="1" step="0.05" value={covLambda} onChange={(e) => setCovLambda(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                    <p className="text-[10px] text-gray-400 mt-1">0 = composite only, 1 = market only</p>
                  </div>
                </div>
              </div>

              {/* Risk Factor Weights */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Target className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-semibold text-gray-900">Risk Factor Weights</h3>
                </div>
                <div className="space-y-3">
                  {riskFactors.map((factor, index) => (
                    <div key={factor} className="flex items-center justify-between gap-4">
                      <label className="text-sm text-gray-600 min-w-[120px]">{factor}</label>
                      <input type="number" min="0" step="0.01" value={riskFactorWeights[index]} onChange={(e) => updateRiskFactorWeight(index, e.target.value)} className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm text-right focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="animate-fade-in-up">
        <div className="flex items-center justify-between mb-6 animate-fade-in-up">
          <h1 className="text-3xl font-bold text-gray-900">Allocation</h1>
        </div>

        {/* Tab Bar + Settings */}
        <div className="flex items-center justify-between mb-6 animate-fade-in-up stagger-2">
          <div className="flex items-center gap-1 bg-gray-100/80 rounded-xl p-1 w-fit">
            {[
              { key: 'optimizer', label: 'Optimizer' },
              { key: 'confidence', label: 'Macro Risk' },
              { key: 'rebalancer', label: 'Rebalancer' },
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
          <div className="flex items-center gap-2">
            {scheme && (
              <button
                onClick={handleClearScheme}
                className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-red-600 bg-gray-50 hover:bg-red-50 border border-gray-200 px-4 py-2 rounded-xl transition-colors"
                title="Clear the active scheme and start over — saved snapshots stay in the Strategic Hub"
              >
                <X size={15} />
                Clear scheme
              </button>
            )}
            {activeSubTab === 'optimizer' && (<>
              <button
                onClick={syncWeightsFromPortfolio}
                disabled={syncingWeights}
                className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                title="Sync weights from current portfolio holdings"
              >
                <RefreshCw size={15} className={syncingWeights ? 'animate-spin' : ''} />
                Sync Weights
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-4 py-2 rounded-xl transition-colors"
              >
                <SlidersHorizontal size={15} />
                Settings
              </button>
            </>)}
          </div>
        </div>

        {activeSubTab === 'optimizer' && (<>

        {/* Asset cards */}
        <div ref={tableRef} className="space-y-2 animate-fade-in-up stagger-2">
          {allocations.map((row, idx) => (
            <div key={row.id} className="group bg-white border border-gray-100 rounded-2xl px-5 py-4 hover:border-gray-200 hover:shadow-sm transition-all">
              {/* Top row: Ticker, Return, Weight, Remove */}
              <div className="flex items-center gap-5">
                <input
                  type="text" spellCheck={true}
                  value={row.ticker}
                  onChange={(e) => updateAllocation(row.id, 'ticker', e.target.value.toUpperCase())}
                  className="w-20 text-[15px] font-bold text-gray-900 bg-transparent border-0 outline-none placeholder:text-gray-300 placeholder:font-normal"
                  placeholder="TICKER"
                />

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Exp. Return</span>
                  <input
                    type="number" min="0" step="0.01"
                    data-col="expectedReturn" data-row={idx}
                    value={row.expectedReturn}
                    onChange={(e) => updateAllocation(row.id, 'expectedReturn', e.target.value)}
                    onKeyDown={(e) => handleColumnTab(e, 'expectedReturn', idx)}
                    className="w-16 text-[15px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all"
                    placeholder="0"
                  />
                  <span className="text-[13px] text-gray-400">%</span>
                </div>

                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Weight</span>
                  <input
                    type="number" min="0" step="0.01"
                    data-col="userWeight" data-row={idx}
                    value={row.userWeight}
                    onKeyDown={(e) => handleColumnTab(e, 'userWeight', idx)}
                    onChange={(e) => updateAllocation(row.id, 'userWeight', e.target.value)}
                    className="w-16 text-[15px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all"
                    placeholder="0"
                  />
                  <span className="text-[13px] text-gray-400">%</span>
                </div>

                {allocations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAllocation(row.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Bottom row: Risk factor exposures */}
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-50">
                <span className="text-[11px] font-medium text-gray-300 uppercase tracking-wide shrink-0">Risk Factors</span>
                <div className="flex items-center gap-3 flex-wrap">
                  {row.factorExposures.map((value, index) => {
                    const ticker = row.ticker.trim().toUpperCase();
                    const isVolLoading = index === 0 && ticker !== 'CASH' && volScoresLoading[ticker];
                    return (
                    <div key={`${row.id}-${riskFactors[index]}`} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">{riskFactors[index]}</span>
                      {isVolLoading ? (
                        <div className="w-14 h-[22px] flex items-center justify-center">
                          <Loader2 size={12} className="animate-spin text-emerald-500" />
                        </div>
                      ) : (
                      <input
                        type="number" min="0" step="0.01"
                        value={value}
                        onChange={(e) => updateAllocationExposure(row.id, index, e.target.value)}
                        className={`w-14 text-[13px] text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-1.5 py-0.5 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all ${index === 0 && ticker !== 'CASH' ? 'border-emerald-200 bg-emerald-50/30' : ''}`}
                        placeholder="0"
                        title={index === 0 && ticker !== 'CASH' ? 'Auto-computed from realized vol (CDF of cross-sectional distribution)' : ''}
                      />
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-5 animate-fade-in-up stagger-3">
          <button
            type="button"
            onClick={addAllocation}
            className="text-[15px] font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 px-4 py-2 rounded-xl transition-colors"
          >
            + Add Asset
          </button>
          <button
            type="button"
            onClick={runMonteCarloSimulation}
            disabled={simulating}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-[15px] font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {simulating ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Simulating...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Run Simulation
              </>
            )}
          </button>
        </div>

        {simulationError && <p className="mt-4 text-[15px] text-red-600 font-medium">{simulationError}</p>}

        {/* Results */}
        {simulationChart && (
          <div className="mt-8 bg-white border border-gray-200 rounded-2xl p-6 animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-gray-900">Efficient Frontier</h3>
              {simulationResult && (
                <span className="text-[13px] text-gray-400">{simulationResult.totalSamples.toLocaleString()} portfolios generated</span>
              )}
            </div>
            <Scatter data={simulationChart} options={simulationChartOptions} />
          </div>
        )}

        {simulationResult && (
          <div className="mt-6 animate-fade-in-up">
            {/* Optimal portfolios — compact summary cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Max Composite */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <h4 className="text-[15px] font-semibold text-gray-900">Max Composite Ratio</h4>
                </div>
                <div className="flex items-baseline gap-3 mb-4">
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{(simulationResult.maxSharpe.expectedReturn * 100).toFixed(1)}%</p>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Return</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-500">{(simulationResult.maxSharpe.volatility * 100).toFixed(1)}%</p>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Risk</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-500">{simulationResult.maxSharpe.compositeRatio.toFixed(2)}</p>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Ratio</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {simulationResult.maxSharpe.weights.map((item) => (
                    <div key={`max-${item.ticker}`} className="flex items-center justify-between text-[15px]">
                      <span className="font-medium text-gray-700">{item.ticker}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(((item.weight * 100) / (parseNumber(maxWeight) || 15)) * 100, 100)}%` }} />
                        </div>
                        <span className="text-[13px] text-gray-500 w-12 text-right">{(item.weight * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Min Risk */}
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <h4 className="text-[15px] font-semibold text-gray-900">Min Risk</h4>
                </div>
                <div className="flex items-baseline gap-3 mb-4">
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{(simulationResult.minVol.expectedReturn * 100).toFixed(1)}%</p>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Return</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-500">{(simulationResult.minVol.volatility * 100).toFixed(1)}%</p>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Risk</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-500">{simulationResult.minVol.compositeRatio.toFixed(2)}</p>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Ratio</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {simulationResult.minVol.weights.map((item) => (
                    <div key={`min-${item.ticker}`} className="flex items-center justify-between text-[15px]">
                      <span className="font-medium text-gray-700">{item.ticker}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(((item.weight * 100) / (parseNumber(maxWeight) || 15)) * 100, 100)}%` }} />
                        </div>
                        <span className="text-[13px] text-gray-500 w-12 text-right">{(item.weight * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* User-Defined */}
              {simulationResult.userDefined && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <h4 className="text-[15px] font-semibold text-gray-900">Your Portfolio</h4>
                  </div>
                  <div className="flex items-baseline gap-3 mb-4">
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{(simulationResult.userDefined.expectedReturn * 100).toFixed(1)}%</p>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Return</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-500">{(simulationResult.userDefined.volatility * 100).toFixed(1)}%</p>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Risk</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-500">{simulationResult.userDefined.compositeRatio.toFixed(2)}</p>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Ratio</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {simulationResult.userDefined.weights.map((item) => (
                      <div key={`user-${item.ticker}`} className="flex items-center justify-between text-[15px]">
                        <span className="font-medium text-gray-700">{item.ticker}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(((item.weight * 100) / (parseNumber(maxWeight) || 15)) * 100, 100)}%` }} />
                          </div>
                          <span className="text-[13px] text-gray-500 w-12 text-right">{(item.weight * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Per-stock standalone composite risk */}
        {simulationResult?.standaloneRisk && (
          <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-5 animate-fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-gray-900">Standalone Composite Risk</h3>
              <span className="text-[11px] text-gray-400">Weighted avg of factor exposures &middot; lambda {simulationResult.lambda?.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {Object.entries(simulationResult.standaloneRisk)
                .filter(([ticker]) => ticker !== 'CASH')
                .sort(([, a], [, b]) => b - a)
                .map(([ticker, risk]) => {
                  const pct = Math.min(risk * 100, 100);
                  const color = risk > 0.5 ? 'bg-red-400' : risk > 0.3 ? 'bg-amber-400' : 'bg-emerald-400';
                  return (
                    <div key={ticker} className="border border-gray-100 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[13px] font-bold text-gray-800">{ticker}</span>
                        <span className="text-[11px] font-mono text-gray-500">{(risk * 100).toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Save scheme & continue → Market Confidence */}
        <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[15px] font-semibold text-gray-900">Happy with these weights?</p>
            <p className="text-[13px] text-gray-500">Save them as an allocation scheme and carry them into Macro Risk.</p>
          </div>
          <button onClick={handleSaveSchemeAndContinue}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700">
            Save scheme &amp; continue <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {schemeError && <p className="mt-3 text-[15px] font-medium text-red-600">{schemeError}</p>}

        </>)}

        {activeSubTab === 'confidence' && (
          scheme ? (
            <ConfidenceTab
              scheme={scheme}
              allocations={allocations}
              riskFactorWeights={riskFactorWeights}
              maxWeight={maxWeight}
              onSaveContinue={handleConfidenceSaveContinue}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-16 text-center animate-fade-in-up">
              <p className="text-sm font-medium text-gray-600">No allocation scheme yet.</p>
              <p className="mt-1 text-xs text-gray-400">Set your target weights in the Optimizer, then hit &ldquo;Save scheme &amp; continue&rdquo;.</p>
              <button onClick={() => setActiveSubTab('optimizer')}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800">
                Go to Optimizer
              </button>
            </div>
          )
        )}

        {activeSubTab === 'rebalancer' && (
          <div className="animate-fade-in-up">
            {/* Header row */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Cash</span>
                  <span className="text-[15px] text-gray-400">$</span>
                  <input type="number" min="0" step="0.01" value={rbCash} onChange={(e) => setRbCash(e.target.value)} className="w-28 text-[15px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all" placeholder="0" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Target Cash</span>
                  <input type="number" min="0" step="0.01" value={rbTargetCashPercent} onChange={(e) => setRbTargetCashPercent(e.target.value)} className="w-16 text-[15px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all" placeholder="0" />
                  <span className="text-sm text-gray-400">%</span>
                </div>
              </div>
              <button
                type="button"
                onClick={resetRebalancerToScheme}
                disabled={rbLoadingPortfolio}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                title="Reset: current values from holdings, target weights from the scheme"
              >
                <RotateCcw size={15} className={rbLoadingPortfolio ? 'animate-spin' : ''} />
              </button>
            </div>

            {rbLoadingPortfolio ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-4 h-4 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mr-2" />
                <span className="text-[15px] text-gray-400">Loading portfolio...</span>
              </div>
            ) : (<>
            {/* Holdings cards */}
            <div ref={rbTableRef} className="space-y-2 animate-fade-in-up stagger-2">
              {rbHoldings.map((row, idx) => (
                <div key={row.id} className="group bg-white border border-gray-100 rounded-2xl px-5 py-3.5 hover:border-gray-200 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-5">
                    <input
                      type="text" spellCheck={true}
                      value={row.ticker}
                      onChange={(e) => updateRbHolding(row.id, 'ticker', e.target.value)}
                      className="w-20 text-[15px] font-bold text-gray-900 bg-transparent border-0 outline-none placeholder:text-gray-300 placeholder:font-normal"
                      placeholder="TICKER"
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Value</span>
                      <span className="text-sm text-gray-400">$</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={row.currentValue}
                        onChange={(e) => updateRbHolding(row.id, 'currentValue', e.target.value)}
                        className="w-24 text-[15px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all"
                        placeholder="0"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Current</span>
                      <span className="w-16 text-right text-[15px] font-mono tabular-nums text-gray-500">
                        {rbCurrentAum > 0 ? ((parseNumber(row.currentValue) / rbCurrentAum) * 100).toFixed(1) : '0.0'}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Target</span>
                      <input
                        type="number" min="0" step="0.01"
                        data-col="rbTargetWeight" data-row={idx}
                        value={row.targetWeight}
                        onChange={(e) => updateRbHolding(row.id, 'targetWeight', e.target.value)}
                        onKeyDown={(e) => handleRbColumnTab(e, 'rbTargetWeight', idx)}
                        className="w-16 text-[15px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-right focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all"
                        placeholder="0"
                      />
                      <span className="text-sm text-gray-400">%</span>
                    </div>
                    {rbHoldings.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRbHolding(row.id)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-5 animate-fade-in-up stagger-3">
              <button type="button" onClick={addRbHolding} className="text-[15px] font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 px-4 py-2 rounded-xl transition-colors">
                + Add Holding
              </button>
              <span className="text-sm text-gray-400">
                Total: <span className={`font-semibold ${Math.abs(rbTotalTargetPercent - 100) < 0.01 ? 'text-emerald-600' : 'text-gray-900'}`}>{rbTotalTargetPercent.toFixed(2)}%</span>
              </span>
              <button
                type="button"
                onClick={handleGenerateRbPlan}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-[15px] font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
              >
                <Zap className="w-4 h-4" />
                Rebalance
              </button>
            </div>

            {rbError && <p className="mt-4 text-[15px] text-red-600 font-medium">{rbError}</p>}

            {rbPlan && (
              <div className="mt-8 space-y-4 animate-fade-in-up">
                {/* Trading instructions */}
                {rbPlan.steps.length > 0 ? (
                  <div className="space-y-1.5">
                    {rbPlan.steps.map((step, index) => {
                      const styles = {
                        buy: 'border-l-emerald-400 bg-emerald-50/60 text-emerald-800',
                        sell: 'border-l-rose-400 bg-rose-50/60 text-rose-800',
                        note: 'border-l-gray-300 bg-gray-50 text-gray-600',
                      };
                      return (
                        <div key={`${step.text}-${index}`} className={`border-l-[3px] rounded-r-lg px-4 py-2.5 text-[15px] ${styles[step.type] || styles.note}`}>{step.text}</div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[15px] text-gray-400 py-2">No trades required. Portfolio is already balanced.</p>
                )}

                {/* Buy / Sell side by side */}
                {(Object.keys(rbPlan.buyDollars).length > 0 || Object.keys(rbPlan.sellDollars).length > 0) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                      <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Buys</h4>
                      {Object.keys(rbPlan.buyDollars).length === 0 ? (
                        <p className="text-[15px] text-gray-400">None</p>
                      ) : (
                        <div className="space-y-1.5">
                          {Object.entries(rbPlan.buyDollars).map(([ticker, value]) => (
                            <div key={ticker} className="flex items-center justify-between text-[15px]">
                              <span className="font-medium text-gray-700">{ticker}</span>
                              <span className="font-semibold text-emerald-600">{formatCurrency(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl p-4">
                      <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Sells</h4>
                      {Object.keys(rbPlan.sellDollars).length === 0 ? (
                        <p className="text-[15px] text-gray-400">None</p>
                      ) : (
                        <div className="space-y-1.5">
                          {Object.entries(rbPlan.sellDollars).map(([ticker, value]) => (
                            <div key={ticker} className="flex items-center justify-between text-[15px]">
                              <span className="font-medium text-gray-700">{ticker}</span>
                              <span className="font-semibold text-rose-600">{formatCurrency(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Projected allocation — compact bar rows */}
                <div className="bg-white border border-gray-100 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Projected Allocation</h4>
                  <div className="space-y-1.5">
                    {Object.entries(rbPlan.finalValues)
                      .sort(([, , ], [, , ]) => 0)
                      .sort(([a], [b]) => rbPlan.finalWeights[b] - rbPlan.finalWeights[a])
                      .map(([ticker, value]) => (
                        <div key={ticker} className="flex items-center justify-between text-[15px]">
                          <span className="font-medium text-gray-700 w-16">{ticker}</span>
                          <div className="flex-1 mx-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(rbPlan.finalWeights[ticker] * 100, 100)}%` }} />
                          </div>
                          <span className="text-sm text-gray-500 w-20 text-right">{(rbPlan.finalWeights[ticker] * 100).toFixed(1)}%</span>
                          <span className="text-sm text-gray-400 w-24 text-right">{formatCurrency(value)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Tax impact */}
                <div className="bg-white border border-gray-100 rounded-2xl p-4">
                  <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Tax Impact</h4>
                  {rbTaxBreakdown.rows.length === 0 ? (
                    <p className="text-[15px] text-gray-400">No sells — no tax impact.</p>
                  ) : (<>
                    {/* Summary at top — large */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      <div>
                        <p className="text-sm text-gray-400 uppercase tracking-wide mb-1">Capital Gains</p>
                        {rbTaxBreakdown.totalGains < 0 ? (
                          <p className="text-xl font-bold text-gray-900">None <span className="text-[15px] font-normal text-gray-400">({formatCurrency(rbTaxBreakdown.totalGains)})</span></p>
                        ) : (
                          <p className="text-xl font-bold text-gray-900">{formatCurrency(rbTaxBreakdown.totalGains)}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm text-gray-400 uppercase tracking-wide mb-1">Tax Owed</p>
                        {rbTaxBreakdown.totalTax < 0 ? (
                          <p className="text-xl font-bold text-gray-900">None <span className="text-[15px] font-normal text-gray-400">({formatCurrency(rbTaxBreakdown.totalTax)})</span></p>
                        ) : (
                          <p className="text-xl font-bold text-rose-600">{formatCurrency(rbTaxBreakdown.totalTax)}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm text-gray-400 uppercase tracking-wide mb-1">AUM</p>
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(rbAumValue)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400 uppercase tracking-wide mb-1">Tax / AUM</p>
                        {rbTaxOwedPctOfAum < 0 ? (
                          <p className="text-xl font-bold text-gray-900">0.00% <span className="text-[15px] font-normal text-gray-400">({rbTaxOwedPctOfAum.toFixed(2)}%)</span></p>
                        ) : (
                          <p className="text-xl font-bold text-gray-900">{rbTaxOwedPctOfAum.toFixed(2)}%</p>
                        )}
                      </div>
                    </div>

                    {/* Per-ticker breakdown below */}
                    <div className="border-t border-gray-100 pt-4 space-y-3">
                      <h5 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Breakdown</h5>
                      {rbTaxBreakdown.rows.map((row) => (
                        <div key={row.ticker} className="border border-gray-100 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2.5">
                            <span className="text-[15px] font-bold text-gray-900">{row.ticker}</span>
                            <span className="text-[11px] text-gray-400">sell {formatCurrency(rbPlan.sellDollars[row.ticker])}</span>
                          </div>
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            <div>
                              <span className="text-[11px] text-gray-400 uppercase tracking-wide">Cost Basis</span>
                              <input type="number" min="0" step="0.01" value={rbTaxInputs[row.ticker]?.initialValue ?? ''} onChange={(e) => updateRbTaxInput(row.ticker, 'initialValue', e.target.value)} className="w-full text-[15px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all" placeholder="0" />
                            </div>
                            <div>
                              <span className="text-[11px] text-gray-400 uppercase tracking-wide">Mkt Value</span>
                              <input type="number" min="0" step="0.01" value={rbTaxInputs[row.ticker]?.finalValue ?? ''} onChange={(e) => updateRbTaxInput(row.ticker, 'finalValue', e.target.value)} className="w-full text-[15px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all" placeholder="0" />
                            </div>
                            <div>
                              <span className="text-[11px] text-gray-400 uppercase tracking-wide">Amt Sold</span>
                              <input type="number" min="0" step="0.01" value={rbTaxInputs[row.ticker]?.amountSold ?? ''} onChange={(e) => updateRbTaxInput(row.ticker, 'amountSold', e.target.value)} className="w-full text-[15px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all" placeholder="0" />
                            </div>
                            <div>
                              <span className="text-[11px] text-gray-400 uppercase tracking-wide">Tax Rate</span>
                              <div className="flex items-center gap-1">
                                <input type="number" min="0" step="0.01" value={rbTaxInputs[row.ticker]?.taxRate ?? ''} onChange={(e) => updateRbTaxInput(row.ticker, 'taxRate', e.target.value)} className="w-full text-[15px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none transition-all" placeholder="20" />
                                <span className="text-sm text-gray-400">%</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                            <span>Gain: <span className="font-semibold text-gray-700">{formatCurrency(row.gainRealized)}</span></span>
                            <span>Tax: <span className="font-semibold text-rose-600">{formatCurrency(row.taxOwed)}</span></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>)}
                </div>
              </div>
            )}
            </>)}
          </div>
        )}
      </div>
    </div>
  );
}
