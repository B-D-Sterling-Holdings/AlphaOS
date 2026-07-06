import { CIO_TENANT_ID } from './auth';

/*
  Framework-neutral storage primitives (no 'server-only', no Next imports) —
  the pure half of src/lib/storage.js, importable from scripts, the demo
  seeder, and tests. All storage *operations* (upload/sign/delete) live in
  storage.js, which enforces sessions; nothing here can touch a bucket.
*/

export const IMAGE_BUCKET = 'research-images';
export const DOCUMENT_BUCKET = 'documents';
const BUCKETS = new Set([IMAGE_BUCKET, DOCUMENT_BUCKET]);

// Signed-URL lifetimes. Browser/UI links are minted per request, so they can
// be short; emails are read hours or days later, so their inline images get a
// longer (but still bounded) lease minted at send time.
export const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes
export const EMAIL_SIGNED_URL_TTL_SECONDS = 7 * 24 * 3600; // 7 days

const TENANT_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

/** A user-supplied value that becomes ONE path segment: no separators, no `..`. */
export function safeSegment(value, fallback) {
  const clean = String(value ?? '')
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim();
  return clean || fallback;
}

/** The stable app-relative URL stored in content and rows for an object. */
export function appStorageUrl(bucket, path) {
  return `/api/storage/object?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

export function isKnownBucket(bucket) {
  return BUCKETS.has(bucket);
}

/**
 * May `tenantId` read/delete `path`? Pure — shared by the signed-URL route,
 * deletes, and the email signer so the rule can never fork.
 */
export function isPathAllowedForTenant(tenantId, path) {
  if (typeof path !== 'string' || !path || path.length > 1024) return false;
  // No traversal, no absolute paths, no backslashes, no empty segments.
  if (path.includes('..') || path.includes('\\') || path.startsWith('/') || path.includes('//')) {
    return false;
  }
  if (!tenantId) return false;
  if (path.startsWith(`${tenantId}/`)) return true;
  // Legacy exception: pre-multitenancy objects have no tenant prefix and
  // belong to the CIO workspace. A path that starts with any OTHER tenant's
  // UUID prefix is never legacy.
  if (tenantId === CIO_TENANT_ID && !TENANT_PREFIX_RE.test(path)) return true;
  return false;
}
