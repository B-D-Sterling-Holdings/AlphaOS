import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { readSetting } from '@/lib/appSettings';
import { uploadMacroPlotForTenant, deleteTenantMacroPlots } from '@/lib/storage';
import { getLatestResultSignal } from '@/lib/macroRegimeSignal';

const MACRO_DIR = path.resolve(process.cwd(), 'macro_regime_allocator');
const OUTPUT_DIR = path.join(MACRO_DIR, 'outputs');
// The status file is GLOBAL on purpose — the pipeline shares one outputs dir
// and one config.yaml, so only one run may execute at a time across tenants.
// It records which tenant owns the run so another tenant's GET never sees the
// owner's command/log details. Logs are per-tenant files.
const STATUS_FILE = '/tmp/macro-regime-run-status.json';
const logFileFor = (tenantId) => `/tmp/macro-regime-run-output-${tenantId}.log`;

const CONFIG_YAML = path.join(MACRO_DIR, 'config.yaml');
const VALID_COMMANDS = ['run', 'predict', 'fast', 'validate', 'clean'];

/** Sync Supabase config → config.yaml so the Python process uses the UI values. */
async function syncConfigToYaml() {
  const supabase = await getDb();
  try {
    const cfg = await readSetting(supabase, 'macro_regime_config', null);
    if (!cfg) return;
    // Build YAML manually to keep it readable (no js-yaml dependency)
    const lines = [
      '# Auto-synced from UI config before run',
      '',
    ];
    for (const [k, v] of Object.entries(cfg)) {
      if (k === 'deriskOverlay') continue; // frontend-only field
      // Keys and values come from a user-editable JSON blob; never let either
      // break out of its YAML scalar (quote/newline smuggling into new keys).
      if (!/^[A-Za-z0-9_-]+$/.test(k)) continue;
      if (v === null) lines.push(`${k}: null`);
      else if (typeof v === 'boolean') lines.push(`${k}: ${v}`);
      else if (typeof v === 'number' && Number.isFinite(v)) lines.push(`${k}: ${v}`);
      else lines.push(`${k}: ${JSON.stringify(String(v))}`); // JSON strings are valid YAML
    }
    lines.push('');
    fs.writeFileSync(CONFIG_YAML, lines.join('\n'));
  } catch (err) {
    console.error('syncConfigToYaml:', err.message);
  }
}

function loadEnvFile() {
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env.local'),
      path.join(MACRO_DIR, '.env.local'),
    ];
    const env = {};
    for (const envPath of candidates) {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
        if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      });
    }
    return env;
  } catch {
    // In production (read-only filesystem), env vars come from process.env
    return {};
  }
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      const v = values[i];
      if (v === undefined || v === '' || v === 'NaN' || v === 'nan') {
        obj[h] = null;
      } else if (v === 'none') {
        obj[h] = 'none';
      } else {
        const num = Number(v);
        obj[h] = isNaN(num) ? v : num;
      }
    });
    return obj;
  });
}

