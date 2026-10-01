const STATUS_TRANSLATION_KEYS = Object.freeze({
  enabled: 'statusEnabled',
  draft: 'statusDraft',
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
  disputed: 'statusDisputed',
  reversed: 'statusReversed',
  revoked: 'rejectedStatus',
  posted: 'statusPosted',
  held: 'reservedStatus',
  reserved: 'reservedStatus',
  captured: 'capturedStatus',
  released: 'releasedStatus',
  refunded: 'statusRefunded',
  closed: 'closedStatus',
  none: 'statusNone',
  initiated: 'statusInitiated',
});

const ORDER_TYPE_TRANSLATION_KEYS = Object.freeze({
  pickup: 'orderTypePickup',
  dine_in: 'orderTypeDineIn',
  delivery: 'orderTypeDelivery',
});

const TRANSACTION_TYPE_TRANSLATION_KEYS = Object.freeze({
  load: 'transactionLoad',
  purchase: 'transactionPurchase',
  refund: 'transactionRefund',
  transfer: 'transactionTransfer',
  adjustment: 'transactionAdjustment',
  settlement: 'transactionSettlement',
  settlement_reversal: 'transactionSettlementReversal',
  fee: 'transactionFee',
  funding: 'transactionFunding',
  reserve_release: 'transactionReserveRelease',
  cash_out: 'transactionCashOut',
  conversion_debit: 'transactionConversionDebit',
  conversion_fee: 'transactionConversionFee',
  conversion_credit: 'transactionConversionCredit',
  expiration: 'transactionExpiration',
  chargeback: 'transactionChargeback',
});

export function creditStatusTranslationKey(status) {
  return STATUS_TRANSLATION_KEYS[String(status || '').trim().toLowerCase()] || 'statusUnknown';
}

export function localizeCreditStatus(status, translate) {
  const key = creditStatusTranslationKey(status);
  return typeof translate === 'function' ? translate(key) : key;
}

export function creditOrderTypeTranslationKey(orderType) {
  return ORDER_TYPE_TRANSLATION_KEYS[String(orderType || '').trim().toLowerCase()] || 'statusUnknown';
}

export function localizeCreditOrderType(orderType, translate) {
  const key = creditOrderTypeTranslationKey(orderType);
  return typeof translate === 'function' ? translate(key) : key;
}

export function localizeCreditOrderTypes(orderTypes, translate) {
  return (Array.isArray(orderTypes) ? orderTypes : [])
    .map((orderType) => localizeCreditOrderType(orderType, translate))
    .join(', ');
}

export function creditTransactionTypeTranslationKey(transactionType) {
  return TRANSACTION_TYPE_TRANSLATION_KEYS[String(transactionType || '').trim().toLowerCase()] || 'transactionUnknown';
}

export function localizeCreditTransactionType(transactionType, translate) {
  const key = creditTransactionTypeTranslationKey(transactionType);
  return typeof translate === 'function' ? translate(key) : key;
}
