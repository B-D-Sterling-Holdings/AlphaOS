import { NextResponse } from 'next/server';
import { generateTickerData } from '@/lib/generateData';

// Generation makes three Alpha Vantage calls with rate-limit pauses (~30s
// total); a deployed serverless default timeout (10s) would kill it mid-run.
export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const { ticker } = body;

    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ALPHA_VANTAGE_API_KEY not set in .env.local' }, { status: 500 });
    }

    const result = await generateTickerData(ticker, apiKey);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
