'use client';

import FundamentalChart from '@/components/charts/FundamentalChart';
import PriceChart from '@/components/charts/PriceChart';
import { formatLargeNumber, formatNumber } from '@/lib/formatters';

/**
 * CompanyFundamentals — the read-only company data view: price history, live
 * stat tiles, and the fundamentals chart grid (revenue, EPS, FCF, margins,
 * shares, PE, FCF yield).
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
      <PriceChart labels={priceLabels} data={priceData} color="#10b981" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Price', value: displayPrice ? `$${displayPrice.toFixed(2)}` : '—' },
          { label: 'PE Ratio', value: livePe ? formatNumber(livePe, 1) : '—' },
          { label: 'FCF Yield', value: liveFcfYield ? `${liveFcfYield.toFixed(1)}%` : '—' },
          { label: 'Price / Sales', value: livePs ? formatNumber(livePs, 1) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">{label}</p>
            {quoteLoading ? (
              <div className="h-7 w-20 rounded-lg skeleton" />
            ) : (
              <p className="text-xl font-extrabold gradient-text">{value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <FundamentalChart title="Revenue" labels={revenueLabels} data={revenueData} label="Revenue" formatY={(v) => formatLargeNumber(v)} />
        <FundamentalChart title="EPS (Diluted)" labels={epsLabels} data={epsData} label="EPS" formatY={(v) => `$${v.toFixed(2)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <FundamentalChart title="Free Cash Flow" labels={fcfLabels} data={fcfData} label="FCF" formatY={(v) => formatLargeNumber(v)} />
        <FundamentalChart title="Operating Margins" labels={marginLabels} data={marginData} chartType="line" label="Op Margin" color="#f59e0b" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <FundamentalChart title="Outstanding Shares" labels={sharesLabels} data={sharesData} label="Shares" formatY={(v) => formatLargeNumber(v)} colorPositive="#06b6d4" colorNegative="#06b6d4" />
        <PriceChart title="PE Ratio" labels={peLabels} data={peData} label="PE Ratio" color="#8b5cf6" formatY={(v) => v.toFixed(1)} showCagr={false} className="" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <PriceChart title="FCF Yield" labels={fcfYieldLabels} data={fcfYieldData} label="FCF Yield" color="#10b981" formatY={(v) => `${v.toFixed(1)}%`} showCagr={false} className="" />
      </div>
    </>
  );
}
