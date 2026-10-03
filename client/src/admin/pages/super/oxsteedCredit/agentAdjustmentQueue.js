/**
 * Pure helpers for the agent credit-adjustment approval queue.
 *
 * The two-person rule is enforced on the server (self-approval is a hard
 * 403), but the queue UI must not offer Approve/Reject to the proposer in
 * the first place: they should never discover the rule via an error toast.
 * These predicates keep that logic in one testable place.
 */

export const AGENT_ADJUSTMENT_ENDPOINTS = {
  pending: '/api/agent/credit-adjustments/pending',
  approve: (id) => `/api/agent/credit-adjustments/${id}/approve`,
  reject: (id) => `/api/agent/credit-adjustments/${id}/reject`,
  cancel: (id) => `/api/agent/credit-adjustments/${id}/cancel`,
};

function isSameIdentity(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  return a !== '' && a === b;
}

/** True when the viewing admin is the one who proposed the adjustment. */
export function isOwnProposal(adjustment, adminId) {
  return isSameIdentity(adjustment?.proposedBy, adminId);
}

/**
 * True when the viewing admin may approve or reject the adjustment.
 * Only a different admin may decide; the proposer must use cancel().
 */
export function canDecideAdjustment(adjustment, adminId) {
  if (!adminId || String(adminId).trim() === '') return false;
  return !isOwnProposal(adjustment, adminId);
}

/** True when the viewing admin may withdraw the pending proposal. */
export function canCancelAdjustment(adjustment, adminId) {
  if (!adminId || String(adminId).trim() === '') return false;
  return isOwnProposal(adjustment, adminId);
}

/** Signed display amount, e.g. "+$75.00" or "-$20.00". */
export function signedAmountLabel(amountCents, formatMoney) {
  const cents = Number(amountCents || 0);
  const sign = cents < 0 ? '-' : '+';
  return `${sign}${formatMoney(Math.abs(cents))}`;
}
