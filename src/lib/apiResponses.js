import { NextResponse } from 'next/server';
import { VersionConflictError } from './concurrency';

export function apiJson(data, init) {
  return NextResponse.json(data, init);
}

// The one canonical optimistic-concurrency conflict response. Every OCC-guarded
// route replies with this exact shape on a lost-update race, so a single client
// helper (src/lib/occClient.js) can recognize + reconcile it everywhere:
//   409 { conflict: true, current: <fresh server row/doc | null>, version }
export function conflictResponse(current) {
  return apiJson(
    { conflict: true, current: current ?? null, version: current?.version ?? 0 },
    { status: 409 }
  );
}

export function apiCreated(data) {
  return apiJson(data, { status: 201 });
}

export function apiBadRequest(message) {
  return apiJson({ error: message }, { status: 400 });
}

export function apiError(error, status = 500) {
  const message = typeof error === 'string' ? error : error?.message || 'Internal server error';
  return apiJson({ error: message }, { status });
}

export function apiOk(data = { ok: true }) {
  return apiJson(data);
}

export async function withApiError(handler) {
  try {
    return await handler();
  } catch (error) {
    // A lost-update race from versionedWrite becomes the canonical 409 — so any
    // route wrapped in withApiError gets uniform conflict handling for free, with
    // no per-route try/catch.
    if (error instanceof VersionConflictError) {
      return conflictResponse(error.current);
    }
    return apiError(error);
  }
}
