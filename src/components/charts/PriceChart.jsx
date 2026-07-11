'use client';

import { useState } from 'react';
import Card from '@/components/Card';
import LineChart from './LineChart';
import ChartModal, { ExpandButton } from './ChartModal';

const PRICE_OPTIONS = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '2Y', days: 504 },
  { label: '5Y', days: 1260 },
  { label: '10Y', days: 2520 },
  { label: 'All', days: Infinity },
];

function computeCAGR(labels, data, targetYears) {
  if (!data || !labels || data.length < 2) return null;
  const endDate = new Date(labels[labels.length - 1]);
  const targetDate = new Date(endDate);
  targetDate.setFullYear(targetDate.getFullYear() - targetYears);

  // Find the data point closest to targetDate
  let startIdx = 0;
  for (let i = 0; i < labels.length; i++) {
    if (new Date(labels[i]) >= targetDate) { startIdx = i; break; }
  }

  const startVal = data[startIdx];
  const endVal = data[data.length - 1];
  if (!startVal || !endVal || startVal <= 0) return null;

  // Actual elapsed years from the dates
  const startDate = new Date(labels[startIdx]);
  const actualYears = (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);
  if (actualYears < 0.5) return null;

  return (Math.pow(endVal / startVal, 1 / actualYears) - 1) * 100;
}

function TimeframeToggle({ value, onChange }) {
  return (
    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {PRICE_OPTIONS.map(opt => (
        <button
          key={opt.label}
          onClick={() => onChange(opt.label)}
          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all duration-200 ${
            value === opt.label
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CagrRow({ cagrs }) {
  return (
    <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100">
      {cagrs.map(c => (
        <div key={c.label} className="text-center">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold block">{c.label} CAGR</span>
          <span className={`text-sm font-bold ${c.value == null ? 'text-gray-300' : c.value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {c.value != null ? `${c.value >= 0 ? '+' : ''}${c.value.toFixed(2)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function PriceChart({
  labels,
  data,
  color = '#10b981',
  title = 'Price',
  label: chartLabel = 'Price',
  formatY = (v) => `$${v.toFixed(2)}`,
  showCagr = true,
  className = 'mb-6',
}) {
  const [timeframe, setTimeframe] = useState('5Y');
  const [expanded, setExpanded] = useState(false);

  const selectedDays = PRICE_OPTIONS.find(o => o.label === timeframe)?.days || 1260;
  const sliceCount = selectedDays === Infinity ? labels.length : Math.min(selectedDays, labels.length);
  const slicedLabels = labels.slice(-sliceCount);
  const slicedData = data.slice(-sliceCount);

  const cagrs = showCagr ? [
    { label: '1Y', value: computeCAGR(labels, data, 1) },
    { label: '2Y', value: computeCAGR(labels, data, 2) },
    { label: '5Y', value: computeCAGR(labels, data, 5) },
    { label: '10Y', value: computeCAGR(labels, data, 10) },
  ] : [];
  const hasCagr = showCagr && cagrs.some(c => c.value !== null);

  const renderChart = (containerClassName) => (
    <LineChart
      labels={slicedLabels}
      data={slicedData}
      label={chartLabel}
      color={color}
      formatY={formatY}
      containerClassName={containerClassName}
    />
  );

  const toggle = <TimeframeToggle value={timeframe} onChange={setTimeframe} />;

  return (
    <>
      <Card
        title={title}
        actions={
          <div className="flex items-center gap-2">
            {toggle}
            <ExpandButton onClick={() => setExpanded(true)} />
          </div>
        }
        className={className}
      >
        {renderChart('chart-container')}
        {hasCagr && <CagrRow cagrs={cagrs} />}
      </Card>

      {expanded && (
        <ChartModal title={title} actions={toggle} onClose={() => setExpanded(false)}>
          {renderChart('chart-container-lg')}
          {hasCagr && <CagrRow cagrs={cagrs} />}
        </ChartModal>
      )}
    </>
  );
}
