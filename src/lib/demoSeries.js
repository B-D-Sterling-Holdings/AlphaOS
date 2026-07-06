/*
  Deterministic numeric generators for the demo tenant's seed data.

  Everything here is pure: same inputs -> same outputs (a fixed-seed PRNG drives
  all "noise"), with dates computed relative to `now` so the demo never looks
  stale. The narrative rows live in demoData.js; the wipe/insert orchestration
  lives in demoSeed.js.
*/

import { createHash } from 'crypto';

/* ── Deterministic ids ─────────────────────────────────────────────
   Every seeded row that needs a uuid gets one derived from a stable label, so
   re-seeding (or two concurrent resets) converges on the same rows instead of
   ever duplicating them. */
export function demoId(label) {
  const h = createHash('sha256').update(`alphaos-demo:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* ── PRNG (mulberry32) ───────────────────────────────────────────── */
export function makeRng(seed = 0x5eed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Standard-normal-ish via sum of uniforms (plenty for chart noise).
function gauss(rng) {
  return (rng() + rng() + rng() + rng() - 2) * Math.sqrt(3);
}

/* ── Date helpers ──────────────────────────────────────────────────── */
export const dstr = (d) => d.toISOString().slice(0, 10);
export function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function isWeekend(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }

export function lastBusinessDay(now) {
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d = addDays(d, -1); // yesterday: "as of last close"
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

export function businessDays(from, to) {
  const out = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    if (!isWeekend(d)) out.push(new Date(d));
  }
  return out;
}

export function monthEnds(from, to) {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  for (let m = new Date(d); m <= to; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 2, 0))) {
    out.push(new Date(m));
  }
  return out;
}

// Start of the quarter `back` quarters before the one containing `now`.
export function quarterStart(now, back = 0) {
  const q = Math.floor(now.getUTCMonth() / 3) - back;
  return new Date(Date.UTC(now.getUTCFullYear() + Math.floor(q / 4), ((q % 4) + 4) % 4 * 3, 1));
}
export function quarterLabel(d) {
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/* ── Piecewise price paths ─────────────────────────────────────────
   checkpoints: [[fraction 0..1, price], ...] — log-linear between checkpoints
   with PRNG noise, then rescaled per segment so every checkpoint is hit
   exactly. Lets a name round-trip (run up, crack, base) like real charts do. */
export function pricePath(dates, checkpoints, { vol = 0.016, seed = 1 } = {}) {
  const rng = makeRng(seed);
  const n = dates.length;
  const pts = checkpoints.map(([f, p]) => [Math.min(n - 1, Math.round(f * (n - 1))), Math.log(p)]);
  const logs = new Array(n);
  for (let s = 0; s < pts.length - 1; s++) {
    const [i0, l0] = pts[s];
    const [i1, l1] = pts[s + 1];
    const len = i1 - i0;
    // raw walk with per-step drift, then pin both ends of the segment
    const raw = [0];
    for (let i = 1; i <= len; i++) raw.push(raw[i - 1] + gauss(rng) * vol);
    for (let i = 0; i <= len; i++) {
      const f = len === 0 ? 1 : i / len;
      const bridge = raw[i] - raw[len] * f; // Brownian bridge: ends at 0
      logs[i0 + i] = l0 + (l1 - l0) * f + bridge;
    }
  }
  return logs.map((l) => Math.round(Math.exp(l) * 100) / 100);
}

export function marketDataFor(dates, closes) {
  const n = closes.length;
  const currentPrice = closes[n - 1];
  const currentDate = dstr(dates[n - 1]);
  const last252 = closes.slice(-252);
  const hi = Math.max(...last252);
  const lo = Math.min(...last252);
  const rows = [
    { metric: 'current_price', value: currentPrice, date: currentDate },
    { metric: '52_week_high', value: hi, date: currentDate },
    { metric: '52_week_low', value: lo, date: currentDate },
    { metric: 'pct_from_52week_high', value: Math.round(((currentPrice - hi) / hi) * 10000) / 100, date: currentDate },
  ];
  if (n >= 252) {
    const ago = closes[n - 252];
    rows.push({ metric: 'pct_change_1y', value: Math.round(((currentPrice - ago) / ago) * 10000) / 100, date: currentDate });
  }
  return rows;
}

/* ── Quarterly fundamentals (TTM series, same field names the app writes) ── */
// Last `count` COMPLETE quarters before `now`, oldest first: [{year, quarter:'Q1'..}]
export function lastQuarters(now, count) {
  const out = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3); // 0-based; current (incomplete) quarter
  for (let i = 0; i < count; i++) {
    q -= 1;
    if (q < 0) { q += 4; y -= 1; }
    out.unshift({ year: y, quarter: `Q${q + 1}` });
  }
  return out;
}

/**
 * One ticker's full fundamentals set. Growth compounds per year with a little
 * wobble; margins glide start->end; shares follow explicit checkpoints so
 * buyback (or dilution / merger) stories read true on the chart.
 */
export function fundamentalsFor(now, {
  seed, revenue0, revenueGrowth, margin0, margin1,
  eps0, epsGrowth, shares, fcfMargin, quarters = 29,
}) {
  const rng = makeRng(seed);
  const qs = lastQuarters(now, quarters);
  const wob = () => 1 + (rng() - 0.5) * 0.05;
  const n = qs.length;

  const shPts = shares.map(([f, v]) => [Math.round(f * (n - 1)), v]);
  const shareAt = (i) => {
    for (let s = 0; s < shPts.length - 1; s++) {
      const [i0, v0] = shPts[s]; const [i1, v1] = shPts[s + 1];
      if (i >= i0 && i <= i1) return v0 + ((v1 - v0) * (i - i0)) / Math.max(1, i1 - i0);
    }
    return shPts[shPts.length - 1][1];
  };

  const rev = [], margins = [], eps = [], fcf = [], buybacks = [];
  for (let i = 0; i < n; i++) {
    const t = i / 4; // years
    const r = revenue0 * Math.pow(1 + revenueGrowth, t) * wob();
    const m = (margin0 + (margin1 - margin0) * (i / (n - 1))) * (1 + (rng() - 0.5) * 0.08);
    const e = eps0 * Math.pow(1 + epsGrowth, t) * wob();
    rev.push({ ...qs[i], revenue: Math.round(r) });
    margins.push({ ...qs[i], operating_margin: Math.round(m * 10000) / 10000 });
    eps.push({ ...qs[i], eps_diluted: Math.round(e * 10000) / 10000 });
    fcf.push({ ...qs[i], free_cash_flow: Math.round(r * fcfMargin * wob()) });
    buybacks.push({ ...qs[i], shares_outstanding: Math.round(shareAt(i)) });
  }
  return { revenue: rev, operating_margins: margins, eps, fcf, buybacks };
}

/* ── Fund NAV curve (fund vs S&P, daily, inception -> last close) ── */
export function navSeries(now, { fundEnd = 164.8, spEnd = 129.9, seed = 77 } = {}) {
  const inception = quarterStart(now, 7);
  const end = lastBusinessDay(now);
  const dates = businessDays(inception, end);
  const n = dates.length;
  const rng = makeRng(seed);

  // Correlated walks (fund beta ~1.1 to a shared market shock plus idio noise),
  // then a log-space rescale so both series land exactly on their targets.
  const fLog = [0], sLog = [0];
  for (let i = 1; i < n; i++) {
    const mkt = gauss(rng) * 0.0085;
    fLog.push(fLog[i - 1] + mkt * 1.1 + gauss(rng) * 0.006);
    sLog.push(sLog[i - 1] + mkt);
  }
  // one honest drawdown ~55-65% of the way in (a rough spring), then recovery
  const dipC = Math.round(n * 0.6), dipW = Math.round(n * 0.05);
  for (let i = 0; i < n; i++) {
    const dip = Math.exp(-((i - dipC) ** 2) / (2 * dipW ** 2));
    fLog[i] -= 0.13 * dip;
    sLog[i] -= 0.08 * dip;
  }
  const scale = (logs, target) => {
    const drift = (Math.log(target / 100) - (logs[n - 1] - logs[0])) / (n - 1);
    return logs.map((l, i) => 100 * Math.exp(l - logs[0] + drift * i));
  };
  const fund = scale(fLog, fundEnd);
  const sp = scale(sLog, spEnd);
  return dates.map((d, i) => ({
    date: dstr(d),
    fund_nav: Math.round(fund[i] * 1e6) / 1e6,
    sp500_nav: Math.round(sp[i] * 1e6) / 1e6,
  }));
}

/* ── Fund accounting state (the Financials accounting tool) ───────
   Same JSON shape the AccountingTool persists. Contributions land at
   different times per investor, so money-weighted IRRs differ by design. */
export function accountingState(now) {
  const qReturns = [0.055, -0.025, 0.09, 0.115, 0.075, 0.06, 0.045, 0.08];
  const spMults = [1.031, 0.972, 1.055, 1.062, 1.041, 1.028, 1.019, 1.036];
  const contribs = [
    null,
    { Morgan: 5000 },
    { Alex: 2500, Jordan: 1500 },
    { Morgan: 7500 },
    { Jordan: 4000 },
    { Alex: 6000, Morgan: 3000 },
    null,
    { Alex: 10000, Jordan: 6000, Morgan: 4000 },
  ];

  const inception = quarterStart(now, 7);
  const inceptionSP = 5710;
  let aum = 20000;
  let sp = inceptionSP;
  const round2 = (x) => Math.round(x * 100) / 100;

  const quarters = [];
  for (let i = 0; i < 8; i++) {
    const qs = quarterStart(now, 7 - i);
    const qe = addDays(quarterStart(now, 6 - i), -1);
    const label = quarterLabel(qs);
    const events = [];
    const g = 1 + qReturns[i];
    const spQ = spMults[i];
    const c = contribs[i];
    if (!c) {
      aum *= g; sp *= spQ;
      events.push({ type: 'period', startDate: dstr(qs), endDate: dstr(qe), endAUM: round2(aum), spEnd: round2(sp) });
    } else {
      // split the quarter around a mid-quarter contribution date
      const mid = addDays(qs, 44);
      const half = Math.sqrt(g);
      const spHalf = Math.sqrt(spQ);
      aum *= half; sp *= spHalf;
      events.push({ type: 'period', startDate: dstr(qs), endDate: dstr(mid), endAUM: round2(aum), spEnd: round2(sp) });
      events.push({ type: 'contribution', date: dstr(mid), amounts: c });
      aum += Object.values(c).reduce((s, v) => s + v, 0);
      aum *= half; sp *= spHalf;
      events.push({ type: 'period', startDate: dstr(addDays(mid, 1)), endDate: dstr(qe), endAUM: round2(aum), spEnd: round2(sp) });
    }
    quarters.push({ label, events });
  }

  return {
    investors: ['Alex', 'Jordan', 'Morgan'],
    inceptionDate: dstr(inception),
    inceptionNAV: 100,
    initialShares: { Alex: 120, Jordan: 80, Morgan: 0 },
    inceptionSP,
    quarters,
  };
}

/* ── Macro regime allocator backtest (monthly walk-forward) ──────── */
function interp(points, f) {
  for (let s = 0; s < points.length - 1; s++) {
    const [f0, v0] = points[s]; const [f1, v1] = points[s + 1];
    if (f >= f0 && f <= f1) return v0 + ((v1 - v0) * (f - f0)) / Math.max(1e-9, f1 - f0);
  }
  return points[points.length - 1][1];
}

export function macroBacktest(now, { months = 138, seed = 31 } = {}) {
  const rng = makeRng(seed);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last complete month-end
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  const ends = monthEnds(start, end);
  const n = ends.length;

  // Era-shaped macro series (fractions of the window), loosely 2015 -> now:
  // a long expansion, a violent spike ~45% in (the 2020 analog), a hot-inflation
  // bear ~62% in, then normalization with one recent wobble.
  const unemp = (f) => interp([[0, 5.4], [0.42, 3.6], [0.45, 13.0], [0.5, 8.2], [0.62, 3.7], [0.8, 4.0], [1, 4.2]], f);
  const infl = (f) => interp([[0, 1.6], [0.4, 2.1], [0.55, 4.5], [0.63, 8.9], [0.75, 3.4], [0.9, 2.6], [1, 2.4]], f);
  const spread = (f) => interp([[0, 1.4], [0.44, 1.1], [0.46, 3.9], [0.50, 1.4], [0.62, 1.45], [0.66, 2.4], [0.72, 1.4], [0.8, 1.25], [1, 1.25]], f);
  const slope = (f) => interp([[0, 1.4], [0.4, 0.8], [0.55, 1.2], [0.68, -0.9], [0.85, -0.2], [1, 0.6]], f);
  const fedReal = (f) => interp([[0, -1.4], [0.4, 0.4], [0.5, -3.5], [0.68, -5.5], [0.8, 2.2], [1, 1.4]], f);
  const eqDrift = (f) => interp(
    [[0, 0.008], [0.42, 0.01], [0.44, -0.09], [0.47, 0.05], [0.55, 0.014],
     [0.6, -0.02], [0.68, -0.012], [0.72, 0.02], [0.88, 0.012], [0.93, 0.004], [1, 0.012]], f);
  const tbRate = (f) => interp([[0, 0.0008], [0.45, 0.0002], [0.68, 0.002], [0.8, 0.0044], [1, 0.0035]], f);

  const rows = [];
  let cumEq = 100, cumTb = 100, cum6040 = 100, cumEw = 100, cumPort = 100;
  let weight = 0.85;
  let peakEq = 100;
  let vix = 15;
  const first = {
    date: dstr(addDays(ends[0], -30)), cum_ew: 100, overlay: null, cum_6040: 100, cum_port: 100,
    ret_6040: null, turnover: 0, ew_return: null, cum_equity: 100, cum_tbills: 100,
    pred_class: null, ret_equity: null, ret_tbills: null, train_size: null, port_return: null,
    prob_equity: null, prob_tbills: null, actual_label: null, weight_equity: null, weight_tbills: null,
    rebalance_date: null,
  };
  rows.push(first);

  let prevMomentum = 3;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const retEq = eqDrift(f) + gauss(rng) * 0.032;
    const retTb = tbRate(f) * (1 + (rng() - 0.5) * 0.1);
    const prevEq = cumEq;
    cumEq *= 1 + retEq;
    cumTb *= 1 + retTb;
    peakEq = Math.max(peakEq, cumEq);
    const drawdown = ((cumEq - peakEq) / peakEq) * 100;
    const momentum = ((cumEq / prevEq - 1) * 0.4 + prevMomentum / 100 * 0.6) * 100;
    prevMomentum = momentum;
    const newVix = Math.max(11, Math.min(62, 16 - momentum * 0.8 - drawdown * 0.9 + gauss(rng) * 2.5));
    const vixChange = newVix - vix;
    vix = newVix;

    // model: momentum + curve - stress => prob equity beats t-bills. Calm
    // regimes sit comfortably risk-on; only genuine stress (credit spikes,
    // vix shocks, deep drawdowns) pulls the book down — and it re-risks
    // quickly once stress clears, so the backtest shows the de-risking win
    // without a permanent underweight drag.
    const score = 1.05 + momentum * 0.12 + slope(f) * 0.25
      - Math.max(0, spread(f) - 1.6) * 2.6 - Math.max(0, vixChange) * 0.15;
    const probEq = 1 / (1 + Math.exp(-score));
    const targetW = 0.1 + 0.87 / (1 + Math.exp(-13 * (probEq - 0.45)));
    const prevW = weight;
    weight = probEq >= 0.5 ? prevW * 0.75 + targetW * 0.25 : prevW * 0.7 + targetW * 0.3;
    weight = Math.min(0.97, Math.max(0.1, weight));
    const overlay = drawdown < -10 && retEq < 0 ? 'defense' : vixChange > 7 ? 'vix_spike' : 'none';
    if (overlay === 'defense') weight = Math.max(0.1, weight - 0.15);

    const portRet = prevW * retEq + (1 - prevW) * retTb;
    cumPort *= 1 + portRet;
    const ret6040 = 0.6 * retEq + 0.4 * retTb;
    cum6040 *= 1 + ret6040;
    const ewRet = 0.5 * retEq + 0.5 * retTb;
    cumEw *= 1 + ewRet;

    const r4 = (x) => Math.round(x * 1e6) / 1e6;
    rows.push({
      date: dstr(ends[i]),
      cum_ew: r4(cumEw), overlay, cum_6040: r4(cum6040), cum_port: r4(cumPort),
      ret_6040: r4(ret6040), turnover: r4(Math.abs(weight - prevW)), ew_return: r4(ewRet),
      cum_equity: r4(cumEq), cum_tbills: r4(cumTb),
      pred_class: probEq >= 0.5 ? 1 : 0,
      ret_equity: r4(retEq), ret_tbills: r4(retTb),
      train_size: 60 + i, port_return: r4(portRet),
      prob_equity: r4(probEq), prob_tbills: r4(1 - probEq),
      actual_label: retEq > retTb ? 1 : 0,
      weight_equity: r4(prevW), weight_tbills: r4(1 - prevW),
      rebalance_date: `${dstr(i === 0 ? addDays(ends[0], -30) : ends[i - 1])} 00:00:00`,
      md_equity_vol_3m: r4(Math.abs(gauss(rng)) * 4 + 9 + Math.max(0, vix - 16) * 0.5),
      md_inflation_yoy: r4(infl(f)),
      md_vix_1m_change: r4(vixChange),
      md_real_fed_funds: r4(fedReal(f)),
      md_inflation_impulse: r4(infl(f) - infl(Math.max(0, f - 0.02))),
      md_unemployment_rate: r4(unemp(f)),
      md_yield_curve_slope: r4(slope(f)),
      md_drawdown_1m_change: r4(retEq < 0 ? retEq * 100 : 0),
      md_equity_momentum_3m: r4(momentum * 3),
      md_vix_term_structure: r4(1 + (vix - 16) * -0.01),
      md_credit_spread_level: r4(spread(f)),
      md_credit_spread_3m_change: r4(spread(f) - spread(Math.max(0, f - 0.02))),
      md_equity_drawdown_from_high: r4(drawdown),
    });
  }
  return rows;
}

// Portfolio metrics table from a monthly return series (matches METRICS_KEYS).
function seriesMetrics(label, rets) {
  const n = rets.length;
  const cum = rets.reduce((c, r) => c * (1 + r), 1);
  const years = n / 12;
  const mean = rets.reduce((s, r) => s + r, 0) / n;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / n);
  const downs = rets.filter((r) => r < 0);
  const dsd = Math.sqrt(downs.reduce((s, r) => s + r * r, 0) / Math.max(1, downs.length));
  let peak = 1, level = 1, maxDd = 0, ddStart = 0, maxDur = 0, curDur = 0;
  rets.forEach((r) => {
    level *= 1 + r;
    if (level > peak) { peak = level; curDur = 0; } else { curDur += 1; maxDur = Math.max(maxDur, curDur); }
    maxDd = Math.min(maxDd, level / peak - 1);
  });
  const cagr = Math.pow(cum, 1 / years) - 1;
  const vol = sd * Math.sqrt(12);
  const r2 = (x) => Math.round(x * 10000) / 10000;
  return {
    label,
    cagr: r2(cagr),
    total_return: r2(cum - 1),
    volatility: r2(vol),
    sharpe: r2(vol > 0 ? (cagr - 0.03) / vol : 0),
    sortino: r2(dsd > 0 ? (cagr - 0.03) / (dsd * Math.sqrt(12)) : 0),
    calmar: r2(maxDd < 0 ? cagr / -maxDd : 0),
    max_drawdown: r2(maxDd),
    max_dd_duration: maxDur,
    hit_rate: r2(rets.filter((r) => r > 0).length / n),
    best_month: r2(Math.max(...rets)),
    worst_month: r2(Math.min(...rets)),
    up_down_ratio: r2(
      (rets.filter((r) => r > 0).reduce((s, r) => s + r, 0) / Math.max(1, rets.filter((r) => r > 0).length)) /
      Math.max(1e-9, -(downs.reduce((s, r) => s + r, 0) / Math.max(1, downs.length)))
    ),
  };
}

export function macroMetrics(backtest) {
  const rows = backtest.filter((r) => r.port_return != null);
  const pick = (k) => rows.map((r) => r[k]);
  return [
    seriesMetrics('Model Portfolio', pick('port_return')),
    seriesMetrics('Equity Only', pick('ret_equity')),
    seriesMetrics('60/40 Portfolio', pick('ret_6040')),
    seriesMetrics('Equal Weight', pick('ew_return')),
    seriesMetrics('T-bills Only', pick('ret_tbills')),
  ];
}

export function macroLivePrediction(now, backtest) {
  const last = backtest[backtest.length - 1];
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const w = Math.min(0.94, (last.weight_equity ?? 0.85) + 0.02);
  return {
    rebalance_date: last.date,
    allocation_month: dstr(nextMonth),
    weight_equity: w,
    weight_tbills: Math.round((1 - w) * 1e6) / 1e6,
    prob_equity: 0.77,
    prob_tbills: 0.23,
    overlay: 'none',
    market_signals: {
      vix: 16.4,
      credit_spread: last.md_credit_spread_level,
      yield_curve_slope: last.md_yield_curve_slope,
      unemployment: last.md_unemployment_rate,
      equity_momentum_3m: last.md_equity_momentum_3m,
    },
  };
}

/* ── Minimal PDF builder ───────────────────────────────────────────
   Hand-assembled single-font PDF (valid per spec: correct xref offsets).
   Small on purpose — these are placeholder artifacts for the demo library. */
function pdfEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function makePdf(title, lines) {
  const content = [];
  content.push('BT');
  content.push('/F2 16 Tf 72 720 Td');
  content.push(`(${pdfEscape(title)}) Tj`);
  content.push('/F1 10 Tf 0 -30 Td 14 TL');
  for (const line of lines) content.push(`(${pdfEscape(line)}) Tj T*`);
  content.push('ET');
  const stream = content.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let out = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
