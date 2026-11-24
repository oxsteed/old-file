import api from './axios';

// Statement transaction investigation endpoints. The router is mounted at
// /api (see server/routes/statementInvestigation.js); the axios client already
// prefixes /api. The archive UI (StatementArchivePage) links each entry to the
// StatementTransactionView route.
function entryBase(documentId, entryId) {
  if (!documentId || !entryId) throw new Error('Invalid statement entry');
  return `/statements/${encodeURIComponent(String(documentId))}/entries/${encodeURIComponent(String(entryId))}`;
}

function documentBase(documentId) {
  if (!documentId) throw new Error('Invalid statement document');
  return `/statements/${encodeURIComponent(String(documentId))}/entries`;
}

export function listStatementEntries(documentId, { page = 1, pageSize = 25, signal } = {}) {
  return api.get(documentBase(documentId), { params: { page, pageSize }, signal })
    .then((response) => response.data);
}

export function getStatementEntry(documentId, entryId, { signal } = {}) {
  return api.get(entryBase(documentId, entryId), { signal })
    .then((response) => response.data);
}

// reason: 'unrecognized' | 'duplicate' | 'incorrect_amount' | 'other'.
// Retries reuse the existing case; the response carries replayed: true then.
export function createStatementCase(documentId, entryId, { reason = 'unrecognized', description = '' } = {}) {
  return api.post(entryBase(documentId, entryId) + '/cases', { reason, description })
    .then((response) => response.data);
}

export function listStatementCases(documentId, entryId, { signal } = {}) {
  return api.get(`${entryBase(documentId, entryId)}/cases`, { signal })
    .then((response) => response.data);
}

// Group 14 Slice 5b (708, D-425): shared annotations on a statement entry.
// Append-only and visible to every reader authorized for the document —
// unlike the private per-user entry notes, which stay owner-only.
export function listEntryAnnotations(documentId, entryId, { signal } = {}) {
  return api.get(`${entryBase(documentId, entryId)}/annotations`, { signal })
    .then((response) => response.data);
}

export function addEntryAnnotation(documentId, entryId, { body = '' } = {}) {
  return api.post(entryBase(documentId, entryId) + '/annotations', { body })
    .then((response) => response.data);
}
