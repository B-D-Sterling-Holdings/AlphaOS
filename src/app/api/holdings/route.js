import { NextResponse } from 'next/server';
import { addHolding, removeHolding } from '@/lib/portfolio';
import { VersionConflictError } from '@/lib/concurrency';
import { conflictResponse } from '@/lib/apiResponses';

export async function POST(request) {
  try {
    const body = await request.json();
    const { ticker, shares, cost_basis, baseVersion } = body;

    if (!ticker || !shares || !cost_basis) {
      return NextResponse.json({ error: 'ticker, shares, and cost_basis are required' }, { status: 400 });
    }

    const portfolio = await addHolding(ticker, Number(shares), Number(cost_basis), baseVersion);
    return NextResponse.json({ success: true, portfolio });
  } catch (e) {
    if (e instanceof VersionConflictError) return conflictResponse(e.current);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    const portfolio = await removeHolding(ticker);
    return NextResponse.json({ success: true, portfolio });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
