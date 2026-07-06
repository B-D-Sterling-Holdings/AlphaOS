import { NextResponse } from 'next/server';
import { validateTicker } from '@/lib/yahoo';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    if (!ticker) {
      return NextResponse.json({ error: 'ticker param required' }, { status: 400 });
    }

    const result = await validateTicker(ticker);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
