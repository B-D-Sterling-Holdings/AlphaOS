import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';

const PRISM_DIR = path.resolve(process.cwd(), 'prism_ai');
const STATUS_FILE = '/tmp/prism-run-status.json';
const LOG_FILE = '/tmp/prism-run-output.log';

// `make` targets the Pipeline tab is allowed to run.
const VALID_COMMANDS = ['install', 'generate-data', 'plot', 'analyze', 'analyze-all', 'list', 'info'];

function loadEnvFile() {
  const env = {};
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env.local'),
      path.join(PRISM_DIR, '.env'),
    ];
    for (const envPath of candidates) {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
        if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      });
    }
  } catch {
    // Read-only filesystem in prod: env comes from process.env instead.
  }
  return env;
}

async function updateRunRecord(runId, fields) {
  if (!runId) return;
  const supabase = await getDb();
  try {
    await supabase.from('prism_runs').update(fields).eq('id', runId);
  } catch {}
}

async function pruneRuns() {
  const supabase = await getDb();
  try {
    const { data: recent } = await supabase
      .from('prism_runs')
      .select('id')
      .order('started_at', { ascending: false })
      .limit(10);
    if (recent && recent.length === 10) {
      const keepIds = recent.map((r) => r.id);
      await supabase.from('prism_runs').delete().not('id', 'in', `(${keepIds.join(',')})`);
    }
  } catch {}
}

// Read the JSON analyses on disk and upsert them into prism_recommendations so
// the Signal History tab reflects every completed analysis. Keyed by source_file
// (idempotent), so re-running is safe and also backfills the seeded samples.
// POST - start a pipeline command
export async function POST(req) {
  const supabase = await getDb();
  // Demo sessions are read-only: running the pipeline spawns heavy Python
  // processes (Ollama inference, data fetches). Demo reads seeded history only.
  if (supabase.isDemo) {
    return NextResponse.json(
      { error: 'Running the analysis pipeline is disabled in demo mode.' },
      { status: 403 }
    );
  }

  try {
    const { command, ticker, mode } = await req.json();
    if (!VALID_COMMANDS.includes(command)) {
      return NextResponse.json({ error: `Invalid command: ${command}` }, { status: 400 });
    }

    const needsTicker = ['generate-data', 'plot', 'info'].includes(command);
    const cleanTicker = (ticker || '').trim().toUpperCase();
    if (command === 'analyze' && !cleanTicker) {
      return NextResponse.json({ error: 'A ticker is required for analyze.' }, { status: 400 });
    }
    if (needsTicker && !cleanTicker) {
      return NextResponse.json({ error: `A ticker is required for ${command}.` }, { status: 400 });
    }

    // Reject if a run is already in progress.
    if (fs.existsSync(STATUS_FILE)) {
      try {
        const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        if (status.running && status.pid) {
          try {
            process.kill(status.pid, 0);
            return NextResponse.json({ error: 'A run is already in progress', status: 'running' }, { status: 409 });
          } catch {
            // stale pid, fall through
          }
        }
      } catch { /* corrupted status, proceed */ }
    }

    const fileEnv = loadEnvFile();
    const startedAt = new Date().toISOString();

    fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: true, command, ticker: cleanTicker, startedAt, pid: null }));
    fs.writeFileSync(LOG_FILE, `[${startedAt}] Starting: make ${command}${cleanTicker ? ` TICKER=${cleanTicker}` : ''}\n`);

    // Record the run.
    let runId = null;
    try {
      const { data } = await supabase
        .from('prism_runs')
        .insert({ run_type: command, ticker: cleanTicker || null, status: 'running', started_at: startedAt })
        .select('id')
        .single();
      if (data) runId = data.id;
    } catch { /* Supabase optional */ }

    // Build env for the make process: forward OLLAMA_* / ALPHA_VANTAGE plus the
    // command args the Makefile reads (TICKER, ANALYSIS_MODE).
    const childEnv = { ...process.env, ...fileEnv };
    if (cleanTicker) childEnv.TICKER = cleanTicker;
    if (command === 'analyze' && mode) childEnv.ANALYSIS_MODE = mode;

    const proc = spawn('make', [command], {
      cwd: PRISM_DIR,
      shell: '/bin/bash',
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    fs.writeFileSync(STATUS_FILE, JSON.stringify({ running: true, command, ticker: cleanTicker, startedAt, pid: proc.pid }));

    proc.stdout.on('data', (d) => fs.appendFileSync(LOG_FILE, d.toString()));
    proc.stderr.on('data', (d) => fs.appendFileSync(LOG_FILE, d.toString()));

    proc.on('close', async (code) => {
      const completedAt = new Date().toISOString();
      fs.writeFileSync(STATUS_FILE, JSON.stringify({
        running: false, command, ticker: cleanTicker, startedAt, completedAt, exitCode: code, pid: proc.pid,
      }));
      fs.appendFileSync(LOG_FILE, `\n[${completedAt}] Finished with exit code ${code}\n`);

      const log = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
      await updateRunRecord(runId, {
        status: code === 0 ? 'completed' : 'failed',
        completed_at: completedAt,
        exit_code: code,
        log_output: log.slice(-10000),
      });

      // Recommendations are written directly to Supabase by the Python pipeline
      // (see _save_result); no disk-sync step is needed here.
      await pruneRuns();
    });

    return NextResponse.json({ status: 'started', command, ticker: cleanTicker, pid: proc.pid });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET - poll status + recent run history (or one run's log via ?history=<id>)
export async function GET(req) {
  const supabase = await getDb();
  try {
    const { searchParams } = new URL(req.url);
    const historyId = searchParams.get('history');

    if (historyId) {
      const { data } = await supabase
        .from('prism_runs')
        .select('id, run_type, ticker, status, started_at, completed_at, log_output')
        .eq('id', historyId)
        .single();
      return NextResponse.json({ run: data || null });
    }

    const status = fs.existsSync(STATUS_FILE)
      ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
      : { running: false };
    const log = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';

    let history = [];
    try {
      const { data } = await supabase
        .from('prism_runs')
        .select('id, run_type, ticker, status, started_at, completed_at')
        .order('started_at', { ascending: false })
        .limit(5);
      if (data) history = data;
    } catch { /* ignore */ }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    return NextResponse.json({ ...status, log, history, model });
  } catch (err) {
    return NextResponse.json({ running: false, log: '', history: [], error: err.message });
  }
}

// DELETE - cancel the running command
export async function DELETE() {
  const supabase = await getDb();
  if (supabase.isDemo) {
    return NextResponse.json({ error: 'Disabled in demo mode.' }, { status: 403 });
  }
  try {
    if (!fs.existsSync(STATUS_FILE)) return NextResponse.json({ cancelled: false });
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (status.running && status.pid) {
      try {
        process.kill(status.pid, 'SIGKILL');
      } catch { /* already gone */ }
      const completedAt = new Date().toISOString();
      fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...status, running: false, completedAt, exitCode: -1 }));
      fs.appendFileSync(LOG_FILE, `\n[${completedAt}] Cancelled by user\n`);
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ cancelled: false });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
