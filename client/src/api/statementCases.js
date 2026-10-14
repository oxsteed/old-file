import api from './axios';

// Statement-level follow-up endpoints owned by the Group C workstream:
// statement reports, correction diffs, and case follow-up messaging.
//
// The investigation router is mounted at /api (see
// server/routes/statementInvestigation.js); the axios client already
// prefixes /api. Product is always explicit in these URLs so a report or
// diff can never be filed against the wrong archive.

function productBase(product, documentId) {
  if (!product || !documentId) throw new Error('Invalid statement reference');
  return `/statements/${encodeURIComponent(String(product))}/documents/${encodeURIComponent(String(documentId))}`;
}

// reportType: 'missing_transaction' | 'wrong_opening_balance' |
// 'incomplete_period' | 'other_statement_problem'.
export function createStatementReport(product, documentId, { reportType, description = '' } = {}) {
  return api.post(`${productBase(product, documentId)}/reports`, { reportType, description })
    .then((response) => response.data);
}

export function listStatementReports(product, documentId, { signal } = {}) {
  return api.get(`${productBase(product, documentId)}/reports`, { signal })
    .then((response) => response.data);
}

export function getCorrectionDiff(product, documentId, correctionId, { signal } = {}) {
  if (!correctionId) throw new Error('Invalid correction reference');
  return api.get(
    `${productBase(product, documentId)}/corrections/${encodeURIComponent(String(correctionId))}/diff`,
    { signal },
  ).then((response) => response.data);
}

// Case follow-up messaging reuses the EXISTING support ticket APIs.
// getMyTicket returns { ticket, messages }; reply posts a follow-up message.
// Idempotency-Key dedupes retried replies server-side.
export function getSupportTicket(ticketId, { signal } = {}) {
  if (!ticketId) throw new Error('Invalid support case');
  return api.get(`/support/my-tickets/${encodeURIComponent(String(ticketId))}`, { signal })
    .then((response) => response.data);
}

export function replyToSupportTicket(ticketId, content, { idempotencyKey } = {}) {
  if (!ticketId) throw new Error('Invalid support case');
  return api.post(
    `/support/my-tickets/${encodeURIComponent(String(ticketId))}/reply`,
    { content },
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
  ).then((response) => response.data);
}
