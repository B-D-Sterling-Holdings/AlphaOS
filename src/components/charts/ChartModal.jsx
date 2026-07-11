'use client';

import { useEffect } from 'react';

/**
 * Full-screen overlay that hosts an expanded chart. The expand button lives on
 * each chart card (see FundamentalChart / PriceChart); clicking it renders the
 * exact same chart at viewport scale so the numbers can be read in detail.
 */
export default function ChartModal({ title, actions, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-8 bg-gray-900/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl border border-gray-100 shadow-2xl w-full max-w-6xl p-6 sm:p-8 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Small expand ("open in larger view") icon button for a chart card header. */
export function ExpandButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Expand chart"
      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>
  );
}
