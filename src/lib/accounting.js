/**
 * Fund Accounting Engine
 *
 * Pure functions for NAV-based share accounting.
 * Maps the accounting logic from /home/datta/base/research_management_tool/port overview.xlsx
 *
 * Workbook mapping:
 *   - Each quarter sheet has a top accounting block (rows 1-22)
 *   - Row 3: AUM, Row 4: NAV/share, Row 5: Outstanding Shares
 *   - Rows 7-9: Bhuvan (Capital, Equity%, Shares)
 *   - Rows 11-13: Dhruv (Capital, Equity%, Shares)
 *   - Rows 15-17: Amit (Capital, Equity%, Shares)
 *   - Row 19: Period/QTD return, Row 20: Cumulative return
 *   - Row 22: Dates
 *   - Contribution columns (e.g. E, H, K, N) appear between period start/end pairs
 */

// ─── Data Model ─────────────────────────────────────────────────────────────
// The raw state stores ONLY user inputs: endAUM values and contributions.
// All other values (NAV, shares, capital, equity, returns) are derived.
//
// state = {
//   investors: ['Bhuvan', 'Dhruv', 'Amit'],
//   inceptionDate: '2024-09-17',
//   inceptionNAV: 100,
//   initialShares: { Bhuvan: 32.71903056, Dhruv: 15.92656944, Amit: 0 },
//   quarters: [
//     {
//       label: 'Q4 2024',
//       events: [
//         { type: 'period', startDate: '...', endDate: '...', endAUM: 5923.04 },
//         { type: 'contribution', date: '...', amounts: { Amit: 2500 } },
//         { type: 'period', startDate: '...', endDate: '...', endAUM: 8207.62 },
//         ...
//       ]
//     }
//   ]
// }

// ─── Seed State (mirrors port overview.xlsx) ─────────────────────────────────

export function createSeedState() {
  return {
    investors: ['Bhuvan', 'Dhruv', 'Amit'],
    inceptionDate: '2024-09-17',
    inceptionNAV: 100,
    // Workbook Q4 2024 sheet: C9=32.71903056, C13=15.92656944 (hardcoded strings)
    // These represent shares at inception, issued at NAV=100
    // Bhuvan: 3271.90/100 = 32.71903056, Dhruv: 1592.66/100 = 15.92656944
    initialShares: { Bhuvan: 32.71903056, Dhruv: 15.92656944, Amit: 0 },
    // S&P 500 price at fund inception — benchmark anchor
    inceptionSP: 5634.58,
    quarters: [
      {
        label: 'Q4 2024',
        events: [
          { type: 'period', startDate: '2024-09-17', endDate: '2024-12-31', endAUM: 5923.04, spEnd: 5881.63 }
        ]
      },
      {
        label: 'Q1 2025',
        events: [
          { type: 'period', startDate: '2025-01-01', endDate: '2025-03-17', endAUM: 5790.92, spEnd: 5675.12 },
          { type: 'contribution', date: '2025-03-17', amounts: { Amit: 2500 } },
          { type: 'period', startDate: '2025-03-18', endDate: '2025-03-18', endAUM: 8207.62, spEnd: 5614.66 },
          { type: 'contribution', date: '2025-03-18', amounts: { Amit: 2500 } },
          { type: 'period', startDate: '2025-03-19', endDate: '2025-03-31', endAUM: 10594.99, spEnd: 5611.85 }
        ]
      },
      {
        label: 'Q2 2025',
        events: [
          { type: 'period', startDate: '2025-04-01', endDate: '2025-04-09', endAUM: 10838.33, spEnd: 5456.90 },
          { type: 'contribution', date: '2025-04-09', amounts: { Dhruv: 2500 } },
          { type: 'period', startDate: '2025-04-10', endDate: '2025-05-28', endAUM: 14948.95, spEnd: 5888.55 },
          { type: 'contribution', date: '2025-05-28', amounts: { Bhuvan: 601.49, Dhruv: 1130.52 } },
          { type: 'period', startDate: '2025-05-29', endDate: '2025-06-17', endAUM: 17142.37, spEnd: 5982.72 },
          { type: 'contribution', date: '2025-06-17', amounts: { Bhuvan: 2000 } },
          { type: 'period', startDate: '2025-06-18', endDate: '2025-06-24', endAUM: 19348.68, spEnd: 6092.18 },
          { type: 'contribution', date: '2025-06-24', amounts: { Dhruv: 1100 } },
          { type: 'period', startDate: '2025-06-25', endDate: '2025-06-30', endAUM: 21236.56, spEnd: 6204.95 }
        ]
      },
      {
        label: 'Q3 2025',
        events: [
          { type: 'period', startDate: '2025-07-01', endDate: '2025-07-31', endAUM: 21167.07, spEnd: 6339.39 },
          { type: 'contribution', date: '2025-07-31', amounts: { Bhuvan: 500, Dhruv: 500 } },
          { type: 'period', startDate: '2025-08-01', endDate: '2025-09-30', endAUM: 25655.34, spEnd: 6688.46 }
        ]
      },
      {
        label: 'Q4 2025',
        events: [
          { type: 'period', startDate: '2025-10-01', endDate: '2025-12-01', endAUM: 27219.64, spEnd: 6812.63 }
        ]
      }
    ]
  };
}


