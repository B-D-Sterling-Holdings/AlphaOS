'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Trash2, ZoomIn, X, Image as ImageIcon, Bold, Italic, Underline as UnderlineIcon, Type, Table as TableIcon, List as ListIcon } from 'lucide-react';

/**
 * RichTextArea — a contentEditable rich-text editor with inline images.
 *
 * Value format:
 *   - Legacy: plain string (auto-converted to [{type:'text', value:'...'}])
 *   - New: array of blocks: [{type:'text', value:'<html or text>'}, {type:'image', url, path, name}]
 *
 * Text blocks store HTML (bold/italic/underline/font-size). Plain-text legacy
 * values render identically — newlines become <br> on display.
 */

const FONT_SIZES = [
  { label: 'S', value: '2', title: 'Small' },
  { label: 'M', value: '3', title: 'Normal' },
  { label: 'L', value: '5', title: 'Large' },
  { label: 'XL', value: '6', title: 'Huge' },
];

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toDisplayHTML(val) {
  if (!val) return '';
  const looksLikeHtml = /<\/?(p|br|b|i|u|strong|em|span|div|font|table|thead|tbody|tr|td|th|img|ul|ol|li)\b/i.test(val);
  if (looksLikeHtml) return val;
  return escapeHtml(val).replace(/\n/g, '<br>');
}

