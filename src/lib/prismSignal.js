// Pure helpers for deriving Prism AI signal history from prism_recommendations
// rows. Ports the history logic from the original prism_ai frontend/server.py
// (build_ticker_history / get_all_ticker_histories / get_ticker_timeline) so the
// API routes stay thin. No Supabase access here — callers pass in fetched rows.

export const SIGNAL_MAP = { BUY: 1, HOLD: 0, AVOID: -1, SELL: -1, UNKNOWN: 0 };
export const CONVICTION_MAP = { VERY_HIGH: 4, HIGH: 3, MODERATE: 2, LOW: 1, UNKNOWN: 0 };

export function normalizeSignal(signal) {
  if (!signal) return 'UNKNOWN';
  const s = String(signal).trim().toUpperCase();
  if (s === 'SELL') return 'AVOID';
  return s || 'UNKNOWN';
}

// Sort rows for a single ticker oldest -> newest and flag signal changes.
function sortedEntries(rows) {
  const entries = (rows || []).map((r) => ({
    id: r.id,
    source_file: r.source_file,
    analysis_date: r.analysis_date || '',
    signal: normalizeSignal(r.signal),
    conviction: (r.conviction || 'UNKNOWN') ? String(r.conviction || 'UNKNOWN').toUpperCase() : 'UNKNOWN',
    position_size_pct: r.position_size_pct ?? null,
    price_target: r.price_target ?? null,
    expected_return_pct: r.expected_return_pct ?? null,
    model: r.model || null,
    analysis_mode: r.analysis_mode || null,
  }));

  entries.sort((a, b) => String(a.analysis_date).localeCompare(String(b.analysis_date)));

  let prev = null;
  for (const e of entries) {
    e.signal_changed = prev !== null && e.signal !== prev;
    prev = e.signal;
  }
  return entries;
}

// Full history for one ticker (entries + summary fields).
export function buildTickerHistory(ticker, rows) {
  const entries = sortedEntries(rows);
  const signalChanges = entries.filter((e) => e.signal_changed).length;
  const last = entries[entries.length - 1];
  const first = entries[0];
  return {
    ticker: String(ticker).toUpperCase(),
    entries,
    total_analyses: entries.length,
    signal_changes: signalChanges,
    current_signal: last ? last.signal : '',
    current_conviction: last ? last.conviction : '',
    first_analysis: first ? first.analysis_date : '',
    last_analysis: last ? last.analysis_date : '',
  };
}

// Timeline points (charting/dot view) for one ticker.
export function buildTimeline(ticker, rows) {
  return sortedEntries(rows).map((e) => ({
    id: e.id,
    source_file: e.source_file,
    date: e.analysis_date,
    signal: e.signal,
    signal_value: SIGNAL_MAP[e.signal] ?? 0,
    conviction: e.conviction,
    conviction_value: CONVICTION_MAP[e.conviction] ?? 0,
    position_size_pct: e.position_size_pct,
    price_target: e.price_target,
    expected_return_pct: e.expected_return_pct,
    signal_changed: e.signal_changed,
    model: e.model,
  }));
}

// Per-ticker summaries across all rows (Signal History landing list).
export function summarizeHistories(rows) {
  const byTicker = new Map();
  for (const r of rows || []) {
    const t = String(r.ticker || '').toUpperCase();
    if (!t) continue;
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t).push(r);
  }

  const histories = [];
  for (const [ticker, tickerRows] of byTicker) {
    const h = buildTickerHistory(ticker, tickerRows);
    if (!h.entries.length) continue;

    // Collapse consecutive duplicate signals: e.g. "HOLD → BUY → HOLD".
    const progression = [];
    for (const e of h.entries) {
      if (!progression.length || progression[progression.length - 1] !== e.signal) {
        progression.push(e.signal);
      }
    }

    histories.push({
      ticker: h.ticker,
      total_analyses: h.total_analyses,
      signal_changes: h.signal_changes,
      current_signal: h.current_signal,
      current_conviction: h.current_conviction,
      first_analysis: h.first_analysis,
      last_analysis: h.last_analysis,
      signal_progression: progression.join(' → '),
    });
  }

  histories.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return histories;
}
