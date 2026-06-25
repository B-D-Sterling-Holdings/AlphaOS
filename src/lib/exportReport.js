import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ImageRun, HeadingLevel,
  ShadingType, PageBreak,
} from 'docx';
import { saveAs } from 'file-saver';
import { Chart } from 'chart.js';

// ── Color palette inspired by academic equity research ──
const C = {
  navy: '1B2A4A',
  dark: '1F2937',
  mid: '4B5563',
  light: '9CA3AF',
  accent: '1B6B4A',
  accentLight: '2D9D6E',
  blue: '2563EB',
  amber: 'B45309',
  red: 'DC2626',
  headerBg: 'E8EDF5',
  headerBg2: 'F0F4FA',
  rowAlt: 'F8FAFC',
  border: 'D1D5DB',
  borderLight: 'E5E7EB',
  white: 'FFFFFF',
  coverBg: '1B2A4A',
};

const FONT = 'Calibri';
const FONT_SERIF = 'Cambria';

// ── Utility functions ──

function heading(text, level = HeadingLevel.HEADING_1, opts = {}) {
  const sizes = {
    [HeadingLevel.HEADING_1]: 30,
    [HeadingLevel.HEADING_2]: 24,
    [HeadingLevel.HEADING_3]: 21,
  };
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 200, after: 100 },
    keepNext: true,
    ...opts,
    children: [new TextRun({
      text,
      font: FONT_SERIF,
      bold: true,
      size: sizes[level] || 24,
      color: C.navy,
    })],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    spacing: { before: 480, after: 40 },
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.navy } },
    children: [new TextRun({
      text: text.toUpperCase(),
      font: FONT,
      bold: true,
      size: 24,
      color: C.navy,
    })],
  });
}

function subSectionTitle(text) {
  return new Paragraph({
    spacing: { before: 140, after: 60 },
    keepNext: true,
    children: [new TextRun({
      text,
      font: FONT_SERIF,
      bold: true,
      size: 22,
      color: C.navy,
    })],
  });
}

function bodyText(text, opts = {}) {
  if (!text || !text.trim()) return null;
  return new Paragraph({
    spacing: { after: 100, line: 276 },
    alignment: opts.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({
      text,
      font: opts.font || FONT_SERIF,
      size: opts.size || 20,
      color: opts.color || C.dark,
      bold: opts.bold,
      italics: opts.italic,
    })],
  });
}

function bodyParagraph(text) {
  if (!text || !text.trim()) return null;
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({
      text,
      font: FONT_SERIF,
      size: 20,
      color: C.dark,
    })],
  });
}

function spacer(size = 200) {
  return new Paragraph({ spacing: { before: size, after: 0 }, children: [] });
}

function pageBreakParagraph() {
  return new Paragraph({ children: [new TextRun({ children: [new PageBreak()] })] });
}

function dividerLine() {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.borderLight } },
    children: [],
  });
}

function bulletPoint(text, opts = {}) {
  return new Paragraph({
    bullet: { level: opts.level || 0 },
    spacing: { after: 60, line: 276 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({
      text,
      font: FONT_SERIF,
      size: opts.size || 20,
      color: opts.color || C.dark,
      bold: opts.bold,
      italics: opts.italic,
    })],
  });
}

function fmt(v, dec = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(v, dec = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v * 100).toFixed(dec) + '%';
}

