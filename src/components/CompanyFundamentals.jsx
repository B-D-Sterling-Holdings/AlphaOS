'use client';

import FundamentalChart from '@/components/charts/FundamentalChart';
import PriceChart from '@/components/charts/PriceChart';
import { formatLargeNumber, formatNumber, formatShareCount } from '@/lib/formatters';

/**
 * CompanyFundamentals — the read-only company data view: a headline metrics
 * summary (valuation / growth / margins / price), price history, and the
 * fundamentals chart grid (revenue, EPS, FCF, margins, shares, PE, FCF yield).
 *
 * Extracted from the Research page's Fundamentals tab so the exact same view
 * can render anywhere in the pipeline — Draft & Review shows it so the author
 * and reviewer can reference the numbers mid-discussion without leaving for
 * Research (or Qualtrim). Purely presentational: the caller owns fetching
 * `tickerData` (/api/ticker/<t>) and the live quote.
 */

// Live-quote-adjusted headline stats. The CSV valuation block is the fallback
// when there's no live quote (market closed, quote API down).
export function computeQuickStats(tickerData, liveQuote) {
  const epsData = tickerData?.eps?.map(e => e.eps_diluted) || [];
  const fcfData = tickerData?.fcf?.map(f => f.free_cash_flow) || [];
  const revenueData = tickerData?.revenue?.map(r => r.revenue) || [];
  const sharesData = tickerData?.buybacks?.map(b => b.shares_outstanding) || [];
  const valuation = tickerData?.valuation || {};

  const livePrice = liveQuote?.price || null;
  const csvPrice = valuation.currentPrice ? Number(valuation.currentPrice) : null;
  const displayPrice = livePrice || csvPrice;

  const csvEps = epsData.length > 0 ? epsData[epsData.length - 1] : null;
  const csvFcf = fcfData.length > 0 ? fcfData[fcfData.length - 1] : null;
  const csvRevenue = revenueData.length > 0 ? revenueData[revenueData.length - 1] : null;
  const csvShares = sharesData.length > 0 ? sharesData[sharesData.length - 1] : null;

  const livePe = (displayPrice && csvEps && csvEps > 0) ? displayPrice / csvEps : (valuation.peRatio ? Number(valuation.peRatio) : null);
  const liveFcfYield = (displayPrice && csvFcf && csvShares && csvShares > 0) ? (csvFcf / (displayPrice * csvShares)) * 100 : (valuation.fcfYield ? Number(valuation.fcfYield) : null);
  const livePs = (displayPrice && csvRevenue && csvShares && csvShares > 0) ? (displayPrice * csvShares) / csvRevenue : (valuation.priceToSales ? Number(valuation.priceToSales) : null);

  return { displayPrice, livePe, liveFcfYield, livePs };
}

