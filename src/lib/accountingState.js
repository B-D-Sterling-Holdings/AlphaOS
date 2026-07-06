import { createSeedState } from './accounting.js';

export const ACCOUNTING_STORAGE_KEY = 'fund-accounting-state';

export function activeQuarterForState(state) {
  return Math.max(0, (state?.quarters?.length || 1) - 1);
}

export function backfillBenchmarkData(parsed, seed = createSeedState()) {
  const next = structuredClone(parsed);
  next.inceptionSP = seed.inceptionSP;
  for (let qi = 0; qi < next.quarters.length && qi < seed.quarters.length; qi += 1) {
    const savedEvents = next.quarters[qi].events;
    const seedEvents = seed.quarters[qi].events;
    let seedIndex = 0;
    for (let eventIndex = 0; eventIndex < savedEvents.length; eventIndex += 1) {
      if (savedEvents[eventIndex].type === 'period') {
        while (seedIndex < seedEvents.length && seedEvents[seedIndex].type !== 'period') seedIndex += 1;
        if (seedIndex < seedEvents.length) {
          savedEvents[eventIndex].spEnd = seedEvents[seedIndex].spEnd;
        }
        seedIndex += 1;
      }
    }
  }
  return next;
}

export function calculateLiveAUM(portfolio, quotesPayload) {
  const holdings = portfolio?.holdings || [];
  const cash = portfolio?.cash || 0;
  if (holdings.length === 0) return cash;

  const quotes = quotesPayload?.quotes || quotesPayload || {};
  const nav = holdings.reduce((sum, holding) => {
    const price = quotes[holding.ticker]?.price || holding.cost_basis;
    return sum + holding.shares * price;
  }, 0);
  return nav + cash;
}
