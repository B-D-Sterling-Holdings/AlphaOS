import { NextResponse } from 'next/server';

export function apiJson(data, init) {
  return NextResponse.json(data, init);
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
    return apiError(error);
  }
}
