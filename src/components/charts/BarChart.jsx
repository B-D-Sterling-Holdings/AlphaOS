'use client';

import { useRef, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export default function BarChart({ labels, data, label = '', formatY, colorPositive = '#10b981', colorNegative = '#ef4444', containerClassName = 'chart-container' }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext('2d');

    const colors = data.map(v => v >= 0 ? colorPositive : colorNegative);

    // Solid, vibrant bars with a subtle top-to-bottom fade (built per-bar so
    // the gradient tracks the plot area even after resize / expand).
    const barFill = (context) => {
      const c = colors[context.dataIndex] || colorPositive;
      const chart = context.chart;
      const area = chart.chartArea;
      if (!area) return c;
      const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, c);
      g.addColorStop(1, c + 'b0');
      return g;
    };

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: barFill,
          hoverBackgroundColor: colors,
          borderWidth: 0,
          borderRadius: 7,
          borderSkipped: false,
          maxBarThickness: 46,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            titleColor: '#111827',
            bodyColor: '#6b7280',
            padding: 12,
            cornerRadius: 12,
            boxPadding: 4,
            callbacks: {
              label: (ctx) => formatY ? formatY(ctx.parsed.y) : ctx.parsed.y.toFixed(2),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#9ca3af', maxTicksLimit: 12, font: { size: 10, family: 'Plus Jakarta Sans' } },
            border: { display: false },
          },
          y: {
            grid: { color: '#f3f4f6', drawTicks: false },
            ticks: {
              color: '#9ca3af',
              padding: 8,
              font: { size: 10, family: 'Plus Jakarta Sans' },
              callback: formatY || ((v) => v),
            },
            border: { display: false },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [labels, data, label, formatY, colorPositive, colorNegative]);

  if (!data || !data.length) {
    return <div className="text-gray-400 text-sm text-center py-8">No data available</div>;
  }

  return (
    <div className={containerClassName}>
      <canvas ref={canvasRef} />
    </div>
  );
}
