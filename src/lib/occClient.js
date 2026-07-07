/*
  The single client-side entry point for optimistic-concurrency-guarded saves.

  Every OCC route replies with one canonical conflict shape (see
  src/lib/apiResponses.js conflictResponse):

      409 { conflict: true, current: <fresh server row/doc | null>, version }

  so this one helper can recognize and reconcile a lost-update race everywhere,
  instead of each page/route re-implementing 409 handling. What stays per-surface
  is ONLY the merge policy — "what to do when two people collide" is a product
  decision that legitimately differs:

    - documents with additive collaboration (theses, …) pass a `merge` that unions
      the concurrent work and RETRY (nobody's edit is lost);
    - plain record rows pass NO `merge`, so the first conflict is returned with the
      server's fresh row for the caller to swap in + notify (reload-and-redo — the
      right UX when two people edit the same scalar field).

  This module is deliberately not server-only: it runs in the browser.
*/

const jsonHeaders = { 'Content-Type': 'application/json' };

async function readResponse(res) {
  const data = await res.json().catch(() => ({}));
  const conflict = res.status === 409 && data?.conflict === true;
  return { conflict, ok: res.ok, status: res.status, data };
}

/**
 * Generic OCC writer with reconciliation.
 *
 * @param url       endpoint
 * @param method    HTTP method (default PUT)
 * @param local     the object being saved (carries its loaded `.version`)
 * @param buildBody (obj) => request body; typically attaches `baseVersion`
 * @param merge     (local, server) => nextAttempt; omit for reload-on-conflict
 * @param retries   max merge+retry rounds (default 1)
 * @returns
 *   { ok:true,  data, sent, reconciled }          — saved (reconciled if a merge happened)
 *   { ok:false, conflict:true, server, merged }   — caller must resolve (server = fresh row)
 *   { ok:false, error, local }                    — network / server error
 */
export async function saveWithOCC({ url, method = 'PUT', local, buildBody, merge, retries = 1 }) {
  let attempt = local;
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(url, { method, headers: jsonHeaders, body: JSON.stringify(buildBody(attempt)) });
    } catch (e) {
      return { ok: false, error: e?.message || 'network error', local: attempt };
    }
    const { conflict, ok, data } = await readResponse(res);
    if (!conflict) {
      if (!ok) return { ok: false, error: data?.error || 'save failed', local: attempt };
      return { ok: true, data, sent: attempt, reconciled: i > 0 };
    }
    const server = data.current;
    if (!merge || i >= retries) {
      return { ok: false, conflict: true, server, merged: merge ? merge(attempt, server) : null };
    }
    attempt = merge(attempt, server);
  }
}

/**
 * Convenience for the common case: PUT one record row, guarding on its `version`,
 * with reload-on-conflict (no auto-merge). On success returns { ok, row } with the
 * server's persisted row (new version); on conflict returns { ok:false, conflict,
 * server } so the caller can replace the row in its list and prompt a redo.
 *
 * `pick` optionally narrows what is sent (defaults to the whole row); `baseVersion`
 * is always attached from the row's current `version`.
 */
export async function saveRow(url, row, { method = 'PUT', pick } = {}) {
  const res = await saveWithOCC({
    url,
    method,
    local: row,
    buildBody: (r) => ({ ...(pick ? pick(r) : r), baseVersion: r.version }),
  });
  if (res.ok) return { ok: true, row: res.data?.row ?? res.data, data: res.data };
  return res;
}