function fmtLarge(v) {
  if (!v) return '—';
  const n = Number(v);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${fmt(n)}`;
}

function fmtVol(v) {
  if (!v) return '—';
  const n = Number(v);
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return fmt(n, 0);
}

// ── Table helpers ──

const TB_NONE = { style: BorderStyle.NONE, size: 0, color: C.white };
const TB_LINE = { style: BorderStyle.SINGLE, size: 1, color: C.border };
const TB_HEAVY = { style: BorderStyle.SINGLE, size: 2, color: C.navy };

function makeCell(text, opts = {}) {
  const borders = {};
  if (opts.borderTop) borders.top = opts.heavyBorder ? TB_HEAVY : TB_LINE;
  else borders.top = TB_NONE;
  if (opts.borderBottom) borders.bottom = opts.heavyBorder ? TB_HEAVY : TB_LINE;
  else borders.bottom = TB_NONE;
  borders.left = TB_NONE;
  borders.right = TB_NONE;

  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shading ? { type: ShadingType.CLEAR, fill: opts.shading } : undefined,
    borders,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({
        text: String(text ?? ''),
        font: opts.font || FONT,
        size: opts.size || 18,
        bold: opts.bold,
        color: opts.color || C.dark,
        italics: opts.italic,
      })],
    })],
  });
}

function metricCell(text, opts = {}) {
  return makeCell(text, {
    ...opts,
    borderBottom: true,
    size: 18,
  });
}

// ── Rich content / Image helpers ──

function normalizeRichBlocks(value) {
  if (!value) return [];
  if (typeof value === 'string') return [{ type: 'text', value }];
  if (Array.isArray(value)) return value;
  return [];
}

function hasRichContent(value) {
  const blocks = normalizeRichBlocks(value);
  return blocks.some(block => {
    if (block?.type === 'image' && block.url) return true;
    if (block?.type === 'text' && typeof block.value === 'string' && block.value.trim()) return true;
    return false;
  });
}

function normalizeQuestionItems(items) {
  return (items || []).map(item => {
    if (typeof item === 'string') {
      return { text: item, done: false, answer: '', subQuestions: [] };
    }
    return {
      text: item?.text || '',
      done: !!item?.done,
      answer: item?.answer ?? '',
      subQuestions: (item?.subQuestions || []).map(sq => ({
        text: sq?.text || '',
        done: !!sq?.done,
        answer: sq?.answer ?? '',
      })),
    };
  });
}

function captureCharts() {
  const canvases = document.querySelectorAll('.chart-container canvas');
  const images = [];
  canvases.forEach(canvas => {
    try {
      const chartInstance = Chart.getChart(canvas);
      let tooltipWasEnabled = true;
      if (chartInstance) {
        tooltipWasEnabled = chartInstance.options.plugins.tooltip.enabled !== false;
        chartInstance.options.plugins.tooltip.enabled = false;
        chartInstance.setActiveElements([]);
        chartInstance.tooltip?.setActiveElements([], { x: 0, y: 0 });
        chartInstance.update('none');
      }

      const url = canvas.toDataURL('image/png');
      const w = canvas.width;
      const h = canvas.height;
      const label = canvas.closest('[data-chart-title]')?.getAttribute('data-chart-title') ||
        canvas.closest('.bg-white')?.querySelector('h3, p.text-sm.font-bold, .text-sm.font-semibold')?.textContent || '';
      const cagrs = [];
      const card = canvas.closest('[data-chart-title]') || canvas.closest('.bg-white');
      if (card) {
        const cagrContainer = card.querySelector('.border-t.border-gray-100');
        if (cagrContainer) {
          cagrContainer.querySelectorAll('div.text-center').forEach(el => {
            const labelEl = el.querySelector('span.text-\\[10px\\], span.uppercase');
            const valueEl = el.querySelector('span.font-bold');
            if (labelEl && valueEl) {
              cagrs.push({ label: labelEl.textContent.trim(), value: valueEl.textContent.trim() });
            }
          });
        }
      }
      images.push({ url, label, width: w, height: h, cagrs });

      if (chartInstance && tooltipWasEnabled) {
        chartInstance.options.plugins.tooltip.enabled = true;
        chartInstance.update('none');
      }
    } catch {}
  });
  return images;
}

function chartImageRun(dataUrl, canvasWidth, canvasHeight, maxWidth = 520) {
  const base64 = dataUrl.split(',')[1];
  const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const ratio = (canvasWidth && canvasHeight) ? canvasHeight / canvasWidth : 0.45;
  const width = maxWidth;
  const height = Math.round(maxWidth * ratio);
  return new ImageRun({ data: buffer, transformation: { width, height }, type: 'png' });
}

async function remoteImageRun(url, opts = {}) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const type = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : contentType.includes('bmp') ? 'bmp' : 'jpg';
    const buffer = new Uint8Array(await res.arrayBuffer());
    return new ImageRun({
      data: buffer,
      transformation: { width: opts.width || 500, height: opts.height || 310 },
      type,
    });
  } catch {
    return null;
  }
}

// execCommand fontSize 1..7 → docx half-points (size 20 ≈ 10pt body default)
const FONT_SIZE_MAP = { '1': 14, '2': 16, '3': 20, '4': 24, '5': 28, '6': 36, '7': 48 };

function parseFontSizeStyle(value) {
  if (!value) return null;
  const m = String(value).match(/(\d+(?:\.\d+)?)(px|pt|em|rem)?/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = (m[2] || 'px').toLowerCase();
  let pt;
  if (unit === 'pt') pt = num;
  else if (unit === 'em' || unit === 'rem') pt = num * 12;
  else pt = num * 0.75;
  return Math.max(8, Math.round(pt * 2)); // half-points
}

/**
 * Parse a rich-text HTML string into an array of paragraphs, where each
 * paragraph is an array of run descriptors {text, bold, italics, underline, size}.
 */
function htmlToParagraphs(html) {
  if (!html || !html.trim()) return [];
  const looksLikeHtml = /<\/?(p|br|b|i|u|strong|em|span|div|font)\b/i.test(html);
  if (!looksLikeHtml) {
    return html.split('\n').filter(l => l.trim()).map(line => [{ text: line }]);
  }

  let root;
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    root = doc.body.firstChild;
  } catch {
    return [[{ text: html.replace(/<[^>]+>/g, '') }]];
  }
  if (!root) return [];

  const paragraphs = [];
  let current = [];
  const flush = () => {
    if (current.some(r => r.text && r.text.length > 0)) paragraphs.push(current);
    current = [];
  };

  const walk = (node, fmt) => {
    if (node.nodeType === 3) {
      const text = node.textContent;
      if (text) current.push({ ...fmt, text });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') { flush(); return; }
    if (tag === 'p' || tag === 'div') {
      flush();
      const nextFmt = { ...fmt };
      applyInlineStyles(node, nextFmt);
      for (const child of node.childNodes) walk(child, nextFmt);
      flush();
      return;
    }
    const nextFmt = { ...fmt };
    if (tag === 'b' || tag === 'strong') nextFmt.bold = true;
    if (tag === 'i' || tag === 'em') nextFmt.italics = true;
    if (tag === 'u') nextFmt.underline = true;
    if (tag === 'font') {
      const size = node.getAttribute('size');
      if (size && FONT_SIZE_MAP[size]) nextFmt.size = FONT_SIZE_MAP[size];
    }
    applyInlineStyles(node, nextFmt);
    for (const child of node.childNodes) walk(child, nextFmt);
  };

  const applyInlineStyles = (el, fmt) => {
    const style = el.style;
    if (!style) return;
    if (style.fontWeight && (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 600)) fmt.bold = true;
    if (style.fontStyle === 'italic') fmt.italics = true;
    if (style.textDecoration && style.textDecoration.includes('underline')) fmt.underline = true;
    if (style.fontSize) {
      const sz = parseFontSizeStyle(style.fontSize);
      if (sz) fmt.size = sz;
    }
  };

  walk(root, {});
  flush();
  return paragraphs;
}

function runsToTextRuns(runs) {
  return runs.map(r => new TextRun({
    text: r.text,
    font: FONT_SERIF,
    size: r.size || 20,
    color: C.dark,
    bold: !!r.bold,
    italics: !!r.italics,
    underline: r.underline ? {} : undefined,
  }));
}

async function appendRichContent(sections, value, opts = {}) {
  const blocks = normalizeRichBlocks(value);
  let wroteAny = false;

  for (const block of blocks) {
    if (block?.type === 'image' && block.url) {
      const imageRun = await remoteImageRun(block.url, { width: opts.imageWidth || 500, height: opts.imageHeight || 310 });
      if (imageRun) {
        sections.push(new Paragraph({
          spacing: { before: 60, after: 80 },
          alignment: opts.centerImages ? AlignmentType.CENTER : AlignmentType.LEFT,
          indent: opts.indent ? { left: opts.indent } : undefined,
          children: [imageRun],
        }));
        if (block.name) {
          sections.push(new Paragraph({
            spacing: { after: 60 },
            alignment: AlignmentType.CENTER,
            indent: opts.indent ? { left: opts.indent } : undefined,
            children: [new TextRun({ text: block.name, font: FONT, size: 16, color: C.light, italics: true })],
          }));
        }
        wroteAny = true;
      }
      continue;
    }

    if (block?.type === 'text' && typeof block.value === 'string') {
      const paragraphs = htmlToParagraphs(block.value);
      paragraphs.forEach(runs => {
        if (!runs.length) return;
        const children = runsToTextRuns(runs);
        sections.push(new Paragraph({
          spacing: { after: 100, line: 276 },
          alignment: AlignmentType.JUSTIFIED,
          indent: opts.indent ? { left: opts.indent } : undefined,
          children,
        }));
      });
      if (paragraphs.length > 0) wroteAny = true;
    }
  }

  return wroteAny;
}

// ── Find a specific chart by label ──
function findChart(chartImages, ...keywords) {
  return chartImages.find(img => {
    const lbl = img.label.toLowerCase();
    return keywords.some(kw => lbl.includes(kw.toLowerCase()));
  });
}

// ── Render a chart with title and CAGR ──
function renderChart(sections, chart, figureNum, caption) {
  if (!chart) return;

  // Chart image
  sections.push(new Paragraph({
    spacing: { before: 100, after: chart.cagrs?.length ? 20 : 40 },
    keepNext: true,
    alignment: AlignmentType.CENTER,
    children: [chartImageRun(chart.url, chart.width, chart.height, 480)],
  }));

  // CAGR line
  if (chart.cagrs && chart.cagrs.length > 0) {
    sections.push(new Paragraph({
      spacing: { after: 40 },
      keepNext: true,
      alignment: AlignmentType.CENTER,
      children: chart.cagrs.flatMap((c, i) => [
        ...(i > 0 ? [new TextRun({ text: '     ', font: FONT, size: 17 })] : []),
        new TextRun({ text: `${c.label}: `, font: FONT, size: 17, color: C.light }),
        new TextRun({ text: c.value, font: FONT, size: 17, bold: true, color: c.value.startsWith('-') ? C.red : C.accent }),
      ]),
    }));
  }

  // Figure caption below chart
  sections.push(new Paragraph({
    spacing: { before: 0, after: 60 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `Figure ${figureNum}: ${caption}`,
      font: FONT,
      size: 18,
      italics: true,
      color: C.mid,
    })],
  }));
}

// ── Render questions section (DD or Dislocation) ──
async function renderQuestions(sections, title, items) {
  const normalized = normalizeQuestionItems(items).filter(item => item.text.trim() || hasRichContent(item.answer));
  if (normalized.length === 0) return;

  sections.push(sectionTitle(title));

  for (const [idx, item] of normalized.entries()) {
    const status = item.done ? 'Completed' : 'Open';
    const statusColor = item.done ? C.accent : C.light;

    // Question header
    sections.push(new Paragraph({
      spacing: { before: 200, after: 80 },
      keepNext: true,
      children: [
        new TextRun({ text: `Question ${idx + 1}: `, font: FONT, size: 21, bold: true, color: C.navy }),
        new TextRun({ text: item.text || 'Untitled question', font: FONT_SERIF, size: 21, color: C.dark }),
        new TextRun({ text: `  [${status}]`, font: FONT, size: 17, color: statusColor, italics: true }),
      ],
    }));

    // Answer
    const wroteAnswer = await appendRichContent(sections, item.answer, { centerImages: true });
    if (!wroteAnswer) {
      sections.push(bodyText('No written answer yet.', { color: C.light, italic: true }));
    }

    // Sub-questions
    const subs = item.subQuestions || [];
    for (const [si, sq] of subs.entries()) {
      if (!sq.text?.trim() && !hasRichContent(sq.answer)) continue;
      const subStatus = sq.done ? 'Completed' : 'Open';
      const subStatusColor = sq.done ? C.accent : C.light;

      sections.push(new Paragraph({
        spacing: { before: 140, after: 60 },
        indent: { left: 480 },
        keepNext: true,
        children: [
          new TextRun({ text: `${idx + 1}.${si + 1}  `, font: FONT, size: 19, bold: true, color: C.navy }),
          new TextRun({ text: sq.text || 'Untitled sub-question', font: FONT_SERIF, size: 19, color: C.dark }),
          new TextRun({ text: `  [${subStatus}]`, font: FONT, size: 16, color: subStatusColor, italics: true }),
        ],
      }));

      const wroteSubAnswer = await appendRichContent(sections, sq.answer, { indent: 480, centerImages: true });
      if (!wroteSubAnswer) {
        sections.push(new Paragraph({
          spacing: { after: 60 },
          indent: { left: 480 },
          children: [new TextRun({ text: 'No written answer yet.', font: FONT_SERIF, size: 18, color: C.light, italics: true })],
        }));
      }
    }

    // Thin divider between questions
    if (idx < normalized.length - 1) {
      sections.push(new Paragraph({
        spacing: { before: 100, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.borderLight } },
        children: [],
      }));
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════

export async function exportReport({ ticker, thesis, model, tickerData, liveQuote, displayPrice, reportType = 'position_review', equityRating = 0 }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const isResearchWorkspace = reportType === 'research_workspace';
  const researchWorkspace = thesis?.underwriting?.researchWorkspace || {};
  const chartImages = captureCharts();

  const sections = [];
  const q = liveQuote || {};
  const val = tickerData?.valuation || {};
  let figureNum = 0;

  // ═══════════ PAGE 1: COVER ═══════════
  {
    const exchangePrefix = q.exchange ? `${q.exchange}:` : '';

    // Top header line: left = "Equity Research Report | Date | Exchange:TICKER", right = firm name
    sections.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 65, type: WidthType.PERCENTAGE },
              borders: { top: TB_NONE, bottom: TB_NONE, left: TB_NONE, right: TB_NONE },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({ text: isResearchWorkspace ? 'Equity Research Primer' : 'Position Review', font: FONT_SERIF, size: 20, color: C.dark }),
                  new TextRun({ text: ` | ${dateStr} | `, font: FONT_SERIF, size: 20, color: C.mid }),
                  new TextRun({ text: `${exchangePrefix}${ticker}`, font: FONT_SERIF, size: 20, bold: true, color: C.dark }),
                ],
              })],
            }),
            new TableCell({
              width: { size: 35, type: WidthType.PERCENTAGE },
              borders: { top: TB_NONE, bottom: TB_NONE, left: TB_NONE, right: TB_NONE },
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({
                  text: 'B.D. Sterling Capital Management',
                  font: FONT_SERIF,
                  size: 20,
                  bold: true,
                  color: C.dark,
                })],
              })],
            }),
          ],
        }),
      ],
    }));

    // Company name large
    sections.push(new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [new TextRun({
        text: q.shortName || ticker,
        font: FONT_SERIF,
        bold: true,
        size: 48,
        color: '000000',
      })],
    }));

    // Thick horizontal rule
    sections.push(new Paragraph({
      spacing: { before: 60, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.dark } },
      children: [],
    }));

    // Info grid: Equity Rating | Price | Sector | Classification
    const priceStr = displayPrice ? `$${fmt(displayPrice)}` : (q.price ? `$${fmt(q.price)}` : '—');
    const starStr = equityRating > 0 ? '★'.repeat(equityRating) + '☆'.repeat(5 - equityRating) : '—';

    // Rating label based on equity rating
    let ratingLabel = '—';
    let ratingColor = C.mid;
    let ratingBg = C.white;
    if (equityRating === 5) { ratingLabel = 'STRONG BUY'; ratingColor = C.white; ratingBg = '1B6B4A'; }
    else if (equityRating === 4) { ratingLabel = 'BUY'; ratingColor = C.white; ratingBg = '1B6B4A'; }
    else if (equityRating === 3) { ratingLabel = 'HOLD'; ratingColor = C.white; ratingBg = C.amber; }
    else if (equityRating === 2) { ratingLabel = 'SELL'; ratingColor = C.white; ratingBg = C.red; }
    else if (equityRating === 1) { ratingLabel = 'STRONG SELL'; ratingColor = C.white; ratingBg = C.red; }

    // Determine market cap classification
    const mcap = q.marketCap ? Number(q.marketCap) : 0;
    const classification = mcap >= 200e9 ? 'Mega Large Cap' : mcap >= 10e9 ? 'Large Cap' : mcap >= 2e9 ? 'Mid Cap' : mcap >= 300e6 ? 'Small Cap' : mcap > 0 ? 'Micro Cap' : '—';

    // Append ordinal suffix to day for pretty date
    const dayNum = now.getDate();
    const ordinal = [11,12,13].includes(dayNum % 100) ? 'th' : {1:'st',2:'nd',3:'rd'}[dayNum % 10] || 'th';
    const datePretty = now.toLocaleDateString('en-US', { month: 'long' }) + ' ' + dayNum + ordinal + ', ' + now.getFullYear();

    // Labels row
    sections.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            makeCell('Equity Rating', { bold: true, width: 25, borderTop: true, heavyBorder: true, color: C.dark, size: 19, font: FONT_SERIF }),
            makeCell('Price', { bold: true, width: 25, borderTop: true, heavyBorder: true, color: C.dark, size: 19, font: FONT_SERIF }),
            makeCell('Sector', { bold: true, width: 25, borderTop: true, heavyBorder: true, color: C.dark, size: 19, font: FONT_SERIF }),
            makeCell('Classification', { bold: true, width: 25, borderTop: true, heavyBorder: true, color: C.dark, size: 19, font: FONT_SERIF }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              width: { size: 25, type: WidthType.PERCENTAGE },
              borders: { top: TB_NONE, bottom: TB_HEAVY, left: TB_NONE, right: TB_NONE },
              margins: { top: 40, bottom: 60, left: 80, right: 80 },
              children: [new Paragraph({
                children: [
                  new TextRun({ text: ratingLabel, font: FONT, size: 18, bold: true, color: ratingColor, shading: equityRating > 0 ? { type: ShadingType.CLEAR, fill: ratingBg } : undefined }),
                  new TextRun({ text: `  ${starStr}`, font: FONT, size: 20, color: 'D4880F' }),
                ],
              })],
            }),
            makeCell(`${priceStr} (${datePretty})`, { width: 25, size: 18, borderBottom: true, heavyBorder: true }),
            makeCell(q.sector || '—', { width: 25, size: 18, borderBottom: true, heavyBorder: true }),
            makeCell(classification, { width: 25, size: 18, borderBottom: true, heavyBorder: true }),
          ],
        }),
      ],
    }));

    // Investment Summary heading + Preexisting Thesis (core reasons)
    const coreReasons = (thesis?.coreReasons || [])
      .map(r => (typeof r === 'string' ? { title: r, description: '' } : r))
      .filter(r => (r.title && r.title.trim()) || (r.description && r.description.trim()));

    if (coreReasons.length > 0) {
      sections.push(new Paragraph({
        spacing: { before: 300, after: 100 },
        keepNext: true,
        children: [new TextRun({
          text: 'Investment Summary',
          font: FONT_SERIF,
          bold: true,
          size: 26,
          color: C.navy,
        })],
      }));

      coreReasons.forEach((reason, idx) => {
        const titleText = reason.title?.trim() || `Core Reason #${idx + 1}`;
        sections.push(new Paragraph({
          spacing: { before: idx === 0 ? 80 : 160, after: 60 },
          keepNext: true,
          children: [
            new TextRun({ text: `${idx + 1}. `, font: FONT_SERIF, size: 21, bold: true, color: C.navy }),
            new TextRun({ text: titleText, font: FONT_SERIF, size: 21, bold: true, color: C.dark }),
          ],
        }));
        if (reason.description && reason.description.trim()) {
          reason.description.split('\n').filter(l => l.trim()).forEach(line => {
            const p = bodyParagraph(line);
            if (p) sections.push(p);
          });
        }
      });
    }

    if (!isResearchWorkspace && hasRichContent(thesis?.underwriting?.companyOverview)) {
      if (coreReasons.length === 0) {
        sections.push(new Paragraph({
          spacing: { before: 300, after: 100 },
          keepNext: true,
          children: [new TextRun({
            text: 'Investment Summary',
            font: FONT_SERIF,
            bold: true,
            size: 26,
            color: C.navy,
          })],
        }));
      }
      sections.push(subSectionTitle('Company Overview'));
      await appendRichContent(sections, thesis.underwriting.companyOverview);
    }

    // Price target sentence (2Y @ Expected CAGR)
    if (model?.computed?.priceTarget != null && !isNaN(Number(model.computed.priceTarget))) {
      const cagrVal = model.computed.totalCAGR;
      const hasCagr = cagrVal != null && !isNaN(Number(cagrVal));
      sections.push(new Paragraph({
        spacing: { before: 200, after: 120 },
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({ text: 'Our price target is ', font: FONT_SERIF, size: 20, color: C.dark }),
          new TextRun({ text: `$${fmt(model.computed.priceTarget, 2)}`, font: FONT_SERIF, size: 20, bold: true, color: C.accent }),
          new TextRun({ text: ', implying an expected CAGR of ', font: FONT_SERIF, size: 20, color: C.dark }),
          new TextRun({ text: hasCagr ? fmtPct(cagrVal, 2) : '—', font: FONT_SERIF, size: 20, bold: true, color: C.accent }),
          new TextRun({ text: ' (2-year price target at our expected CAGR).', font: FONT_SERIF, size: 20, color: C.dark }),
        ],
      }));
    }

    // Price chart right below Investment Summary
    const priceChart = findChart(chartImages, 'Price');
    if (priceChart) {
      figureNum++;
      renderChart(sections, priceChart, figureNum, `${ticker} Stock Price`);
    }
  }

  // ═══════════ KEY METRICS TABLE ═══════════
  {
    sections.push(spacer(60));

    const opMargins = tickerData?.operating_margins || [];
    const latestOpMargin = opMargins.length ? opMargins[opMargins.length - 1].operating_margin : null;
    const shares = tickerData?.buybacks || [];
    let buybackYield = null;
    if (shares.length >= 5) {
      const cur = shares[shares.length - 1].shares_outstanding;
      const prev = shares[shares.length - 5].shares_outstanding;
      if (cur && prev && prev > 0) buybackYield = ((prev - cur) / prev);
    }
    const fcfYield = val.fcfYield ? Number(val.fcfYield) : null;
    const hi52 = q.fiftyTwoWeekHigh || val.high52w;
    const lo52 = q.fiftyTwoWeekLow || val.low52w;
    const range52 = (lo52 && hi52) ? `$${fmt(Number(lo52))} – $${fmt(Number(hi52))}` : '—';
    let netDebtEbitda = '—';
    if (q.enterpriseValue && q.marketCap && q.evToEbitda && q.evToEbitda > 0) {
      const netDebt = q.enterpriseValue - q.marketCap;
      const ebitda = q.enterpriseValue / q.evToEbitda;
      if (ebitda > 0) netDebtEbitda = fmt(netDebt / ebitda, 1) + 'x';
    }

    // Two-column metrics layout
    const leftMetrics = [
      ['Market Cap', fmtLarge(q.marketCap)],
      ['Enterprise Value', fmtLarge(q.enterpriseValue)],
      ['P/E Ratio', q.trailingPE ? fmt(Number(q.trailingPE), 1) + 'x' : (val.peRatio ? fmt(Number(val.peRatio), 1) + 'x' : '—')],
      ['EV / EBITDA', q.evToEbitda ? fmt(Number(q.evToEbitda), 1) + 'x' : '—'],
      ['FCF Yield', fcfYield ? `${fmt(fcfYield, 1)}%` : '—'],
      ['Revenue Growth YoY', q.revenueGrowth != null ? `${(q.revenueGrowth * 100).toFixed(1)}%` : '—'],
      ['EPS Growth YoY', q.earningsGrowth != null ? `${(q.earningsGrowth * 100).toFixed(1)}%` : '—'],
    ];

    const rightMetrics = [
      ['Operating Margin', latestOpMargin != null ? `${(latestOpMargin * 100).toFixed(1)}%` : '—'],
      ['Return on Equity', q.roic != null ? `${(q.roic * 100).toFixed(1)}%` : '—'],
      ['Net Debt / EBITDA', netDebtEbitda],
      ['Buyback Yield', buybackYield != null ? `${(buybackYield * 100).toFixed(1)}%` : '—'],
      ['Dividend Yield', q.dividendYield != null ? `${Number(q.dividendYield).toFixed(2)}%` : '—'],
      ['52 Week Range', range52],
      ['Avg Daily Volume', fmtVol(q.avgVolume)],
    ];

    const maxRows = Math.max(leftMetrics.length, rightMetrics.length);
    const tableRows = [];

    // Header row
    tableRows.push(new TableRow({
      children: [
        makeCell('Metric', { bold: true, shading: C.headerBg, width: 25, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy }),
        makeCell('Value', { bold: true, shading: C.headerBg, width: 25, align: AlignmentType.RIGHT, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy }),
        makeCell('Metric', { bold: true, shading: C.headerBg, width: 25, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy }),
        makeCell('Value', { bold: true, shading: C.headerBg, width: 25, align: AlignmentType.RIGHT, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy }),
      ],
    }));

    for (let i = 0; i < maxRows; i++) {
      const left = leftMetrics[i] || ['', ''];
      const right = rightMetrics[i] || ['', ''];
      const bg = i % 2 ? C.rowAlt : C.white;
      tableRows.push(new TableRow({
        children: [
          makeCell(left[0], { shading: bg, width: 25, size: 17 }),
          makeCell(left[1], { align: AlignmentType.RIGHT, bold: true, shading: bg, width: 25, size: 17 }),
          makeCell(right[0], { shading: bg, width: 25, size: 17 }),
          makeCell(right[1], { align: AlignmentType.RIGHT, bold: true, shading: bg, width: 25, size: 17 }),
        ],
      }));
    }

    // Bottom border
    tableRows.push(new TableRow({
      children: [
        makeCell('', { width: 25, borderTop: true, heavyBorder: true }),
        makeCell('', { width: 25, borderTop: true, heavyBorder: true }),
        makeCell('', { width: 25, borderTop: true, heavyBorder: true }),
        makeCell('', { width: 25, borderTop: true, heavyBorder: true }),
      ],
    }));

    sections.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
    }));
  }

  // ═══════════ COMPANY DEEP DIVE (research primer only) ═══════════
  if (isResearchWorkspace && hasRichContent(thesis?.underwriting?.companyOverview)) {
    sections.push(sectionTitle('Company Deep Dive'));
    await appendRichContent(sections, thesis.underwriting.companyOverview, { centerImages: true });
  }

  // ═══════════ THE STORY ═══════════
  if (hasRichContent(thesis?.assumptions)) {
    sections.push(sectionTitle('The Story'));
    await appendRichContent(sections, thesis.assumptions);
  }

  // ═══════════ REVENUE & GROWTH ═══════════
  {
    sections.push(sectionTitle('Revenue & Growth Profile'));

    const revenueChart = findChart(chartImages, 'Revenue');
    if (revenueChart) {
      figureNum++;
      renderChart(sections, revenueChart, figureNum, `${ticker} Quarterly Revenue`);
    }

    // Revenue & Growth text from thesis structure
    const revenueText = researchWorkspace?.fundamentals?.revenueGrowth;
    if (hasRichContent(revenueText)) {
      await appendRichContent(sections, revenueText);
    }
  }

  // ═══════════ PROFITABILITY ═══════════
  {
    sections.push(sectionTitle('Profitability Profile'));

    const epsChart = findChart(chartImages, 'EPS');
    const fcfChart = findChart(chartImages, 'Free Cash Flow', 'FCF');
    const marginChart = findChart(chartImages, 'Operating Margin');

    if (epsChart) {
      figureNum++;
      renderChart(sections, epsChart, figureNum, `${ticker} EPS (Diluted)`);
    }

    if (fcfChart) {
      figureNum++;
      renderChart(sections, fcfChart, figureNum, `${ticker} Free Cash Flow`);
    }

    if (marginChart) {
      figureNum++;
      renderChart(sections, marginChart, figureNum, `${ticker} Operating Margins`);
    }

    // Profitability text from thesis structure
    const profitabilityText = researchWorkspace?.fundamentals?.profitability;
    if (hasRichContent(profitabilityText)) {
      await appendRichContent(sections, profitabilityText);
    }
  }

  // ═══════════ CAPITAL RETURNS TO SHAREHOLDERS ═══════════
  {
    sections.push(sectionTitle('Capital Returns to Shareholders'));

    const sharesChart = findChart(chartImages, 'Outstanding Shares', 'Buyback', 'Shares');
    if (sharesChart) {
      figureNum++;
      renderChart(sections, sharesChart, figureNum, `${ticker} Outstanding Shares`);
    }

    // Capital Returns text
    const capitalText = researchWorkspace?.fundamentals?.capitalReturn;
    if (hasRichContent(capitalText)) {
      await appendRichContent(sections, capitalText);
    }
  }

  // ═══════════ MISC ═══════════
  {
    const miscText = researchWorkspace?.fundamentals?.misc;
    if (hasRichContent(miscText)) {
      sections.push(sectionTitle('Additional Notes'));
      await appendRichContent(sections, miscText);
    }
  }

  // ═══════════ DUE DILIGENCE QUESTIONS ═══════════
  {
    const ddItems = researchWorkspace.dueDiligenceItems || [];
    const hasDD = normalizeQuestionItems(ddItems).some(item => item.text.trim() || hasRichContent(item.answer));
    if (hasDD) {
      await renderQuestions(sections, 'Due Diligence Questions', ddItems);
    }
  }

  // ═══════════ DISLOCATION QUESTIONS ═══════════
  {
    const disItems = researchWorkspace.dislocationItems || [];
    const hasDis = normalizeQuestionItems(disItems).some(item => item.text.trim() || hasRichContent(item.answer));
    if (hasDis) {
      await renderQuestions(sections, 'Dislocation Questions', disItems);
    }
  }

  // ═══════════ NEWS & UPDATES ═══════════
  {
    const updates = (thesis?.newsUpdates || []).filter(u => u.title || u.body);
    if (updates.length > 0) {
      sections.push(sectionTitle('News & Recent Developments'));

      [...updates].reverse().forEach((entry, idx) => {
        // Title line
        const titleParts = [];
        if (entry.title) {
          titleParts.push(new TextRun({ text: entry.title, font: FONT_SERIF, size: 22, bold: true, color: C.navy }));
        }
        if (entry.date) {
          titleParts.push(new TextRun({ text: `  |  ${entry.date}`, font: FONT, size: 17, color: C.light }));
        }
        sections.push(new Paragraph({
          spacing: { before: idx > 0 ? 160 : 100, after: 60 },
          keepNext: true,
          children: titleParts,
        }));

        // Body
        if (entry.body && entry.body.trim()) {
          entry.body.split('\n').filter(l => l.trim()).forEach(line => {
            const p = bodyParagraph(line);
            if (p) sections.push(p);
          });
        }

        // Impact on assumptions
        if (entry.impactOnAssumptions && entry.impactOnAssumptions.trim()) {
          sections.push(new Paragraph({
            spacing: { before: 100, after: 40 },
            keepNext: true,
            children: [new TextRun({ text: 'Impact on Assumptions:', font: FONT, size: 18, bold: true, color: C.amber })],
          }));
          entry.impactOnAssumptions.split('\n').filter(l => l.trim()).forEach(line => {
            sections.push(bodyText(line, { italic: true, color: '92400E' }));
          });
        }

        if (idx < updates.length - 1) {
          sections.push(dividerLine());
        }
      });
    }
  }

  // ═══════════ VALUATION CHARTS (PE Ratio + FCF Yield) ═══════════
  {
    const peChart = findChart(chartImages, 'PE Ratio');
    const fcfYieldChart = findChart(chartImages, 'FCF Yield');
    if (peChart || fcfYieldChart) {
      sections.push(sectionTitle('Valuation'));

      if (peChart) {
        figureNum++;
        renderChart(sections, peChart, figureNum, `${ticker} PE Ratio`);
      }
      if (fcfYieldChart) {
        figureNum++;
        renderChart(sections, fcfYieldChart, figureNum, `${ticker} FCF Yield`);
      }
    }
  }

  // ═══════════ VALUATION MODEL ═══════════
  if (model) {
    sections.push(sectionTitle('EPS-Based Valuation Model'));

    const inp = model.inputs || {};
    const has = (v) => v !== '' && v !== undefined && v !== null;

    // Input parameters table 1
    const inputRow1Header = ['Ticker', 'Share Price', 'Current Dividend', 'Target P/E Multiple'];
    const inputRow1Values = [
      ticker,
      has(inp.sharePrice) ? `$${fmt(Number(inp.sharePrice))}` : '—',
      has(inp.currentDividend) && Number(inp.currentDividend) !== 0 ? `$${fmt(Number(inp.currentDividend))}` : '$0.00',
      has(inp.targetPE) ? fmt(Number(inp.targetPE), 2) : '—',
    ];

    sections.push(spacer(40));
    sections.push(new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      rows: [
        new TableRow({
          children: inputRow1Header.map(h =>
            makeCell(h, { bold: true, align: AlignmentType.CENTER, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy, size: 17 })
          ),
        }),
        new TableRow({
          children: inputRow1Values.map(v =>
            makeCell(v, { align: AlignmentType.CENTER, borderBottom: true, size: 17 })
          ),
        }),
      ],
    }));

    sections.push(spacer(80));

    // Input parameters table 2
    const inputRow2Header = ['Revenue Growth', 'Target Op. Margin', 'Net Share Dilution', 'Dividend Growth %', 'Tax Rate'];
    const inputRow2Values = [
      has(inp.revenueGrowth) ? fmtPct(Number(inp.revenueGrowth), 2) : '—',
      has(inp.targetOpMargin) ? fmtPct(Number(inp.targetOpMargin), 2) : '—',
      has(inp.netShareDilution) ? fmtPct(Number(inp.netShareDilution), 2) : '—',
      has(inp.dividendGrowth) ? fmtPct(Number(inp.dividendGrowth), 2) : '0.00%',
      has(inp.taxRate) ? fmtPct(Number(inp.taxRate), 2) : '21.00%',
    ];

    sections.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: inputRow2Header.map(h =>
            makeCell(h, { bold: true, align: AlignmentType.CENTER, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy, size: 16 })
          ),
        }),
        new TableRow({
          children: inputRow2Values.map(v =>
            makeCell(v, { align: AlignmentType.CENTER, borderBottom: true, size: 17 })
          ),
        }),
      ],
    }));

    sections.push(spacer(120));

    // Projection table
    if (model.computed) {
      const yearLabels = model.computed.yearLabels || [];
      const labelWidth = 28;
      const yearWidth = (100 - labelWidth) / yearLabels.length;

      const projRows = [
        { label: 'Revenue (bil)', data: model.computed.revenue, fmt: v => `$${fmt(v, 2)}`, bold: true },
        { label: 'Operating Expense', data: model.computed.opex, fmt: v => `$${fmt(v, 2)}` },
        { label: 'Other Income, net', data: model.computed.nonOpIncome, fmt: v => `${Number(v) < 0 ? '-' : ''}$${fmt(Math.abs(v), 2)}` },
        { sep: true },
        { label: 'Operating Income (bil)', data: model.computed.opIncome, fmt: v => `$${fmt(v, 2)}`, bold: true },
        { label: 'Operating Margin (%)', data: model.computed.opMargin, fmt: v => fmtPct(v, 2) },
        { sep: true },
        { label: 'Tax Expense', data: model.computed.taxExpense, fmt: v => `$${fmt(v, 2)}` },
        { sep: true },
        { label: 'Net Income (bil)', data: model.computed.netIncome, fmt: v => `$${fmt(v, 2)}`, bold: true },
        { label: 'Outstanding Shares (bil)', data: model.computed.shares, fmt: v => fmt(v, 4) },
        { sep: true },
        { label: 'Earnings Per Share', data: model.computed.eps, fmt: v => `$${fmt(v, 2)}`, bold: true },
        { sep: true },
        { label: 'Share Price (Tgt P/E)', data: model.computed.priceArr, fmt: v => `$${fmt(v, 2)}`, bold: true },
        { label: 'Extra Shares w/ Reinvested Div', data: model.computed.divShares, fmt: v => fmt(v, 4) },
      ];

      const headerCells = [
        makeCell('Factors', { bold: true, width: labelWidth, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy }),
        ...yearLabels.map(y => makeCell(String(y), { bold: true, align: AlignmentType.RIGHT, width: yearWidth, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy })),
      ];

      const tableRows = [new TableRow({ children: headerCells })];

      for (let ri = 0; ri < projRows.length; ri++) {
        const row = projRows[ri];
        if (row.sep) continue;
        const prevIsSep = ri > 0 && projRows[ri - 1]?.sep;

        const cells = [
          makeCell(row.label, { bold: row.bold, width: labelWidth, borderTop: prevIsSep, size: 17 }),
          ...(row.data || []).map(v => makeCell(row.fmt(v), { align: AlignmentType.RIGHT, bold: row.bold, width: yearWidth, borderTop: prevIsSep, size: 17 })),
        ];
        tableRows.push(new TableRow({ children: cells }));
      }

      // Total CAGR
      const totalCAGRVal = model.computed.totalCAGR != null ? fmtPct(model.computed.totalCAGR, 2) : '—';
      const cagrCells = [
        makeCell('Total CAGR', { bold: true, width: labelWidth, borderTop: true, borderBottom: true, heavyBorder: true, color: C.navy }),
      ];
      for (let i = 0; i < yearLabels.length - 1; i++) {
        cagrCells.push(makeCell('', { width: yearWidth, borderTop: true, borderBottom: true, heavyBorder: true }));
      }
      cagrCells.push(makeCell(totalCAGRVal, { bold: true, align: AlignmentType.RIGHT, width: yearWidth, borderTop: true, borderBottom: true, heavyBorder: true, color: C.accent }));
      tableRows.push(new TableRow({ children: cagrCells }));

      sections.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: tableRows,
      }));

      // Table caption
      sections.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 60 },
        children: [new TextRun({
          text: `Table 1: ${ticker} 5-Year Valuation Forecast (revenue and income in billions).`,
          font: FONT,
          size: 17,
          italics: true,
          color: C.mid,
        })],
      }));

      sections.push(spacer(100));

      // Model output summary
      sections.push(new Table({
        width: { size: 80, type: WidthType.PERCENTAGE },
        alignment: AlignmentType.CENTER,
        rows: [
          new TableRow({
            children: ['', 'Expected CAGR', 'CAGR w/ Dividends', 'Price Target (2Y @ Expected CAGR)', '5Y Target Price'].map(h =>
              makeCell(h, { bold: true, align: h ? AlignmentType.CENTER : AlignmentType.LEFT, borderTop: true, borderBottom: true, heavyBorder: true, size: 16, color: C.navy })
            ),
          }),
          new TableRow({
            children: [
              makeCell('', { borderBottom: true, heavyBorder: true }),
              makeCell(fmtPct(model.computed.totalCAGRNoDivs, 2), { align: AlignmentType.CENTER, bold: true, borderBottom: true, heavyBorder: true, color: C.accent }),
              makeCell(fmtPct(model.computed.totalCAGR, 2), { align: AlignmentType.CENTER, bold: true, borderBottom: true, heavyBorder: true, color: C.accent }),
              makeCell(`$${fmt(model.computed.priceTarget, 2)}`, { align: AlignmentType.CENTER, bold: true, borderBottom: true, heavyBorder: true }),
              makeCell(`$${fmt(model.computed.targetPrice5, 2)}`, { align: AlignmentType.CENTER, bold: true, borderBottom: true, heavyBorder: true }),
            ],
          }),
        ],
      }));
    }
  }

  // ═══════════ DISCLAIMER ═══════════
  {
    sections.push(spacer(200));
    sections.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.navy } },
      children: [],
    }));
    sections.push(spacer(60));

    const disclaimerText = [
      'This report was prepared by B.D. Sterling Capital Management for internal research purposes only and does not constitute investment advice, a solicitation, or an offer to buy or sell any securities.',
      'The information contained herein is based on sources believed to be reliable but is not guaranteed as to its accuracy or completeness. Past performance is not indicative of future results. All investments involve risk, including the possible loss of principal.',
      `Report generated on ${dateStr}.`,
    ];
    disclaimerText.forEach(line => {
      sections.push(new Paragraph({
        spacing: { after: 60, line: 240 },
        children: [new TextRun({ text: line, font: FONT, size: 15, color: C.light, italics: true })],
      }));
    });
  }

  // ═══════════ BUILD DOCUMENT ═══════════
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 },
        },
      },
      children: sections,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const dateTag = `${mm}.${dd}.${yy}`;
  const filename = isResearchWorkspace
    ? `${ticker} Equity Primer ${dateTag}.docx`
    : `${ticker} Position Review ${dateTag}.docx`;
  saveAs(blob, filename);
}
