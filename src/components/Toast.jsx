'use client';

import { useEffect } from 'react';

export default function Toast({ message, type = 'info', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const styles = type === 'success' ? 'bg-emerald-600 text-white'
    : type === 'error' ? 'bg-red-500 text-white'
    : type === 'warning' ? 'bg-amber-500 text-white'
    : 'bg-gray-900 text-white';

  return (
    // Sits ABOVE the floating Feedback button (fixed bottom-6 right-6, ~48px tall)
    // rather than on top of it — bottom-24 clears the button + its notification
    // badge so save toasts never overlap it. See issue #94.
    <div className={`fixed bottom-24 right-6 z-50 px-5 py-3 rounded-2xl text-sm font-semibold ${styles} shadow-xl animate-[slideIn_0.3s_ease]`}>
      {message}
    </div>
  );
}
