import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';

const PRISM_DIR = path.resolve(process.cwd(), 'prism_ai');

// One Gemini call over a compact payload — fast, but keep headroom.
const TIMEOUT_MS = 120_000;

// Same .env discovery the pipeline runner uses, so GEMINI_API_KEY is available
// to the Python process in dev.
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

// Spawn the Python command and pipe the TTM payload to it on stdin.
function runPython(payload, childEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'uv',
      ['run', 'python', '-m', 'src.main', 'thesis-fundamentals'],
      { cwd: PRISM_DIR, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Thesis fundamentals generation timed out'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

export async function POST(req) {
  const supabase = await getDb();
  if (supabase.isDemo) {
    return NextResponse.json(
      { error: 'Generating thesis fundamentals is disabled in demo mode.' },
      { status: 403 }
    );
  }

  try {
    const { ticker, fundamentals } = await req.json();
    const cleanTicker = (ticker || '').trim().toUpperCase();
    if (!cleanTicker) {
      return NextResponse.json({ error: 'A ticker is required.' }, { status: 400 });
    }
    if (!fundamentals || typeof fundamentals !== 'object') {
      return NextResponse.json(
        { error: 'No fundamentals data provided. Generate data for this ticker first.' },
        { status: 400 }
      );
    }

    // Forward the tenant so the prism pipeline isolates its Supabase reads/writes.
    const childEnv = { ...process.env, ...loadEnvFile(), APP_TENANT_ID: supabase.tenantId };
    const { code, stdout, stderr } = await runPython(
      { ticker: cleanTicker, fundamentals },
      childEnv
    );

    const begin = stdout.indexOf('===PRISM_THESIS_BEGIN===');
    const end = stdout.indexOf('===PRISM_THESIS_END===');
    if (begin === -1 || end === -1) {
      const detail = (stderr || stdout).slice(-500).trim();
      return NextResponse.json(
        { error: `Generation failed${detail ? `: ${detail}` : ''}` },
        { status: 500 }
      );
    }

    const jsonStr = stdout.slice(begin + '===PRISM_THESIS_BEGIN==='.length, end).trim();
    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Could not parse generation output.' }, { status: 500 });
    }

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
    if (code !== 0) {
      return NextResponse.json({ error: 'Generation exited with an error.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      ticker: data.ticker,
      model: data.model,
      boxes: data.boxes,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
