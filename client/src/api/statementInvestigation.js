import api from './axios';

// Statement transaction investigation endpoints. The router is mounted at
// /api (see server/routes/statementInvestigation.js); the archive UI wires
// drilldown links to the StatementTransactionView route.
function entryBase(documentId, entryId) {
  if (!documentId || !entryId) throw new Error('Invalid statement entry');
  return `/api/statements/${encodeURIComponent(String(documentId))}/entries/${encodeURIComponent(String(entryId))}`;
}

function documentBase(documentId) {
  if (!documentId) throw new Error('Invalid statement document');
  return `/api/statements/${encodeURIComponent(String(documentId))}/entries`;
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