// ─── Core Computation ────────────────────────────────────────────────────────
// computeFullTimeline: walks through all quarters chronologically, deriving
// every value from endAUM inputs and contribution amounts.
//
// This mirrors the workbook column-by-column computation:
//   - Period start: NAV and shares carried from prior period end (or post-contribution)
//   - Period end: NAV = endAUM / totalShares, investor capital = shares * NAV
//   - Contribution: freeze NAV, issue new shares = amount / frozenNAV

export function computeFullTimeline(state) {
  const { investors, inceptionNAV, initialShares, quarters } = state;

  // Running state across all quarters
  let currentNAV = inceptionNAV; // Workbook Q4'24 C4 = 100
  let currentSP = state.inceptionSP || null; // S&P 500 benchmark tracking
  let shares = { ...initialShares };
  let totalShares = investors.reduce((sum, inv) => sum + (shares[inv] || 0), 0);
  const inceptionOpenNAV = inceptionNAV; // For cumulative return: always 100

  const result = []; // Array of computed quarter objects

  for (let qi = 0; qi < quarters.length; qi++) {
    const quarter = quarters[qi];
    const quarterOpenNAV = currentNAV; // For QTD return calculation
    const computedEvents = [];

    for (let ei = 0; ei < quarter.events.length; ei++) {
      const event = quarter.events[ei];

      if (event.type === 'contribution') {
        // ─── Contribution Event ───────────────────────────────────────
        // Workbook pattern: freeze NAV at prior period end, issue shares
        // Example: Q1'25 E15=2500(Amit), new shares = 2500/D4 = 2500/119.043
        // Example: Q3'25 F7=500(Bhuvan), F11=500(Dhruv), frozen at E4=143.747
        const frozenNAV = currentNAV;
        const newShares = {};
        let totalNewShares = 0;

        for (const inv of investors) {
          const amount = event.amounts[inv] || 0;
          if (amount > 0) {
            const issued = amount / frozenNAV;
            newShares[inv] = issued;
            shares[inv] = (shares[inv] || 0) + issued;
            totalNewShares += issued;
          } else {
            newShares[inv] = 0;
          }
        }

        totalShares += totalNewShares;

        computedEvents.push({
          type: 'contribution',
          date: event.date,
          amounts: { ...event.amounts },
          frozenNAV,
          newShares: { ...newShares },
          totalNewShares,
          sharesAfter: { ...shares },
          totalSharesAfter: totalShares,
          aumAfter: frozenNAV * totalShares
        });

      } else if (event.type === 'period') {
        // ─── Period Start ─────────────────────────────────────────────
        // Workbook: start NAV = prior end NAV (or frozen NAV after contribution)
        // Start AUM = NAV * total shares (e.g. Q1'25 F3 = F4*F5)
        const startNAV = currentNAV;
        const startShares = { ...shares };
        const startTotalShares = totalShares;
        const startAUM = startNAV * startTotalShares;

        // ─── Period End ───────────────────────────────────────────────
        // Workbook: user inputs endAUM, then NAV = endAUM / totalShares
        // e.g. Q4'24 D4 = D3/C5, Q1'25 D4 = D3/C5
        // Shares don't change during a performance period
        const endAUM = event.endAUM;
        const endNAV = startTotalShares > 0 ? endAUM / startTotalShares : startNAV;

        // Shares unchanged during period
        const endShares = { ...startShares };
        const endTotalShares = startTotalShares;

        // Investor capital and equity
        // Workbook: capital = shares * NAV (e.g. Q4'24 C7 = C9*C4)
        // Workbook: equity = shares / total (e.g. Q4'24 C8 = C9/C5)
        const investorStart = {};
        const investorEnd = {};
        for (const inv of investors) {
          const s = startShares[inv] || 0;
          investorStart[inv] = {
            shares: s,
            capital: s * startNAV,
            equity: startTotalShares > 0 ? s / startTotalShares : 0
          };
          investorEnd[inv] = {
            shares: s,
            capital: s * endNAV,
            equity: endTotalShares > 0 ? s / endTotalShares : 0
          };
        }

        // ─── Returns ──────────────────────────────────────────────────
        // Workbook: period return = (endNAV - startNAV) / startNAV
        //   e.g. Q4'24 D19 = (D4-C4)/C4
        // QTD: (currentNAV - quarterOpenNAV) / quarterOpenNAV
        //   e.g. Q1'25 J19 = (J4-C4)/C4
        // Cumulative: (currentNAV - inceptionNAV) / inceptionNAV
        //   e.g. Q1'25 D20 = (D4-Q4'24!$C$4)/Q4'24!$C$4
        const periodReturn = startNAV > 0 ? (endNAV / startNAV - 1) : 0;
        const qtdReturn = quarterOpenNAV > 0 ? (endNAV / quarterOpenNAV - 1) : 0;
        const cumulativeReturn = inceptionOpenNAV > 0 ? (endNAV / inceptionOpenNAV - 1) : 0;

        // S&P 500 benchmark for this period
        const spStart = currentSP;
        const spEnd = event.spEnd != null ? event.spEnd : null;

        // Update running state
        currentNAV = endNAV;
        if (spEnd != null) currentSP = spEnd;

        computedEvents.push({
          type: 'period',
          startDate: event.startDate,
          endDate: event.endDate,
          startAUM,
          endAUM,
          startNAV,
          endNAV,
          startTotalShares,
          endTotalShares,
          investorStart,
          investorEnd,
          periodReturn,
          qtdReturn,
          cumulativeReturn,
          spStart,
          spEnd
        });
      }
    }

    result.push({
      label: quarter.label,
      quarterOpenNAV,
      computedEvents
    });
  }

  return result;
}


