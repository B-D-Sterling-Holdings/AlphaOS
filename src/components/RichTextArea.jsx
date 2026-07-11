'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Image as ImageIcon, Bold, Italic, Underline as UnderlineIcon, Type, Table as TableIcon, List as ListIcon } from 'lucide-react';

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
  // Treat the value as HTML if it has tags OR HTML entities. contentEditable
  // serializes a typed "&" as "&amp;", so entity-only content (e.g. "Tom &amp;
  // Jerry") is already HTML and must NOT be re-escaped — otherwise every render
  // compounds it into "&amp;amp;".
  const looksLikeHtml = /<\/?(p|br|b|i|u|strong|em|span|div|font|table|thead|tbody|tr|td|th|img|ul|ol|li)\b/i.test(val)
    || /&(?:amp|lt|gt|quot|#\d+|nbsp);/i.test(val);
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

// Migrate a legacy { type:'image' } block (the old separate-block format) into an
// inline <img>, preserving its stored width. Inline images are the only image mode
// now, so old block-format content is folded into the text on render and persists
// inline on the next save.
function legacyImageBlockToHTML(block) {
  const widthStyle = typeof block?.width === 'number' ? ` style="width:${block.width}%"` : '';
  const safeUrl = String(block?.url || '').replace(/"/g, '&quot;');
  const safeName = String(block?.name || '').replace(/"/g, '&quot;');
  return `<img src="${safeUrl}" alt="${safeName}" class="rt-inline-img"${widthStyle} />`;
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
    // Update the placeholder flag live from the actual content. The JSX-bound
    // `data-empty` is derived from the `value` prop, which a parent may feed back
    // debounced (e.g. sticky notes) — so on its own the "Take a note…" placeholder
    // lingers over text until a save round-trips. Setting it here clears it the
    // instant you type; React reconciles the same value on the next render.
    ref.current.setAttribute('data-empty', isEmptyHTML(html) ? 'true' : 'false');
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
    if (selImgRef.current) clearImgSelection();

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
      {imgSel && (
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

function Toolbar({ onCommand, enableTables, sticky, compact }) {
  const [tableOpen, setTableOpen] = useState(false);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const TABLE_MAX = 6;

  const exec = (cmd, val) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCommand(cmd, val);
  };

  // `compact` (sticky notes): seamless, no chrome — dark-grey icons that blend
  // into the note, no boxed background.
  const btn = compact
    ? `p-1 rounded-md text-gray-700 hover:text-gray-900 hover:bg-black/5 transition-colors`
    : `p-1.5 rounded-md hover:bg-emerald-50 text-gray-600 hover:text-emerald-700 transition-colors`;

  const insertTable = (rows, cols) => {
    setTableOpen(false);
    setHover({ r: 0, c: 0 });
    onCommand('insertHTML', buildTableHTML(rows, cols));
  };

  return (
    <div
      // compact: a borderless, background-free strip that sits flush with the note;
      // otherwise the boxed toolbar used by Draft & Review / Issues.
      className={
        compact
          ? 'flex items-center gap-0.5 flex-wrap mb-1.5'
          : `flex items-center gap-1 mb-2 px-2 py-1.5 border border-gray-200 rounded-xl w-fit ${
              sticky ? 'sticky top-20 z-30 bg-white/95 backdrop-blur shadow-sm' : 'bg-gray-50/80'
            }`
      }
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
      {/* Font sizes are hidden in compact mode (kept for Draft & Review / Issues). */}
      {!compact && (
        <>
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
        </>
      )}
      {enableTables && (
        <>
          {!compact && <div className="w-px h-5 bg-gray-200 mx-1" />}
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

export default function RichTextArea({ value, onChange, ticker, placeholder, rows = 4, className = '', onBlur, onCommit, enableTables = false, stickyToolbar = false, compact = false }) {
  const [uploading, setUploading] = useState(false);
  const [focusedBlockIdx, setFocusedBlockIdx] = useState(null);
  const lastFocusedIdxRef = useRef(null);

  // Images are always inline now (real <img> tags in the text flow). Everything
  // collapses into a single rich-text block: text blocks are concatenated and any
  // legacy { type:'image' } block is folded in as an inline <img> — so old
  // block-format content still renders and is migrated to inline on the next save.
  const rawBlocks = Array.isArray(value) ? value : [{ type: 'text', value: value || '' }];
  const mergedHTML = rawBlocks
    .map(b => b?.type === 'image' ? legacyImageBlockToHTML(b) : (b?.value || ''))
    .filter(frag => frag && frag.trim())
    .join('<br>');
  const normalizedBlocks = [{ type: 'text', value: mergedHTML }];

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
      // If an image ends up as the last node, there's no caret position after it,
      // so typing can't continue (worst case: the image is the only content). Add a
      // trailing line break to give the caret somewhere to land.
      if (editorEl.lastChild && editorEl.lastChild.nodeName === 'IMG') {
        editorEl.appendChild(document.createElement('br'));
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
    const editorEl = document.querySelector(`[data-rt-block="${idx}"] [contenteditable]`);
    if (editorEl) {
      editorEl.focus();
      return insertInlineImages(idx, editorEl, files.map(file => () => uploadImage(file)));
    }
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
      await insertInlineImages(blockIdx, editorEl, imageFiles.map(file => () => uploadImage(file)));
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
        await insertInlineImages(blockIdx, editorEl, srcs.map(src => () => srcToImageBlock(src)));
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
    <div className={compact ? 'rt-compact' : undefined}>
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
        /* compact (sticky notes): make the editor a flex column that fills the
           note body, so an image can be bounded by BOTH the note's width and its
           available HEIGHT — the whole image fits with no scroll, and it scales
           live as the card is resized (all definite heights flow from the card). */
        .rt-compact {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }
        .rt-compact > .relative.group {          /* the data-rt-block wrapper */
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
        }
        .rt-compact > .relative.group > .relative.group {  /* EditableBlock wrapper */
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          display: flex;
        }
        .rt-compact .rich-text-editor {
          flex: 1 1 auto;
          min-height: 0 !important;            /* beat the rows-based inline floor */
          width: 100%;
          overflow: auto;
        }
        .rt-compact .rich-text-editor img {
          max-width: 100%;
          max-height: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
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

      {/* In compact mode (sticky notes) the toolbar is always shown so it reads as
          part of the note; elsewhere it appears only while a block is focused. */}
      {(compact || focusedBlockIdx !== null) && <Toolbar onCommand={runCommand} enableTables={enableTables} sticky={stickyToolbar} compact={compact} />}

      {normalizedBlocks.map((block, idx) => (
        <div key={idx} className="relative group" data-rt-block={idx}>
          <EditableBlock
            valueHTML={toDisplayHTML(block.value)}
            onInput={(html) => updateTextBlock(idx, html)}
            onFocus={() => { setFocusedBlockIdx(idx); lastFocusedIdxRef.current = idx; }}
            onBlur={() => { setFocusedBlockIdx(prev => prev === idx ? null : prev); onBlur?.(normalizedBlocks); }}
            onPaste={(e) => handlePaste(e, idx)}
            placeholder={placeholder}
            rows={rows}
            className={className || defaultTextClass}
            enableTables={enableTables}
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
      ))}

      {uploading && (
        <div className="text-xs text-emerald-600 animate-pulse mt-1 pl-1">Uploading image...</div>
      )}
    </div>
  );
}
