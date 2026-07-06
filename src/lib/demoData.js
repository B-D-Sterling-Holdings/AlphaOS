/*
  The demo tenant's canonical dataset.

  Modeled on the CIO Alpha workspace (same kind of concentrated quality-growth
  fund, same analytic voice) but fully fictional: "Blue Harbor Capital", run by
  Alex (PM) and Jordan (analyst). Every section the real workspace uses is
  populated — and the sections that are thin in the real workspace (contact
  profiles, interactions, ideas, lessons, candidate positions) are deliberately
  built out so the demo shows each feature the way it's meant to look.

  The ticker cast intentionally does NOT overlap the CIO tenant's stored
  ticker_prices / ticker_fundamentals rows: in the deployed DB those two tables
  are still keyed on (ticker, data_type) without tenant_id (see
  scripts/migrations/009_ticker_data_tenant_keys.sql), so overlapping tickers
  could not carry their own demo data.

  buildDemoDataset() is pure: rows have no tenant_id (demoSeed stamps it) and
  all dates derive from `now`, so the demo always reads as current.
*/

import {
  demoId, dstr, addDays, lastBusinessDay, businessDays,
  pricePath, marketDataFor, fundamentalsFor,
  navSeries, accountingState, macroBacktest, macroMetrics, macroLivePrediction,
  makePdf,
} from './demoSeries.js';

/* ── Ticker catalog ────────────────────────────────────────────────
   `end` prices are anchors for the synthetic history; when the seeder can get
   a live quote the whole path is rescaled so charts end at the real price. */
const PRICE_PATHS = {
  AAPL: { end: 260,  pts: [[0, 155], [0.4, 225], [0.6, 205], [1, 260]] },
  MSFT: { end: 505,  pts: [[0, 338], [0.5, 430], [0.7, 398], [1, 505]] },
  AVGO: { end: 340,  pts: [[0, 92], [0.5, 178], [0.75, 242], [1, 340]] },
  TSM:  { end: 260,  pts: [[0, 95], [0.45, 185], [0.6, 152], [1, 260]] },
  V:    { end: 370,  pts: [[0, 238], [0.5, 292], [1, 370]] },
  SPOT: { end: 640,  pts: [[0, 158], [0.5, 322], [0.8, 705], [1, 640]] },
  DASH: { end: 210,  pts: [[0, 76], [0.4, 132], [0.6, 108], [1, 210]] },
  COST: { end: 980,  pts: [[0, 552], [0.5, 905], [0.75, 1050], [1, 980]] },
  LLY:  { end: 850,  pts: [[0, 455], [0.4, 950], [0.6, 720], [1, 850]] },
  ISRG: { end: 430,  pts: [[0, 292], [0.5, 388], [0.75, 482], [1, 430]] },
  MCO:  { end: 420,  pts: [[0, 338], [0.4, 468], [0.7, 496], [1, 420]] },
  MELI: { end: 2400, pts: [[0, 1250], [0.5, 2050], [0.75, 1720], [1, 2400]] },
  PYPL: { end: 70,   pts: [[0, 74], [0.3, 62], [0.6, 88], [1, 70]] },
};

const FUNDAMENTAL_PARAMS = {
  AAPL: { revenue0: 95e9, revenueGrowth: 0.07, margin0: 0.295, margin1: 0.32, eps0: 1.52, epsGrowth: 0.105, fcfMargin: 0.26, shares: [[0, 16.7e9], [1, 14.9e9]] },
  MSFT: { revenue0: 134e9, revenueGrowth: 0.135, margin0: 0.34, margin1: 0.46, eps0: 5.1, epsGrowth: 0.15, fcfMargin: 0.30, shares: [[0, 7.68e9], [1, 7.42e9]] },
  // AVGO share path mirrors the VMware merger: jump on the deal, buybacks after.
  AVGO: { revenue0: 8.6e9, revenueGrowth: 0.20, margin0: 0.28, margin1: 0.39, eps0: 0.92, epsGrowth: 0.24, fcfMargin: 0.38, shares: [[0, 4.12e9], [0.5, 4.14e9], [0.56, 4.88e9], [1, 4.7e9]] },
  TSM:  { revenue0: 17.2e9, revenueGrowth: 0.18, margin0: 0.38, margin1: 0.46, eps0: 1.08, epsGrowth: 0.22, fcfMargin: 0.24, shares: [[0, 5.19e9], [1, 5.19e9]] },
  V:    { revenue0: 22e9, revenueGrowth: 0.10, margin0: 0.65, margin1: 0.67, eps0: 4.9, epsGrowth: 0.13, fcfMargin: 0.58, shares: [[0, 2.27e9], [1, 1.93e9]] },
  SPOT: { revenue0: 3.2e9, revenueGrowth: 0.16, margin0: -0.02, margin1: 0.13, eps0: 0.28, epsGrowth: 0.55, fcfMargin: 0.13, shares: [[0, 1.95e8], [1, 2.06e8]] },
  DASH: { revenue0: 1.9e9, revenueGrowth: 0.24, margin0: -0.09, margin1: 0.07, eps0: 0.06, epsGrowth: 0.65, fcfMargin: 0.12, shares: [[0, 3.5e8], [1, 4.2e8]] },
  ISRG: { revenue0: 1.62e9, revenueGrowth: 0.14, margin0: 0.25, margin1: 0.285, eps0: 1.14, epsGrowth: 0.16, fcfMargin: 0.22, shares: [[0, 3.55e8], [1, 3.58e8]] },
  MCO:  { revenue0: 1.42e9, revenueGrowth: 0.10, margin0: 0.42, margin1: 0.465, eps0: 2.38, epsGrowth: 0.13, fcfMargin: 0.31, shares: [[0, 1.87e8], [1, 1.8e8]] },
  MELI: { revenue0: 2.1e9, revenueGrowth: 0.30, margin0: 0.06, margin1: 0.15, eps0: 3.1, epsGrowth: 0.42, fcfMargin: 0.14, shares: [[0, 5.0e7], [1, 5.08e7]] },
};

const HOLDINGS = [
  { ticker: 'AAPL', shares: 42.1836, cost_basis: 205.10 },
  { ticker: 'MSFT', shares: 22.1042, cost_basis: 412.85 },
  { ticker: 'AVGO', shares: 28.4405, cost_basis: 214.30 },
  { ticker: 'TSM', shares: 31.5122, cost_basis: 295.00 },
  { ticker: 'V', shares: 26.3155, cost_basis: 286.75 },
  { ticker: 'SPOT', shares: 14.2078, cost_basis: 445.20 },
  { ticker: 'DASH', shares: 39.8214, cost_basis: 158.30 },
  { ticker: 'COST', shares: 6.2247, cost_basis: 892.30 },
  { ticker: 'LLY', shares: 5.4310, cost_basis: 776.45 },
  { ticker: 'ISRG', shares: 18.6021, cost_basis: 398.60 },
];

const q = (text, done = false, answer = '', subQuestions = []) => ({ text, done, answer, subQuestions });
const sq = (text, done = false, answer = '') => ({ text, done, answer });
const block = (value) => ({ type: 'text', value });

function thread(label, title, resolved, messages, baseIso) {
  return {
    id: demoId(`thread:${label}`),
    title,
    resolved,
    createdAt: baseIso,
    messages: messages.map(([role, body], i) => ({
      id: demoId(`msg:${label}:${i}`),
      role,
      body,
      createdAt: baseIso,
    })),
  };
}

