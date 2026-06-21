#!/usr/bin/env node
/**
 * Macro-regime ⇄ Supabase sync for CI (GitHub Actions).
 *
 * The backtest pipeline (FRED download + sklearn training + plots) can't run on
 * Vercel's serverless runtime, so it runs on a GitHub runner instead. This script
 * is the bridge between that runner and Supabase — the same database the deployed
 * app reads. It mirrors the logic the Next.js route uses locally
 * (src/app/api/macro-regime/run/route.js: syncConfigToYaml + syncToSupabase).
 *
 * Usage:
 *   node scripts/macro-sync.mjs pull-config
 *   node scripts/macro-sync.mjs push-results --command run --exit 0 --log outputs/run.log
 *
 * Env (set as GitHub secrets):
 *   NEXT_PUBLIC_SUPABASE_URL      Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     service-role key (writes bypass RLS)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MACRO_DIR = path.join(REPO_ROOT, 'macro_regime_allocator');
const OUTPUT_DIR = path.join(MACRO_DIR, 'outputs');
const CONFIG_YAML = path.join(MACRO_DIR, 'config.yaml');

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

// Mirror of route.js parseCSV: numbers coerced, blanks/NaN -> null, 'none' kept.
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      const v = values[i];
      if (v === undefined || v === '' || v === 'NaN' || v === 'nan') obj[h] = null;
      else if (v === 'none') obj[h] = 'none';
      else { const num = Number(v); obj[h] = isNaN(num) ? v : num; }
    });
    return obj;
  });
}

// ── pull-config: Supabase macro_regime_config -> config.yaml ─────────────────
async function pullConfig() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('macro_regime_config')
    .select('config')
    .eq('id', 1)
    .single();
  if (error || !data?.config) {
    console.log('No stored config found — leaving committed config.yaml as-is.');
    return;
  }
  const cfg = data.config;
  const lines = ['# Auto-synced from Supabase UI config before run', ''];
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'deriskOverlay') continue; // frontend-only field
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === 'boolean') lines.push(`${k}: ${v}`);
    else if (typeof v === 'number') lines.push(`${k}: ${v}`);
    else lines.push(`${k}: "${v}"`);
  }
  lines.push('');
  fs.writeFileSync(CONFIG_YAML, lines.join('\n'));
  console.log(`Wrote ${Object.keys(cfg).length} config keys to config.yaml`);
}

// Optionally override end_date in config.yaml (e.g. to "today" for fresh data).
function setEndDate(endDate) {
  if (!endDate) return;
  let text = fs.existsSync(CONFIG_YAML) ? fs.readFileSync(CONFIG_YAML, 'utf8') : '';
  if (/^end_date:.*$/m.test(text)) {
    text = text.replace(/^end_date:.*$/m, `end_date: "${endDate}"`);
  } else {
    text += `\nend_date: "${endDate}"\n`;
  }
  fs.writeFileSync(CONFIG_YAML, text);
  console.log(`Set end_date: ${endDate}`);
}

// ── push-results: outputs/ -> Supabase macro_regime_results (+ run record) ───
async function pushResults(args) {
  const supabase = getSupabase();
  const command = args.command || 'run';
  const exitCode = Number(args.exit ?? 0);
  const startedAt = args.started || new Date().toISOString();
  const completedAt = new Date().toISOString();

  let logOutput = '';
  if (args.log && fs.existsSync(args.log)) {
    logOutput = fs.readFileSync(args.log, 'utf8').slice(-10000);
  }

  // Record the run (mirrors macro_regime_runs rows the app shows in history).
  let runId = null;
  try {
    const { data } = await supabase
      .from('macro_regime_runs')
      .insert({
        run_type: command,
        status: exitCode === 0 ? 'completed' : 'failed',
        started_at: startedAt,
        completed_at: completedAt,
        log_output: logOutput,
      })
      .select('id')
      .single();
    if (data) runId = data.id;
  } catch (e) { console.error('run record:', e.message); }

  if (exitCode !== 0) {
    console.error(`Run failed (exit ${exitCode}); recorded run, skipping results insert.`);
    await pruneRuns(supabase);
    process.exitCode = exitCode;
    return;
  }

  const result = { backtest: [], metrics: [], report: null, plots: {}, validation_report: null, validation_data: {}, live_prediction: null };

  const btPath = path.join(OUTPUT_DIR, 'backtest_results.csv');
  if (fs.existsSync(btPath)) result.backtest = parseCSV(fs.readFileSync(btPath, 'utf8'));

  const metricsPath = path.join(OUTPUT_DIR, 'investment_metrics.csv');
  if (fs.existsSync(metricsPath)) result.metrics = parseCSV(fs.readFileSync(metricsPath, 'utf8'));

  const reportPath = path.join(OUTPUT_DIR, 'report.md');
  if (fs.existsSync(reportPath)) result.report = fs.readFileSync(reportPath, 'utf8');

  const plotDir = path.join(OUTPUT_DIR, 'plots');
  if (fs.existsSync(plotDir)) {
    for (const file of fs.readdirSync(plotDir).filter((f) => f.endsWith('.png'))) {
      result.plots[file] = fs.readFileSync(path.join(plotDir, file)).toString('base64');
    }
  }

  const valDir = path.join(OUTPUT_DIR, 'validation');
  if (fs.existsSync(valDir)) {
    const valReport = path.join(valDir, 'validation_report.md');
    if (fs.existsSync(valReport)) result.validation_report = fs.readFileSync(valReport, 'utf8');
    for (const f of fs.readdirSync(valDir).filter((f) => f.endsWith('.csv'))) {
      result.validation_data[f.replace('.csv', '')] = parseCSV(fs.readFileSync(path.join(valDir, f), 'utf8'));
    }
  }

  const livePredPath = path.join(OUTPUT_DIR, 'live_prediction.json');
  if (fs.existsSync(livePredPath)) result.live_prediction = JSON.parse(fs.readFileSync(livePredPath, 'utf8'));

  const { error } = await supabase.from('macro_regime_results').insert({
    run_id: runId,
    backtest: result.backtest,
    live_prediction: result.live_prediction,
    metrics: result.metrics,
    report: result.report,
    plots: result.plots,
    validation_report: result.validation_report,
    validation_data: result.validation_data,
  });
  if (error) throw new Error(`results insert: ${error.message}`);

  console.log(`Inserted results: ${result.backtest.length} backtest rows, `
    + `${Object.keys(result.plots).length} plots, `
    + `live_prediction=${result.live_prediction ? 'yes' : 'no'}`);

  await pruneResults(supabase);
  await pruneRuns(supabase);
}

async function pruneRuns(supabase) {
  try {
    const { data } = await supabase.from('macro_regime_runs')
      .select('id').order('started_at', { ascending: false }).limit(5);
    if (data && data.length === 5) {
      await supabase.from('macro_regime_runs').delete()
        .not('id', 'in', `(${data.map((r) => r.id).join(',')})`);
    }
  } catch (e) { console.error('pruneRuns:', e.message); }
}

async function pruneResults(supabase) {
  try {
    const { data } = await supabase.from('macro_regime_results')
      .select('id').order('created_at', { ascending: false }).limit(3);
    if (data && data.length === 3) {
      await supabase.from('macro_regime_results').delete()
        .not('id', 'in', `(${data.map((r) => r.id).join(',')})`);
    }
  } catch (e) { console.error('pruneResults:', e.message); }
}

// ── main ─────────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
try {
  if (cmd === 'pull-config') { await pullConfig(); setEndDate(args['end-date']); }
  else if (cmd === 'push-results') { await pushResults(args); }
  else { console.error('Usage: macro-sync.mjs <pull-config|push-results> [--flags]'); process.exit(2); }
} catch (e) {
  console.error('macro-sync error:', e.message);
  process.exit(1);
}
