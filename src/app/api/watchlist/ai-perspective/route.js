import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';
import { fetchFundamentals } from '@/lib/yahoo';

const PRISM_DIR = path.resolve(process.cwd(), 'prism_ai');

// One Gemini call over a compact triage payload — fast, but keep headroom.
const TIMEOUT_MS = 120_000;

// Same .env discovery the pipeline runner uses, so GEMINI_API_KEY (and
// GEMINI_MODEL) are available to the Python process in dev.
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

// Spawn the Python command and pipe the triage payload to it on stdin.
function runPython(payload, childEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'uv',
      ['run', 'python', '-m', 'src.main', 'watchlist-perspective'],
      { cwd: PRISM_DIR, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('AI perspective generation timed out'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

// Derive a compact price-dislocation context from the quote the client holds.
function buildPriceChanges(quote = {}) {
  const out = {};
  if (quote.price != null && quote.fiftyTwoWeekHigh) {
    out.pctFrom52WeekHigh = ((quote.price - quote.fiftyTwoWeekHigh) / quote.fiftyTwoWeekHigh) * 100;
  }
  if (quote.price != null && quote.fiftyTwoWeekLow) {
    out.pctAbove52WeekLow = ((quote.price - quote.fiftyTwoWeekLow) / quote.fiftyTwoWeekLow) * 100;
  }
  if (quote.dayChangePct != null) out.dayChangePct = quote.dayChangePct;
  return out;
}

export async function POST(req) {
  const supabase = await getDb();
  if (supabase.isDemo) {
    return NextResponse.json(
      { error: 'AI perspective is disabled in demo mode.' },
      { status: 403 }
    );
  }

  try {
    const { ticker, quote, note, analystResearch } = await req.json();
    const cleanTicker = (ticker || '').trim().toUpperCase();
    if (!cleanTicker) {
      return NextResponse.json({ error: 'A ticker is required.' }, { status: 400 });
    }

    // Enrich server-side with valuation multiples + sector (same source the
    // research tab uses), so the triage has more than just the live quote.
    let valuation = {};
    try {
      const fundamentals = await fetchFundamentals([cleanTicker]);
      valuation = fundamentals?.[cleanTicker] || {};
    } catch {
      // Non-fatal: the model can still triage on quote + price action alone.
    }

    const childEnv = { ...process.env, ...loadEnvFile() };
    const { code, stdout, stderr } = await runPython(
      {
        ticker: cleanTicker,
        quote: quote || {},
        fundamentals: valuation,
        priceChanges: buildPriceChanges(quote),
        note: note || '',
        analystResearch: analystResearch || {},
      },
      childEnv
    );

    const begin = stdout.indexOf('===PRISM_PERSPECTIVE_BEGIN===');
    const end = stdout.indexOf('===PRISM_PERSPECTIVE_END===');
    if (begin === -1 || end === -1) {
      const detail = (stderr || stdout).slice(-500).trim();
      return NextResponse.json(
        { error: `Generation failed${detail ? `: ${detail}` : ''}` },
        { status: 500 }
      );
    }

    const jsonStr = stdout
      .slice(begin + '===PRISM_PERSPECTIVE_BEGIN==='.length, end)
      .trim();
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
      perspective: data.perspective,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