// ── Summary-metric helpers ────────────────────────────────────────────────
// TTM-based CAGR for a flow series (revenue / eps / fcf). Uses trailing-4Q
// windows so seasonality doesn't distort the endpoints. Clamps the horizon to
// the data actually available so short histories still produce a number.
function flowCagr(series, years) {
  if (!series || series.length < 8) return null;
  const q = years * 4;
  const end = series.slice(-4).reduce((a, b) => a + b, 0);
  const start = series.slice(-4 - q, series.length - q).reduce((a, b) => a + b, 0);
  if (start <= 0 || end <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

// CAGR for a point-in-time series (shares outstanding).
function pointCagr(series, years) {
  const q = years * 4;
  if (!series || series.length < q + 1) return null;
  const end = series[series.length - 1];
  const start = series[series.length - 1 - q];
  if (start <= 0 || end <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

function marketMetric(tickerData, metric) {
  const row = tickerData?.market_data?.find(r => r.metric === metric);
  return row ? Number(row.value) : null;
}

const fmtPrice = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);
const fmtPct = (v, dp = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(dp)}%`);
const fmtPctPlain = (v, dp = 1) => (v == null ? '—' : `${Number(v).toFixed(dp)}%`);

function MetricRow({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'pos' ? 'text-emerald-600'
    : tone === 'neg' ? 'text-red-500'
    : 'text-gray-900';
  return (
    <div className="flex items-baseline">
      <dt className="text-[13px] text-gray-500 whitespace-nowrap">{label}</dt>
      <span className="flex-1 mx-2 border-b border-dotted border-gray-200 translate-y-[-3px]" />
      <dd className={`text-[13px] font-bold tabular-nums whitespace-nowrap ${toneClass}`}>{value}</dd>
    </div>
  );
}

function MetricSection({ title, rows }) {
  return (
    <div>
      <h3 className="text-[13px] font-extrabold text-gray-900 uppercase tracking-wider mb-3.5">{title}</h3>
      <dl className="space-y-2.5">
        {rows.map(r => <MetricRow key={r.label} {...r} />)}
      </dl>
    </div>
  );
}

function MetricsSummary({ tickerData, displayPrice, livePe, liveFcfYield, livePs }) {
  const revenue = tickerData?.revenue?.map(r => r.revenue) || [];
  const eps = tickerData?.eps?.map(e => e.eps_diluted) || [];
  const fcf = tickerData?.fcf?.map(f => f.free_cash_flow) || [];
  const margins = tickerData?.operating_margins?.map(m => m.operating_margin) || [];
  const shares = tickerData?.buybacks?.map(b => b.shares_outstanding) || [];

  const latestShares = shares.length ? shares[shares.length - 1] : null;
  const marketCap = (displayPrice && latestShares) ? displayPrice * latestShares : null;

  // Single growth horizon shared across rows (max 5Y, clamped to history).
  const minLen = Math.min(revenue.length, eps.length, fcf.length) || 0;
  const growthYears = Math.max(1, Math.min(5, Math.floor((minLen - 4) / 4)));

  const opMargin = margins.length ? margins[margins.length - 1] * 100 : null;
  const ttmRevenue = revenue.length >= 4 ? revenue.slice(-4).reduce((a, b) => a + b, 0) : null;
  const ttmFcf = fcf.length >= 4 ? fcf.slice(-4).reduce((a, b) => a + b, 0) : null;
  const fcfMargin = (ttmRevenue && ttmFcf && ttmRevenue > 0) ? (ttmFcf / ttmRevenue) * 100 : null;

  const revCagr = flowCagr(revenue, growthYears);
  const epsCagr = flowCagr(eps, growthYears);
  const fcfCagr = flowCagr(fcf, growthYears);
  const sharesCagr = pointCagr(shares, growthYears);

  const high52 = marketMetric(tickerData, '52_week_high') ?? tickerData?.valuation?.high52w ?? null;
  const low52 = marketMetric(tickerData, '52_week_low') ?? tickerData?.valuation?.low52w ?? null;
  const fromHigh = marketMetric(tickerData, 'pct_from_52week_high') ?? tickerData?.valuation?.pctFrom52wHigh ?? null;
  const change1y = marketMetric(tickerData, 'pct_change_1y');

  const growthTone = (v) => (v == null ? 'neutral' : v >= 0 ? 'pos' : 'neg');

  const sections = [
    {
      title: 'Valuation',
      rows: [
        { label: 'Market Cap', value: formatLargeNumber(marketCap) },
        { label: 'P/E (TTM)', value: livePe ? formatNumber(livePe, 1) : '—' },
        { label: 'Price / Sales', value: livePs ? formatNumber(livePs, 1) : '—' },
        { label: 'FCF Yield', value: fmtPctPlain(liveFcfYield) },
      ],
    },
    {
      title: `Growth · ${growthYears}Y CAGR`,
      rows: [
        { label: 'Revenue', value: fmtPct(revCagr), tone: growthTone(revCagr) },
        { label: 'EPS', value: fmtPct(epsCagr), tone: growthTone(epsCagr) },
        { label: 'Free Cash Flow', value: fmtPct(fcfCagr), tone: growthTone(fcfCagr) },
        // A shrinking share count (buybacks) is the good outcome — flip the tone.
        { label: 'Shares Out.', value: fmtPct(sharesCagr), tone: sharesCagr == null ? 'neutral' : sharesCagr <= 0 ? 'pos' : 'neg' },
      ],
    },
    {
      title: 'Margins',
      rows: [
        { label: 'Operating Margin', value: fmtPctPlain(opMargin) },
        { label: 'FCF Margin', value: fmtPctPlain(fcfMargin) },
      ],
    },
    {
      title: 'Price',
      rows: [
        { label: 'Current', value: fmtPrice(displayPrice) },
        { label: '52W High', value: fmtPrice(high52) },
        { label: '52W Low', value: fmtPrice(low52) },
        { label: 'From 52W High', value: fmtPct(fromHigh), tone: fromHigh == null ? 'neutral' : fromHigh < 0 ? 'neg' : 'pos' },
        { label: '1Y Return', value: fmtPct(change1y), tone: growthTone(change1y) },
      ],
    },
  ];

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 shadow-sm mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-10 gap-y-8">
        {sections.map(s => <MetricSection key={s.title} {...s} />)}
      </div>
    </div>
  );
}

export default function CompanyFundamentals({ tickerData, liveQuote, quoteLoading = false }) {
  const makeQuarterLabel = (row) => `${row.quarter}'${String(row.year).slice(-2)}`;

  const revenueLabels = tickerData?.revenue?.map(makeQuarterLabel) || [];
  const revenueData = tickerData?.revenue?.map(r => r.revenue) || [];
  const epsLabels = tickerData?.eps?.map(makeQuarterLabel) || [];
  const epsData = tickerData?.eps?.map(e => e.eps_diluted) || [];
  const fcfLabels = tickerData?.fcf?.map(makeQuarterLabel) || [];
  const fcfData = tickerData?.fcf?.map(f => f.free_cash_flow) || [];
  const marginLabels = tickerData?.operating_margins?.map(makeQuarterLabel) || [];
  const marginData = tickerData?.operating_margins?.map(m => m.operating_margin * 100) || [];
  const sharesLabels = tickerData?.buybacks?.map(makeQuarterLabel) || [];
  const sharesData = tickerData?.buybacks?.map(b => b.shares_outstanding) || [];
  const priceLabels = tickerData?.daily_prices?.map(p => p.date) || [];
  const priceData = tickerData?.daily_prices?.map(p => p.close) || [];
  const peLabels = tickerData?.valuation?.peHistory?.map(p => p.date) || [];
  const peData = tickerData?.valuation?.peHistory?.map(p => p.pe_ratio) || [];
  const fcfYieldLabels = tickerData?.valuation?.fcfYieldHistory?.map(f => f.date) || [];
  const fcfYieldData = tickerData?.valuation?.fcfYieldHistory?.map(f => f.fcf_yield) || [];

  const { displayPrice, livePe, liveFcfYield, livePs } = computeQuickStats(tickerData, liveQuote);

  return (
    <>
      {quoteLoading ? (
        <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 shadow-sm mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-10 gap-y-8">
            {[0, 1, 2, 3].map(col => (
              <div key={col}>
                <div className="h-4 w-24 rounded skeleton mb-4" />
                <div className="space-y-3">
                  {[0, 1, 2, 3].map(i => <div key={i} className="h-4 w-full rounded skeleton" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <MetricsSummary
          tickerData={tickerData}
          displayPrice={displayPrice}
          livePe={livePe}
          liveFcfYield={liveFcfYield}
          livePs={livePs}
        />
      )}

      <PriceChart labels={priceLabels} data={priceData} color="#10b981" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <FundamentalChart title="Revenue" labels={revenueLabels} data={revenueData} label="Revenue" formatY={(v) => formatLargeNumber(v)} colorPositive="#10b981" />
        <FundamentalChart title="EPS (Diluted)" labels={epsLabels} data={epsData} label="EPS" formatY={(v) => `$${v.toFixed(2)}`} colorPositive="#f59e0b" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <FundamentalChart title="Free Cash Flow" labels={fcfLabels} data={fcfData} label="FCF" formatY={(v) => formatLargeNumber(v)} colorPositive="#f97316" />
        <FundamentalChart title="Operating Margins" labels={marginLabels} data={marginData} chartType="line" label="Op Margin" color="#8b5cf6" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <FundamentalChart title="Outstanding Shares" labels={sharesLabels} data={sharesData} label="Shares" formatY={(v) => formatShareCount(v)} colorPositive="#06b6d4" colorNegative="#06b6d4" />
        <PriceChart title="PE Ratio" labels={peLabels} data={peData} label="PE Ratio" color="#8b5cf6" formatY={(v) => v.toFixed(1)} showCagr={false} className="" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <PriceChart title="FCF Yield" labels={fcfYieldLabels} data={fcfYieldData} label="FCF Yield" color="#10b981" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} className="" />
      </div>
    </>
  );
}
