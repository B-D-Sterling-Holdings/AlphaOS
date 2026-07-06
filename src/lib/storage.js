import 'server-only';
import { supabaseAdmin } from './supabaseAdmin';
import { getSession } from './db';
import {
  IMAGE_BUCKET,
  DOCUMENT_BUCKET,
  MACRO_PLOT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  EMAIL_SIGNED_URL_TTL_SECONDS,
  safeSegment,
  appStorageUrl,
  isKnownBucket,
  isPathAllowedForTenant,
} from './storageShared';

/*
  Centralized tenant-scoped storage access — the ONLY module that may touch
  Supabase Storage on behalf of a user request.

  Buckets are PRIVATE (migration 021): there are no public object URLs, so a
  leaked link (browser history, logs, exports, referrers) is worthless on its
  own. What the app stores and renders instead are stable app-relative URLs:

      /api/storage/object?bucket=<bucket>&path=<tenant_id>/...

  That route (src/app/api/storage/object/route.js) validates the caller's
  session and tenant against the path, then 302-redirects to a short-lived
  signed URL minted here. Only the app URL is durable; the signed URL expires
  in minutes.

  Rules this module enforces so callers can't get them wrong:
  - Object paths are BUILT here (tenant prefix + sanitized segments), never
    accepted whole from a request for uploads.
  - Reads/deletes validate the path against the session tenant's `<uuid>/`
    prefix (isPathAllowedForTenant — including the CIO legacy exception for
    pre-multitenancy unprefixed paths).
  - Signing for emails (`signStorageUrlsForTenant`) takes the tenant from the
    DB row being rendered — never from client input — and only signs paths
    that tenant may read.

  Storage RLS note: the service-role client bypasses storage policies, which
  is exactly why every entry point here re-checks the tenant prefix before
  acting. Pure helpers (URL shape, path rules, TTLs) live in storageShared.js
  so scripts and the demo seeder can share them without pulling in Next.
*/

export {
  IMAGE_BUCKET,
  DOCUMENT_BUCKET,
  MACRO_PLOT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  EMAIL_SIGNED_URL_TTL_SECONDS,
  safeSegment,
  appStorageUrl,
  isKnownBucket,
  isPathAllowedForTenant,
};

async function requireSession() {
  const session = await getSession();
  if (!session) {
    const err = new Error('Not authenticated');
    err.status = 401;
    throw err;
  }
  return session;
}

function forbidden(message = 'Invalid path') {
  const err = new Error(message);
  err.status = 403;
  return err;
}

async function uploadToBucket({ bucket, path, file }) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return { path: data.path, url: appStorageUrl(bucket, data.path) };
}

/**
 * Store a rich-text inline image under the session tenant's prefix.
 * Returns { path, url } where url is the app-relative (auth-gated) URL.
 */
export async function uploadTenantImage({ ticker, file }) {
  const session = await requireSession();
  const tickerSeg = safeSegment(String(ticker || '').toUpperCase(), 'UNKNOWN');
  const nameSeg = safeSegment(file.name, 'file');
  const path = `${session.tenantId}/${tickerSeg}/${Date.now()}_${nameSeg}`;
  return uploadToBucket({ bucket: IMAGE_BUCKET, path, file });
}

/**
 * Store a document-library file under the session tenant's prefix.
 * Returns { path, url } where url is the app-relative (auth-gated) URL.
 */
export async function uploadTenantDocument({ category, file }) {
  const session = await requireSession();
  const categorySeg = safeSegment(category, 'other');
  const nameSeg = safeSegment(file.name, 'file');
  const path = `${session.tenantId}/${categorySeg}/${Date.now()}_${nameSeg}`;
  return uploadToBucket({ bucket: DOCUMENT_BUCKET, path, file });
}

/**
 * Mint a short-lived signed URL for an object the session tenant owns.
 * Throws { status: 401|403|404 }-shaped errors for the route to map.
 *
 * @param {object} opts
 * @param {string} opts.bucket        one of the known buckets
 * @param {string} opts.path          full object path (`<tenant_id>/...`)
 * @param {number} [opts.ttlSeconds]  lifetime, default SIGNED_URL_TTL_SECONDS
 * @param {string|boolean} [opts.download]  force content-disposition (true or a filename)
 */
export async function getTenantSignedUrl({ bucket, path, ttlSeconds = SIGNED_URL_TTL_SECONDS, download } = {}) {
  const session = await requireSession();
  if (!isKnownBucket(bucket)) throw forbidden('Unknown bucket');
  if (!isPathAllowedForTenant(session.tenantId, path)) throw forbidden();
  return signPathForTenant({ bucket, path, ttlSeconds, download });
}

// The actual mint, AFTER authorization. Kept private so every public caller
// has been through a tenant check first.
async function signPathForTenant({ bucket, path, ttlSeconds, download }) {
  const options = download ? { download: download === true ? undefined : download } : undefined;
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds, options);
  if (error) {
    const err = new Error(error.message);
    err.status = /not.?found/i.test(error.message) ? 404 : 500;
    throw err;
  }
  return data.signedUrl;
}

async function deleteTenantObject(bucket, path) {
  const session = await requireSession();
  if (!isPathAllowedForTenant(session.tenantId, path)) throw forbidden();
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}

/** Delete one rich-text image the session tenant owns. */
export async function deleteTenantImage(path) {
  return deleteTenantObject(IMAGE_BUCKET, path);
}

/** Delete one document-library object the session tenant owns. */
export async function deleteTenantDocument(path) {
  return deleteTenantObject(DOCUMENT_BUCKET, path);
}

