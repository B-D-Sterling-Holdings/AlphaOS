/*
  Conflict reconciliation for a thesis save (see src/lib/researchApi.js
  saveThesisReconciled). When a save is rejected because a teammate saved first,
  we hold two versions with no common base: `local` (the saving user's in-progress
  edits) and `server` (the current row, which already contains the teammate's
  change). mergeThesis fuses them so nobody's work is silently dropped:

    - Additive collaboration is UNIONED by id, so nothing is lost: Draft & Review
      threads and their message chains, plus todos and news updates. A thread the
      local copy never saw is kept; a locally-added thread is kept; a thread in
      both keeps the local scalar fields (title/resolved — the user's intent) but
      unions the messages, so two reviewers posting comments at once both survive.
    - Everything else takes the LOCAL value (the saving user's explicit intent).
      A genuine edit to the same scalar field is therefore last-write-wins, but
      VISIBLE: the caller surfaces it and the merged result is saved against the
      server's current version, so it is never a silent overwrite.

  The result carries `version: server.version` so the follow-up save compares
  against the row as it now stands.
*/

function indexById(arr) {
  const m = new Map();
  for (const it of arr || []) if (it && it.id != null) m.set(it.id, it);
  return m;
}

function unionMessages(localMsgs = [], serverMsgs = []) {
  const byId = new Map();
  for (const m of localMsgs || []) if (m && m.id != null) byId.set(m.id, m);
  for (const m of serverMsgs || []) if (m && m.id != null && !byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a?.createdAt) || 0;
    const tb = Date.parse(b?.createdAt) || 0;
    return ta - tb;
  });
}

function unionThreads(localThreads = [], serverThreads = []) {
  const serverById = indexById(serverThreads);
  const merged = (localThreads || []).map((lt) => {
    const st = serverById.get(lt.id);
    if (!st) return lt; // locally-added thread the server hasn't seen — keep it
    // Present in both: keep the local scalar fields, union the message chains.
    return { ...st, ...lt, messages: unionMessages(lt.messages, st.messages) };
  });
  const localIds = new Set((localThreads || []).map((t) => t.id));
  for (const st of serverThreads || []) {
    if (!localIds.has(st.id)) merged.push(st); // server-only thread — keep it
  }
  return merged;
}

// Union two id-bearing lists: local items first (local order + fields win), then
// any server-only items appended. Items without an id fall back to the local list
// unchanged (can't be safely matched).
function unionById(localArr, serverArr) {
  if (!Array.isArray(localArr)) return serverArr || [];
  if (!Array.isArray(serverArr)) return localArr;
  const localIds = new Set(localArr.map((it) => it && it.id).filter((id) => id != null));
  const serverOnly = serverArr.filter((it) => it && it.id != null && !localIds.has(it.id));
  return [...localArr, ...serverOnly];
}

export function mergeThesis(local, server) {
  if (!server) return local;
  if (!local) return server;

  const localDR = local.underwriting?.draftReview || {};
  const serverDR = server.underwriting?.draftReview || {};

  return {
    ...server, // start from the freshest server document…
    ...local, // …but the saving user's scalar fields win
    version: server.version, // …and we save against the row as it now stands
    underwriting: {
      ...(server.underwriting || {}),
      ...(local.underwriting || {}),
      draftReview: {
        ...serverDR,
        ...localDR,
        threads: unionThreads(localDR.threads, serverDR.threads),
      },
    },
    todos: unionById(local.todos, server.todos),
    newsUpdates: unionById(local.newsUpdates, server.newsUpdates),
  };
}