// Build a clean, empty table for the Insert-table picker. First row is a header
// (<th>); body cells carry a <br> so they have height and are clickable. The
// trailing <p> lets the caret land after the table to keep typing.
function buildTableHTML(rows, cols) {
  let html = '<table class="rt-table"><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const tag = r === 0 ? 'th' : 'td';
      html += `<${tag}><br></${tag}>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table><p><br></p>';
  return html;
}

// Rebuild a single pasted <table> into a clean one: drop all inline styles,
// classes and junk, keep only the grid (rows/cells), colspan/rowspan and cell
// text. The first row — or any <th> — becomes a header for consistent styling.
function cleanTable(tableEl) {
  const out = document.createElement('table');
  out.className = 'rt-table';
  const body = document.createElement('tbody');
  const anyTh = !!tableEl.querySelector('th');
  const rows = Array.from(tableEl.querySelectorAll('tr')).filter(tr => tr.closest('table') === tableEl);
  rows.forEach((tr, rIdx) => {
    const cells = Array.from(tr.children).filter(ch => /^(td|th)$/i.test(ch.tagName));
    if (!cells.length) return;
    const newTr = document.createElement('tr');
    cells.forEach(cell => {
      const asHeader = /^th$/i.test(cell.tagName) || (rIdx === 0 && !anyTh);
      const newCell = document.createElement(asHeader ? 'th' : 'td');
      const cs = cell.getAttribute('colspan');
      const rs = cell.getAttribute('rowspan');
      if (cs && Number(cs) > 1) newCell.setAttribute('colspan', cs);
      if (rs && Number(rs) > 1) newCell.setAttribute('rowspan', rs);
      const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) newCell.textContent = text;
      else newCell.innerHTML = '<br>';
      newTr.appendChild(newCell);
    });
    body.appendChild(newTr);
  });
  out.appendChild(body);
  return out;
}

// Extract and sanitize all top-level tables from pasted HTML. Returns '' when
// the clipboard has no table, so the caller falls back to plain-text paste.
function sanitizeTablesFromHTML(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table')).filter(t => !t.parentElement?.closest('table'));
    if (!tables.length) return '';
    return tables.map(t => cleanTable(t).outerHTML).join('<br>');
  } catch {
    return '';
  }
}

// Pull the src of every <img> out of pasted HTML (covers images copied from web
// pages / docs, which arrive as markup rather than as a file on the clipboard).
function extractImageSrcs(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('img'))
      .map(img => img.getAttribute('src'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function inlineImgTag(url, name) {
  const safeUrl = String(url || '').replace(/"/g, '&quot;');
  const safeName = String(name || '').replace(/"/g, '&quot;');
  return `<img src="${safeUrl}" alt="${safeName}" class="rt-inline-img" />`;
}

function placeCaretInCell(cell) {
  if (!cell) return;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function isEmptyHTML(html) {
  if (!html) return true;
  if (/<img\b/i.test(html)) return false;
  const stripped = String(html).replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
  return stripped.length === 0;
}

function EditableBlock({
  valueHTML,
  onInput,
  onBlur,
  onFocus,
  onPaste,
  placeholder,
  rows,
  className,
  enableTables,
  inlineImageResize,
}) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const focusedRef = useRef(false);
  const lastHTMLRef = useRef(valueHTML);
  const selImgRef = useRef(null);
  const [imgSel, setImgSel] = useState(null);

  const clearImgSelection = useCallback(() => {
    selImgRef.current = null;
    setImgSel(null);
  }, []);

  // Position the resize overlay over the currently-selected inline image,
  // measured relative to the editor wrapper.
  const syncImgSelection = useCallback(() => {
    const img = selImgRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap || !wrap.contains(img)) { setImgSel(null); return; }
    const ir = img.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    setImgSel({ left: ir.left - wr.left, top: ir.top - wr.top, width: ir.width, height: ir.height });
  }, []);

  // Initial mount — set innerHTML once
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = valueHTML || '';
      lastHTMLRef.current = valueHTML || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value change — only sync DOM when not focused
  useEffect(() => {
    if (!ref.current) return;
    if (focusedRef.current) return;
    if ((valueHTML || '') === lastHTMLRef.current) return;
    ref.current.innerHTML = valueHTML || '';
    lastHTMLRef.current = valueHTML || '';
  }, [valueHTML]);

  const handleInput = () => {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    lastHTMLRef.current = html;
    onInput(html);
  };

  const handleFocus = (e) => {
    focusedRef.current = true;
    onFocus?.(e);
  };

  const handleBlur = (e) => {
    focusedRef.current = false;
    // Keep the overlay if focus moved into the resize handle itself.
    if (!e.relatedTarget || !e.relatedTarget.dataset?.rtImgHandle) clearImgSelection();
    onBlur?.(e);
  };

  // Click an inline image to select it (shows the resize handle); click anywhere
  // else clears the selection.
  const handleClick = (e) => {
    if (!inlineImageResize) return;
    if (e.target?.tagName === 'IMG' && ref.current?.contains(e.target)) {
      selImgRef.current = e.target;
      syncImgSelection();
    } else {
      clearImgSelection();
    }
  };

  // Drag the corner handle to resize the selected inline image. Width is stored
  // as a percentage of the editor so it stays responsive; the change persists
  // through onInput (saved on the next blur, like any text edit).
  const startImgDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const img = selImgRef.current;
    const editor = ref.current;
    if (!img || !editor) return;
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const editorW = editor.clientWidth || 1;

    const onMove = (ev) => {
      const nextW = startW + (ev.clientX - startX);
      const pct = Math.max(8, Math.min(100, Math.round((nextW / editorW) * 100)));
      img.style.width = `${pct}%`;
      img.style.height = 'auto';
      syncImgSelection();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      handleInput();
      syncImgSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const deleteSelectedImg = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const img = selImgRef.current;
    if (img?.parentNode) {
      img.parentNode.removeChild(img);
      handleInput();
    }
    clearImgSelection();
  };

  // Inside a table, Tab/Shift+Tab walks cells; Tab in the last cell appends a new
  // row. Outside a table, Tab keeps its default behavior (moving focus away).
  const handleKeyDown = (e) => {
    if (inlineImageResize && selImgRef.current) clearImgSelection();

    // Markdown-style bullets: "-" or "*" at the start of a line, then space,
    // turns the line into a bullet list. Enter then continues / exits the list
    // (handled natively by contentEditable).
    if (e.key === ' ' && ref.current) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && ref.current.contains(sel.anchorNode)) {
        const caret = sel.getRangeAt(0);
        if (caret.collapsed) {
          const pre = document.createRange();
          pre.selectNodeContents(ref.current);
          pre.setEnd(caret.startContainer, caret.startOffset);
          const lineBefore = pre.toString().split('\n').pop();
          if (lineBefore === '-' || lineBefore === '*') {
            e.preventDefault();
            document.execCommand('delete'); // remove the "-"/"*" marker
            document.execCommand('insertUnorderedList');
            handleInput();
            return;
          }
        }
      }
    }

    if (!enableTables || e.key !== 'Tab') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    const startEl = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    const cell = startEl?.closest?.('td,th');
    if (!cell || !ref.current?.contains(cell)) return;
    e.preventDefault();
    const row = cell.parentElement;
    const cells = Array.from(row.cells || row.querySelectorAll('td,th'));
    const idx = cells.indexOf(cell);

    if (e.shiftKey) {
      if (idx > 0) { placeCaretInCell(cells[idx - 1]); return; }
      const prevRow = row.previousElementSibling;
      if (prevRow) placeCaretInCell((prevRow.cells || prevRow.querySelectorAll('td,th'))[prevRow.cells ? prevRow.cells.length - 1 : 0]);
      return;
    }

    if (idx < cells.length - 1) { placeCaretInCell(cells[idx + 1]); return; }
    const nextRow = row.nextElementSibling;
    if (nextRow) { placeCaretInCell((nextRow.cells || nextRow.querySelectorAll('td,th'))[0]); return; }
    // Last cell of the last row — append a matching empty row.
    const newRow = document.createElement('tr');
    for (let i = 0; i < cells.length; i++) {
      const td = document.createElement('td');
      td.innerHTML = '<br>';
      newRow.appendChild(td);
    }
    row.parentElement.appendChild(newRow);
    placeCaretInCell(newRow.cells[0]);
    handleInput();
  };

  const minHeight = (rows || 4) * 22 + 24;
  const isEmpty = isEmptyHTML(valueHTML);

  return (
    <div className="relative group" ref={wrapRef}>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPaste={onPaste}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        className={`${className} rich-text-editor`}
        data-empty={isEmpty ? 'true' : 'false'}
        data-placeholder={placeholder || ''}
        style={{ minHeight: `${minHeight}px`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      />
      {inlineImageResize && imgSel && (
        <div
          className="absolute pointer-events-none border-2 border-emerald-400/80 rounded-md z-10"
          style={{ left: imgSel.left, top: imgSel.top, width: imgSel.width, height: imgSel.height }}
        >
          <button
            type="button"
            data-rt-img-handle="1"
            onMouseDown={startImgDrag}
            className="pointer-events-auto absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-emerald-500 rounded-sm shadow cursor-nwse-resize"
            title="Drag to resize"
          />
          <button
            type="button"
            data-rt-img-handle="1"
            onMouseDown={deleteSelectedImg}
            className="pointer-events-auto absolute -top-2.5 -right-2.5 w-5 h-5 flex items-center justify-center bg-white border border-gray-200 rounded-full shadow text-red-500 hover:bg-red-50"
            title="Remove image"
          >
            <X size={11} strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}

function Toolbar({ onCommand, enableTables, sticky }) {
  const [tableOpen, setTableOpen] = useState(false);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const TABLE_MAX = 6;

  const exec = (cmd, val) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCommand(cmd, val);
  };

  const btn = `p-1.5 rounded-md hover:bg-emerald-50 text-gray-600 hover:text-emerald-700 transition-colors`;

  const insertTable = (rows, cols) => {
    setTableOpen(false);
    setHover({ r: 0, c: 0 });
    onCommand('insertHTML', buildTableHTML(rows, cols));
  };

  return (
    <div
      className={`flex items-center gap-1 mb-2 px-2 py-1.5 border border-gray-200 rounded-xl w-fit ${
        sticky
          ? 'sticky top-20 z-30 bg-white/95 backdrop-blur shadow-sm'
          : 'bg-gray-50/80'
      }`}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className={btn} title="Bold (Ctrl+B)" onMouseDown={exec('bold')}>
        <Bold size={14} />
      </button>
      <button type="button" className={btn} title="Italic (Ctrl+I)" onMouseDown={exec('italic')}>
        <Italic size={14} />
      </button>
      <button type="button" className={btn} title="Underline (Ctrl+U)" onMouseDown={exec('underline')}>
        <UnderlineIcon size={14} />
      </button>
      <button type="button" className={btn} title="Bullet list" onMouseDown={exec('insertUnorderedList')}>
        <ListIcon size={14} />
      </button>
      <div className="w-px h-5 bg-gray-200 mx-1" />
      <Type size={13} className="text-gray-400" />
      {FONT_SIZES.map(s => (
        <button
          key={s.value}
          type="button"
          title={s.title}
          className={`${btn} text-[11px] font-bold min-w-[24px]`}
          onMouseDown={exec('fontSize', s.value)}
        >
          {s.label}
        </button>
      ))}
      {enableTables && (
        <>
          <div className="w-px h-5 bg-gray-200 mx-1" />
          <div className="relative">
            <button
              type="button"
              className={btn}
              title="Insert table"
              onMouseDown={(e) => { e.preventDefault(); setTableOpen(o => !o); }}
            >
              <TableIcon size={14} />
            </button>
            {tableOpen && (
              <div
                className="absolute z-30 top-full left-0 mt-1 p-2 bg-white border border-gray-200 rounded-xl shadow-lg"
                onMouseLeave={() => setHover({ r: 0, c: 0 })}
              >
                <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${TABLE_MAX}, 1fr)` }}>
                  {Array.from({ length: TABLE_MAX * TABLE_MAX }).map((_, i) => {
                    const r = Math.floor(i / TABLE_MAX) + 1;
                    const c = (i % TABLE_MAX) + 1;
                    const on = r <= hover.r && c <= hover.c;
                    return (
                      <button
                        key={i}
                        type="button"
                        onMouseEnter={() => setHover({ r, c })}
                        onMouseDown={(e) => { e.preventDefault(); insertTable(r, c); }}
                        className={`w-4 h-4 rounded-sm border transition-colors ${on ? 'bg-emerald-400 border-emerald-500' : 'bg-gray-50 border-gray-200'}`}
                      />
                    );
                  })}
                </div>
                <div className="text-[10px] text-gray-400 text-center mt-1.5">
                  {hover.r > 0 ? `${hover.r} × ${hover.c} table` : 'Pick size'}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const IMAGE_SIZE_PRESETS = [
  { label: 'S', value: 25 },
  { label: 'M', value: 50 },
  { label: 'L', value: 75 },
  { label: 'Full', value: 100 },
];

