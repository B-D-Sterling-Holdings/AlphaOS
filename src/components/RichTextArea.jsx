'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Trash2, ZoomIn, X, Image as ImageIcon, Bold, Italic, Underline as UnderlineIcon, Type } from 'lucide-react';

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
  const looksLikeHtml = /<\/?(p|br|b|i|u|strong|em|span|div|font)\b/i.test(val);
  if (looksLikeHtml) return val;
  return escapeHtml(val).replace(/\n/g, '<br>');
}

function isEmptyHTML(html) {
  if (!html) return true;
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
}) {
  const ref = useRef(null);
  const focusedRef = useRef(false);
  const lastHTMLRef = useRef(valueHTML);

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
    onBlur?.(e);
  };

  const minHeight = (rows || 4) * 22 + 24;
  const isEmpty = isEmptyHTML(valueHTML);

  return (
    <div className="relative group">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPaste={onPaste}
        className={`${className} rich-text-editor`}
        data-empty={isEmpty ? 'true' : 'false'}
        data-placeholder={placeholder || ''}
        style={{ minHeight: `${minHeight}px`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      />
    </div>
  );
}

function Toolbar({ onCommand }) {
  const exec = (cmd, val) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCommand(cmd, val);
  };

  const btn = `p-1.5 rounded-md hover:bg-emerald-50 text-gray-600 hover:text-emerald-700 transition-colors`;

  return (
    <div
      className="flex items-center gap-1 mb-2 px-2 py-1.5 bg-gray-50/80 border border-gray-200 rounded-xl w-fit"
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
    </div>
  );
}

export default function RichTextArea({ value, onChange, ticker, placeholder, rows = 4, className = '', onBlur, onCommit }) {
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

  const insertImagesAt = async (idx, files, captureCursor = null) => {
    if (!files || files.length === 0) return;
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

      for (const file of files) {
        const imgBlock = await uploadImage(file);
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

  const insertImageAfter = (idx, files) => insertImagesAt(idx, files, null);

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
      await insertImagesAt(blockIdx, imageFiles, () => splitAtCaret(editorEl));
      return;
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
      const blockEl = document.querySelector(`[data-rt-block="${idx}"]`);
      if (blockEl) {
        const html = blockEl.innerHTML;
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
      `}</style>

      {focusedBlockIdx !== null && <Toolbar onCommand={runCommand} />}

      {normalizedBlocks.map((block, idx) => {
        if (block.type === 'image') {
          return (
            <div key={idx} className="relative group my-2 inline-block w-full">
              <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img
                  src={block.url}
                  alt={block.name || 'Inline image'}
                  className="w-full max-h-96 object-contain cursor-pointer"
                  onClick={() => setPreviewUrl(block.url)}
                />
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setPreviewUrl(block.url)}
                    className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm text-gray-600"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={() => removeImage(idx)}
                    className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {block.name && (
                <p className="text-[10px] text-gray-400 mt-0.5 pl-1">{block.name}</p>
              )}
            </div>
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
