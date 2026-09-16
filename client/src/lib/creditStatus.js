const STATUS_TRANSLATION_KEYS = Object.freeze({
  enabled: 'statusEnabled',
  active: 'activeStatus',
  balanced: 'statusBalanced',
  pending: 'statusPending',
  pending_approval: 'statusPending',
  running: 'statusRunning',
  difference: 'statusDifference',
  failed: 'statusFailed',
  suspended: 'suspendedStatus',
  terminated: 'statusTerminated',
  expired: 'expiredStatus',
  paid: 'statusPaid',
  approved: 'statusApproved',
  voided: 'statusVoided',
  open: 'openStatus',
  in_review: 'underReviewStatus',
  resolved: 'resolvedStatus',
  rejected: 'rejectedStatus',
  revoked: 'rejectedStatus',
  posted: 'statusPosted',
  held: 'reservedStatus',
  reserved: 'reservedStatus',
  captured: 'capturedStatus',
  released: 'releasedStatus',
  refunded: 'statusRefunded',
  closed: 'closedStatus',
});

export function creditStatusTranslationKey(status) {
  return STATUS_TRANSLATION_KEYS[String(status || '').trim().toLowerCase()] || 'statusUnknown';
}

export function localizeCreditStatus(status, translate) {
  const key = creditStatusTranslationKey(status);
  return typeof translate === 'function' ? translate(key) : key;
}