/*
  ── Macro-regime backtest plots ─────────────────────────────────────────────
  The allocator writes a handful of PNGs per run. They used to be base64-inlined
  into macro_regime_results.plots (rows were megabytes). They now live in the
  private `macro-plots` bucket under `<tenant_id>/<runId>/<file>`, and the row
  stores `{ filename: storage_path }`.
*/

/**
 * Upload one plot PNG for an EXPLICIT tenant (no session needed — the writer is
 * a background run callback / CI script that already knows its tenant). Returns
 * the stored object path. `upsert` so a re-run overwrites deterministically.
 */
export async function uploadMacroPlotForTenant({ tenantId, runId, filename, buffer, contentType = 'image/png' }) {
  const runSeg = safeSegment(String(runId ?? 'run'), 'run');
  const nameSeg = safeSegment(filename, 'plot.png');
  const path = `${tenantId}/${runSeg}/${nameSeg}`;
  if (!isPathAllowedForTenant(tenantId, path)) throw forbidden();
  const { data, error } = await supabaseAdmin.storage
    .from(MACRO_PLOT_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return data.path;
}

/** A short-lived signed URL for a plot the session tenant owns (for the reader route). */
export async function getMacroPlotSignedUrl(path) {
  const session = await requireSession();
  if (!isPathAllowedForTenant(session.tenantId, path)) throw forbidden();
  return signPathForTenant({ bucket: MACRO_PLOT_BUCKET, path, ttlSeconds: SIGNED_URL_TTL_SECONDS });
}

/** Delete every plot object under a tenant's `<tenant_id>/` prefix in the macro-plots bucket. */
export async function deleteTenantMacroPlots(tenantId, runId = null) {
  const prefix = runId ? `${tenantId}/${safeSegment(String(runId), 'run')}` : `${tenantId}`;
  const { data: list, error: listErr } = await supabaseAdmin.storage
    .from(MACRO_PLOT_BUCKET)
    .list(prefix, { limit: 1000 });
  if (listErr || !list?.length) return;
  const paths = [];
  for (const entry of list) {
    // one level of run-folders under the tenant prefix
    if (entry.id === null) {
      const { data: sub } = await supabaseAdmin.storage
        .from(MACRO_PLOT_BUCKET)
        .list(`${prefix}/${entry.name}`, { limit: 1000 });
      for (const f of sub || []) paths.push(`${prefix}/${entry.name}/${f.name}`);
    } else {
      paths.push(`${prefix}/${entry.name}`);
    }
  }
  if (paths.length) await supabaseAdmin.storage.from(MACRO_PLOT_BUCKET).remove(paths);
}

/*
  ── Email rendering support ─────────────────────────────────────────────────

  Stored content references images by app-relative URL (or, for rows written
  before the private-bucket cutover, by the old Supabase public URL). Neither
  works from an email client: there is no session cookie, and public URLs die
  with migration 021. Before rendering an email, the server rewrites every
  storage reference it is AUTHORIZED to serve into a fresh signed URL with an
  email-grade TTL. The authorizing tenant comes from the DB row (cron) or the
  verified session (manual nudge) — never from the payload itself, so a
  crafted body can't exfiltrate another tenant's file (its paths simply don't
  pass the tenant check and are left untouched).
*/

// Matches app-relative object URLs and legacy public URLs, in plain text or
// inside HTML attributes. Captures bucket + path (URL-encoded or raw).
const APP_URL_RE = /\/api\/storage\/object\?bucket=([a-z0-9-]+)&(?:amp;)?path=([^"'\s&]+)/gi;
function legacyPublicUrlRe() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!base) return null;
  return new RegExp(`${base}/storage/v1/object/public/([a-z0-9-]+)/([^"'\\s?]+)`, 'gi');
}

async function replaceAsync(str, regex, replacer) {
  const jobs = [];
  str.replace(regex, (...args) => {
    jobs.push(replacer(...args));
    return '';
  });
  const results = await Promise.all(jobs);
  let i = 0;
  return str.replace(regex, () => results[i++]);
}

async function signMatch({ tenantId, ttlSeconds, bucket, rawPath, original }) {
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = rawPath;
  }
  if (!isKnownBucket(bucket) || !isPathAllowedForTenant(tenantId, path)) return original;
  try {
    return await signPathForTenant({ bucket, path, ttlSeconds });
  } catch {
    return original; // missing object etc. — leave the reference as-is
  }
}

async function signUrlsInString(str, { tenantId, ttlSeconds }) {
  if (typeof str !== 'string' || !str) return str;
  let out = await replaceAsync(str, APP_URL_RE, (m, bucket, rawPath) =>
    signMatch({ tenantId, ttlSeconds, bucket, rawPath, original: m }));
  const legacyRe = legacyPublicUrlRe();
  if (legacyRe) {
    out = await replaceAsync(out, legacyRe, (m, bucket, rawPath) =>
      signMatch({ tenantId, ttlSeconds, bucket, rawPath, original: m }));
  }
  return out;
}

/**
 * Deep-rewrite every storage reference in `value` (a string, a rich-text
 * block array, a thread list — any JSON-ish shape) into signed URLs the given
 * tenant may read. Returns a new value; the input is not mutated.
 */
export async function signStorageUrlsForTenant(value, { tenantId, ttlSeconds = EMAIL_SIGNED_URL_TTL_SECONDS } = {}) {
  if (!tenantId) return value;
  if (typeof value === 'string') return signUrlsInString(value, { tenantId, ttlSeconds });
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => signStorageUrlsForTenant(v, { tenantId, ttlSeconds })));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await signStorageUrlsForTenant(v, { tenantId, ttlSeconds });
    }
    return out;
  }
  return value;
}