async function syncToSupabase(runId) {
  const supabase = await getDb();
  try {
    const result = { backtest: [], metrics: [], report: null, plots: {}, validation_report: null, validation_data: {} };

    // Parse backtest CSV
    const btPath = path.join(OUTPUT_DIR, 'backtest_results.csv');
    if (fs.existsSync(btPath)) {
      result.backtest = parseCSV(fs.readFileSync(btPath, 'utf8'));
    }

    // Parse metrics CSV
    const metricsPath = path.join(OUTPUT_DIR, 'investment_metrics.csv');
    if (fs.existsSync(metricsPath)) {
      result.metrics = parseCSV(fs.readFileSync(metricsPath, 'utf8'));
    }

    // Read report
    const reportPath = path.join(OUTPUT_DIR, 'report.md');
    if (fs.existsSync(reportPath)) {
      result.report = fs.readFileSync(reportPath, 'utf8');
    }

    // Upload plots to the private macro-plots bucket; store paths (not bytes).
    const plotDir = path.join(OUTPUT_DIR, 'plots');
    if (fs.existsSync(plotDir)) {
      const pngFiles = fs.readdirSync(plotDir).filter((f) => f.endsWith('.png'));
      for (const file of pngFiles) {
        const buf = fs.readFileSync(path.join(plotDir, file));
        result.plots[file] = await uploadMacroPlotForTenant({
          tenantId: supabase.tenantId, runId, filename: file, buffer: buf,
        });
      }
    }

    // Read validation report + CSVs
    const valDir = path.join(OUTPUT_DIR, 'validation');
    if (fs.existsSync(valDir)) {
      const valReport = path.join(valDir, 'validation_report.md');
      if (fs.existsSync(valReport)) {
        result.validation_report = fs.readFileSync(valReport, 'utf8');
      }
      for (const f of fs.readdirSync(valDir).filter((f) => f.endsWith('.csv'))) {
        result.validation_data[f.replace('.csv', '')] = parseCSV(fs.readFileSync(path.join(valDir, f), 'utf8'));
      }
    }

    // Read live prediction from final model (different from last backtest row)
    const livePredPath = path.join(OUTPUT_DIR, 'live_prediction.json');
    if (fs.existsSync(livePredPath)) {
      result.live_prediction = JSON.parse(fs.readFileSync(livePredPath, 'utf8'));
    }

    // Insert into Supabase
    await supabase.from('macro_regime_results').insert({
      run_id: runId,
      backtest: result.backtest,
      live_prediction: result.live_prediction || null,
      metrics: result.metrics,
      report: result.report,
      plots: result.plots,
      validation_report: result.validation_report,
      validation_data: result.validation_data,
    });

    // Clean up local files now that they're in Supabase
    try {
      const plotDir = path.join(OUTPUT_DIR, 'plots');
      if (fs.existsSync(plotDir)) {
        for (const f of fs.readdirSync(plotDir)) fs.unlinkSync(path.join(plotDir, f));
      }
      for (const f of ['backtest_results.csv', 'investment_metrics.csv', 'report.md', 'live_prediction.json']) {
        const fp = path.join(OUTPUT_DIR, f);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
      // Clean up validation folder
      const valDir = path.join(OUTPUT_DIR, 'validation');
      if (fs.existsSync(valDir)) {
        for (const f of fs.readdirSync(valDir)) fs.unlinkSync(path.join(valDir, f));
      }
      // Also clean up the data folder (cached downloads, features, model)
      const dataDir = path.join(MACRO_DIR, 'data');
      if (fs.existsSync(dataDir)) {
        for (const f of fs.readdirSync(dataDir)) {
          const fp = path.join(dataDir, f);
          if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
        }
      }
    } catch { /* cleanup is best-effort */ }
  } catch (err) {
    console.error('syncToSupabase error:', err.message);
  }
}

async function updateRunRecord(runId, fields) {
  const supabase = await getDb();
  if (!runId) return;
  try {
    await supabase.from('macro_regime_runs').update(fields).eq('id', runId);
  } catch {}
}

async function pruneRuns() {
  const supabase = await getDb();
  try {
    const { data: recent } = await supabase
      .from('macro_regime_runs')
      .select('id')
      .order('started_at', { ascending: false })
      .limit(5);
    if (recent && recent.length === 5) {
      const keepIds = recent.map((r) => r.id);
      await supabase.from('macro_regime_runs').delete().not('id', 'in', `(${keepIds.join(',')})`);
    }
  } catch {}
}

async function pruneResults() {
  const supabase = await getDb();
  try {
    const { data: all } = await supabase
      .from('macro_regime_results')
      .select('id, run_id')
      .order('created_at', { ascending: false });
    if (!all || all.length <= 3) return;
    const keepIds = all.slice(0, 3).map((r) => r.id);
    const dropped = all.slice(3);
    await supabase.from('macro_regime_results').delete().not('id', 'in', `(${keepIds.join(',')})`);
    // Purge the plot folders that belonged to the dropped result rows so the
    // macro-plots bucket doesn't accumulate orphans.
    for (const r of dropped) {
      if (r.run_id) {
        try { await deleteTenantMacroPlots(supabase.tenantId, r.run_id); } catch {}
      }
    }
  } catch {}
}

// POST - start a run
export async function POST(req) {
  const supabase = await getDb();
  try {
    const { command } = await req.json();
    if (!VALID_COMMANDS.includes(command)) {
      return NextResponse.json({ error: `Invalid command: ${command}` }, { status: 400 });
    }

    // Vercel's serverless runtime can't spawn the Python pipeline (no make/uv/
    // python, read-only FS, short timeouts — hence `make: command not found` /
    // exit 127). Instead, trigger the GitHub Actions workflow that runs it on a
    // real runner and syncs results back to Supabase. `predict` only reads
    // Supabase, so it works here and never reaches this branch.
    if (command !== 'predict' && (process.env.VERCEL || process.env.MACRO_RUN_DISABLED === '1')) {
      const dispatchable = ['run', 'fast', 'validate'];
      const token = process.env.GH_DISPATCH_TOKEN;
      const repo = process.env.GH_DISPATCH_REPO; // "owner/repo"
      if (token && repo && dispatchable.includes(command)) {
        const workflow = process.env.GH_DISPATCH_WORKFLOW || 'macro-regime.yml';
        const ref = process.env.GH_DISPATCH_REF || 'main';
        try {
          const ghRes = await fetch(
            `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ ref, inputs: { command, tenant_id: supabase.tenantId } }),
            },
          );
          if (ghRes.status === 204) {
            return NextResponse.json({ status: 'dispatched', command, via: 'github-actions' });
          }
          const detail = await ghRes.text();
          return NextResponse.json(
            { error: `GitHub Actions dispatch failed (${ghRes.status}): ${detail.slice(0, 300)}` },
            { status: 502 },
          );
        } catch (e) {
          return NextResponse.json({ error: `GitHub Actions dispatch error: ${e.message}` }, { status: 502 });
        }
      }
      return NextResponse.json({
        error: 'Model runs can’t execute on this deployment (no Python runtime). Set GH_DISPATCH_TOKEN + GH_DISPATCH_REPO to trigger the GitHub Actions backtest, or run locally — results sync to Supabase and appear here. "Predict" works on this deployment.',
      }, { status: 501 });
    }

    // Check if already running
    if (fs.existsSync(STATUS_FILE)) {
      try {
        const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        if (status.running) {
          try {
            process.kill(status.pid, 0);
            return NextResponse.json({ error: 'A run is already in progress', status: 'running' }, { status: 409 });
          } catch {
            // Process is dead, clean up stale status
          }
        }
      } catch { /* corrupted file, proceed */ }
    }

    const fileEnv = loadEnvFile();
    const startedAt = new Date().toISOString();
    const LOG_FILE = logFileFor(supabase.tenantId);

    // Write initial status (stamped with the owning tenant)
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: true, command, startedAt, pid: null, tenantId: supabase.tenantId }));
    fs.writeFileSync(LOG_FILE, `[${startedAt}] Starting: make ${command}\n`);

    // Record run in Supabase
    let runId = null;
    try {
      const { data } = await supabase
        .from('macro_regime_runs')
        .insert({ run_type: command, status: 'running', started_at: startedAt })
        .select('id')
        .single();
      if (data) runId = data.id;
    } catch { /* Supabase not configured, continue without */ }

    if (command === 'predict') {
      const completedAt = new Date().toISOString();
      let exitCode = 0;

      try {
        const derived = await getLatestResultSignal(supabase);

        if (!derived?.signal) {
          exitCode = 1;
          fs.appendFileSync(LOG_FILE, 'No backtest data found in Supabase. Run a full backtest first.\n');
        } else {
          fs.appendFileSync(LOG_FILE, 'Loaded latest prediction inputs from Supabase.\n');
          fs.appendFileSync(LOG_FILE, `${derived.raw_output}\n`);
        }
      } catch (err) {
        exitCode = 1;
        fs.appendFileSync(LOG_FILE, `${err.message}\n`);
      }

      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        running: false, command, startedAt, completedAt, exitCode, pid: null, tenantId: supabase.tenantId,
      }));
      fs.appendFileSync(LOG_FILE, `\n[${completedAt}] Finished with exit code ${exitCode}\n`);

      const log = fs.readFileSync(LOG_FILE, 'utf8');
      await updateRunRecord(runId, {
        status: exitCode === 0 ? 'completed' : 'failed',
        completed_at: completedAt,
        log_output: log.slice(-10000),
      });
      await pruneRuns();

      return NextResponse.json({ status: 'started', command, pid: null });
    }

    // Sync UI config to config.yaml before running
    await syncConfigToYaml();

    const proc = spawn('make', [command], {
      cwd: MACRO_DIR,
      shell: '/bin/bash',
      env: { ...process.env, ...fileEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Update status with PID
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: true, command, startedAt, pid: proc.pid, tenantId: supabase.tenantId }));

    proc.stdout.on('data', (data) => {
      fs.appendFileSync(LOG_FILE, data.toString());
    });
    proc.stderr.on('data', (data) => {
      fs.appendFileSync(LOG_FILE, data.toString());
    });

    proc.on('close', async (code) => {
      const completedAt = new Date().toISOString();
      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        running: false, command, startedAt, completedAt, exitCode: code, pid: proc.pid, tenantId: supabase.tenantId,
      }));
      fs.appendFileSync(LOG_FILE, `\n[${completedAt}] Finished with exit code ${code}\n`);

      // Update Supabase run record
      if (runId) {
        const log = fs.readFileSync(LOG_FILE, 'utf8');
        await updateRunRecord(runId, {
          status: code === 0 ? 'completed' : 'failed',
          completed_at: completedAt,
          log_output: log.slice(-10000),
        });
      }

      // Sync results to Supabase after successful run
      if (code === 0 && ['run', 'fast', 'validate'].includes(command)) {
        await syncToSupabase(runId);
      }

      await pruneRuns();
      await pruneResults();
    });

    return NextResponse.json({ status: 'started', command, pid: proc.pid });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET - check run status + run history
export async function GET(req) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(req.url);
    const historyMode = searchParams.get('history');

    // If requesting a specific run's log
    if (historyMode) {
      const { data } = await supabase
        .from('macro_regime_runs')
        .select('id, run_type, status, started_at, completed_at, log_output')
        .eq('id', historyMode)
        .single();
      return NextResponse.json({ run: data || null });
    }

    const LOG_FILE = logFileFor(supabase.tenantId);

    let status = fs.existsSync(STATUS_FILE)
      ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
      : { running: false };

    // Another tenant's run: expose only that the runner is busy — never its
    // command, timing, pid or (below) its log. A pre-multitenancy status file
    // has no tenantId; treat it as belonging to the caller.
    if (status.tenantId && status.tenantId !== supabase.tenantId) {
      status = { running: !!status.running, foreign: true };
    }

    // Guard against a stale "running" flag left behind by an interrupted run
    // (server restart / redeploy / crash). Without this, the recorded PID is
    // dead but the UI keeps every run button disabled forever. POST already
    // does this liveness check; GET must too so the buttons recover on reload.
    if (status.running && status.pid) {
      let alive = false;
      try { process.kill(status.pid, 0); alive = true; } catch { alive = false; }
      if (!alive) {
        status = { ...status, running: false, exitCode: status.exitCode ?? -1, stale: true };
        try { fs.writeFileSync(STATUS_FILE, JSON.stringify(status)); } catch { /* read-only fs in prod */ }
      }
    }

    const log = fs.existsSync(LOG_FILE)
      ? fs.readFileSync(LOG_FILE, 'utf8')
      : '';

    // Fetch last 5 runs from Supabase
    let history = [];
    try {
      const { data } = await supabase
        .from('macro_regime_runs')
        .select('id, run_type, status, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(5);
      if (data) history = data;
    } catch { /* ignore */ }

    return NextResponse.json({ ...status, log, history });
  } catch (err) {
    return NextResponse.json({ running: false, log: '', history: [], error: err.message });
  }
}
