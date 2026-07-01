import 'server-only';

/*
  In-memory brute-force protection for the login endpoint.

  Only FAILED attempts count, so legitimate users are never throttled. State is
  per server instance (serverless deployments get one map per warm instance) —
  not a hard distributed guarantee, but it turns an unthrottled online guessing
  attack into an impractical one at zero infra cost.
*/

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_KEY = 5;   // per ip+username
const MAX_FAILURES_PER_IP = 20;   // per ip across all usernames
const MAX_ENTRIES = 10_000;

const failures = new Map(); // key -> { count, resetAt }

function bump(key) {
  const now = Date.now();
  if (failures.size > MAX_ENTRIES) {
    for (const [k, v] of failures) {
      if (now > v.resetAt) failures.delete(k);
    }
  }
  let entry = failures.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    failures.set(key, entry);
  }
  entry.count += 1;
}

function countFor(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() > entry.resetAt) return 0;
  return entry.count;
}

/** Client IP for keying — first hop of x-forwarded-for, or 'unknown'. */
export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export function isLoginBlocked(ip, username) {
  const uname = String(username || '').toLowerCase();
  return (
    countFor(`u:${ip}:${uname}`) >= MAX_FAILURES_PER_KEY ||
    countFor(`ip:${ip}`) >= MAX_FAILURES_PER_IP
  );
}

export function recordLoginFailure(ip, username) {
  const uname = String(username || '').toLowerCase();
  bump(`u:${ip}:${uname}`);
  bump(`ip:${ip}`);
}

export function clearLoginFailures(ip, username) {
  const uname = String(username || '').toLowerCase();
  failures.delete(`u:${ip}:${uname}`);
}