export function buildDemoDataset({ now = new Date(), quotes = {} } = {}) {
  const ago = (days, hour = 15) => new Date(now.getTime() - days * 86400000 - hour * 3600000).toISOString();
  const inDays = (days) => dstr(addDays(now, days));
  const T = {}; // tables

  /* ── Price + fundamentals series ─────────────────────────────── */
  const priceEnd = lastBusinessDay(now);
  const priceDates = businessDays(addDays(priceEnd, -1120), priceEnd); // ~3 trading years
  T.ticker_prices = [];
  const lastCloseOf = {};
  Object.entries(PRICE_PATHS).forEach(([ticker, { end, pts }], idx) => {
    const live = Number(quotes[ticker]);
    const k = live > 0 ? live / end : 1;
    const scaled = pts.map(([f, p]) => [f, p * k]);
    const closes = pricePath(priceDates, scaled, { seed: 100 + idx });
    lastCloseOf[ticker] = closes[closes.length - 1];
    T.ticker_prices.push(
      { ticker, data_type: 'daily_prices', data: priceDates.map((d, i) => ({ date: dstr(d), close: closes[i] })), updated_at: ago(0) },
      { ticker, data_type: 'market_data', data: marketDataFor(priceDates, closes), updated_at: ago(0) },
    );
  });

  T.ticker_fundamentals = [];
  Object.entries(FUNDAMENTAL_PARAMS).forEach(([ticker, params], idx) => {
    const series = fundamentalsFor(now, { seed: 500 + idx, ...params });
    for (const [data_type, data] of Object.entries(series)) {
      T.ticker_fundamentals.push({ ticker, data_type, data, updated_at: ago(1) });
    }
  });

  /* ── Portfolio ───────────────────────────────────────────────── */
  T.holdings = HOLDINGS.map((h, i) => ({ ...h, added_at: ago(560 - i * 45) }));
  // Per-tenant cash lives in app_settings now (see the app_settings block below).
  T.fund_nav_data = navSeries(now);

  /* ── Watchlist pipeline (all four stages populated) ──────────── */
  const fundamentalsNote = { misc: '', capitalReturn: '', profitability: '', revenueGrowth: '' };
  const mainStocks = [
    // ── watching ──
    { ticker: 'NOW', stage: 'watching', addedAt: ago(95), note: 'Mission critical workflow platform, still compounding subscription revenue ~20% with cRPO ahead of that, but the stock has been cut roughly in half from the high on AI-displacement fear. The question is whether agentic tools erode seat counts or whether NOW is the layer that orchestrates them. Watch seat vs. consumption pricing mix in the next two prints.', fundamentals: fundamentalsNote, dislocationItems: [], dueDiligenceItems: [] },
    { ticker: 'ADP', stage: 'watching', addedAt: ago(80), note: 'Payroll toll booth with 30+ year dividend growth streak, float income gives a free kicker while rates stay up here. Boring on purpose - candidate for the defensive sleeve if we trim growth.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'SPGI', stage: 'watching', addedAt: ago(74), note: 'The pair to study against our MCO work - same ratings CYA dynamics plus the index royalty stream. If the MCO memo clears IC, do the relative-value comparison before sizing: SPGI has the better index business, MCO the cleaner ratings mix.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'INTU', stage: 'watching', addedAt: ago(105), note: 'Down ~65% from the high on AI-does-your-taxes fear. Strong ecosystem around tax, small business, payroll and consumer finance with multiple engines running, but the bear case (an AI agent files your taxes for free) attacks the core segment directly, not the edges. Needs proof the assistant features deepen engagement instead of shrinking the category. High bar to move this forward.', fundamentals: fundamentalsNote, dislocation: { catalyst: '', mispricing: '', marketVsYou: '', downsideRisk: '', variantPerception: '' }, dislocationItems: [] },
    { ticker: 'TXN', stage: 'watching', addedAt: ago(60), note: 'Analog semis at the bottom of the inventory cycle, 300mm capacity build mostly behind them so FCF inflects from here. Slower grower than what we own - only interesting at a real discount.', fundamentals: fundamentalsNote, dislocationItems: [] },
    // ── draft ──
    { ticker: 'MCO', stage: 'draft', addedAt: ago(70), note: 'Ratings duopoly toll booth with excellent margins. Market is penalizing the whole company for AI risk in Moody\'s Analytics (~35% of operating income) while MIS - the crown jewel - is insulated and rides the refinancing wall. Draft memo in review with Jordan, IC Friday.', fundamentals: { revenueGrowth: 'TTM revenue ~$7.9B growing ~10% with MIS rebounding on issuance', profitability: 'MIS op margin ~60%; MA ~30%; blended mid-40s and rising', capitalReturn: 'Buying back ~1.5%/yr; 15 straight years of dividend growth', misc: 'MA recurring revenue ~95% - decay would be slow even in the bear case' }, dislocationItems: [], dueDiligenceItems: [] },
    { ticker: 'PYPL', stage: 'draft', addedAt: ago(55), note: 'Branded checkout share is the whole debate. Optically very cheap (~10x FCF ex-cash) but every quarter shows unbranded (Braintree) doing the growing at thin margins. We wrote it up to force the discussion - leaning pass unless branded TPV stabilizes. See the post-mortem from our 2025 round trip in Lessons.', fundamentals: fundamentalsNote, dislocationItems: [], dueDiligenceItems: [] },
    // ── research ──
    { ticker: 'FICO', stage: 'research', addedAt: ago(48), note: 'Scores segment is one of the best businesses in America - 90%+ share in mortgage decisioning, pure pricing-power model, near-zero capital needs. Down ~30% from the high on the FHFA noise re VantageScore. Working through how real the regulatory substitution risk is.', fundamentals: { revenueGrowth: 'Scores growing ~20% almost entirely on price; software steady high single digits', profitability: 'Operating margin marching to mid-40s; Scores incremental margin ~90%', capitalReturn: 'Cannibal - share count down ~20% over a decade', misc: '' }, dislocationItems: [q('Is the FHFA/VantageScore substitution a real volume threat or a headline?', false, 'Lender switching costs look enormous (validation, securitization language). But need channel checks.'), q('How much of Scores growth is one-time repricing vs durable?', false, '')], dueDiligenceItems: [q('Map mortgage vs auto vs card exposure inside Scores', true, 'Mortgage ~45% of Scores revenue after repricing - concentration higher than expected.'), q('Talk to a mid-size lender about score-switching costs', false, '', [sq('Get intro via David R. (worked at Rocket)', false, '')]), q('Model downside: mortgage volumes -20% + price freeze', false, '')] },
    { ticker: 'MELI', stage: 'research', addedAt: ago(40), note: 'LatAm commerce + fintech flywheel still compounding >30% in USD with logistics moat deepening (96%+ managed network). Credit book is the swing factor - great in benign cycles, scary in a real LatAm downturn. Sizing question more than quality question.', fundamentals: { revenueGrowth: 'USD revenue +34% TTM; Mercado Pago TPV growing faster', profitability: 'EBIT margin expanding as logistics scales; credit provisioning is the noise', capitalReturn: 'Reinvests everything - fine at these returns on capital', misc: 'FX translation masks unit economics - look at constant currency' }, dislocationItems: [q('Why is it 25% off the high while comps re-rated?', false, 'Brazil rate spike + credit-book fear. Feels temporary but need loss-curve data.')], dueDiligenceItems: [q('Pull NPL curves by cohort from the last 8 quarters', true, '15-90 day NPLs improving 3 quarters straight; coverage ratio > 100%.'), q('Stress the credit book at 2x current loss rates', false, ''), q('Understand take-rate bridge: ads vs credit vs logistics', false, '')] },
    // ── position ──
    { ticker: 'AAPL', stage: 'position', addedAt: ago(560), note: 'Services mix + the buyback machine keep per-share economics compounding through flat hardware cycles. The AI-refresh supercycle is the free option, not the thesis.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'MSFT', stage: 'position', addedAt: ago(515), note: 'The safest AI monetization story - Copilot attach is real and Azure takes share every quarter. Valuation full; earn it by holding.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'AVGO', stage: 'position', addedAt: ago(470), note: 'Custom AI silicon + networking franchise with software (VMware) turning the cyclical into a subscription. Hock\'s capital allocation is the thesis as much as the chips.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'TSM', stage: 'position', addedAt: ago(425), note: 'The one company the entire AI buildout cannot route around. Export-control headlines keep spooking the tape - underlying leading-edge share only goes up. Our job is to not get shaken out.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'V', stage: 'position', addedAt: ago(380), note: 'The network tax on global consumption. Watch stablecoin/real-time-rails headlines - so far every "Visa killer" has become a Visa customer.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'SPOT', stage: 'position', addedAt: ago(335), note: 'Won audio; now it is a pricing + gross-margin story. Pullback on content-spend guidance looks like a gift, needs the position review to confirm.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'DASH', stage: 'position', addedAt: ago(290), note: 'Network liquidity moat in local delivery, new verticals (grocery, retail) scaling, FCF inflected hard. Autonomy headline risk is real but DASH is the demand layer whoever owns the robot.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'COST', stage: 'position', addedAt: ago(245), note: 'Membership renewal >90%, fee hike cadence gives visible earnings. Expensive always - it is the ballast sleeve of the book.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'LLY', stage: 'position', addedAt: ago(200), note: 'GLP-1 franchise with the best pipeline depth in pharma. Supply, not demand, is the constraint. Small position - policy/pricing risk caps our sizing.', fundamentals: fundamentalsNote, dislocationItems: [] },
    { ticker: 'ISRG', stage: 'position', addedAt: ago(155), note: 'Razor/razorblade at its best: ~85% recurring revenue on a growing installed base, procedures compounding mid-teens. Bought the macro-driven hospital-capex scare like the playbook said.', fundamentals: fundamentalsNote, dislocationItems: [] },
  ].map((s, i) => ({ position: i, ...s }));

  T.watchlists = [
    { id: 'default', name: 'Blue Harbor Watchlist', stocks: mainStocks },
    {
      id: 'wl_demo_jordan', name: "Jordan's Watchlist", stocks: [
        { ticker: 'TOST', stage: 'watching', position: 0, addedAt: ago(30), note: 'Restaurant OS with real payments attach. Saw it everywhere on the Austin trip - every new opening was a Toast terminal. Need unit economics on the fintech side.', fundamentals: fundamentalsNote, dislocationItems: [] },
        { ticker: 'DUOL', stage: 'watching', position: 1, addedAt: ago(22), note: 'Pitched at the quarterly idea dinner. Gamified habit loop + AI content costs falling. Worry: is it a feature for a foundation-model app?', fundamentals: fundamentalsNote, dislocationItems: [] },
        { ticker: 'RKLB', stage: 'watching', position: 2, addedAt: ago(12), note: 'Neutron timeline slipping again but launch cadence + space systems backlog both up. Lottery-ticket sizing only.', fundamentals: fundamentalsNote, dislocationItems: [] },
      ],
    },
  ];

  /* ── Theses (Draft & Review + Research workspaces + position notes) ── */
  const mcoPaper = [
    block('<span style="font-weight: bold; font-size: xx-large;">Moody\'s (MCO) - Draft Review</span><div><br></div><div><span style="font-weight: bold;">One-line thesis:</span> the market is repricing all of Moody\'s for AI disruption that plausibly touches only Moody\'s Analytics (~35% of operating income), while MIS - the ratings crown jewel - is structurally insulated and rides a multi-year refinancing wall.</div><div><br></div><div><span style="font-weight: bold; font-size: x-large;">Segment economics</span></div><div><br></div><table class="rt-table"><tbody><tr><th>Segment</th><th>TTM revenue</th><th>Share of op income</th><th>Op margin</th><th>3Y income CAGR</th></tr><tr><td>MIS (Ratings)</td><td>$3.9B</td><td>~63%</td><td>~60%</td><td>~18%</td></tr><tr><td>MA (Analytics)</td><td>$3.5B</td><td>~37%</td><td>~30%</td><td>~11%</td></tr></tbody></table><div><br></div><div><span style="font-weight: bold; font-size: x-large;">Why MIS is AI-proof</span></div><div>The product is not analysis - it is a stamp of approval so entrenched that funds are mandated to hold only rated paper. An issuer pays a handful of basis points because the rating saves multiple points of spread over the life of the bond; it would be financially irrational not to buy it. AI making credit analysis easier does not remove the need for the stamp - if anything it commoditizes everyone except the stamp. Most issuance requires two ratings by convention hard-coded into index inclusion rules and fund mandates; Moody\'s and S&P are that duopoly.</div><div><br></div><div><span style="font-weight: bold; font-size: x-large;">Cyclicality, not fragility</span></div><div>MIS revenue swings with issuance volumes (2021 boom, 2022 air pocket - op income fell ~30% peak to trough). The maturity wall through 2028 forces refinancing regardless of rate levels - volume visibility most cyclicals would kill for.</div><div><br></div><div><span style="font-weight: bold; font-size: x-large;">The MA bear case</span></div><div>MA is research, data feeds, and risk software - the part an LLM stack could plausibly erode. But ~95% of MA revenue is recurring on multi-year contracts, and the data feeds increasingly SELL to the AI builders. Even a permanent -5%/yr decay in MA leaves the consolidated business growing.</div><div><br></div><div><span style="font-weight: bold; font-size: x-large;">Valuation</span></div><div>At ~27x forward earnings vs a 5-year average north of 33x, we are paying a below-average multiple for a business where 63% of the income compounds at ~60% margins behind a regulatory moat. Base case ~$560 in 3 years (10% revenue CAGR, modest re-rate to 30x); bear ~$360 if MA melts faster than MIS grows.</div>'),
  ];

  T.theses = [
    {
      id: demoId('thesis:MCO'), ticker: 'MCO',
      core_reasons: [
        { title: 'Ratings duopoly is a legal toll booth', description: 'Issuers must buy the stamp (a few bps) because it saves points of spread; funds are mandated to hold rated paper. AI cannot replace a CYA function.' },
        { title: 'Refinancing wall = volume visibility', description: 'The 2026-2028 maturity wall forces issuance regardless of rate levels - MIS revenue has a floor most cyclicals never get.' },
        { title: 'Market is mispricing segment mix', description: 'AI fear about Moody\'s Analytics (~35% of op income, 95% recurring) has the whole company at ~27x while the insulated 63% compounds at 60% margins.' },
      ],
      assumptions: [{ type: 'text', value: 'Debt issuance normalizes with the 2026-2028 maturity wall; MA decays no faster than ~5%/yr in the bear case; buybacks retire ~1.5%/yr; no structural change to the NRSRO regime.' }],
      valuation: 'Base: $560 (3yr) = 10% rev CAGR, 46% op margin, 30x exit. Bear: $360 = MA -5%/yr, 25x. At $420 entry that is roughly 2.5:1 up/down.',
      underwriting: {
        exitPE: '30', buybackRate: '1.5', revenueCAGR: '10', exitFCFYield: '3.6', operatingMargin: '46', terminalGrowthRate: '3',
        companyOverview: [block('<div>Two segments: MIS (ratings - the moat) and MA (analytics, data, risk software). The stock trades on blended fear; the value is almost all in MIS plus the recurring floor under MA. Fifteen straight years of dividend growth; steady cannibal.</div>')],
        draftReview: {
          paper: mcoPaper,
          author: { name: 'Alex', email: 'alex@blueharbor.demo' },
          reviewer: { name: 'Jordan', email: 'jordan@blueharbor.demo' },
          threads: [
            thread('mco:1', 'MA decay rate in the bear case', false, [
              ['reviewer', 'The bear case assumes MA decays 5%/yr but research/data subscriptions have never gone negative even in 2009. What breaks first - seats or price? If it is seats, the decay could be lumpier than a smooth -5%.'],
              ['author', 'Fair - the -5% is a placeholder for "loses the marginal seat to an LLM stack." I will split it: research seats -8%/yr, data feeds flat (they feed the LLMs), risk software GDP-ish, and reprice the bear at that mix.'],
              ['reviewer', 'Also check contract duration on the data feeds. If they run 3-year terms the decay lags the narrative by a full cycle.'],
            ], ago(6)),
            thread('mco:2', 'MIS cyclicality vs 2022', false, [
              ['reviewer', 'The 2022 issuance air pocket took MIS op income down ~30% peak to trough. Position sizing should assume that can happen again in year one. Does the 8% target weight survive that?'],
              ['author', 'Modeled it - at 8% weight a 2022 rerun costs the fund ~85bps vs benchmark for the year. Acceptable given the maturity wall makes a repeat less likely. Keeping 8% but starting at 5% and adding on issuance data.'],
            ], ago(4)),
            thread('mco:3', 'Segment table sources', true, [
              ['reviewer', 'Segment margins in the table mix adjusted and GAAP - footnote which is which or the IC will pick at it.'],
              ['author', 'Fixed - all figures now segment-adjusted op income; noted that corporate overhang inflates them ~1%.'],
            ], ago(9)),
          ],
        },
        researchWorkspace: {
          note: 'Carried up from Research: dislocation is sentiment about AI + a soft issuance quarter; quality checks all pass (margins, share count, ROIC). Remaining work item was the MA decay model - now in the draft.',
          fundamentals: { revenueGrowth: 'TTM ~$7.9B +10%; MIS +18% on the refi wave', profitability: 'MIS ~60% op margin; blended mid-40s', capitalReturn: 'Share count down from 187M toward 180M; 15 years of dividend growth', misc: 'MA is ~95% recurring - decay math dominates the bear case' },
          dueDiligenceItems: [q('Rebuild segment op income bridge ex-corporate', true, 'Done - see draft table.'), q('Interview a DCM banker on ratings shopping dynamics', true, 'Two of three said dual-rating is non-negotiable for IG issuance.')],
          dislocationItems: [q('Is the AI fear about MA already in sell-side numbers?', true, 'No - consensus still has MA growing 7%/yr. The dislocation is multiple, not estimates.')],
        },
      },
      news_updates: [], todos: [],
      notes: { tabs: [{ id: 'tab_mco_1', title: 'IC prep', content: [block('<div>IC date: next Friday. Open items: MA decay split (Jordan thread), position sizing ladder 5% -> 8%, pair analysis vs SPGI. Kill criteria: NRSRO reform bill advancing, or two consecutive quarters of MIS share loss to private credit ratings.</div>')] }], links: [] },
      created_at: ago(45), updated_at: ago(2),
    },
    {
      id: demoId('thesis:PYPL'), ticker: 'PYPL',
      core_reasons: [
        { title: 'Optically cheap', description: '~10x FCF ex-cash with a giant buyback - the screen says value.' },
        { title: 'But mix is deteriorating', description: 'Growth is unbranded Braintree at ~100bps take rate; branded checkout (the moat) is flat-to-down on share.' },
        { title: 'Write-up forces the pass/no-pass call', description: 'We round-tripped this name in 2025 (see Lessons). This memo exists to stop us repeating that trade on autopilot.' },
      ],
      assumptions: [{ type: 'text', value: 'Branded TPV share stabilizes only if checkout latency + Fastlane adoption actually move conversion; assume unbranded take rate never exceeds 120bps.' }],
      valuation: 'If branded stabilizes: $95 (14x FCF). If branded keeps bleeding 100bps share/yr: $55 and the multiple is a value trap. Coin flip - which is why it stays a draft, not a position.',
      underwriting: {
        exitPE: '14', buybackRate: '5', revenueCAGR: '7', exitFCFYield: '8', operatingMargin: '19', terminalGrowthRate: '2',
        companyOverview: [block('<div>Two businesses wearing one ticker: branded checkout (high take rate, moaty, mature) and Braintree processing (growing, commodity). The blended numbers hide the divergence - always model them separately.</div>')],
        draftReview: {
          paper: [block('<span style="font-weight: bold; font-size: xx-large;">PayPal (PYPL) - devil\'s advocate memo</span><div><br></div><div>This is a deliberately adversarial write-up: the cheap multiple keeps pulling us back (twice now), so the memo argues the bear case and the burden of proof is on the bulls.</div><div><br></div><div><span style="font-weight: bold; font-size: x-large;">The core problem</span></div><div>Every quarter shows the same shape: total TPV +10%, branded TPV +2-3%, unbranded +20%+. The moat asset is the branded button; it is losing share to Apple Pay and Shop Pay at the exact moment checkout is being redesigned around agentic commerce. Buying the blended multiple means averaging a melting business with a commodity one.</div><div><br></div><div><span style="font-weight: bold; font-size: x-large;">What would change our mind</span></div><div><ul><li>Two consecutive quarters of branded TPV growing >= e-commerce growth</li><li>Fastlane conversion data from a top-20 merchant, not company anecdotes</li><li>Venmo monetization inflecting (P2P -> checkout attach >5%)</li></ul></div>')],
          author: { name: 'Jordan', email: 'jordan@blueharbor.demo' },
          reviewer: { name: 'Alex', email: 'alex@blueharbor.demo' },
          threads: [
            thread('pypl:1', 'Buyback math vs share loss', false, [
              ['reviewer', 'Steelman the bull: at 5%/yr buyback and flat branded, FCF/share still compounds ~9%. Is "melting" fair if per-share value grows high single digits?'],
              ['author', 'It compounds until the branded margin pool shrinks - then the buyback is recycling a declining coupon. Added a sensitivity: branded -3%/yr makes the 2029 FCF/share flat despite the buyback.'],
            ], ago(3)),
          ],
        },
        researchWorkspace: { note: 'Prior round-trip notes archived in the lesson entry. Key learning applied here: cheapness was the entire original thesis - this time the memo leads with the share-loss data.', fundamentals: fundamentalsNote, dueDiligenceItems: [q('Get branded vs unbranded TPV split for last 10 quarters', true, 'Built - branded share of TPV down from 34% to 27% in 10 quarters.')], dislocationItems: [] },
      },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(30), updated_at: ago(3),
    },
    {
      id: demoId('thesis:FICO'), ticker: 'FICO',
      core_reasons: [
        { title: 'Pricing power annuity', description: 'The score costs cents inside a multi-thousand-dollar mortgage decision - price is invisible to the end transaction.' },
        { title: 'Cannibal capital return', description: 'Share count down ~20% in a decade; every point of repricing drops straight to buybacks.' },
        { title: 'Regulatory scare = entry point', description: 'FHFA/VantageScore headlines knocked ~30% off the high; switching costs across securitization language look underappreciated.' },
      ],
      assumptions: [{ type: 'text', value: 'Mortgage score pricing holds (no freeze); VantageScore adoption limited to non-conforming; software segment stays GDP-plus and is effectively a free option.' }],
      valuation: 'Scores at 30x (deserves more), software at 6x sales -> SOTP ~30% above today. Bear (price freeze + volume down 20%) ~25% below.',
      underwriting: {
        exitPE: '32', buybackRate: '2.5', revenueCAGR: '13', exitFCFYield: '3.2', operatingMargin: '46', terminalGrowthRate: '3.5',
        companyOverview: [block('<div>Two segments: Scores (the monopoly) and Software (decisioning platform, fine business, not why we are here). All the debate is Scores mortgage repricing durability.</div>')],
        researchWorkspace: {
          note: 'Live research. The FHFA noise is the whole opportunity: if bi-merge + VantageScore optionality never dents conforming volume, the current price pays us to wait. Channel checks scheduled.',
          fundamentals: { revenueGrowth: 'Scores +20% (price-led), software +8%', profitability: 'Op margin path to mid-40s; Scores incremental ~90%', capitalReturn: 'Serial cannibal', misc: '' },
          dueDiligenceItems: [q('Map Scores revenue by channel (mortgage/auto/card)', true, 'Mortgage ~45% post-repricing. Higher concentration = higher regulatory beta.'), q('Lender interviews on switching costs', false, '', [sq('Rocket alum intro via David R.', false, ''), sq('Credit union CTO (Jordan contact)', false, '')]), q('History: what happened to pricing after prior FHFA reviews?', false, '')],
          dislocationItems: [q('Temporary or structural?', false, 'Leaning temporary: no volume has moved, only headlines. Structural risk is a mandated dual-score world - handicap 15%.')],
        },
      },
      news_updates: [], todos: [],
      notes: { tabs: [{ id: 'tab_fico_1', title: 'Reg timeline', content: [block('<div>FHFA director comments (Mar) -> lender letter (Apr) -> no rulemaking docket yet. Real rulemaking would take 18-24 months minimum. The tape trades it like it is done.</div>')] }], links: [] },
      created_at: ago(48), updated_at: ago(1),
    },
    {
      id: demoId('thesis:MELI'), ticker: 'MELI',
      core_reasons: [
        { title: 'Two flywheels, one company', description: 'Commerce network + Mercado Pago fintech rails, each strengthening the other across LatAm.' },
        { title: 'Logistics moat compounding', description: '96%+ of shipments on managed network; same-day coverage no competitor can replicate at scale.' },
        { title: 'Credit fear = sizing opportunity', description: 'Brazil rate spike has the stock 25% off the high while cohort NPLs improve - quality is not the question, size is.' },
      ],
      assumptions: [{ type: 'text', value: 'USD revenue CAGR 25%+ through 2028; credit book grows <= TPV growth with loss rates capped near current levels; no capital raise.' }],
      valuation: 'At 4.5x forward sales for 30%+ USD growth with expanding margins, paying below the 5-year trough multiple. Target sizing 3-4% given EM/credit tail.',
      underwriting: {
        exitPE: '38', buybackRate: '0', revenueCAGR: '26', exitFCFYield: '2.8', operatingMargin: '15', terminalGrowthRate: '4',
        companyOverview: [block('<div>Marketplace + payments + logistics + credit + ads, mostly Brazil/Mexico/Argentina. Watch the credit book like a hawk - it is the only part that can break fast.</div>')],
        researchWorkspace: {
          note: 'Research focus: stress the credit book, then this becomes a buy ticket. Everything else already cleared quality checks.',
          fundamentals: { revenueGrowth: '+34% USD TTM', profitability: 'EBIT margin +200bps y/y with logistics leverage', capitalReturn: 'Full reinvestment', misc: 'Constant-currency view essential' },
          dueDiligenceItems: [q('Cohort NPL curves, last 8 quarters', true, 'Improving 3 straight quarters; coverage >100%.'), q('Stress: 2x loss rates + funding cost +300bps', false, ''), q('Ads take-rate trajectory vs Amazon LatAm', false, '')],
          dislocationItems: [q('What breaks the flywheel?', false, 'A forced credit contraction. Handicapping via position size, not avoidance.')],
        },
      },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(40), updated_at: ago(2),
    },
    {
      id: demoId('thesis:AAPL'), ticker: 'AAPL',
      core_reasons: [
        { title: 'Services annuity on the installed base', description: '2.4B active devices monetized at software margins; services now ~45% of gross profit and still compounding double digits.' },
        { title: 'The buyback machine', description: 'Share count down ~3%/yr for a decade - per-share value compounds through flat hardware cycles.' },
        { title: 'AI refresh is the free option', description: 'On-device AI shortens replacement cycles at the margin; we underwrite zero supercycle and get any upside for free.' },
      ],
      assumptions: [{ type: 'text', value: 'Hardware revenue GDP-ish, services 11-12% CAGR, gross margin drifts up on mix, buyback ~3%/yr continues, no material China disruption.' }],
      valuation: 'Earnings power ~$9.20/share in 2028 at 28x = ~$258 base case. Owned from $205 - let the per-share math work.',
      underwriting: {
        exitPE: '28', buybackRate: '3', revenueCAGR: '7', exitFCFYield: '3.5', operatingMargin: '32', terminalGrowthRate: '3',
        companyOverview: [block('<div>Hardware is the customer-acquisition engine; services is the P&L. Model them separately and the "low growth" narrative falls apart on a per-share basis.</div>')],
        researchWorkspace: { note: 'Position maintenance mode - full workspace archived in the Q1 position review doc.', fundamentals: fundamentalsNote, dueDiligenceItems: [], dislocationItems: [] },
      },
      news_updates: [], todos: [],
      notes: { tabs: [{ id: 'tab_aapl_1', title: 'Review triggers', content: [block('<div>Re-underwrite if: services growth < 9% for two quarters, China revenue down >15% y/y, or the buyback pace halves.</div>')] }], links: [] },
      created_at: ago(540), updated_at: ago(7),
    },
    {
      id: demoId('thesis:MSFT'), ticker: 'MSFT',
      core_reasons: [
        { title: 'Distribution is the AI moat', description: 'Copilot rides an installed base no startup can reach; Azure takes share each quarter.' },
        { title: 'Pricing ladder intact', description: 'E5 + Copilot attach keeps per-seat revenue climbing through any macro.' },
        { title: 'Fortress financials', description: 'Mid-40s operating margins funding the largest capex program in tech without stressing the model.' },
      ],
      assumptions: [{ type: 'text', value: 'Azure 25%+ through 2027; Copilot attach reaching 15% of eligible seats; margins dip <=150bps on AI capex then recover.' }],
      valuation: 'Never optically cheap. 30x on $22 of 2028 EPS = $660. Position earns its keep via durability, not upside torque.',
      underwriting: { exitPE: '30', buybackRate: '0.7', revenueCAGR: '14', exitFCFYield: '3.1', operatingMargin: '45', terminalGrowthRate: '4', companyOverview: [block('<div>Productivity + Cloud + More Personal Computing; all roads run through Azure consumption and M365 seat pricing.</div>')], researchWorkspace: { note: '', fundamentals: fundamentalsNote, dueDiligenceItems: [], dislocationItems: [] } },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(500), updated_at: ago(12),
    },
    {
      id: demoId('thesis:V'), ticker: 'V',
      core_reasons: [
        { title: 'Tax on nominal consumption', description: 'Revenue grows with inflation + volume + mix; the rare business where inflation helps.' },
        { title: 'New flows optionality', description: 'B2B, remittances, RTP overlays - each headline "Visa killer" keeps becoming a customer.' },
        { title: 'Ferocious per-share math', description: '~60% FCF margins recycled into a shrinking share count for a decade straight.' },
      ],
      assumptions: [{ type: 'text', value: 'Payments volume grows nominal-GDP-plus; take rate flat (regulatory pressure offset by value-added services); buyback ~3%/yr.' }],
      valuation: '27x on $14.50 of 2028 EPS = ~$390. The point of the position is the floor, not the ceiling.',
      underwriting: { exitPE: '27', buybackRate: '3', revenueCAGR: '10', exitFCFYield: '3.6', operatingMargin: '67', terminalGrowthRate: '3.5', companyOverview: [block('<div>Four-party network. Watch interchange regulation (CCCA) and stablecoin rails - both perennial headlines, neither has dented the model yet.</div>')], researchWorkspace: { note: '', fundamentals: fundamentalsNote, dueDiligenceItems: [], dislocationItems: [] } },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(460), updated_at: ago(20),
    },
    {
      id: demoId('thesis:TSM'), ticker: 'TSM',
      core_reasons: [
        { title: 'Monopoly on the leading edge', description: '90%+ share below 5nm; every AI chip that matters is fabbed here. No substitute exists this decade.' },
        { title: 'Pricing power finally being used', description: 'N3/N2 wafer prices up double digits and customers pre-pay - the days of leaving margin on the table are over.' },
        { title: 'Geopolitics is the discount, not the thesis-breaker', description: 'Export-control and Taiwan headlines keep the multiple in the teens for the most important company in the supply chain.' },
      ],
      assumptions: [{ type: 'text', value: 'Leading-edge share holds >85%; gross margin 55%+ through the capex cycle; Arizona/Kumamoto fabs dilute margin <200bps; no kinetic Taiwan event (unhedgeable - sized accordingly).' }],
      valuation: 'EPS power ~$13 by 2028 at 22x = ~$285. Underwater vs our 295 cost after the export-scare air pocket - thesis intact, patience required (see the lesson entry on the add).',
      underwriting: { exitPE: '22', buybackRate: '0.5', revenueCAGR: '17', exitFCFYield: '3.4', operatingMargin: '46', terminalGrowthRate: '4', companyOverview: [block('<div>The one company the AI buildout cannot route around. Judge it on leading-edge share and wafer pricing, never on a single quarter of utilization headlines.</div>')], researchWorkspace: { note: '', fundamentals: fundamentalsNote, dueDiligenceItems: [], dislocationItems: [] } },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(400), updated_at: ago(5),
    },
    {
      id: demoId('thesis:SPOT'), ticker: 'SPOT',
      core_reasons: [
        { title: 'Audio war is over', description: 'Podcasts consolidation done, competitors retreated to licensing; scale economics now run one direction.' },
        { title: 'Gross margin structural story', description: 'Marketplace take + podcasts + audiobooks lift gross margin past 31% with room left.' },
        { title: 'Pricing power proven', description: 'Two price hikes through churn scares; premium ARPU climbing with tier ladders.' },
      ],
      assumptions: [{ type: 'text', value: 'Revenue ~14% CAGR, gross margin through 32%, opex growth capped below revenue growth, MAU growth mid-single-digit in developed + strong EM mix.' }],
      valuation: 'The pullback on content-spend guidance is our add zone; position review open to confirm. EUR 22 EPS power 2028 at 32x = ~$780.',
      underwriting: { exitPE: '32', buybackRate: '0', revenueCAGR: '14', exitFCFYield: '3', operatingMargin: '13', terminalGrowthRate: '4', companyOverview: [block('<div>The debate has moved from user growth to gross margin and content ROI discipline - update the KPI dashboard accordingly.</div>')], researchWorkspace: { note: '', fundamentals: fundamentalsNote, dueDiligenceItems: [], dislocationItems: [] } },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(280), updated_at: ago(4),
    },
    {
      id: demoId('thesis:AVGO'), ticker: 'AVGO',
      core_reasons: [
        { title: 'Custom AI silicon franchise', description: 'The XPU designer of choice for every hyperscaler that wants off the merchant-GPU tax; multi-year design wins locked.' },
        { title: 'VMware turns cyclical into subscription', description: 'Software now ~40% of revenue at 70%+ operating margins - the semi cycle rides on a recurring floor.' },
        { title: 'Capital allocation is the second moat', description: 'Hock\'s M&A record: buy franchises, cut costs, raise the dividend. The playbook keeps working.' },
      ],
      assumptions: [{ type: 'text', value: 'AI networking + XPU revenue CAGR 30%+ through 2028; VMware retention holds through the pricing migration; dividend grows with FCF; leverage glides back under 2x.' }],
      valuation: '$7.50 EPS power 2028 at 28x = ~$210 pre-split-equivalent upside. The merger-era share count peak is behind us; per-share math improving from here.',
      underwriting: { exitPE: '28', buybackRate: '1', revenueCAGR: '19', exitFCFYield: '3.8', operatingMargin: '39', terminalGrowthRate: '4', companyOverview: [block('<div>Semis (networking, custom accelerators, wireless) + infrastructure software (VMware, mainframe). The VMware share issuance spiked the count in the merger - watch the buyback work it back down.</div>')], researchWorkspace: { note: '', fundamentals: fundamentalsNote, dueDiligenceItems: [], dislocationItems: [] } },
      news_updates: [], todos: [],
      notes: { tabs: [], links: [] },
      created_at: ago(410), updated_at: ago(9),
    },
  ];

  /* ── Valuation models ────────────────────────────────────────── */
  const vm = (ticker, inputs, agoDays) => ({ id: demoId(`vm:${ticker}`), ticker, inputs: { ticker, baseYear: now.getUTCFullYear(), sharePrice: lastCloseOf[ticker] ?? inputs.sharePrice, ...inputs }, updated_at: ago(agoDays) });
  T.valuation_models = [
    vm('AAPL', { taxRate: 0.16, baseCOGS: 214.0, baseOpex: 62.1, targetPE: 28, baseShares: 14.9, cogsGrowth: 0.055, opexGrowth: 0.06, baseRevenue: 408.5, revenueGrowth: 0.07, baseTaxExpense: 21.3, dividendGrowth: 0.05, baseNonOpIncome: 0.4, currentDividend: 1.04, netShareDilution: -0.03 }, 6),
    vm('MSFT', { taxRate: 0.19, baseCOGS: 92.4, baseOpex: 88.1, targetPE: 30, baseShares: 7.42, cogsGrowth: 0.12, opexGrowth: 0.10, baseRevenue: 322.5, revenueGrowth: 0.14, baseTaxExpense: 26.8, dividendGrowth: 0.10, baseNonOpIncome: 3.1, currentDividend: 3.32, netShareDilution: -0.007 }, 14),
    vm('V', { taxRate: 0.18, baseCOGS: 0, baseOpex: 14.6, targetPE: 27, baseShares: 1.93, cogsGrowth: 0, opexGrowth: 0.09, baseRevenue: 42.8, revenueGrowth: 0.10, baseTaxExpense: 4.9, dividendGrowth: 0.14, baseNonOpIncome: -0.4, currentDividend: 2.36, netShareDilution: -0.028 }, 21),
    vm('MCO', { taxRate: 0.21, baseCOGS: 0, baseOpex: 4.3, targetPE: 30, baseShares: 0.18, cogsGrowth: 0, opexGrowth: 0.08, baseRevenue: 7.9, revenueGrowth: 0.10, baseTaxExpense: 0.72, dividendGrowth: 0.10, baseNonOpIncome: -0.15, currentDividend: 3.40, netShareDilution: -0.015 }, 3),
    vm('AVGO', { taxRate: 0.14, baseCOGS: 20.8, baseOpex: 15.2, targetPE: 28, baseShares: 4.7, cogsGrowth: 0.14, opexGrowth: 0.10, baseRevenue: 57.6, revenueGrowth: 0.19, baseTaxExpense: 2.6, dividendGrowth: 0.12, baseNonOpIncome: -2.8, currentDividend: 2.36, netShareDilution: -0.01 }, 30),
    vm('TSM', { taxRate: 0.16, baseCOGS: 40.7, baseOpex: 8.9, targetPE: 22, baseShares: 5.19, cogsGrowth: 0.14, opexGrowth: 0.12, baseRevenue: 92.4, revenueGrowth: 0.17, baseTaxExpense: 6.9, dividendGrowth: 0.12, baseNonOpIncome: 1.8, currentDividend: 2.20, netShareDilution: 0 }, 18),
  ];

  /* ── Strategic hub ───────────────────────────────────────────── */
  const sn = (label, ticker, fields, agoDays) => ({ id: demoId(`sn:${label}`), ticker, sentiment: 'feeling_good', conviction: 4, action: 'hold', action_reason: '', notes: '', alternatives: '', target_weight: null, expected_return: null, priority: 'normal', sort_order: 0, created_at: ago(agoDays + 30), updated_at: ago(agoDays), ...fields });
  T.strategic_notes = [
    sn('port', '_PORTFOLIO', {
      sentiment: 'neutral', conviction: 3, priority: 'high', sort_order: 0,
      notes: `Portfolio review ${dstr(addDays(now, -6))}:\n\nInflows landed (~$20k across the three of us) so this is the quarter to fix the shape of the book, not add names.\n\n1) Semis + AI-adjacent is ~55% of NAV. Nothing wrong with any single position but the basket moves as one trade on export-control headlines. Target: bring it under 48% by funding MCO (if it clears IC) from MSFT and AVGO trims rather than cash.\n\n2) SPOT pullback is our add candidate but ONLY after the open position review closes - no averaging into an unreviewed name (that is exactly the process mistake in the TSM lesson).\n\n3) Cash at ~6.5% is above the 2% target. Deploy half into the MCO starter if approved, keep the rest for the FICO decision.\n\n4) LLY stays capped at 5% on policy risk regardless of how good the pipeline looks. Sizing is the risk control, not the thesis.`,
    }, 6),
    sn('aapl', 'AAPL', { conviction: 5, sort_order: -3, notes: 'Best per-share math in the book. Services mix shift keeps grinding margins up while the buyback compounds it.' }, 8),
    sn('avgo', 'AVGO', { conviction: 4, sort_order: -2, notes: 'Thesis played out faster than modeled - the position ran to 11%+. Trimmed back to target once already; next add goes elsewhere.', action: 'trim', action_reason: 'Weight discipline, not thesis change', target_weight: 10 }, 10),
    sn('msft', 'MSFT', { conviction: 4, sort_order: -1, notes: 'Core ballast. Funding source for MCO if approved - lowest expected return of the mega-cap sleeve from this multiple.', action: 'trim', target_weight: 11 }, 12),
    sn('tsm', 'TSM', { sentiment: 'uneasy', conviction: 3, sort_order: 1, notes: 'Underwater from the export-control air pocket. Thesis intact (leading-edge share, wafer pricing) but this is the position that tests our patience discipline - documented in Lessons. No adds until the N2 ramp data confirms.', priority: 'high' }, 4),
    sn('v', 'V', { conviction: 5, sort_order: 0, notes: 'Watch the CCCA reintroduction and stablecoin settlement pilots. Every prior rail scare was an add opportunity.', priority: 'low' }, 18),
    sn('spot', 'SPOT', { conviction: 4, sort_order: 1, notes: 'Add zone if position review confirms content-spend guidance is discipline rather than desperation. Target +100bps.', action: 'add', target_weight: 10, expected_return: 15 }, 5),
    sn('dash', 'DASH', { conviction: 4, sort_order: 2, notes: 'Autonomy headlines will keep whipping it around. The demand-aggregation layer wins in every AV scenario except full vertical integration by the winner - handicap that under 20%.' }, 20),
    sn('cost', 'COST', { conviction: 4, sort_order: 3, notes: 'Ballast. Membership fee increase cycle gives visible EPS through 2027. Never sell the ballast because it looks expensive - that is what ballast looks like.', priority: 'low' }, 25),
    sn('lly', 'LLY', { sentiment: 'neutral', conviction: 3, sort_order: 4, notes: 'Capped at 5% on pricing-policy risk. Oral GLP-1 data is the next catalyst; supply chain scale-up is the moat nobody prices.', priority: 'low' }, 22),
    sn('isrg', 'ISRG', { conviction: 4, sort_order: 5, notes: 'The hospital-capex scare entry worked exactly as the playbook said. Procedures compounding; hold and stop looking at the multiple.', priority: 'low' }, 15),
  ];

  T.candidate_positions = [
    { id: demoId('cand:MCO'), ticker: 'MCO', status: 'researching', sentiment: 'feeling_good', conviction: 4, priority: 'urgent', target_weight: 8, notes: 'Draft memo in review - IC Friday. Starter 5% from MSFT/AVGO trims if approved; scale to 8% on issuance data.', sort_order: 0, created_at: ago(45), updated_at: ago(1) },
    { id: demoId('cand:FICO'), ticker: 'FICO', status: 'researching', sentiment: 'neutral', conviction: 3, priority: 'high', target_weight: 4, notes: 'Regulatory substitution risk is the whole debate. Lender channel checks scheduled - decision after those land.', sort_order: 1, created_at: ago(40), updated_at: ago(2) },
    { id: demoId('cand:MELI'), ticker: 'MELI', status: 'watching', sentiment: 'feeling_good', conviction: 3, priority: 'normal', target_weight: 3, notes: 'Quality confirmed; waiting on the credit-book stress test before sizing. EM sleeve would be new for us - start small.', sort_order: 2, created_at: ago(35), updated_at: ago(5) },
    { id: demoId('cand:PYPL'), ticker: 'PYPL', status: 'passed', sentiment: 'uneasy', conviction: 2, priority: 'low', target_weight: null, notes: 'Devil\'s advocate memo leaning pass: branded share loss vs Apple Pay is structural until proven otherwise. Revisit only on two straight quarters of branded TPV >= e-comm growth.', sort_order: 3, created_at: ago(30), updated_at: ago(3) },
  ];

  /* ── Relationships (beefed up: full profiles + interactions + files) ── */
  const contact = (label, fields, createdDaysAgo) => ({
    id: demoId(`contact:${label}`),
    company: '', role: '', relationship_type: 'other', contact_method: 'email', contact_value: '',
    status: 'active', relationship_strength: 'developing', importance: 3, outreach_type: 'other',
    summary: '', next_action: '', follow_up_date: null, last_contacted_at: null,
    tags: [], city: '', phone: '', notes: '', last_meeting_note: '',
    created_at: ago(createdDaysAgo), updated_at: ago(2),
    ...fields,
  });
  T.contacts = [
    contact('davidr', { name: 'David Reyes', company: 'Crestline Mortgage (ex-Rocket)', role: 'VP Capital Markets', relationship_strength: 'strong', importance: 5, outreach_type: 'in_person', contact_value: 'david.reyes@crestline.demo', city: 'Detroit', summary: 'Our best channel check for anything mortgage - ex-Rocket capital markets, now at a mid-size lender. Key to the FICO switching-cost question.', next_action: 'Set the lender-switching-costs call for the FICO work', follow_up_date: inDays(2), last_contacted_at: ago(9), tags: ['channel-check', 'credit', 'FICO'], last_meeting_note: 'Walked us through how score requirements are hard-coded into securitization docs - switching is a 2-3 year project minimum.', notes: 'Prefers calls over email. Happy to intro the Rocket alum network.' }, 400),
    contact('priyak', { name: 'Priya Krishnan', company: 'Meridian Growth Partners', role: 'Partner', relationship_strength: 'strong', importance: 5, outreach_type: 'send_article', contact_value: 'priya@meridiangp.demo', city: 'San Francisco', summary: 'Software specialist PM, 15 years. Our sounding board for anything SaaS - she took the other side on NOW and was right for a year.', next_action: 'Send the MCO draft once IC-approved; she covered the rating agencies at her old shop', follow_up_date: inDays(6), last_contacted_at: ago(15), tags: ['PM', 'software', 'idea-exchange'], last_meeting_note: 'Q1 dinner: her framework for seat-based software in an agent world - "price per outcome eats price per seat, slowly then fast."', notes: '' }, 380),
    contact('tomg', { name: 'Thomas Grady', company: 'Moody\'s (retired)', role: 'Former MD, Ratings', relationship_strength: 'warm', importance: 4, outreach_type: 'in_person', contact_value: 'tgrady@post.demo', city: 'New York', summary: 'Retired ratings MD - invaluable on the MCO work. Explained the CYA dynamics and issuer-pays economics from the inside.', next_action: 'Thank-you note + send final memo when done', follow_up_date: inDays(10), last_contacted_at: ago(21), tags: ['industry', 'MCO', 'ratings'], last_meeting_note: 'Coffee in NYC: "Nobody ever got fired for requiring two ratings. That sentence is the moat."', notes: 'Introduced by Priya.' }, 120),
    contact('sofiam', { name: 'Sofia Martinez', company: 'Andes Capital', role: 'Analyst, LatAm consumer', relationship_strength: 'developing', importance: 4, outreach_type: 'send_article', contact_value: 'sofia@andescap.demo', city: 'Mexico City', summary: 'LatAm specialist - our reality check on MELI credit book and Brazil macro. Met at the EM investing conference.', next_action: 'Share our NPL cohort analysis for her read', follow_up_date: inDays(4), last_contacted_at: ago(11), tags: ['EM', 'MELI', 'channel-check'], last_meeting_note: '', notes: 'Writes a monthly LatAm fintech letter - subscribed.' }, 90),
    contact('markb', { name: 'Mark Bellows', company: 'Bellows Family Office', role: 'CIO', relationship_strength: 'strong', importance: 5, outreach_type: 'in_person', contact_value: 'mark@bellowsfo.demo', city: 'Austin', summary: 'Prospective LP - $2M potential. Wants to see 12 months of the letter cadence and the risk process before committing.', next_action: 'Send Q2 letter + macro overlay one-pager', follow_up_date: inDays(1), last_contacted_at: ago(5), tags: ['LP', 'prospect'], last_meeting_note: 'Austin lunch: cares more about drawdown behavior than upside. Showed real interest in the regime model.', notes: 'Check in monthly, no more.' }, 200),
    contact('lindaw', { name: 'Linda Wu', company: 'Hartwell Accounting', role: 'Fund Accountant', relationship_strength: 'strong', importance: 4, outreach_type: 'other', contact_value: 'linda@hartwell.demo', city: 'Chicago', summary: 'Handles our books and K-1s. Quarter-end NAV package due dates are the recurring touchpoint.', next_action: 'Q2 close package - send broker statements', follow_up_date: inDays(3), last_contacted_at: ago(8), tags: ['ops', 'accounting'], last_meeting_note: '', notes: '' }, 350),
    contact('rajp', { name: 'Raj Patel', company: 'Novum Semi Research', role: 'Founder / Analyst', relationship_strength: 'warm', importance: 4, outreach_type: 'send_article', contact_value: 'raj@novumsemi.demo', city: 'Portland', summary: 'Independent semis researcher - the TSM capacity/pricing read we trust most. Called the export-control air pocket two quarters early.', next_action: 'Ask for his N2 ramp timeline update', follow_up_date: inDays(8), last_contacted_at: ago(18), tags: ['semis', 'TSM', 'research'], last_meeting_note: '', notes: 'Paid research relationship, renews January.' }, 300),
    contact('emilyc', { name: 'Emily Chen', company: 'Stanford GSB', role: 'MBA candidate (ex-Spotify strategy)', relationship_strength: 'developing', importance: 3, outreach_type: 'other', contact_value: 'echen@gsb.demo', city: 'Palo Alto', summary: 'Ex-Spotify content strategy - gave us the inside view on the content-ROI culture shift for the position review.', next_action: 'Intro her to Priya (job search)', follow_up_date: inDays(12), last_contacted_at: ago(25), tags: ['SPOT', 'network'], last_meeting_note: 'Call: "The content budget debate internally is about ROI per show now, not volume. That culture stuck."', notes: '' }, 75),
    contact('gregt', { name: 'Greg Thornton', company: 'Apex Prime Services', role: 'Relationship Manager', relationship_strength: 'warm', importance: 2, outreach_type: 'other', contact_value: 'gthornton@apexprime.demo', city: 'New York', summary: 'Prime broker RM. Annual pricing review coming up - we are small but rates are negotiable.', next_action: 'Push on margin rates at the annual review', follow_up_date: inDays(20), last_contacted_at: ago(40), tags: ['ops', 'broker'], last_meeting_note: '', notes: '' }, 340),
    contact('annav', { name: 'Anna Volkov', company: 'The Capital Letter (Substack)', role: 'Writer', relationship_strength: 'developing', importance: 3, outreach_type: 'send_article', contact_value: 'anna@capletter.demo', city: 'London', summary: 'Writes the payments deep-dives we keep citing. Traded notes on PYPL branded-share data - she has merchant-side sources.', next_action: 'Send her our branded vs unbranded TPV build', follow_up_date: inDays(7), last_contacted_at: ago(13), tags: ['payments', 'PYPL', 'writer'], last_meeting_note: '', notes: '' }, 60),
    contact('carlosd', { name: 'Carlos Duarte', company: 'Horizon Endowment', role: 'Director of Public Equities', relationship_strength: 'developing', importance: 4, outreach_type: 'in_person', contact_value: 'cduarte@horizon.demo', city: 'Houston', summary: 'Long-shot institutional LP prospect - endowment allocates to emerging managers at 3yr track. We are at month 21.', next_action: 'Quarterly touch: send performance snapshot + one research sample', follow_up_date: inDays(15), last_contacted_at: ago(50), tags: ['LP', 'prospect', 'institutional'], last_meeting_note: 'Conference chat: wants to see process consistency, specifically how we handle losers.', notes: 'The TSM lesson write-up is exactly what he asked about - share it.' }, 180),
    contact('nateh', { name: 'Nate Hoffman', company: 'Gridline Energy Research', role: 'Analyst', relationship_strength: 'developing', importance: 2, outreach_type: 'other', contact_value: 'nate@gridline.demo', city: 'Denver', summary: 'Power/datacenter buildout specialist - context for the AI capex sustainability question across MSFT/AVGO/TSM.', next_action: '', follow_up_date: inDays(25), last_contacted_at: ago(30), tags: ['energy', 'AI-capex'], last_meeting_note: '', notes: '' }, 45),
  ];

  const inter = (label, contactLabel, type, daysAgo, summary, next_step = '') => ({
    id: demoId(`inter:${label}`), contact_id: demoId(`contact:${contactLabel}`),
    type, summary, next_step, date: ago(daysAgo), created_at: ago(daysAgo),
  });
  T.interactions = [
    inter('i1', 'davidr', 'call', 9, 'Walked through FICO score hard-coding in securitization docs. His take: a mandated switch would take 24+ months of parallel runs before any lender moves volume.', 'He will intro two more lenders for the switching-cost calls'),
    inter('i2', 'davidr', 'meeting', 62, 'Detroit dinner. Mortgage volume outlook: refi wave is real if rates break 5.5%. Good context for the FICO volume-sensitivity model.', ''),
    inter('i3', 'priyak', 'email', 15, 'Sent her our NOW note; she pushed back hard on seat-count risk - "the orchestration layer captures budget, the seat layer loses it." Adjusting the watch criteria accordingly.', 'Send MCO memo after IC'),
    inter('i4', 'priyak', 'meeting', 95, 'Quarterly idea dinner. Her short list overlaps ours on data/analytics moats; she is long SPGI, skeptical of FICO regulatory risk being priced right.', ''),
    inter('i5', 'tomg', 'meeting', 21, 'NYC coffee. Issuer-pays economics 101 from the inside: ratings shopping is constrained by index inclusion rules, not ethics. The two-rating norm is contractual everywhere.', 'Send final MCO memo when done'),
    inter('i6', 'sofiam', 'call', 11, 'MELI credit book read: she trusts the cohort disclosures, flags Argentina normalization as upside optionality nobody models. Watch funding costs, not NPLs.', 'Share our NPL cohort build'),
    inter('i7', 'markb', 'meeting', 5, 'Austin lunch. Walked him through the macro regime overlay and the drawdown discipline. He asked for the Q2 letter and a one-pager on the risk process.', 'Send Q2 letter + risk one-pager this week'),
    inter('i8', 'markb', 'email', 33, 'Sent Q1 letter. Reply: "like the lessons-learned section - most managers hide the misses." Keep that section prominent.', ''),
    inter('i9', 'lindaw', 'email', 8, 'Q2 close kickoff - she needs broker statements by the 5th and the contribution log for the quarter.', 'Send statements + contribution log'),
    inter('i10', 'rajp', 'call', 18, 'TSM check-in: leading-edge utilization back above 95% in his channel data; N2 ramp on schedule, wafer pricing holding. Says the order recovery is a H2 story, not H1.', 'Get his written N2 timeline'),
    inter('i11', 'emilyc', 'call', 25, 'Spotify content ROI culture discussion - per-show ROI review process survived the leadership change. Supports the "discipline not desperation" read on the spend guidance.', 'Intro to Priya'),
    inter('i12', 'annav', 'email', 13, 'Traded PYPL data. Her merchant sources: Fastlane trials show conversion lift but merchants demand rate concessions to feature the button - margin cost to hold share.', 'Send our TPV build'),
    inter('i13', 'carlosd', 'meeting', 50, 'Conference meeting. Endowment wants emerging managers with documented process - specifically asked how we post-mortem losers. Told him about the lessons library; he wants to see it.', 'Quarterly performance snapshot'),
    inter('i14', 'gregt', 'call', 40, 'Annual review scheduling. Flagged that our cash balance justifies better money-market sweep terms.', 'Collect competing PB quotes before the review'),
    inter('i15', 'nateh', 'note', 30, 'His grid-constraint report: datacenter power is the real capex governor - permits, not GPUs. Useful for the MSFT/AVGO capex-cycle assumption.', ''),
    inter('i16', 'priyak', 'note', 44, 'Her framework note on agentic software pricing filed to the NOW watch entry. Core idea: per-outcome pricing compresses seat TAM but expands usage TAM.', ''),
    inter('i17', 'davidr', 'email', 28, 'Sent him the FHFA timeline question - his read: "director statements are not rulemaking; watch for a docket number, ignore everything else."', ''),
    inter('i18', 'markb', 'call', 70, 'Intro call. Family office, $40M total, wants 5% with an emerging manager. Cares about process repeatability and drawdown behavior.', 'Lunch in Austin next month'),
  ];

  T.contact_files = [
    { id: demoId('cf:1'), contact_id: demoId('contact:markb'), name: 'Blue Harbor - LP intro deck (Q2)', url: 'https://blueharbor.demo/decks/lp-intro-q2.pdf', type: 'link', created_at: ago(5) },
    { id: demoId('cf:2'), contact_id: demoId('contact:davidr'), name: 'FICO switching-cost interview notes', url: 'https://blueharbor.demo/notes/fico-lender-calls.pdf', type: 'link', created_at: ago(9) },
    { id: demoId('cf:3'), contact_id: demoId('contact:rajp'), name: 'Novum Semi - foundry pricing tracker (paid)', url: 'https://novumsemi.demo/tracker', type: 'link', created_at: ago(18) },
    { id: demoId('cf:4'), contact_id: demoId('contact:carlosd'), name: 'Horizon Endowment - emerging manager criteria', url: 'https://blueharbor.demo/notes/horizon-criteria.pdf', type: 'link', created_at: ago(50) },
  ];

  /* ── Tasks (two boards, assignees, subtasks) ─────────────────── */
  const task = (label, title, fields, daysAgo) => ({
    id: demoId(`task:${label}`), title, priority: 'medium', done: false, notes: '', assignee: '',
    subtasks: [], status: '', position: 0, board_id: 'default',
    created_at: ago(daysAgo), updated_at: ago(Math.max(0, daysAgo - 10)), ...fields,
  });
  T.tasks = [
    task('t1', 'Finish MCO draft review - resolve Jordan\'s MA-decay and sizing threads before IC Friday', { priority: 'highest', assignee: 'Alex', status: 'working', position: 0, subtasks: [{ id: 1, title: 'Split MA decay: seats vs feeds', done: true, assignee: 'Alex' }, { id: 2, title: 'Re-run bear case at new mix', done: false, assignee: 'Alex' }, { id: 3, title: 'Check data-feed contract terms', done: false, assignee: 'Jordan' }] }, 6),
    task('t2', 'Position Review for SPOT needs to be completed', { priority: 'highest', assignee: 'Jordan', position: 1, notes: 'Blocking the add - see strategic hub note.' }, 9),
    task('t3', 'FICO lender channel checks - schedule the two intros from David', { priority: 'highest', assignee: 'Both', status: 'working', position: 2 }, 8),
    task('t4', 'Stress test MELI credit book at 2x loss rates + 300bps funding', { priority: 'medium', assignee: 'Jordan', position: 3 }, 12),
    task('t5', 'Q2 letter: draft the lessons-learned section first (Mark specifically reads it)', { priority: 'highest', assignee: 'Alex', position: 4, subtasks: [{ id: 1, title: 'Performance + attribution table', done: true, assignee: 'Alex' }, { id: 2, title: 'TSM patience-discipline write-up', done: false, assignee: 'Alex' }] }, 10),
    task('t6', 'Send Mark Bellows the risk-process one-pager + Q2 letter', { priority: 'highest', assignee: 'Alex', position: 5 }, 4),
    task('t7', 'Position Review for DASH needs to be completed', { priority: 'medium', assignee: 'Jordan', position: 6 }, 15),
    task('t8', 'Rebalance plan: fund MCO starter from MSFT/AVGO trims (pending IC)', { priority: 'medium', assignee: 'Both', position: 7 }, 5),
    task('t9', 'Update watchlist notes with specifics so we can monitor actively', { priority: 'medium', assignee: 'Jordan', done: true, position: 8 }, 40),
    task('t10', 'Think about overlaying a short book - individual names vs sector ETFs vs index puts', { priority: 'low', assignee: 'Alex', position: 9 }, 55),
    task('t11', 'Market map: payments value chain (V, MA, PYPL, adyen, stripe private comps)', { priority: 'low', assignee: 'Jordan', position: 10, notes: 'Documentation project - one map per quarter.' }, 35),
    task('t12', 'Get all position review docs uploaded into the documents library', { priority: 'medium', assignee: 'Jordan', done: true, position: 11 }, 60),
    task('t13', 'Write up the macro regime white paper for LP conversations', { priority: 'medium', assignee: 'Alex', done: true, status: 'working', position: 12 }, 80),
    task('t14', 'Q2 close: broker statements + contribution log to Linda by the 5th', { priority: 'highest', assignee: 'Alex', position: 13 }, 3),
    // ops board
    task('o1', 'Renew Novum Semi research subscription (January) - negotiate multi-year', { board_id: 'board_demo_ops', priority: 'low', assignee: 'Alex', position: 0 }, 20),
    task('o2', 'Prime broker annual review - collect two competing quotes first', { board_id: 'board_demo_ops', priority: 'medium', assignee: 'Alex', status: 'working', position: 1 }, 25),
    task('o3', 'Compliance calendar: Form ADV update + custody audit dates', { board_id: 'board_demo_ops', priority: 'highest', assignee: 'Jordan', position: 2 }, 14),
    task('o4', 'Set up the quarterly LP report template so letters stop being ad-hoc', { board_id: 'board_demo_ops', priority: 'medium', assignee: 'Both', done: true, position: 3 }, 45),
  ];

  /* ── App settings (boards, assignees, saved emails, accounting, and all
     per-tenant config) ──
     app_settings.value is JSONB — store native objects/arrays/strings, not
     stringified JSON. The single-row config tables were folded in here by
     migration 024; the macro/allocation/sector/factor blocks below push their
     keys onto this array. */
  const assigneeList = [{ name: 'Alex', color: '#2563eb' }, { name: 'Jordan', color: '#dc2626' }, { name: 'Both', color: '#16a34a' }];
  T.app_settings = [
    { key: 'activeWatchlistId', value: 'default' },
    { key: 'activeTaskBoardId', value: 'default' },
    { key: 'task_boards', value: [{ id: 'default', name: 'Blue Harbor Tasks' }, { id: 'board_demo_ops', name: 'Fund Operations' }] },
    { key: 'assignees', value: assigneeList },
    { key: 'assignees_board_demo_ops', value: assigneeList },
    { key: 'saved_emails', value: [{ name: 'Alex', email: 'alex@blueharbor.demo' }, { name: 'Jordan', email: 'jordan@blueharbor.demo' }] },
    { key: 'fund-accounting-state', value: accountingState(now) },
    { key: 'portfolio_cash', value: { cash: 6180.42 } },
  ];

  /* ── Research links (mix of read/unread, summarized/pending) ─── */
  const link = (label, fields, daysAgo) => ({
    id: demoId(`link:${label}`), ticker: '', content_type: 'web_article', title: null, source: null,
    published_at: null, notes: null, extracted_text: null, pasted_text: null,
    auto_summary: null, manual_summary: null, summary_status: 'pending', summary_method: 'none',
    is_read: false, created_at: ago(daysAgo), updated_at: ago(Math.max(0, daysAgo - 1)), ...fields,
  });
  T.research_links = [
    link('l1', { ticker: 'MCO', url: 'https://capletter.demo/p/the-ratings-oligopoly-and-ai', title: 'The Ratings Oligopoly Meets AI', source: 'The Capital Letter', content_type: 'web_article', summary_status: 'summarized', summary_method: 'extractive', published_at: ago(20), is_read: true, auto_summary: 'Argues AI commoditizes credit analysis but not credit ratings: the product is regulatory acceptance, not insight. Issuer-pays economics survive because index inclusion and fund mandates hard-code the big-three stamps. Risk is political (NRSRO reform), not technological.' }, 19),
    link('l2', { ticker: 'FICO', url: 'https://mortgagewire.demo/fhfa-vantagescore-timeline-analysis', title: 'What the FHFA Score Announcement Actually Requires', source: 'Mortgage Wire', summary_status: 'summarized', summary_method: 'extractive', published_at: ago(35), is_read: true, auto_summary: 'Walks the actual rulemaking path: director statements are not rules; bi-merge implementation needs GSE system changes, investor disclosure updates, and a parallel-run period. Realistic earliest volume impact is 24-36 months out, and pricing is untouched by the current proposal.' }, 33),
    link('l3', { ticker: 'TSM', url: 'https://novumsemi.demo/notes/n2-ramp-and-wafer-pricing', title: 'N2 Ramp Economics and the Wafer Price Ladder', source: 'Novum Semi', content_type: 'report', summary_status: 'summarized', summary_method: 'extractive', published_at: ago(50), auto_summary: 'N2 wafer prices land ~20% above N3 with yields tracking ahead of the N3 curve at the same age. CoWoS advanced-packaging capacity doubling again; the constraint (and the pricing power) migrates from lithography to packaging through 2027.' }, 48),
    link('l4', { ticker: 'PYPL', url: 'https://x.com/paymentsdata/status/18829917', title: null, source: null, content_type: 'tweet', summary_status: 'summarized', summary_method: 'tweet_clean', auto_summary: 'Checkout share data thread: Apple Pay share of e-comm checkout up 340bps y/y, PayPal branded down 210bps, Shop Pay up 180bps. Merchant survey says button placement now auctioned - incumbency discount eroding.', is_read: true }, 14),
    link('l5', { ticker: 'MELI', url: 'https://andescap.demo/letters/latam-fintech-monthly-june', title: 'LatAm Fintech Monthly - June', source: 'Andes Capital', content_type: 'report', summary_status: 'pending', notes: 'Sofia\'s letter - credit section relevant to our stress test.' }, 7),
    link('l6', { url: 'https://aeonresearch.demo/papers/agentic-commerce-checkout.pdf', title: 'Agentic Commerce and the Future of Checkout', source: 'Aeon Research', content_type: 'white_paper', summary_status: 'pending' }, 10),
    link('l7', { ticker: 'SPOT', url: 'https://screenledger.demo/spotify-content-roi-discipline', title: 'Inside Spotify\'s Per-Show ROI Regime', source: 'Screen Ledger', summary_status: 'pending', notes: 'Matches what Emily told us - use in position review.' }, 11),
    link('l8', { url: 'https://a16z.com/its-time-to-build/', content_type: 'web_article', is_read: true }, 120),
    link('l9', { url: 'https://www.wsj.com/business/datacenter-power-constraints-2026', title: null, content_type: 'web_article', notes: 'Grid constraints as the real AI capex governor - pairs with Nate\'s report.' }, 16),
    link('l10', { ticker: 'NOW', url: 'https://priyaknotes.demo/seats-vs-outcomes', title: 'Seats vs Outcomes: Pricing Software in the Agent Era', source: 'PK Notes', summary_status: 'summarized', summary_method: 'extractive', published_at: ago(16), auto_summary: 'Framework piece: agentic workflows shift value capture from per-seat licenses to per-outcome pricing. Platforms that own workflow state and audit trails (ServiceNow, Salesforce) can convert; point tools cannot. Watch cRPO mix, not seat counts.', is_read: true }, 15),
    link('l11', { url: 'https://ftalphalog.demo/private-credit-ratings-shopping', title: 'Private Credit and the New Ratings Shopping', content_type: 'web_article', summary_status: 'pending', notes: 'Counter-thesis for MCO - does private credit bypass public ratings at scale?' }, 5),
    link('l12', { ticker: 'DASH', url: 'https://transportweekly.demo/autonomous-delivery-economics-2026', title: 'Sidewalk Robots and Drone Delivery: Unit Economics Check-in', content_type: 'web_article', summary_status: 'pending' }, 22),
    link('l13', { url: 'https://howardmarks.demo/memos/the-illusion-of-knowing', title: 'The Illusion of Knowing', content_type: 'web_article', manual_summary: 'Read for the behavioral section of the lessons library: forecast confidence vs forecast accuracy. The anchoring section maps exactly to our NVDA miss.', summary_status: 'summarized', summary_method: 'manual', is_read: true }, 65),
    link('l14', { ticker: 'LLY', url: 'https://pharmaledger.demo/oral-glp1-supply-scale', title: 'Oral GLP-1: The Supply Question', source: 'Pharma Ledger', content_type: 'web_article', summary_status: 'pending' }, 9),
  ];

  /* ── Ideas (workspace sticky notes - beefed up) ──────────────── */
  const idea = (label, fields, daysAgo) => ({
    id: demoId(`idea:${label}`), title: '', content: '', color: 'yellow', category: 'idea',
    tags: [], pinned: false, archived: false, position: 0,
    created_at: ago(daysAgo), updated_at: ago(Math.max(0, daysAgo - 2)), ...fields,
  });
  T.ideas = [
    idea('id1', { title: '3-sentence thesis rule', content: 'Any director could summarize the movie\'s money in 3 sentences (Spielberg via the TBPN interview). Same bar for us: if we can\'t state the thesis in 3 sentences at the top of the memo, we don\'t understand it yet. Added to the draft template - enforce it.', color: 'yellow', pinned: true, position: 0, tags: ['process'] }, 70),
    idea('id2', { title: 'Boring toll booths basket', content: 'MCO, SPGI, FICO, V, MA, ICE, CME - businesses selling stamps, scores and rails. What would a permanent 30% sleeve of only these look like? Backtest the drawdown profile vs our current growth tilt.', color: 'blue', category: 'idea', pinned: true, position: 1, tags: ['portfolio-construction'] }, 55),
    idea('id3', { title: 'India voice-AI consumer boom', content: 'Voice-first AI could leapfrog app-based UX for the next 500M Indian internet users. Who owns the rails - Jio? Google? Watch for a listed pure play; nothing investable yet.', color: 'green', position: 2, tags: ['EM', 'AI'] }, 90),
    idea('id4', { title: 'Question: what kills Costco?', content: 'Seriously - inversion exercise for the ballast sleeve. Membership model survived Amazon, inflation, covid. Candidate answers: demographic cliff in suburban car culture? Instant delivery at Costco prices? Write the pre-mortem.', color: 'pink', category: 'question', position: 3 }, 40),
    idea('id5', { title: 'Lessons library -> LP letter section', content: 'Mark reads the lessons section first. Institutionalize: every letter gets one post-mortem or process note from the library. Differentiator vs every other emerging manager deck.', color: 'purple', category: 'todo', position: 4, tags: ['LP', 'process'] }, 30),
    idea('id6', { title: 'AI capex food chain map', content: 'We own the fab (TSM), a designer (AVGO), and a spender (MSFT). Map the middle: power, cooling, networking, memory. Where is pricing power moving next? Nate\'s grid report says the bottleneck is permits.', color: 'orange', position: 5, tags: ['AI-capex', 'market-map'] }, 25),
    idea('id7', { title: 'Note: our edge is holding period', content: 'Every lesson so far reduces to the same thing - our advantage is not information, it is the willingness to hold through the middle of the thesis when the tape disagrees. Structure everything (sizing, cash, LP base) to protect that.', color: 'gray', category: 'note', position: 6 }, 18),
    idea('id8', { title: 'Random: earnings-call diff tool', content: 'Dumb-simple tool idea - diff consecutive quarterly call transcripts and flag dropped phrases (guidance language that quietly disappears). The SPOT "content discipline" phrasing change is exactly what it would catch.', color: 'blue', category: 'random', position: 7 }, 12),
  ];

  /* ── Lessons learned (beefed up: 5 full entries + pattern library) ── */
  const patterns = [
    ['pat1', 'Value trap - cheap for a reason', 'The optically low multiple was the market correctly pricing a deteriorating business, not an inefficiency.', 'A cheap multiple on declining unit economics is the most expensive thing we buy.', ['Is the cheapness explained by a metric that is structurally deteriorating?', 'What would have to stabilize for the multiple to re-rate?', 'Are we the marginal buyer because everyone informed has left?']],
    ['pat2', 'Anchoring on price instead of value', 'A prior price (our cost, a 52-week high, a round number) drove the decision instead of the business trajectory.', 'Anchors feel like discipline but they are noise; the business does not know our cost basis.', ['Would we buy this today at this price with fresh eyes?', 'Is the anchor a valuation or a coincidence of our history?', 'What changed in the business since the anchor formed?']],
    ['pat3', 'Underestimated regulatory risk', 'A regulatory, legal, or political change impaired the thesis in a way we treated as remote.', 'Regulatory shifts can reset earnings power or market structure with little warning.', ['What regulator can change this business\'s economics unilaterally?', 'What do unit economics look like under the plausible adverse rule?', 'Is any part of the moat regulatory - and removable?']],
    ['pat4', 'Misread capital allocation', 'Management deployed capital (M&A, buybacks, capex) in a way that destroyed per-share value and we under-weighted it.', 'Capital allocation compounds silently; it can offset years of operating excellence.', ['What is the track record across a full cycle?', 'Are buybacks happening above or below intrinsic value?', 'Do incentives reward per-share value or empire size?']],
    ['pat5', 'Thesis creep', 'The reason we held was no longer the reason we bought, and we never forced the re-underwrite.', 'Positions quietly become different investments; unnoticed, we hold things we never chose.', ['Is today\'s bull case the one in the original memo?', 'If the original thesis is dead, would we buy this new one fresh?', 'When was the last full re-underwrite?']],
    ['pat6', 'Sold the winner to fund nothing', 'Trimmed or exited a compounder for valuation comfort without a better use for the capital.', 'The cost of interrupting compounding is invisible on the day you do it and enormous a decade later.', ['What exactly will this capital do next?', 'Is the sale a valuation judgment or discomfort with position size?', 'What is the realistic re-entry plan if we are wrong?']],
    ['pat7', 'Sized by conviction, not by risk', 'Position size reflected how excited we were, not what the downside scenario could do to the book.', 'Sizing is the only decision that turns an analytical mistake into a fund-level problem.', ['What does the position do to the fund at the bear-case price?', 'Is the size survivable through the maximum plausible drawdown?', 'Did excitement or process set this weight?']],
  ];
  T.lesson_patterns = patterns.map(([label, name, description, why_it_matters, checklist_questions], i) => ({
    id: demoId(`pat:${label}`), name, description, why_it_matters, checklist_questions,
    created_at: ago(200 - i), updated_at: ago(200 - i),
  }));

  const lesson = (label, fields, daysAgo) => ({
    id: demoId(`lesson:${label}`), ticker: '', company: '', title: '', type: 'post_mortem',
    outcome: 'uncertain', category: 'business', severity: 'medium', repeat_risk: 'medium',
    status: 'not_reviewed', position_type: 'owned', date_opened: null, date_reviewed: null,
    tags: [], pattern_ids: [], detail: { setup: '', outcome: '', analysis: '', lesson: '' }, comments: [],
    created_at: ago(daysAgo), updated_at: ago(Math.max(1, daysAgo - 5)), ...fields,
  });
  T.lessons = [
    lesson('pypl', {
      ticker: 'PYPL', company: 'PayPal', title: 'PYPL round trip: bought the multiple, ignored the mix',
      type: 'post_mortem', outcome: 'wrong_thesis', category: 'business', severity: 'high', repeat_risk: 'high',
      status: 'watch_item', position_type: 'sold', date_opened: dstr(addDays(now, -420)), date_reviewed: dstr(addDays(now, -180)),
      tags: ['payments', 'value-trap', 'mix-shift'], pattern_ids: [demoId('pat:pat1'), demoId('pat:pat2')],
      detail: {
        setup: '<div><b>Original thesis:</b> dominant checkout brand at 11x FCF with a monster buyback; market extrapolating covid-era pull-forward pain forever. We believed branded checkout share was stable and the multiple alone was the opportunity.</div><div><br></div><div>What needed to go right: branded TPV growing at least with e-commerce, take rate flat, buyback shrinking the count 5%+/yr.</div>',
        outcome: '<div>Held ~7 months, exited at roughly breakeven after two quarters showed the same shape: total TPV fine, branded flat, unbranded (Braintree, ~100bps take rate) doing all the growing. The stock went nowhere while the book compounded - real cost was opportunity.</div>',
        analysis: '<div>The mistake was analytical laziness dressed as value discipline: we underwrote the blended multiple instead of separating a melting high-margin business from a growing commodity one. The disconfirming data (branded share losses to Apple Pay) was in every quarterly deck - we filed it under "noise" because the multiple felt protective.</div>',
        lesson: '<div><b>Rule:</b> for any multi-segment business, no thesis is valid until segments are modeled separately - the cheap blended multiple is where value traps hide. <b>Applied:</b> the current PYPL draft memo leads with the branded/unbranded split, and the burden of proof is on the bull case. Cheapness alone can never again be reason #1 in a Blue Harbor memo.</div>',
      },
      comments: [thread('lc:pypl', 'Re-entry criteria', false, [
        ['reviewer', 'The watch-item status needs teeth: what exactly re-opens this? Two quarters of branded TPV >= e-comm growth, or do we also need Fastlane merchant data?'],
        ['author', 'Both - added to the draft memo kill/confirm criteria. Branded >= e-comm for 2 quarters AND independent conversion data. Otherwise it stays a pass forever, happily.'],
      ], ago(170))],
    }, 185),
    lesson('nvda', {
      ticker: 'NVDA', company: 'NVIDIA', title: 'The one that got away: anchored at $450',
      type: 'missed_opportunity', outcome: 'missed_upside', category: 'behavioral', severity: 'high', repeat_risk: 'high',
      status: 'watch_item', position_type: 'missed', date_opened: dstr(addDays(now, -600)), date_reviewed: dstr(addDays(now, -300)),
      tags: ['behavioral', 'anchoring', 'AI'], pattern_ids: [demoId('pat:pat2')],
      detail: {
        setup: '<div>Did the full work in 2024: datacenter revenue visibility, CUDA lock-in, supply constraints as pricing power. Conclusion was "exceptional business, wait for a pullback to $450." It touched $460, we bid $450 limit, never filled.</div>',
        outcome: '<div>The stock roughly doubled from our unfilled limit. We owned the analysis and none of the position. The $10 we saved on entry cost the fund the single best risk/reward we identified that year.</div>',
        analysis: '<div>Classic anchoring: $450 was a round number from a chart, not a valuation output. Our own model said fair value ~$700 - meaning $460 was already a 35% discount, and we haggled over 2%. The deeper error: for the highest-conviction ideas, entry precision matters least, because the expected error bars dwarf the entry difference.</div>',
        lesson: '<div><b>Rule:</b> when conviction is top-decile and the price is inside 10% of the target entry, take a half position immediately and work the rest. Precision is for mediocre ideas. This rule got us into DASH at 158 instead of waiting for 150 - that alone paid for the lesson.</div>',
      },
      comments: [],
    }, 310),
    lesson('unh', {
      ticker: 'UNH', company: 'UnitedHealth', title: 'Early on the regulatory knife - sized like it was over',
      type: 'post_mortem', outcome: 'early', category: 'risk', severity: 'medium', repeat_risk: 'medium',
      status: 'one_off', position_type: 'sold', date_opened: dstr(addDays(now, -380)), date_reviewed: dstr(addDays(now, -120)),
      tags: ['healthcare', 'regulatory'], pattern_ids: [demoId('pat:pat3'), demoId('pat:pat7')],
      detail: {
        setup: '<div>Bought the crash after the MA-rates/DOJ headline pile-up: "peak pessimism on the best managed-care franchise." Believed the regulatory storm was priced in after a 40% drawdown. Sized it at 6% - a conviction size for what was really a special situation.</div>',
        outcome: '<div>Two more shoes dropped (V28 phase-in math, PBM scrutiny) and the stock fell another 20%. Exited at -18% on the position - right that it was cheap, wrong that the news cycle was over. It bottomed 5 months after our exit.</div>',
        analysis: '<div>Regulatory cascades do not have a "priced in" moment that can be called from outside - each headline re-opens the distribution. Our edge in that situation was zero: we were betting on news flow exhaustion, which is not analysis. The 6% size turned a survivable thesis error into a fund-level drag (~110bps).</div>',
        lesson: '<div><b>Rule:</b> regulatory-cascade situations get event-sizing (max 2%) no matter how cheap, until the actual rule text (not commentary) is final. The FICO work is following this rule right now - that is why the target is 4% not 8%.</div>',
      },
      comments: [thread('lc:unh', 'Is one_off right?', true, [
        ['reviewer', 'Marked one_off but the FICO situation rhymes. Should this be a watch item tied to the pattern instead?'],
        ['author', 'The pattern (regulatory cascade sizing) is captured in pattern #3 and the checklist - the specific UNH trade is closed. Keeping one_off, pattern does the carrying.'],
      ], ago(115))],
    }, 130),
    lesson('pton', {
      ticker: 'PTON', company: 'Peloton', title: 'Good pass: the growth story with no unit economics',
      type: 'good_decision', outcome: 'good_pass', category: 'business', severity: 'low', repeat_risk: 'low',
      status: 'archived', position_type: 'passed', date_opened: dstr(addDays(now, -700)), date_reviewed: dstr(addDays(now, -400)),
      tags: ['consumer', 'process-win'], pattern_ids: [demoId('pat:pat1')],
      detail: {
        setup: '<div>Pitched to us twice on the way down ("it\'s a subscription business at a hardware multiple"). The screen said cheap vs subscriber value; the story said category winner.</div>',
        outcome: '<div>Passed both times. Stock fell a further ~60%. The pass saved an estimated 150-200bps of drawdown given the size we were considering.</div>',
        analysis: '<div>What worked: we did the cohort math instead of accepting the subscription framing - hardware losses per incremental sub exceeded the LTV of the sub at realistic churn. The "subscription business" was buying its subscribers at negative margin. Process note: the second pitch nearly worked because the price was 50% lower; the unit economics were unchanged. Price is not thesis.</div>',
        lesson: '<div><b>Keep doing:</b> cohort-level unit economics before any "X business at a Y multiple" framing gets airtime. The framing is marketing; the cohort table is the business.</div>',
      },
      comments: [],
    }, 410),
    lesson('tsm', {
      ticker: 'TSM', company: 'TSMC', title: 'Added into the export-control scare without waiting for the data',
      type: 'process_mistake', outcome: 'uncertain', category: 'process', severity: 'medium', repeat_risk: 'high',
      status: 'watch_item', position_type: 'owned', date_opened: dstr(addDays(now, -300)), date_reviewed: dstr(addDays(now, -60)),
      tags: ['semis', 'process', 'sizing'], pattern_ids: [demoId('pat:pat7'), demoId('pat:pat5')],
      detail: {
        setup: '<div>Owned TSM from 295. When the export-control expansion headlines cracked the stock, we added the same week - "monopoly on sale" - taking the position from 6% to 8.4% before Raj\'s channel data or the actual rule text were available.</div>',
        outcome: '<div>Headlines kept coming for two more months; position bottomed at -28% and is still below cost. The thesis is intact (this may yet be outcome: correct), but the add was pure reflex - we bought our own discomfort, not new information.</div>',
        analysis: '<div>The process violation is crisp: our own rules say adds require either new data or a completed re-underwrite. We had neither - we had a price drop and a slogan ("monopoly on sale"). Slogans are how good theses generate bad trades. Note the interaction with position review: the review was open and unfinished when the add happened.</div>',
        lesson: '<div><b>Rule (now enforced in the workflow):</b> no adds while a position review is open on the name. The SPOT add today is explicitly blocked behind its review - this lesson is why that gate exists.</div>',
      },
      comments: [thread('lc:tsm', 'Outcome still uncertain', false, [
        ['reviewer', 'If leading-edge orders recover in H2 like Raj expects, does this get reclassified as "early" instead of process mistake?'],
        ['author', 'No - the outcome can end up fine and the process was still wrong. That distinction is the whole point of the library. Entry stays a process mistake regardless of where the stock goes.'],
      ], ago(55))],
    }, 65),
  ];

  /* ── Macro regime allocator ──────────────────────────────────── */
  T.app_settings.push({ key: 'macro_regime_config', value: {
    start_date: '2015-01-01', end_date: dstr(addDays(now, -15)).slice(0, 8) + '01',
    holdout_start: '2021-01-01', window_type: 'expanding', max_iter: 1000,
    max_weight: 0.97, min_weight: 0.1, class_weight: null, crash_overlay: true,
    deriskOverlay: { alpha: 0.5, cash_max: 0.02, cash_min: 0.002, max_trim: 0.2, max_boost: 0.1, derisk_start: 0.7 },
    equity_ticker: 'SPY', baseline_equity: 0.95, baseline_tbills: 0.05,
    momentum_window: 3, macro_lag_months: 1, min_train_months: 48, regularization_C: 0.5,
    volatility_window: 3, vix_spike_threshold: 7, weight_smoothing_up: 0.98, weight_smoothing_down: 0.97,
    allocation_steepness: 13, rolling_window_months: 120, credit_spike_threshold: 1.5,
    forecast_horizon_months: 1, recency_halflife_months: 12, drawdown_defense_threshold: -10,
  } });

  const backtest = macroBacktest(now);
  const live = macroLivePrediction(now, backtest);
  T.app_settings.push({ key: 'macro_regime_weights', value: { AAPL: 12.8, MSFT: 12.1, AVGO: 9.9, TSM: 8.4, V: 9.8, SPOT: 8.6, DASH: 8.1, COST: 6.3, LLY: 4.9, ISRG: 8.1, CASH: 11.0 } });
  T.macro_regime_runs = [
    { run_type: 'run', status: 'completed', started_at: ago(16), completed_at: ago(16, 14.99), log_output: `── Macro Regime Allocator ─────────────────────────────\nLoaded ${backtest.length - 1} months of macro + market features\nWalk-forward training: expanding window, min 48 months\nPredictions made: ${backtest.length - 1}\nBacktest results saved to outputs/\nModel saved to outputs/model.joblib\n\n── Step 5: Live Prediction ───────────────────────────\nEngineering features for latest month...\nP(equity beats T-bills): ${live.prob_equity}\nAllocation for ${live.allocation_month.slice(0, 7)}: equity ${(live.weight_equity * 100).toFixed(1)}% / t-bills ${(live.weight_tbills * 100).toFixed(1)}%\nOverlay: none\nDone in 26.4s`, created_at: ago(16) },
    { run_type: 'predict', status: 'completed', started_at: ago(1), completed_at: ago(1, 14.99), log_output: `Starting: make predict\nLoaded latest prediction inputs from Supabase.\nCURRENT ALLOCATION SIGNAL\n  Data as of:              ${live.rebalance_date.slice(0, 7)}\n  Allocation for:          ${live.allocation_month.slice(0, 7)}\n  P(equity beats T-bills): ${live.prob_equity}\n  Equity weight:           ${(live.weight_equity * 100).toFixed(1)}%\n  T-bills weight:          ${(live.weight_tbills * 100).toFixed(1)}%\n  Overlay:                 none\nDone in 0.8s`, created_at: ago(1) },
    { run_type: 'validate', status: 'completed', started_at: ago(30), completed_at: ago(30, 14.97), log_output: 'Validation sweep: regularization C in {0.1, 0.5, 1.0}, momentum window in {3, 6}\nBest holdout Sharpe at C=0.5, momentum=3 (current config)\nHit rate (holdout): 0.71\nNo config change recommended.', created_at: ago(30) },
  ];
  T.macro_regime_results = [{
    id: demoId('macro:result:1'), run_id: null, // wired to the seeded run by demoSeed
    backtest, metrics: macroMetrics(backtest), live_prediction: live,
    report: `MACRO REGIME ALLOCATOR - BACKTEST REPORT (demo)\n\nWindow: ${backtest[1]?.date} -> ${backtest[backtest.length - 1]?.date} (monthly, walk-forward)\nModel: regularized logistic regression on 13 macro/market features, expanding window\n\nHeadline: the model portfolio captures most of equity's compounding while cutting the worst drawdown by roughly a quarter and beating 60/40 outright. The win comes almost entirely from de-risking into stress regimes (credit spread spikes + momentum breaks) and re-risking quickly once spreads normalize - not from timing tops.\n\nCurrent signal: ${(live.weight_equity * 100).toFixed(1)}% equity / ${(live.weight_tbills * 100).toFixed(1)}% t-bills for ${live.allocation_month.slice(0, 7)} (P=${live.prob_equity}).\n\nCaveats: monthly rebalance ignores intra-month path; t-bill sleeve assumes frictionless roll; features lagged one month to avoid look-ahead.`,
    plots: {}, validation_report: null, validation_data: {}, created_at: ago(1),
  }];

  /* ── Allocation / risk configs (app_settings keys) ───────────── */
  const alloc = (ticker, userWeight, expectedReturn, exposures) => ({ id: demoId(`alloc:${ticker}`), ticker, userWeight, expectedReturn, factorExposures: exposures });
  T.app_settings.push({ key: 'allocation_config', value: {
    covLambda: '0.5', maxWeight: '15', minWeight: '3', riskFreeRate: '4',
    cashMaxWeight: '3', cashMinWeight: '0.5', numPortfolios: '50000', rbTargetCashPercent: '2',
    allocations: [
      alloc('AAPL', '12.80', '10', ['0.30', '0.20', '0.15', '0.10', '0.35']),
      alloc('MSFT', '12.10', '9', ['0.45', '0.15', '0.15', '0.10', '0.35']),
      alloc('AVGO', '9.90', '13', ['0.35', '0.20', '0.20', '0.20', '0.6']),
      alloc('TSM', '8.40', '15', ['0.20', '0.10', '0.55', '0.15', '0.7']),
      alloc('V', '9.80', '9', ['0.30', '0.30', '0.45', '0.10', '0.3']),
      alloc('SPOT', '8.60', '13', ['0.50', '0.25', '0.10', '0.20', '0.6']),
      alloc('DASH', '8.10', '13', ['0.45', '0.50', '0.25', '0.30', '0.65']),
      alloc('COST', '6.30', '7', ['0.55', '0.10', '0.10', '0.05', '0.25']),
      alloc('LLY', '4.90', '11', ['0.50', '0.20', '0.60', '0.15', '0.55']),
      alloc('ISRG', '8.10', '11', ['0.50', '0.15', '0.25', '0.10', '0.4']),
    ],
    rbTargetWeights: { AAPL: '13', MSFT: '12', AVGO: '10', TSM: '8.5', V: '10', SPOT: '9', DASH: '8', COST: '6.5', LLY: '5', ISRG: '8' },
    riskFactorWeights: [0.6, 0.5, 0.4, 0.8, 0.9],
  } });
  T.app_settings.push({ key: 'sector_config', value: {
    'Technology': { color: '#10b981' },
    'Communication Services': { color: '#06b6d4' },
    'Consumer Cyclical': { color: '#f59e0b' },
    'Financial Services': { color: '#059669' },
    'Healthcare': { color: '#8b5cf6' },
    'Consumer Defensive': { color: '#6366f1' },
  } });
  T.app_settings.push({ key: 'factor_config', value: {
    factors: ['Valuation', 'Disruption', 'Regulatory', 'Earnings Quality', 'Volatility'],
    importance_weights: { 'Valuation': 0.6, 'Disruption': 0.5, 'Regulatory': 0.4, 'Earnings Quality': 0.8, 'Volatility': 0.9 },
    exposures: {
      AAPL: { Valuation: 0.30, Disruption: 0.20, Regulatory: 0.15, 'Earnings Quality': 0.10 },
      MSFT: { Valuation: 0.45, Disruption: 0.15, Regulatory: 0.15, 'Earnings Quality': 0.10 },
      AVGO: { Valuation: 0.35, Disruption: 0.20, Regulatory: 0.20, 'Earnings Quality': 0.20 },
      TSM: { Valuation: 0.20, Disruption: 0.10, Regulatory: 0.55, 'Earnings Quality': 0.15 },
      V: { Valuation: 0.30, Disruption: 0.30, Regulatory: 0.45, 'Earnings Quality': 0.10 },
      SPOT: { Valuation: 0.50, Disruption: 0.25, Regulatory: 0.10, 'Earnings Quality': 0.20 },
      DASH: { Valuation: 0.45, Disruption: 0.50, Regulatory: 0.25, 'Earnings Quality': 0.30 },
      COST: { Valuation: 0.55, Disruption: 0.10, Regulatory: 0.10, 'Earnings Quality': 0.05 },
      LLY: { Valuation: 0.50, Disruption: 0.20, Regulatory: 0.60, 'Earnings Quality': 0.15 },
      ISRG: { Valuation: 0.50, Disruption: 0.15, Regulatory: 0.25, 'Earnings Quality': 0.10 },
    },
  } });

  /* ── Documents (rows reference PDFs the seeder uploads) ──────── */
  const letterBody = (quarter, perf, sp) => [
    `Dear Partners,`,
    ``,
    `Blue Harbor returned ${perf} in ${quarter} versus ${sp} for the S&P 500.`,
    `The book remains concentrated in businesses we believe can compound`,
    `per-share value through a full cycle: network toll booths, the AI`,
    `capex food chain, and franchises with pricing power.`,
    ``,
    `Lessons learned this quarter are documented in the appendix - we`,
    `publish our mistakes because the process is the product.`,
    ``,
    `This is a demo artifact generated for the AlphaOS demo workspace.`,
    ``,
    `- Alex & Jordan, Blue Harbor Capital (fictional)`,
  ];
  const docsSpec = [
    { label: 'doc:q2letter', title: `${quarterLabelOf(now, 1)} Blue Harbor Letter.pdf`, category: 'shareholder_letter', ticker: '', daysAgo: 8, pdf: makePdf('Blue Harbor Capital - Quarterly Letter', letterBody(quarterLabelOf(now, 1), '+7.4%', '+3.4%')) },
    { label: 'doc:q1letter', title: `${quarterLabelOf(now, 2)} Blue Harbor Letter.pdf`, category: 'shareholder_letter', ticker: '', daysAgo: 98, pdf: makePdf('Blue Harbor Capital - Quarterly Letter', letterBody(quarterLabelOf(now, 2), '+4.1%', '+1.8%')) },
    { label: 'doc:q4letter', title: `${quarterLabelOf(now, 3)} Blue Harbor Letter.pdf`, category: 'shareholder_letter', ticker: '', daysAgo: 190, pdf: makePdf('Blue Harbor Capital - Quarterly Letter', letterBody(quarterLabelOf(now, 3), '+6.2%', '+2.7%')) },
    { label: 'doc:mcoreport', title: 'MCO Deep Dive - Ratings, Analytics, and the AI Mispricing.pdf', category: 'equity_research_report', ticker: 'MCO', daysAgo: 6, notes: 'The full memo behind the Draft & Review entry.', pdf: makePdf('MCO Deep Dive (Blue Harbor demo)', ['Thesis: market prices all of Moody\'s for AI risk that touches', '~35% of operating income. MIS is insulated and rides the wall.', 'Base case $560 / bear $360 vs $420 entry.', 'See Draft & Review for threads and the live memo.']) },
    { label: 'doc:paymentsprimer', title: 'Payments Value Chain Primer.pdf', category: 'equity_primer', ticker: '', daysAgo: 55, notes: 'Market-map project output - networks, processors, gateways, BNPL.', pdf: makePdf('Payments Value Chain Primer (demo)', ['Four-party networks (V/MA) sit at the toll-booth layer.', 'Processors and gateways compete on price; networks do not.', 'Wallets attack the button, not the rails - so far.']) },
    { label: 'doc:dashreview', title: 'DASH Position Review - Q1.pdf', category: 'position_review_report', ticker: 'DASH', daysAgo: 70, pdf: makePdf('DASH Position Review (demo)', ['Verdict: hold at target weight. Thesis intact.', 'New verticals scaling; delivery network liquidity deepening;', 'autonomy is the tail risk to keep handicapping, not a today problem.']) },
    { label: 'doc:h1memo', title: 'H1 Investor Memo - Positioning and Process.pdf', category: 'investor_memo', ticker: '', daysAgo: 15, notes: 'Written for LP conversations (Mark, Carlos).', pdf: makePdf('H1 Investor Memo (demo)', ['Positioning: 55% semis/AI-adjacent, trimming toward 48%.', 'Cash 6.5% pending IC decisions on MCO and FICO.', 'Process: no adds while a position review is open.', 'Macro regime overlay: ~88% equity signal for the month.']) },
  ];
  T.documents = docsSpec.map((d) => ({
    title: d.title, category: d.category, ticker: d.ticker || '', notes: d.notes || '',
    file_name: d.title, file_type: 'application/pdf', file_size: d.pdf.length,
    storage_path: null, url: null, // filled by demoSeed after upload
    uploaded_at: ago(d.daysAgo),
    _upload: { label: d.label, bytes: d.pdf, category: d.category },
  }));

  return T;
}

// "Q2 2026"-style label for the quarter `back` quarters before the current one.
function quarterLabelOf(now, back) {
  const q = Math.floor(now.getUTCMonth() / 3) - back;
  const y = now.getUTCFullYear() + Math.floor(q / 4);
  const qi = ((q % 4) + 4) % 4;
  return `Q${qi + 1} ${y}`;
}
