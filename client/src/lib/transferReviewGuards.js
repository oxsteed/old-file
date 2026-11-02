// Money-review gates for OxSteed Credit transfers and restaurant top-up
// clawbacks (admin-ops audit items 3, 4, 11). Pure predicates so the exact
// conditions the pages enforce are unit-testable: no review panel, no
// confirm, and no POST may proceed without a resolved human-readable
// target and, for transfers, a successfully loaded fee quote. The server
// remains the authority; these gates only stop blind confirms in the UI.

export function isValidTransferRecipientId(value) {
  return /^[0-9a-fA-F-]{36}$/.test(String(value || '').trim());
}

function recipientMatches(recipient, recipientId) {
  if (!recipient || !recipient.customerId) return false;
  // A resolved row with no display name is not human-checkable: it must
  // not unlock review either.
  if (!recipient.displayName) return false;
  return String(recipient.customerId) === String(recipientId || '').trim();
}

// The transfer review panel may open, and its confirm button may enable,
// only when the recipient name has been resolved for the exact id entered
// and a fee quote loaded successfully for the current amount. A failed
// quote leaves the transfer unreviewable even though the server would
// still charge a fee on POST.
export function canEnterTransferReview({
  amountCents,
  recipient,
  recipientId,
  feeQuote,
  feeQuoteError,
  currencyCode,
} = {}) {
  if (!amountCents) return false;
  if (feeQuoteError) return false;
  if (!feeQuote) return false;
  // A quote fetched for another currency is stale, not a fee for this
  // transfer: the currency picker does not reset transfer state.
  if (currencyCode && feeQuote.currencyCode && feeQuote.currencyCode !== currencyCode) return false;
  return recipientMatches(recipient, recipientId);
}

export function canConfirmTransfer(args = {}) {
  return canEnterTransferReview(args);
}

// The clawback dialog may confirm only when a top-up preview was loaded
// for the exact id entered. A preview for a different id, or no preview
// at all, is a blind confirm and must stay disabled.
export function canConfirmClawback({ topupId, reason, preview } = {}) {
  const id = String(topupId || '').trim();
  if (!id) return false;
  if (!String(reason || '').trim()) return false;
  if (!preview || String(preview.id) !== id) return false;
  return true;
}