// ─── State Mutation Helpers (return new state, never mutate) ─────────────────

export function updateEndAUM(state, quarterIndex, eventIndex, newEndAUM) {
  const newState = structuredClone(state);
  const event = newState.quarters[quarterIndex].events[eventIndex];
  if (event.type === 'period') {
    event.endAUM = newEndAUM;
  }
  return newState;
}

export function addContribution(state, quarterIndex, afterEventIndex, amounts, date) {
  const newState = structuredClone(state);
  const events = newState.quarters[quarterIndex].events;
  const contribution = { type: 'contribution', date, amounts };
  events.splice(afterEventIndex + 1, 0, contribution);
  return newState;
}

export function removeContribution(state, quarterIndex, eventIndex) {
  const newState = structuredClone(state);
  newState.quarters[quarterIndex].events.splice(eventIndex, 1);
  return newState;
}

export function addPeriod(state, quarterIndex, startDate, endDate, endAUM) {
  const newState = structuredClone(state);
  newState.quarters[quarterIndex].events.push({
    type: 'period', startDate, endDate, endAUM: endAUM || 0
  });
  return newState;
}

// Close the current (last) period by setting its end date and AUM,
// then create a new "current" period starting the next day with AUM carried forward.
export function closePeriod(state, quarterIndex, closeDate, closeAUM, newStartDate) {
  const newState = structuredClone(state);
  const events = newState.quarters[quarterIndex].events;
  // Find the last period event
  let lastPeriodIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'period') { lastPeriodIdx = i; break; }
  }
  if (lastPeriodIdx === -1) return newState;

  // Close the current period
  events[lastPeriodIdx].endDate = closeDate;
  events[lastPeriodIdx].endAUM = closeAUM;

  // Add new current period starting the next day
  events.push({
    type: 'period',
    startDate: newStartDate,
    endDate: new Date().toISOString().split('T')[0],
    endAUM: closeAUM,
  });
  return newState;
}

