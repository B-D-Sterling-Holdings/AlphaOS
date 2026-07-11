'use client';

import { useRef, useEffect, useState } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export default function LineChart({ labels, data, label = '', color = '#10b981', formatY, fillArea = true, containerClassName = 'chart-container' }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const dragState = useRef({ dragging: false, startIdx: null, endIdx: null });
  const [dragInfo, setDragInfo] = useState(null);

  useEffect(() => {
    if (!canvasRef.current || !data || !data.length) return;

    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext('2d');

    // Scriptable fill so the area gradient always spans the real plot height
    // (fixed heights break when the chart is expanded into the modal).
    const areaFill = (context) => {
      const chart = context.chart;
      const area = chart.chartArea;
      if (!area) return color + '15';
      const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, color + '2e');
      g.addColorStop(1, color + '02');
      return g;
    };

    // Plugin to draw drag selection overlay
    const dragOverlayPlugin = {
      id: 'dragOverlay',
      afterDraw(chart) {
        const ds = dragState.current;
        if (!ds.dragging || ds.startIdx === null || ds.endIdx === null) return;

        const { ctx: drawCtx, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta.data.length) return;

        const minIdx = Math.min(ds.startIdx, ds.endIdx);
        const maxIdx = Math.max(ds.startIdx, ds.endIdx);

        const startX = meta.data[minIdx]?.x;
        const endX = meta.data[maxIdx]?.x;
        if (startX == null || endX == null) return;

        drawCtx.save();
        drawCtx.fillStyle = 'rgba(16, 185, 129, 0.08)';
        drawCtx.fillRect(startX, chartArea.top, endX - startX, chartArea.bottom - chartArea.top);

        // Vertical lines at start and end
        drawCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
        drawCtx.lineWidth = 1;
        drawCtx.setLineDash([4, 3]);
        drawCtx.beginPath();
        drawCtx.moveTo(startX, chartArea.top);
        drawCtx.lineTo(startX, chartArea.bottom);
        drawCtx.moveTo(endX, chartArea.top);
        drawCtx.lineTo(endX, chartArea.bottom);
        drawCtx.stroke();
        drawCtx.setLineDash([]);
        drawCtx.restore();
      },
    };

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: fillArea ? areaFill : 'transparent',
          borderWidth: 2,
          fill: fillArea,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: color,
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
            ticks: { color: '#9ca3af', maxTicksLimit: 8, font: { size: 10, family: 'Plus Jakarta Sans' } },
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
      plugins: [dragOverlayPlugin],
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [labels, data, label, color, formatY, fillArea]);

  // Get the nearest data index from a mouse event
  function getIndexFromEvent(e) {
    const chart = chartRef.current;
    if (!chart) return null;
    const elements = chart.getElementsAtEventForMode(e.nativeEvent, 'index', { intersect: false }, false);
    if (elements.length > 0) return elements[0].index;
    return null;
  }

  function updateDragInfo(idx, clientX, clientY) {
    const startVal = data[dragState.current.startIdx];
    const endVal = data[idx];
    if (startVal && endVal && startVal !== 0) {
      const pctChange = ((endVal - startVal) / startVal) * 100;
      const startLabel = labels[dragState.current.startIdx];
      const endLabel = labels[idx];
      const startPrice = formatY ? formatY(startVal) : startVal.toFixed(2);
      const endPrice = formatY ? formatY(endVal) : endVal.toFixed(2);

      const rect = canvasRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      setDragInfo({ pctChange, startLabel, endLabel, startPrice, endPrice, x, y, width: rect.width });
    }
  }

  function handleMouseDown(e) {
    const idx = getIndexFromEvent(e);
    if (idx === null) return;
    dragState.current = { dragging: true, startIdx: idx, endIdx: idx };
    // Disable tooltip while dragging
    if (chartRef.current) {
      chartRef.current.options.plugins.tooltip.enabled = false;
      chartRef.current.update('none');
    }
    setDragInfo(null);
  }

  function handleMouseMove(e) {
    if (!dragState.current.dragging) return;
    const idx = getIndexFromEvent(e);
    if (idx === null) return;
    dragState.current.endIdx = idx;
    updateDragInfo(idx, e.clientX, e.clientY);
    if (chartRef.current) chartRef.current.draw();
  }

  function endDrag() {
    if (!dragState.current.dragging) return;
    dragState.current = { dragging: false, startIdx: null, endIdx: null };
    setDragInfo(null);
    if (chartRef.current) {
      chartRef.current.options.plugins.tooltip.enabled = true;
      chartRef.current.draw();
    }
  }

  // Listen for mouseup on window so releasing outside the chart still ends the drag
  useEffect(() => {
    function onGlobalMouseUp() {
      endDrag();
    }
    window.addEventListener('mouseup', onGlobalMouseUp);
    return () => window.removeEventListener('mouseup', onGlobalMouseUp);
  }, []);

  if (!data || !data.length) {
    return <div className="text-gray-400 text-sm text-center py-8">No data available</div>;
  }

  return (
    <div className={`${containerClassName} relative select-none`} style={{ cursor: 'crosshair' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      />
      {dragInfo && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: Math.min(dragInfo.x + 12, (dragInfo.width || 0) - 180),
            top: Math.max(dragInfo.y - 60, 4),
          }}
        >
          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3 py-2 min-w-[140px]">
            <div className={`text-lg font-bold ${dragInfo.pctChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {dragInfo.pctChange >= 0 ? '+' : ''}{dragInfo.pctChange.toFixed(2)}%
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {dragInfo.startPrice} → {dragInfo.endPrice}
            </div>
            <div className="text-[10px] text-gray-300">
              {dragInfo.startLabel} → {dragInfo.endLabel}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
