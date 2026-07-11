'use client';

import { useState } from 'react';
import Card from '@/components/Card';
import LineChart from './LineChart';
import BarChart from './BarChart';
import ChartModal, { ExpandButton } from './ChartModal';

const QUARTER_OPTIONS = [
  { label: '1Y', quarters: 4 },
  { label: '2Y', quarters: 8 },
  { label: '5Y', quarters: 20 },
  { label: '10Y', quarters: 40 },
  { label: 'All', quarters: Infinity },
];

function parseQuarterLabel(label) {
  // Parse "Q4'20" or "Q1'23" into approximate date
  const match = label.match(/Q(\d)'(\d{2})/);
  if (!match) return null;
  const q = parseInt(match[1]);
  const yr = 2000 + parseInt(match[2]);
  const month = (q - 1) * 3 + 2; // Q1->Feb, Q2->May, Q3->Aug, Q4->Nov (mid-quarter)
  return new Date(yr, month, 15);
}

function computeCAGR(labels, data, targetYears) {
  if (!data || !labels || data.length < 2) return null;

  const endDate = parseQuarterLabel(labels[labels.length - 1]);
  if (!endDate) return null;
  const targetDate = new Date(endDate);
  targetDate.setFullYear(targetDate.getFullYear() - targetYears);

  // Find closest data point to targetDate
  let startIdx = 0;
  for (let i = 0; i < labels.length; i++) {
    const d = parseQuarterLabel(labels[i]);
    if (d && d >= targetDate) { startIdx = i; break; }
  }

  const startVal = data[startIdx];
  const endVal = data[data.length - 1];
  if (!startVal || !endVal || startVal <= 0 || endVal <= 0) return null;

  const startDate = parseQuarterLabel(labels[startIdx]);
  if (!startDate) return null;
  const actualYears = (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);
  if (actualYears < 0.5) return null;

  return (Math.pow(endVal / startVal, 1 / actualYears) - 1) * 100;
}

function TimeframeToggle({ value, onChange }) {
  return (
    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {QUARTER_OPTIONS.map(opt => (
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

function CagrRow({ cagrs, cagrLabel }) {
  return (
    <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100">
      {cagrs.map(c => (
        <div key={c.label} className="text-center">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold block">{c.label} {cagrLabel}</span>
          <span className={`text-sm font-bold ${c.value == null ? 'text-gray-300' : c.value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {c.value != null ? `${c.value >= 0 ? '+' : ''}${c.value.toFixed(2)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function FundamentalChart({
  title,
  labels,
  data,
  chartType = 'bar',
  label = '',
  formatY,
  color = '#10b981',
  colorPositive,
  colorNegative,
  showCagr = true,
  cagrLabel = 'CAGR',
}) {
  const [timeframe, setTimeframe] = useState('5Y');
  const [expanded, setExpanded] = useState(false);

  const selectedQ = QUARTER_OPTIONS.find(o => o.label === timeframe)?.quarters || 20;
  const sliceCount = selectedQ === Infinity ? labels.length : Math.min(selectedQ, labels.length);
  const slicedLabels = labels.slice(-sliceCount);
  const slicedData = data.slice(-sliceCount);

  // CAGR calculations — use full data (not sliced) so CAGRs are always accurate
  const cagrs = showCagr ? [
    { label: '1Y', value: computeCAGR(labels, data, 1) },
    { label: '2Y', value: computeCAGR(labels, data, 2) },
    { label: '5Y', value: computeCAGR(labels, data, 5) },
  ] : [];
  const hasCagr = showCagr && cagrs.some(c => c.value !== null);

  const ChartComponent = chartType === 'line' ? LineChart : BarChart;
  const renderChart = (containerClassName) => {
    const chartProps = chartType === 'line'
      ? { labels: slicedLabels, data: slicedData, label, color, formatY, containerClassName }
      : { labels: slicedLabels, data: slicedData, label, formatY, colorPositive, colorNegative, containerClassName };
    return <ChartComponent {...chartProps} />;
  };

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
      >
        {renderChart('chart-container')}
        {hasCagr && <CagrRow cagrs={cagrs} cagrLabel={cagrLabel} />}
      </Card>

      {expanded && (
        <ChartModal title={title} actions={toggle} onClose={() => setExpanded(false)}>
          {renderChart('chart-container-lg')}
          {hasCagr && <CagrRow cagrs={cagrs} cagrLabel={cagrLabel} />}
        </ChartModal>
      )}
    </>
  );
}