export function removePeriod(state, quarterIndex, eventIndex) {
  const newState = structuredClone(state);
  newState.quarters[quarterIndex].events.splice(eventIndex, 1);
  return newState;
}

export function addQuarter(state, label) {
  const newState = structuredClone(state);
  newState.quarters.push({ label, events: [] });
  return newState;
}

export function removeQuarter(state, quarterIndex) {
  const newState = structuredClone(state);
  newState.quarters.splice(quarterIndex, 1);
  return newState;
}

export function updateContribution(state, quarterIndex, eventIndex, investor, amount) {
  const newState = structuredClone(state);
  const event = newState.quarters[quarterIndex].events[eventIndex];
  if (event.type === 'contribution') {
    event.amounts[investor] = amount;
  }
  return newState;
}

export function updatePeriodDates(state, quarterIndex, eventIndex, startDate, endDate) {
  const newState = structuredClone(state);
  const event = newState.quarters[quarterIndex].events[eventIndex];
  if (event.type === 'period') {
    if (startDate !== undefined) event.startDate = startDate;
    if (endDate !== undefined) event.endDate = endDate;
  }
  return newState;
}

export function updateContributionDate(state, quarterIndex, eventIndex, date) {
  const newState = structuredClone(state);
  const event = newState.quarters[quarterIndex].events[eventIndex];
  if (event.type === 'contribution') {
    event.date = date;
  }
  return newState;
}

export function addInvestor(state, name) {
  const newState = structuredClone(state);
  if (!newState.investors.includes(name)) {
    newState.investors.push(name);
    newState.initialShares[name] = 0;
  }
  return newState;
}


// ─── Validation ──────────────────────────────────────────────────────────────
// Checks the computed timeline for consistency issues.
// Matches workbook invariants:
//   - sum(investor shares) == total outstanding shares
//   - NAV * outstanding shares == AUM
//   - sum(investor capital) == AUM
//   - No negative shares
//   - Chronological dates

