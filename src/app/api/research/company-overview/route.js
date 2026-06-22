import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/lib/db';

const PRISM_DIR = path.resolve(process.cwd(), 'prism_ai');

// Filings fetch + a Gemini call can take a while; give it generous headroom.
const TIMEOUT_MS = 180_000;

// Same .env discovery the pipeline runner uses, so GEMINI_API_KEY (and an
// optional SEC_USER_AGENT) are available to the Python process in dev.
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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Render the model's structured overview into the rich-text HTML the Company
// Overview editor stores. Only sections with content are emitted.
function overviewToHtml(data) {
  const { overview = {}, sources = {} } = data;
  const parts = [];
  const heading = (t) => `<b>${escapeHtml(t)}</b><br>`;
  const para = (t) => `${escapeHtml(t).replace(/\n+/g, '<br>')}<br><br>`;

  if (overview.business_summary) {
    parts.push(heading('Business Summary'));
    parts.push(para(overview.business_summary));
  }

  if (Array.isArray(overview.segments) && overview.segments.length) {
    parts.push(heading('Business Segments'));
    overview.segments.forEach((s) => {
      if (!s?.name && !s?.description) return;
      const mix = s.revenue_mix ? ` <i>(${escapeHtml(s.revenue_mix)})</i>` : '';
      const desc = s.description ? ` — ${escapeHtml(s.description)}` : '';
      parts.push(`• <b>${escapeHtml(s.name || '')}</b>${desc}${mix}<br>`);
    });
    parts.push('<br>');
  }

  const section = (label, value) => {
    if (!value) return;
    parts.push(heading(label));
    parts.push(para(value));
  };
  section('Products & Services', overview.products_services);
  section('Customers & End Markets', overview.customers_end_markets);
  section('Revenue Model', overview.revenue_model);
  section('Competitive Positioning', overview.competitive_positioning);

  if (Array.isArray(overview.key_business_drivers) && overview.key_business_drivers.length) {
    parts.push(heading('Key Business Drivers'));
    overview.key_business_drivers.forEach((d) => {
      if (d) parts.push(`• ${escapeHtml(d)}<br>`);
    });
    parts.push('<br>');
  }

  section('Recent Updates (latest 10-Q)', overview.recent_updates_10q);

  // Citations — prefer authoritative filing metadata, with links.
  const citations = [];
  if (sources.tenk) {
    citations.push(
      `10-K (filed ${escapeHtml(sources.tenk.filing_date)}) — Item 1. Business` +
      (sources.tenk.url ? ` <a href="${escapeHtml(sources.tenk.url)}" target="_blank" rel="noopener">[source]</a>` : '')
    );
  }
  if (sources.tenq) {
    citations.push(
      `10-Q (filed ${escapeHtml(sources.tenq.filing_date)}) — Item 2. MD&A` +
      (sources.tenq.url ? ` <a href="${escapeHtml(sources.tenq.url)}" target="_blank" rel="noopener">[source]</a>` : '')
    );
  }
  if (citations.length) {
    parts.push(heading('Sources'));
    citations.forEach((c) => parts.push(`• ${c}<br>`));
  }

  return parts.join('\n').trim();
}

function runPython(ticker, childEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'uv',
      ['run', 'python', '-m', 'src.main', 'company-overview', '--ticker', ticker],
      { cwd: PRISM_DIR, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Company overview generation timed out'));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function POST(req) {
  const supabase = await getDb();
  // Generating an overview spawns a Python process and calls the LLM — disabled
  // for read-only demo sessions, matching the analysis pipeline.
  if (supabase.isDemo) {
    return NextResponse.json(
      { error: 'Generating a company overview is disabled in demo mode.' },
      { status: 403 }
    );
  }

  try {
    const { ticker } = await req.json();
    const cleanTicker = (ticker || '').trim().toUpperCase();
    if (!cleanTicker) {
      return NextResponse.json({ error: 'A ticker is required.' }, { status: 400 });
    }

    // Forward the tenant so the prism pipeline (supabase_store.py) stamps and
    // filters every Supabase row by it — no cross-tenant reads/writes.
    const childEnv = { ...process.env, ...loadEnvFile(), APP_TENANT_ID: supabase.tenantId };
    const { code, stdout, stderr } = await runPython(cleanTicker, childEnv);

    // Pull the JSON payload from between the sentinels the command prints.
    const begin = stdout.indexOf('===PRISM_OVERVIEW_BEGIN===');
    const end = stdout.indexOf('===PRISM_OVERVIEW_END===');
    if (begin === -1 || end === -1) {
      const detail = (stderr || stdout).slice(-500).trim();
      return NextResponse.json(
        { error: `Overview generation failed${detail ? `: ${detail}` : ''}` },
        { status: 500 }
      );
    }

    const jsonStr = stdout.slice(begin + '===PRISM_OVERVIEW_BEGIN==='.length, end).trim();
    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Could not parse overview output.' }, { status: 500 });
    }

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
    if (code !== 0) {
      return NextResponse.json({ error: 'Overview generation exited with an error.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      ticker: data.ticker,
      companyName: data.company_name,
      model: data.model,
      overview: data.overview,
      sources: data.sources,
      html: overviewToHtml(data),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
