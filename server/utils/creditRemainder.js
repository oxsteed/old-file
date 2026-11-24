'use strict';

// Group 13, item 667 (D-365): order total minus Credit applied, shown
// before the customer confirms. Pure derivation, no money movement: Credit
// applied is the smaller of the order total and the available Credit
// balance, and the remainder is whatever is left after Credit. A remainder
// implies no split payment (D-357) — it only states what is still due.
function creditRemainder({ totalCents, availableCents } = {}) {
  const total = Number(totalCents);
  const available = Number(availableCents);
  const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  const safeAvailable = Number.isSafeInteger(available) && available > 0 ? available : 0;
  const creditAppliedCents = Math.min(safeAvailable, safeTotal);
  const remainderCents = safeTotal - creditAppliedCents;
  return { creditAppliedCents, remainderCents, fullyCovered: remainderCents === 0 };
}

module.exports = { creditRemainder };