export function validateTimeline(computedTimeline, state) {
  const errors = [];
  const EPSILON = 0.01; // tolerance for floating point

  let prevDate = null;

  for (const quarter of computedTimeline) {
    for (const event of quarter.computedEvents) {
      if (event.type === 'period') {
        // Date ordering
        if (prevDate && event.startDate < prevDate) {
          errors.push({
            level: 'error',
            message: `Date ordering violated: ${event.startDate} is before previous date ${prevDate}`,
            quarter: quarter.label
          });
        }
        if (event.endDate < event.startDate) {
          errors.push({
            level: 'error',
            message: `End date ${event.endDate} is before start date ${event.startDate}`,
            quarter: quarter.label
          });
        }
        prevDate = event.endDate;

        // Shares sum check
        const sharesSum = Object.values(event.investorEnd).reduce((s, v) => s + v.shares, 0);
        if (Math.abs(sharesSum - event.endTotalShares) > EPSILON) {
          errors.push({
            level: 'error',
            message: `Shares mismatch: investor sum ${sharesSum.toFixed(4)} != total ${event.endTotalShares.toFixed(4)}`,
            quarter: quarter.label
          });
        }

        // NAV * shares == AUM
        const computedAUM = event.endNAV * event.endTotalShares;
        if (Math.abs(computedAUM - event.endAUM) > EPSILON) {
          errors.push({
            level: 'error',
            message: `AUM mismatch: NAV(${event.endNAV.toFixed(4)}) * shares(${event.endTotalShares.toFixed(4)}) = ${computedAUM.toFixed(2)} != ${event.endAUM.toFixed(2)}`,
            quarter: quarter.label
          });
        }

        // Capital sum == AUM
        const capitalSum = Object.values(event.investorEnd).reduce((s, v) => s + v.capital, 0);
        if (Math.abs(capitalSum - event.endAUM) > EPSILON) {
          errors.push({
            level: 'error',
            message: `Capital sum ${capitalSum.toFixed(2)} != AUM ${event.endAUM.toFixed(2)}`,
            quarter: quarter.label
          });
        }

        // Negative shares check
        for (const [inv, data] of Object.entries(event.investorEnd)) {
          if (data.shares < -EPSILON) {
            errors.push({
              level: 'error',
              message: `${inv} has negative shares: ${data.shares.toFixed(4)}`,
              quarter: quarter.label
            });
          }
        }

        // Zero outstanding shares (unless truly at zero)
        if (event.endTotalShares < EPSILON && event.endAUM > EPSILON) {
          errors.push({
            level: 'error',
            message: `Zero outstanding shares but non-zero AUM: ${event.endAUM.toFixed(2)}`,
            quarter: quarter.label
          });
        }

      } else if (event.type === 'contribution') {
        // Check no negative contributions
        for (const [inv, amount] of Object.entries(event.amounts)) {
          if (amount < 0) {
            errors.push({
              level: 'warning',
              message: `Negative contribution for ${inv}: ${amount}`,
              quarter: quarter.label
            });
          }
        }

        if (prevDate && event.date < prevDate) {
          errors.push({
            level: 'error',
            message: `Contribution date ${event.date} is before previous date ${prevDate}`,
            quarter: quarter.label
          });
        }
        prevDate = event.date;
      }
    }
  }

  return errors;
}


// ─── Investor Performance ────────────────────────────────────────────────────
// Derives per-investor metrics from the computed timeline.
// Does NOT create a separate accounting system — reads the same
// computedTimeline produced by computeFullTimeline.

// Annualized money-weighted return (XIRR). Solves for the rate r where the
// net present value of the dated cash flows is zero, using actual calendar
// time between flows so contribution TIMING — not just amount — drives the
// result. Convention: contributions are negative (cash out of pocket), the
// terminal stake value is the final positive flow.
//
// Robust bisection: with a single sign change (all contributions negative, one
// positive terminal value) the IRR is unique, and NPV is monotonic enough that
// bracketing on (-1, +∞) always converges. Returns null when the inputs can't
// yield a rate (need at least one inflow and one outflow).
export function annualizedIRR(cashflows) {
  const flows = cashflows.filter(cf => cf && isFinite(cf.amount) && cf.date);
  if (flows.length < 2) return null;
  if (!flows.some(cf => cf.amount > 0) || !flows.some(cf => cf.amount < 0)) return null;

  const MS_PER_YEAR = 365 * 24 * 3600 * 1000;
  const t0 = new Date(flows[0].date + 'T00:00:00').getTime();
  const years = flows.map(cf => (new Date(cf.date + 'T00:00:00').getTime() - t0) / MS_PER_YEAR);
  const npv = r => flows.reduce((s, cf, i) => s + cf.amount / Math.pow(1 + r, years[i]), 0);

  // Bracket: just above -100% (NPV → +∞ there since the terminal inflow has the
  // largest exponent) and a very high rate (NPV → the t=0 outflow, negative).
  let lo = -0.999999, hi = 1000;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null; // no sign change in bracket — can't solve

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (Math.abs(fmid) < 1e-9 || (hi - lo) < 1e-12) return mid;
    if (flo * fmid < 0) { hi = mid; fhi = fmid; }
    else { lo = mid; flo = fmid; }
  }
  return (lo + hi) / 2;
}

