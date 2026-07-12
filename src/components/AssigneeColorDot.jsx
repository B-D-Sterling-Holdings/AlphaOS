'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { COLOR_PALETTE } from '@/lib/taskBoard';

/*
  The little coloured circle next to a person in an assignee picker. Clicking it
  opens a palette so you can recolour that person's tag; picking a swatch calls
  `onPick(color)`. When `onPick` isn't provided it renders a plain, static dot
  (used where recolouring doesn't apply). The palette is portaled and positioned
  next to the dot so it never gets clipped by the picker's own scroll box.
*/
export default function AssigneeColorDot({ color, onPick, size = 10, title = 'Change colour' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dotRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (dotRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openPalette = (e) => {
    e.stopPropagation();
    if (!onPick) return;
    const rect = dotRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left });
    setOpen(o => !o);
  };

  const dot = (
    <span
      ref={dotRef}
      onClick={openPalette}
      role={onPick ? 'button' : undefined}
      title={onPick ? title : undefined}
      className={`inline-block rounded-full flex-shrink-0 ${onPick ? 'cursor-pointer ring-offset-1 hover:ring-2 hover:ring-gray-300' : ''}`}
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );

  if (!onPick) return dot;

  return (
    <>
      {dot}
      {open && createPortal(
        <div
          ref={popRef}
          data-rtp-popover
          data-assignee-color-pop
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[10000] bg-white border border-gray-200 rounded-xl shadow-lg p-2"
        >
          <div className="flex items-center gap-1.5 flex-wrap max-w-[150px]">
            {COLOR_PALETTE.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { onPick(c); setOpen(false); }}
                className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
