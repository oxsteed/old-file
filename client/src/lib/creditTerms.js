// Helpers for the public OxSteed Credit terms page (gap fill 13).

export const CREDIT_TERMS_CURRENCIES = Object.freeze(['USD', 'HTG', 'CAD', 'EUR', 'GBP']);

/** True when any item is still the built-in draft text (no approved version published). */
export function pendingLegalApproval(items) {
  return (items || []).some((item) => item.placeholder || !item.approved_reference);
}