export function computeInvestorPerformance(computedTimeline, state, navSeries = null) {
  const { investors, inceptionNAV, initialShares, inceptionDate } = state;
  const EPSILON = 0.01;

  // ── Daily S&P benchmark series (optional) ───────────────────────────
  // Pass the rows from /api/fund-nav ({ date, sp500_nav }) here. Used ONLY for
  // the S&P benchmark leg of the IRR — the fund's own value comes from the (live)
  // accounting timeline, not this series. The series matters because the seed's
  // hardcoded per-period spEnd anchors only cover through 2025, so without a daily
  // sp500_nav the benchmark goes blank for current dates. (sp500_nav is rebased to
  // 100 at inception, but the IRR uses only price RATIOS, so rebasing is moot.)
  const priceSeries = Array.isArray(navSeries)
    ? navSeries
        .filter(d => d && d.date)
        .map(d => ({
          date: d.date,
          sp: d.sp500_nav != null && Number(d.sp500_nav) > 0 ? Number(d.sp500_nav) : null,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    : [];
  const useSeries = priceSeries.length > 0;
  // Latest S&P level on or before a date (handles weekends/holidays/gaps).
  const spOnOrBefore = (date) => {
    if (!date) return null;
    let val = null;
    for (const pt of priceSeries) {
      if (pt.date <= date) { if (pt.sp != null) val = pt.sp; } else break;
    }
    return val;
  };

  // ── Collect all contribution events and period events in order ──────
  const investorContributions = {};
  const allPeriods = [];

  for (const inv of investors) {
    investorContributions[inv] = [];
    const initShares = initialShares[inv] || 0;
    if (initShares > 0) {
      investorContributions[inv].push({
        date: inceptionDate,
        amount: initShares * inceptionNAV,
        nav: inceptionNAV,
        sharesIssued: initShares,
        sp: state.inceptionSP ?? null // S&P level when this money went in
      });
    }
  }

  // Track the most recent period-end S&P level so each contribution can record
  // the benchmark price it "bought in" at (a contribution freezes at the prior
  // period's end NAV, so the matching S&P level is that period's spEnd).
  let lastSpEnd = state.inceptionSP ?? null;

  for (const quarter of computedTimeline) {
    for (const event of quarter.computedEvents) {
      if (event.type === 'contribution') {
        for (const inv of investors) {
          const amount = event.amounts[inv] || 0;
          if (amount > 0) {
            investorContributions[inv].push({
              date: event.date,
              amount,
              nav: event.frozenNAV,
              sharesIssued: event.newShares[inv],
              sp: lastSpEnd
            });
          }
        }
      } else if (event.type === 'period') {
        const investorSharesAtStart = {};
        for (const inv of investors) {
          investorSharesAtStart[inv] = event.investorStart[inv]?.shares || 0;
        }
        allPeriods.push({
          startNAV: event.startNAV,
          endNAV: event.endNAV,
          spStart: event.spStart,
          spEnd: event.spEnd,
          startDate: event.startDate,
          endDate: event.endDate,
          quarterLabel: quarter.label,
          investorSharesAtStart,
          periodReturn: event.periodReturn
        });
        if (event.spEnd != null) lastSpEnd = event.spEnd;
      }
    }
  }

  const lastPeriod = allPeriods[allPeriods.length - 1];
  if (!lastPeriod) return null;

  // Fund value comes entirely from the (live) accounting timeline — the SAME
  // computedTimeline the workbook renders, whose last period carries the live
  // holdings AUM and an end date of today. So currentNAV / Current Capital here
  // match the workbook's current NAV-per-share exactly. The daily price series is
  // used ONLY for the S&P benchmark (its sp500_nav), taken at the most recent day
  // on or before the valuation date. All prior contributions stay in the
  // cash-flow stream; the fund's whole performance history is captured implicitly
  // via each contribution's share count plus this terminal value.
  const currentNAV = lastPeriod.endNAV;
  const valuationDate = lastPeriod.endDate;
  const spNow = useSeries ? spOnOrBefore(valuationDate)
    : (lastPeriod.spEnd != null ? lastPeriod.spEnd : null);

  // Get current shares from the last period event
  let currentTotalShares = 0;
  const currentShares = {};
  for (let qi = computedTimeline.length - 1; qi >= 0; qi--) {
    const events = computedTimeline[qi].computedEvents;
    for (let ei = events.length - 1; ei >= 0; ei--) {
      if (events[ei].type === 'period') {
        for (const inv of investors) {
          currentShares[inv] = events[ei].investorEnd[inv]?.shares || 0;
        }
        currentTotalShares = events[ei].endTotalShares;
        qi = -1;
        break;
      }
    }
  }

  // ── Build per-investor metrics ─────────────────────────────────────
  const investorMetrics = [];
  const validationErrors = [];

  for (const inv of investors) {
    const contribs = investorContributions[inv];
    const shares = currentShares[inv] || 0;
    const totalContributed = contribs.reduce((s, c) => s + c.amount, 0);
    const currentValue = shares * currentNAV;
    const ownership = currentTotalShares > 0 ? shares / currentTotalShares : 0;
    const avgCostNAV = shares > 0 ? totalContributed / shares : null;
    const unrealizedPL = currentValue - totalContributed;
    const unrealizedPLPct = totalContributed > 0 ? (currentValue / totalContributed - 1) : null;

    const firstDate = contribs.length > 0 ? contribs[0].date : null;
    const latestDate = contribs.length > 0 ? contribs[contribs.length - 1].date : null;
    const numContributions = contribs.length;

    // ── Contribution detail with running balances ──────────────────
    let runningShares = 0;
    let runningContributed = 0;
    const contributionDetail = contribs.map(c => {
      runningShares += c.sharesIssued;
      runningContributed += c.amount;
      return {
        date: c.date,
        amount: c.amount,
        nav: c.nav,
        sharesIssued: c.sharesIssued,
        runningShares,
        runningContributed,
        runningCurrentValue: runningShares * currentNAV
      };
    });

    // ── Money-weighted return (XIRR): personal, timing-aware ───────
    // Each contribution is a dated cash outflow; the current stake value is the
    // terminal inflow. Because the dates are real, two people who entered at
    // inception but added money at different times get DIFFERENT returns — this
    // is the "specific investor performance" a time-weighted return can't show.
    // Terminal flow is the stake value at the valuation date; spNow is the S&P
    // level on that same day, so both legs are measured to the same instant.
    const terminalDate = valuationDate;

    const cashflows = contribs.map(c => ({ date: c.date, amount: -c.amount }));
    cashflows.push({ date: terminalDate, amount: currentValue });
    const irr = annualizedIRR(cashflows);

    // S&P 500 benchmark: invest the SAME dollars on the SAME dates into the
    // index, grow each to today at the index's price ratio, then take the IRR of
    // that mirrored cash-flow stream. Apples-to-apples with the investor's IRR.
    let spTerminalValue = 0;
    let spDataComplete = spNow != null && contribs.length > 0;
    for (const c of contribs) {
      const spAtContrib = useSeries ? spOnOrBefore(c.date) : c.sp;
      if (spDataComplete && spAtContrib != null && spAtContrib > 0) {
        spTerminalValue += c.amount * (spNow / spAtContrib);
      } else {
        spDataComplete = false;
      }
    }
    let spIRR = null;
    if (spDataComplete) {
      const spCashflows = contribs.map(c => ({ date: c.date, amount: -c.amount }));
      spCashflows.push({ date: terminalDate, amount: spTerminalValue });
      spIRR = annualizedIRR(spCashflows);
    }
    const alpha = (irr != null && spIRR != null) ? irr - spIRR : null;

    // ── Per-period NAV path over the investor's active periods ─────
    // Context for the detail view: how the fund NAV moved while this investor
    // was invested. cumulativeNavGrowth is the compounded NAV change since their
    // first active period (a fund fact, not a per-dollar personal return).
    let navProduct = 1;
    const periodDetail = [];
    for (let pi = 0; pi < allPeriods.length; pi++) {
      const p = allPeriods[pi];
      const sharesAtStart = p.investorSharesAtStart[inv] || 0;
      if (sharesAtStart > EPSILON) {
        const r = p.startNAV > 0 ? (p.endNAV / p.startNAV - 1) : 0;
        navProduct *= (1 + r);
        const spReturn = (p.spStart != null && p.spEnd != null && p.spStart > 0)
          ? p.spEnd / p.spStart - 1 : null;
        periodDetail.push({
          startDate: p.startDate,
          endDate: p.endDate,
          quarterLabel: p.quarterLabel,
          startNAV: p.startNAV,
          endNAV: p.endNAV,
          periodReturn: r,
          spReturn,
          cumulativeNavGrowth: navProduct - 1,
          sharesAtStart
        });
      }
    }

    // ── Per-investor validation ────────────────────────────────────
    const engineShares = currentShares[inv] || 0;
    const computedShareSum = contribs.reduce((s, c) => s + c.sharesIssued, 0);
    if (Math.abs(engineShares - computedShareSum) > EPSILON) {
      validationErrors.push(`${inv}: share mismatch — engine=${engineShares.toFixed(6)}, computed=${computedShareSum.toFixed(6)}`);
    }
    if (shares > 0 && avgCostNAV === null) {
      validationErrors.push(`${inv}: has shares but no avg cost NAV`);
    }
    if (totalContributed <= 0 && unrealizedPLPct !== null) {
      validationErrors.push(`${inv}: unrealized P/L % exists with zero contributed capital`);
    }

    investorMetrics.push({
      name: inv, firstDate, latestDate, numContributions,
      totalContributed, shares, ownership, avgCostNAV,
      currentNAV, currentValue, unrealizedPL, unrealizedPLPct,
      irr, spIRR, alpha, spTerminalValue: spDataComplete ? spTerminalValue : null,
      valuationDate, contributionDetail, periodDetail
    });
  }

  // ── Cross-investor validation ────────────────────────────────────────
  const ownershipSum = investorMetrics.reduce((s, m) => s + m.ownership, 0);
  if (Math.abs(ownershipSum - 1) > 0.001) {
    validationErrors.push(`Ownership sum = ${(ownershipSum * 100).toFixed(4)}%, expected 100%`);
  }
  const valueSum = investorMetrics.reduce((s, m) => s + m.currentValue, 0);
  const currentAUM = currentNAV * currentTotalShares;
  if (Math.abs(valueSum - currentAUM) > EPSILON) {
    validationErrors.push(`Value sum = ${valueSum.toFixed(2)}, AUM = ${currentAUM.toFixed(2)} — mismatch`);
  }

  return { investorMetrics, validationErrors, currentNAV, currentTotalShares, currentAUM, valuationDate };
}


// ─── Summary helpers ─────────────────────────────────────────────────────────

export function getLatestMetrics(computedTimeline) {
  for (let qi = computedTimeline.length - 1; qi >= 0; qi--) {
    const events = computedTimeline[qi].computedEvents;
    for (let ei = events.length - 1; ei >= 0; ei--) {
      if (events[ei].type === 'period') {
        const p = events[ei];
        return {
          nav: p.endNAV,
          aum: p.endAUM,
          totalShares: p.endTotalShares,
          cumulativeReturn: p.cumulativeReturn,
          investorEnd: p.investorEnd
        };
      }
    }
  }
  return null;
}
