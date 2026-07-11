import { NextResponse } from 'next/server';
import { loadWatchlist, saveWatchlist } from '@/lib/watchlist';
import { VersionConflictError } from '@/lib/concurrency';

export async function GET() {
  try {
    const data = await loadWatchlist();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await saveWatchlist(body);
    // Hand back the freshly-bumped version tokens so the client can refresh the
    // ones it holds; otherwise its next save re-sends a now-stale version and
    // false-conflicts against the row it just wrote.
    return NextResponse.json({ success: true, versions: result?.versions || [] });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      // A concurrent writer changed a list first — hand back the fresh full state
      // so the client can reconcile (re-apply a stage move, or reload) instead of
      // silently overwriting the other person's edit.
      return NextResponse.json({ conflict: true, current: e.current }, { status: 409 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