/**
 * ImageBlock — renders an inline image. When `resizable`, the width (stored as a
 * percentage of the editor column on block.width) can be set via preset buttons
 * or by dragging the bottom-right handle. Width changes are committed through
 * onResize so they persist.
 */
function ImageBlock({ block, idx, resizable, onResize, onRemove, onPreview }) {
  const wrapRef = useRef(null);
  const pctRef = useRef(null);
  const [livePct, setLivePct] = useState(null);
  const [dragging, setDragging] = useState(false);

  const savedPct = typeof block.width === 'number' ? block.width : null;
  const displayPct = livePct ?? savedPct ?? 100;

  const startDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current;
    const imgEl = wrap?.querySelector('img');
    const columnEl = wrap?.parentElement;
    if (!imgEl || !columnEl) return;
    const columnWidth = columnEl.getBoundingClientRect().width;
    const startX = e.clientX;
    const startWidthPx = imgEl.getBoundingClientRect().width;
    setDragging(true);

    const onMove = (ev) => {
      const nextPx = startWidthPx + (ev.clientX - startX);
      const pct = Math.max(10, Math.min(100, Math.round((nextPx / columnWidth) * 100)));
      pctRef.current = pct;
      setLivePct(pct);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(false);
      if (pctRef.current != null) onResize(idx, pctRef.current);
      pctRef.current = null;
      setLivePct(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="relative my-2">
      <div
        ref={wrapRef}
        className="group relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 inline-block align-top max-w-full"
        style={{ width: `${displayPct}%` }}
      >
        <img
          src={block.url}
          alt={block.name || 'Inline image'}
          className={`w-full object-contain cursor-pointer block ${resizable ? '' : 'max-h-96'}`}
          onClick={() => onPreview(block.url)}
          draggable={false}
        />
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onPreview(block.url)}
            className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm text-gray-600"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() => onRemove(idx)}
            className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm text-red-500"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {resizable && (
          <>
            <div className="absolute bottom-2 left-2 flex items-center gap-0.5 p-0.5 bg-white/90 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
              {IMAGE_SIZE_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  onClick={() => onResize(idx, preset.value)}
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-colors ${
                    (savedPct ?? 100) === preset.value
                      ? 'bg-emerald-500 text-white'
                      : 'text-gray-500 hover:bg-emerald-50 hover:text-emerald-700'
                  }`}
                  title={`${preset.value}% width`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div
              onMouseDown={startDrag}
              className="absolute bottom-0 right-0 w-4 h-4 flex items-center justify-center cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity"
              title="Drag to resize"
            >
              <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-white drop-shadow" />
            </div>
            {dragging && (
              <div className="absolute bottom-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-gray-900/80 text-white">
                {displayPct}%
              </div>
            )}
          </>
        )}
      </div>
      {block.name && (
        <p className="text-[10px] text-gray-400 mt-0.5 pl-1">{block.name}</p>
      )}
    </div>
  );
}

export default function RichTextArea({ value, onChange, ticker, placeholder, rows = 4, className = '', onBlur, onCommit, enableTables = false, resizableImages = false, inlineImages = false, stickyToolbar = false }) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [focusedBlockIdx, setFocusedBlockIdx] = useState(null);
  const lastFocusedIdxRef = useRef(null);

  const blocks = Array.isArray(value)
    ? value
    : [{ type: 'text', value: value || '' }];
  const normalizedBlocks = blocks.length === 0 ? [{ type: 'text', value: '' }] : blocks;

  const emitChange = useCallback((newBlocks) => {
    onChange(newBlocks);
  }, [onChange]);

  const updateTextBlock = (idx, html) => {
    const updated = normalizedBlocks.map((b, i) => i === idx ? { ...b, value: html } : b);
    emitChange(updated);
  };

  const uploadImage = async (file) => {
    if (!file || !file.type.startsWith('image/')) return null;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('ticker', ticker || 'GENERAL');
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url) {
      return { type: 'image', url: data.url, path: data.path, name: file.name };
    }
    return null;
  };

  // Turn an <img src> (from pasted HTML) into an image block. data: URIs and
  // same-origin/CORS-friendly URLs are re-uploaded to our storage so the paper
  // doesn't carry giant base64 or break when the source expires; if the fetch is
  // blocked (cross-origin), fall back to referencing the remote URL directly so
  // the image still renders and resizes.
  const srcToImageBlock = async (src) => {
    if (!src) return null;
    try {
      const blob = await (await fetch(src)).blob();
      if (blob && blob.type.startsWith('image/')) {
        const ext = (blob.type.split('/')[1] || 'png').split('+')[0];
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type });
        const uploaded = await uploadImage(file);
        if (uploaded) return uploaded;
      }
    } catch {
      // Cross-origin fetch blocked — reference the remote image directly.
    }
    if (src.startsWith('data:')) return null; // never embed un-uploaded base64
    return { type: 'image', url: src, name: '' };
  };

  // Insert images at idx by running async `producers` (each resolves to a block).
  // Shared by file paste/upload and pasted-HTML images.
  const insertImageProducersAt = async (idx, producers, captureCursor = null) => {
    if (!producers || producers.length === 0) return;
    setUploading(true);
    try {
      const newBlocks = [...normalizedBlocks];
      const current = newBlocks[idx];
      let insertAt;

      if (current?.type === 'text' && captureCursor) {
        const { beforeHTML, afterHTML } = captureCursor();
        newBlocks[idx] = { ...current, value: beforeHTML };
        newBlocks.splice(idx + 1, 0, { type: 'text', value: afterHTML });
        insertAt = idx + 1;
      } else {
        insertAt = idx + 1;
      }

      for (const produce of producers) {
        const imgBlock = await produce();
        if (imgBlock) {
          newBlocks.splice(insertAt, 0, imgBlock);
          insertAt++;
          if (insertAt >= newBlocks.length || newBlocks[insertAt]?.type !== 'text') {
            newBlocks.splice(insertAt, 0, { type: 'text', value: '' });
            insertAt++;
          }
        }
      }
      emitChange(newBlocks);
      onCommit?.(newBlocks);
    } finally {
      setUploading(false);
    }
  };

  const insertImagesAt = (idx, files, captureCursor = null) =>
    insertImageProducersAt(idx, (files || []).map(file => () => uploadImage(file)), captureCursor);

  const insertImageSrcsAt = (idx, srcs, captureCursor = null) =>
    insertImageProducersAt(idx, (srcs || []).map(src => () => srcToImageBlock(src)), captureCursor);

  // Insert images inline at the caret inside `editorEl` (the focused text block),
  // as real <img> tags in the HTML so they flow with the text and can be drag-
  // resized. `producers` resolve to { url, name }. The caret/selection is captured
  // up front and restored after each (async) upload so insertHTML lands correctly.
  const insertInlineImages = async (blockIdx, editorEl, producers) => {
    if (!editorEl || !producers.length) return;
    const sel = window.getSelection();
    let savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setUploading(true);
    try {
      for (const produce of producers) {
        const block = await produce();
        if (!block?.url) continue;
        editorEl.focus();
        if (savedRange) {
          sel.removeAllRanges();
          sel.addRange(savedRange);
        }
        document.execCommand('insertHTML', false, inlineImgTag(block.url, block.name));
        if (sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
      }
      const html = editorEl.innerHTML;
      const updated = normalizedBlocks.map((b, i) => i === blockIdx ? { ...b, value: html } : b);
      emitChange(updated);
      onCommit?.(updated);
    } finally {
      setUploading(false);
    }
  };

  const insertImageAfter = (idx, files) => {
    if (inlineImages) {
      const editorEl = document.querySelector(`[data-rt-block="${idx}"] [contenteditable]`);
      if (editorEl) {
        editorEl.focus();
        return insertInlineImages(idx, editorEl, files.map(file => () => uploadImage(file)));
      }
    }
    return insertImagesAt(idx, files, null);
  };

  const setImageWidth = (idx, pct) => {
    const newBlocks = normalizedBlocks.map((b, i) => i === idx ? { ...b, width: pct } : b);
    emitChange(newBlocks);
    onCommit?.(newBlocks);
  };

  const removeImage = async (idx) => {
    const block = normalizedBlocks[idx];
    if (block?.path) {
      try { await fetch(`/api/upload?path=${encodeURIComponent(block.path)}`, { method: 'DELETE' }); } catch {}
    }
    const newBlocks = normalizedBlocks.filter((_, i) => i !== idx);
    const merged = [];
    for (const b of newBlocks) {
      if (b.type === 'text' && merged.length > 0 && merged[merged.length - 1].type === 'text') {
        const a = merged[merged.length - 1].value || '';
        const c = b.value || '';
        merged[merged.length - 1] = { ...merged[merged.length - 1], value: a + (a && c ? '<br>' : '') + c };
      } else {
        merged.push(b);
      }
    }
    const finalBlocks = merged.length > 0 ? merged : [{ type: 'text', value: '' }];
    emitChange(finalBlocks);
    onCommit?.(finalBlocks);
  };

  /**
   * Split the contentEditable at the current caret position. Returns
   * { beforeHTML, afterHTML } HTML strings.
   */
  const splitAtCaret = (editorEl) => {
    if (!editorEl) return { beforeHTML: editorEl?.innerHTML || '', afterHTML: '' };
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.anchorNode)) {
      return { beforeHTML: editorEl.innerHTML, afterHTML: '' };
    }
    const range = sel.getRangeAt(0);
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(editorEl);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(editorEl);
    afterRange.setStart(range.endContainer, range.endOffset);

    const beforeDiv = document.createElement('div');
    beforeDiv.appendChild(beforeRange.cloneContents());
    const afterDiv = document.createElement('div');
    afterDiv.appendChild(afterRange.cloneContents());
    return { beforeHTML: beforeDiv.innerHTML, afterHTML: afterDiv.innerHTML };
  };

  const handlePaste = async (e, blockIdx) => {
    const items = e.clipboardData?.items;
    const imageFiles = [];
    if (items) {
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      const editorEl = e.currentTarget;
      if (inlineImages) {
        await insertInlineImages(blockIdx, editorEl, imageFiles.map(file => () => uploadImage(file)));
      } else {
        await insertImagesAt(blockIdx, imageFiles, () => splitAtCaret(editorEl));
      }
      return;
    }

    const html = e.clipboardData?.getData('text/html');

    // Pasted table: keep the grid (sanitized) instead of flattening to text.
    if (enableTables && html && /<table/i.test(html)) {
      const cleaned = sanitizeTablesFromHTML(html);
      if (cleaned) {
        e.preventDefault();
        const editorEl = e.currentTarget;
        document.execCommand('insertHTML', false, cleaned + '<p><br></p>');
        updateTextBlock(blockIdx, editorEl.innerHTML);
        return;
      }
    }

    // Image(s) pasted as HTML (copied from a web page / doc rather than as a
    // file): turn them into real images so they render — and resize — instead of
    // landing as raw inline markup.
    if (html && /<img/i.test(html)) {
      const srcs = extractImageSrcs(html);
      // Only divert to image insertion when the paste is essentially just
      // image(s); if there's substantial text too, let the normal text path run.
      const textLen = (e.clipboardData?.getData('text/plain') || '').trim().length;
      if (srcs.length > 0 && textLen < 5) {
        e.preventDefault();
        const editorEl = e.currentTarget;
        if (inlineImages) {
          await insertInlineImages(blockIdx, editorEl, srcs.map(src => () => srcToImageBlock(src)));
        } else {
          await insertImageSrcsAt(blockIdx, srcs, () => splitAtCaret(editorEl));
        }
        return;
      }
    }

    // Plain text: insert as text (avoid huge HTML from word/google docs)
    const plain = e.clipboardData?.getData('text/plain');
    if (plain) {
      e.preventDefault();
      document.execCommand('insertText', false, plain);
    }
  };

  const runCommand = (cmd, val) => {
    // Restore focus on most-recently focused editor (toolbar mousedown prevented blur).
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    // Push the updated HTML upstream
    const idx = lastFocusedIdxRef.current;
    if (idx != null) {
      // Read the contentEditable itself, not the wrapper (which also contains the
      // hidden image-upload label) — otherwise that markup leaks into the value.
      const editorEl = document.querySelector(`[data-rt-block="${idx}"] [contenteditable]`);
      if (editorEl) {
        const html = editorEl.innerHTML;
        const updated = normalizedBlocks.map((b, i) => i === idx ? { ...b, value: html } : b);
        emitChange(updated);
      }
    }
  };

  const defaultTextClass = `w-full bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200`;

  return (
    <div>
      <style jsx global>{`
        .rich-text-editor[data-empty="true"]::before {
          content: attr(data-placeholder);
          color: #d1d5db;
          pointer-events: none;
          display: block;
        }
        .rich-text-editor:focus[data-empty="true"]::before {
          opacity: 0.5;
        }
        .rich-text-editor table {
          border-collapse: collapse;
          width: 100%;
          margin: 10px 0;
          font-size: 13px;
          table-layout: fixed;
        }
        .rich-text-editor td,
        .rich-text-editor th {
          border: 1px solid #e5e7eb;
          padding: 6px 10px;
          text-align: left;
          vertical-align: top;
          min-width: 40px;
          word-break: break-word;
        }
        .rich-text-editor th,
        .rich-text-editor tr:first-child td {
          background: #f9fafb;
          font-weight: 600;
          color: #374151;
        }
        .rich-text-editor table.rt-table {
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          border-radius: 6px;
          overflow: hidden;
        }
        .rich-text-editor img {
          max-width: 100%;
          height: auto;
          border-radius: 6px;
          vertical-align: middle;
        }
        .rich-text-editor img.rt-inline-img {
          display: inline-block;
        }
        .rich-text-editor ul {
          list-style: disc;
          margin: 6px 0;
          padding-left: 24px;
        }
        .rich-text-editor ol {
          list-style: decimal;
          margin: 6px 0;
          padding-left: 24px;
        }
        .rich-text-editor li {
          margin: 2px 0;
        }
      `}</style>

      {focusedBlockIdx !== null && <Toolbar onCommand={runCommand} enableTables={enableTables} sticky={stickyToolbar} />}

      {normalizedBlocks.map((block, idx) => {
        if (block.type === 'image') {
          return (
            <ImageBlock
              key={idx}
              block={block}
              idx={idx}
              resizable={resizableImages}
              onResize={setImageWidth}
              onRemove={removeImage}
              onPreview={setPreviewUrl}
            />
          );
        }

        return (
          <div key={idx} className="relative group" data-rt-block={idx}>
            <EditableBlock
              valueHTML={toDisplayHTML(block.value)}
              onInput={(html) => updateTextBlock(idx, html)}
              onFocus={() => { setFocusedBlockIdx(idx); lastFocusedIdxRef.current = idx; }}
              onBlur={() => { setFocusedBlockIdx(prev => prev === idx ? null : prev); onBlur?.(normalizedBlocks); }}
              onPaste={(e) => handlePaste(e, idx)}
              placeholder={idx === 0 ? placeholder : 'Continue writing...'}
              rows={idx === 0 ? rows : 2}
              className={className || defaultTextClass}
              enableTables={enableTables}
              inlineImageResize={inlineImages}
            />
            <label
              className="absolute bottom-2 right-2 p-1 text-gray-300 hover:text-emerald-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-all"
              title="Add image"
            >
              <ImageIcon size={14} />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => insertImageAfter(idx, Array.from(e.target.files))}
              />
            </label>
          </div>
        );
      })}

      {uploading && (
        <div className="text-xs text-emerald-600 animate-pulse mt-1 pl-1">Uploading image...</div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-8"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          >
            <X size={20} />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
