import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getValuationExpectedReturn } from '@/lib/valuationModel';

// Aggregates portfolio, thesis, research, task, and strategic note data
// into a single payload for the Strategic Hub view
export async function GET() {
  const supabase = await getDb();
  try {
    const [
      holdingsRes,
      cashRes,
      thesesRes,
      linksRes,
      tasksRes,
      notesRes,
      allocRes,
      valuationModelsRes,
    ] = await Promise.all([
      supabase.from('holdings').select('*'),
      supabase.from('portfolio_cash').select('cash').eq('id', 1).single(),
      supabase.from('theses').select('ticker, core_reasons, assumptions, valuation, underwriting, news_updates, todos, updated_at'),
      supabase.from('research_links').select('ticker, title, is_read, summary_status, created_at'),
      supabase.from('tasks').select('id, title, priority, done, status, notes, board_id, created_at'),
      supabase.from('strategic_notes').select('*'),
      supabase.from('allocation_config').select('config').eq('id', 1).single(),
      supabase.from('valuation_models').select('ticker, inputs'),
    ]);

    const holdings = holdingsRes.data || [];
    const cash = cashRes.data?.cash || 0;
    const theses = thesesRes.data || [];
    const links = linksRes.data || [];
    const tasks = tasksRes.data || [];
    const strategicNotes = notesRes.data || [];
    const allocConfig = allocRes.data?.config || {};
    const valuationModels = valuationModelsRes.data || [];

    // Build thesis map
    const thesisMap = {};
    for (const t of theses) {
      thesisMap[t.ticker] = t;
    }

    // Build links-per-ticker stats
    const linkStats = {};
    for (const l of links) {
      const tk = (l.ticker || '').toUpperCase();
      if (!tk) continue;
      if (!linkStats[tk]) linkStats[tk] = { total: 0, unread: 0, unsummarized: 0 };
      linkStats[tk].total++;
      if (!l.is_read) linkStats[tk].unread++;
      if (l.summary_status !== 'done') linkStats[tk].unsummarized++;
    }

    // Build strategic notes map
    const notesMap = {};
    for (const n of strategicNotes) {
      notesMap[n.ticker] = n;
    }

    // Allocation target weights from config
    const allocRows = allocConfig.rows || [];
    const targetWeightMap = {};
    for (const r of allocRows) {
      if (r.ticker) {
        if (r.userWeight != null) targetWeightMap[r.ticker] = Number(r.userWeight);
      }
    }

    // Valuation expected return is the Total CAGR with dividends reinvested.
    const valuationModelMap = {};
    for (const vm of valuationModels) {
      const tk = (vm.ticker || '').toUpperCase();
      if (tk) valuationModelMap[tk] = vm.inputs || null;
    }

    // Build per-holding enriched data
    const tickers = holdings.map(h => h.ticker);

    // Research completeness scoring per holding
    const enriched = holdings.map(h => {
      const tk = h.ticker;
      const thesis = thesisMap[tk] || null;
      const ls = linkStats[tk] || { total: 0, unread: 0, unsummarized: 0 };
      const note = notesMap[tk] || null;
      const valuationInputs = valuationModelMap[tk] || null;
      const valuationExpectedReturn = getValuationExpectedReturn(valuationInputs);

      // Research gaps
      const hasThesis = !!thesis;
      const hasCoreReasons = thesis?.core_reasons?.some(r => r.title && r.title.trim());
      const hasValuation = thesis?.valuation && thesis.valuation.trim();
      const hasUnderwriting = thesis?.underwriting?.revenueCAGR || thesis?.underwriting?.exitPE;
      const thesisAge = thesis?.updated_at
        ? Math.floor((Date.now() - new Date(thesis.updated_at).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const isStale = thesisAge !== null && thesisAge > 60; // stale if > 60 days

      const gaps = [];
      if (!hasThesis) gaps.push('No thesis');
      else {
        if (!hasCoreReasons) gaps.push('No core reasons');
        if (!hasValuation) gaps.push('No valuation');
        if (!hasUnderwriting) gaps.push('No underwriting');
        if (isStale) gaps.push(`Thesis stale (${thesisAge}d)`);
      }
      if (ls.total === 0) gaps.push('No research links');
      else if (ls.unread > 0) gaps.push(`${ls.unread} unread link${ls.unread > 1 ? 's' : ''}`);

      // Research completeness score (0-100)
      let completeness = 0;
      if (hasThesis) completeness += 25;
      if (hasCoreReasons) completeness += 20;
      if (hasValuation) completeness += 20;
      if (hasUnderwriting) completeness += 15;
      if (ls.total > 0) completeness += 10;
      if (ls.unread === 0 && ls.total > 0) completeness += 10;

      // Todos from thesis
      const todos = thesis?.todos || [];
      const openTodos = todos.filter(t => !t.done);

      return {
        ticker: tk,
        shares: Number(h.shares),
        costBasis: Number(h.cost_basis),
        addedAt: h.added_at,
        // Strategic note data
        sentiment: note?.sentiment || 'neutral',
        conviction: note?.conviction ?? 3,
        action: note?.action || 'hold',
        actionReason: note?.action_reason || '',
        strategicNotes: note?.notes || '',
        alternatives: note?.alternatives || '',
        targetWeight: note?.target_weight ?? targetWeightMap[tk] ?? null,
        expectedReturn: valuationExpectedReturn == null ? null : valuationExpectedReturn * 100,
        valuationInputs,
        attentionPriority: note?.priority || 'normal',
        sortOrder: note?.sort_order ?? 0,
        // Research gaps
        gaps,
        completeness,
        thesisAge,
        isStale,
        linkStats: ls,
        openTodos: openTodos.length,
        // News count
        newsCount: (thesis?.news_updates || []).length,
      };
    });

    // Open tasks (not done)
    const openTasks = tasks.filter(t => !t.done);
    const highTasks = openTasks.filter(t => t.priority === 'highest' || t.priority === 'high');

    return NextResponse.json({
      holdings: enriched,
      cash: Number(cash),
      tickerCount: tickers.length,
      openTaskCount: openTasks.length,
      highTaskCount: highTasks.length,
      totalLinks: links.length,
      unreadLinks: links.filter(l => !l.is_read).length,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
