import api from './axios';

export const getOxsteedCreditAccount = (params = {}) =>
  api.get('/oxsteed-credit/account', { params }).then((response) => response.data?.account || null);

export const getOxsteedCreditConversionQuote = (quoteId) =>
  api.get(`/oxsteed-credit/conversion-quotes/${quoteId}`).then((response) => response.data?.quote || null);

// Credit redesign (D-794): the customer creates their own conversion quote
// from the live FX feed; the Convert drawer confirms against the returned
// quote instead of asking for an admin-issued Quote ID.
export const createOxsteedCreditConversionQuote = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/conversion-quotes', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const convertOxsteedCredit = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/conversions', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const getOxsteedCreditLimitSummary = (params = {}) =>
  api.get('/oxsteed-credit/limits', { params }).then((response) => response.data?.limits || null);

export const listOxsteedCreditAccounts = () =>
  api.get('/oxsteed-credit/accounts').then((response) => response.data?.accounts || []);

export const getOxsteedCreditStatus = () =>
  api.get('/oxsteed-credit/status').then((response) => response.data?.credit || null);

export const listOxsteedCreditHolds = (params = {}) =>
  api.get('/oxsteed-credit/holds', { params })
    .then((response) => response.data || { holds: [], pagination: { limit: 25, offset: 0, hasMore: false, nextOffset: null } });

export const listOxsteedCreditEligiblePartners = (params = {}) =>
  api.get('/oxsteed-credit/eligible-partners', { params })
    .then((response) => response.data?.partners || []);

export const getOxsteedCreditEligibility = (params = {}) =>
  api.get('/oxsteed-credit/eligibility', { params })
    .then((response) => response.data || { eligible: false, reasonCode: 'credit_eligibility_unavailable' });

export const getOxsteedCreditEligiblePartnerPage = (params = {}) =>
  api.get('/oxsteed-credit/eligible-partners', { params })
    .then((response) => response.data || { partners: [], pagination: { limit: 25, offset: 0, hasMore: false, nextOffset: null } });

export const listOxsteedCreditTransactions = (params = {}) =>
  api.get('/oxsteed-credit/transactions', { params })
    .then((response) => response.data?.transactions || []);

export const getOxsteedCreditTransactionPage = (params = {}) =>
  api.get('/oxsteed-credit/transactions', { params })
    .then((response) => response.data || { transactions: [], pagination: { limit: 25, offset: 0, hasMore: false, nextOffset: null } });

export const getOxsteedCreditStatement = (params = {}) =>
  api.get('/oxsteed-credit/statement', { params })
    .then((response) => response.data?.statement || null);

export const downloadOxsteedCreditStatement = (params = {}) =>
  api.get('/oxsteed-credit/statement.csv', { params, responseType: 'blob' });

export const getOxsteedCreditStatementPeriods = (params = {}) =>
  api.get('/oxsteed-credit/statement-periods', { params })
    .then((response) => response.data?.periods || []);

export const getOxsteedCreditAccountDetails = (params = {}) =>
  api.get('/oxsteed-credit/account-details', { params })
    .then((response) => response.data?.details || null);

// Credit redesign (D-797): the account letter download, gated by a fresh
// 'account_letter' step-up challenge issued through the money-out endpoint.
export const downloadOxsteedCreditAccountLetter = async (payload) => {
  const response = await api.post('/oxsteed-credit/account-details/letter', payload, { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `oxsteed-credit-account-letter-${payload?.currencyCode || 'USD'}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

// Group 13 Slice 4h (686-690): the participant/HQ door of the location
// reconciliation surface. The caller reads only their own restaurant's
// locations, server-enforced by requireRestaurantAccess; the admin
// reconciliation workspace is untouched.
export const listLocationReconciliationLocations = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/credit-reconciliation/locations`)
    .then((response) => response.data?.locations || []);
export const getLocationReconciliationSummary = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/credit-reconciliation/summary`, { params })
    .then((response) => response.data);
export const listLocationReconciliationExceptions = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/credit-reconciliation/exceptions`, { params })
    .then((response) => response.data);
export const addLocationReconciliationAnnotation = (restaurantId, exceptionId, body) =>
  api.post(`/restaurants/${restaurantId}/credit-reconciliation/exceptions/${encodeURIComponent(exceptionId)}/annotations`, { body })
    .then((response) => response.data);
export const getLocationReconciliationPeriodClose = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/credit-reconciliation/period-close`, { params })
    .then((response) => response.data);
export const recordLocationReconciliationPeriodClose = (restaurantId, params = {}) =>
  api.post(`/restaurants/${restaurantId}/credit-reconciliation/period-close`, params)
    .then((response) => response.data);
export const downloadLocationReconciliationExport = async (restaurantId, params = {}) => {
  const response = await api.get(`/restaurants/${restaurantId}/credit-reconciliation/export.csv`,
    { params, responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `oxsteed-credit-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

// Group 14 Slice 5b (709/710, D-426/D-427): the derived reconciliation
// checklist (open -> matched -> closed) and the closeout evidence package
// (a synchronous per-request ZIP over the already-posted records). Neither
// approves a settlement; the package re-authorizes on every download.
export const getLocationReconciliationChecklist = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/credit-reconciliation/checklist`, { params })
    .then((response) => response.data);
export const downloadLocationReconciliationCloseoutPackage = async (restaurantId, params = {}) => {
  const response = await api.post(`/restaurants/${restaurantId}/credit-reconciliation/closeout-package`,
    params, { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `oxsteed-credit-closeout-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

export const getOxsteedCreditTransaction = (transactionId, params = {}) =>
  api.get(`/oxsteed-credit/transactions/${transactionId}`, { params }).then((response) => response.data?.transaction || null);

export const createOxsteedCreditHold = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/holds', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const releaseOxsteedCreditHold = (holdId, payload = {}) =>
  api.post(`/oxsteed-credit/holds/${holdId}/release`, payload)
    .then((response) => response.data);

// Group 13, item 670 (D-367): one-click re-authorization from an expired hold.
export const reauthorizeOxsteedCreditHold = (holdId) =>
  api.post(`/oxsteed-credit/holds/${holdId}/reauthorize`)
    .then((response) => response.data);

export const openOxsteedCreditDispute = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/disputes', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const listOxsteedCreditDisputes = (params = {}) =>
  api.get('/oxsteed-credit/disputes', { params })
    .then((response) => response.data?.disputes || []);

export const getOxsteedCreditDisputePage = (params = {}) =>
  api.get('/oxsteed-credit/disputes', { params })
    .then((response) => response.data || { disputes: [], pagination: { limit: 25, offset: 0, hasMore: false, nextOffset: null } });

// Group 13, item 674 (D-371/D-372/D-373): customer evidence on their own
// open dispute. The submit takes a FormData body (note and/or one file)
// plus an idempotency key; the list returns signed download URLs minted
// at read time — the storage key never leaves the server.
export const listOxsteedCreditDisputeEvidence = (disputeId) =>
  api.get(`/oxsteed-credit/disputes/${encodeURIComponent(disputeId)}/evidence`)
    .then((response) => response.data?.evidence || []);

export const submitOxsteedCreditDisputeEvidence = (disputeId, formData, idempotencyKey) =>
  api.post(`/oxsteed-credit/disputes/${encodeURIComponent(disputeId)}/evidence`, formData, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

// -- OxSteed Credit money OUT (Phase 6) -----------------------------------
// Withdrawals to the customer's connected bank account, restaurant credit
// conversions, and fee quotes shown before confirming.

export const getOxsteedCreditFeeQuote = (params = {}) =>
  api.get('/oxsteed-credit/fee-quotes', { params }).then((response) => response.data?.quote || null);

export const requestOxsteedCreditWithdrawal = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/withdrawals', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const listOxsteedCreditWithdrawals = (params = {}) =>
  api.get('/oxsteed-credit/withdrawals', { params })
    .then((response) => response.data?.withdrawals || []);

export const cancelOxsteedCreditWithdrawal = (withdrawalId) =>
  api.post(`/oxsteed-credit/withdrawals/${withdrawalId}/cancel`).then((response) => response.data);

export const createOxsteedCreditTransfer = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/transfers', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

// Transfer recipient lookup (admin-ops audit item 4): resolves a pasted
// customer id to a display name for the review panel. Returns the name
// only, never an email address.
export const getOxsteedCreditTransferRecipient = (customerId) =>
  api.get(`/oxsteed-credit/transfer-recipients/${encodeURIComponent(customerId)}`).then((response) => response.data?.recipient || null);

// Credit redesign (D-798): resolve a recipient by account number or by
// card number (a scanned card or QR code), instead of a pasted UUID.
export const resolveOxsteedCreditTransferRecipient = (payload) =>
  api.post('/oxsteed-credit/transfer-recipients/resolve', payload).then((response) => response.data?.recipient || null);

export const createOxsteedCreditRestaurantConversion = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/restaurant-conversions', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const listOxsteedCreditRestaurantConversions = (params = {}) =>
  api.get('/oxsteed-credit/restaurant-conversions', { params })
    .then((response) => response.data?.conversions || []);

// Restaurant conversion allowlist: restaurant ids with the from_restaurant
// direction enabled by OxSteed (gated server-side too; to_restaurant is gated
// server-side on an active credit-partner row).
export const getRestaurantConversionEligibility = () =>
  api.get('/oxsteed-credit/restaurant-conversion-eligibility')
    .then((response) => response.data || { enabledRestaurantIds: [], count: 0 });

export const issueOxsteedCreditMoneyOutStepup = (payload) =>
  api.post('/oxsteed-credit/money-out/stepup-challenges', payload).then((response) => response.data);

// -- OxSteed Credit cards --------------------------------------------------
// A card is only a credential onto the customer's existing wallet above; it
// never represents a second balance.

export const listOxsteedCreditCards = () =>
  api.get('/oxsteed-credit/cards').then((response) => response.data?.cards || []);

export const issueOxsteedCreditVirtualCard = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/cards/virtual', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const requestOxsteedCreditPhysicalCard = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/cards/physical', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const activateOxsteedCreditCard = (cardId, payload, idempotencyKey) =>
  api.post(`/oxsteed-credit/cards/${cardId}/activate`, payload, { headers: { 'Idempotency-Key': idempotencyKey } }).then((response) => response.data);

export const freezeOxsteedCreditCard = (cardId, payload = {}) =>
  api.post(`/oxsteed-credit/cards/${cardId}/freeze`, payload).then((response) => response.data);

export const unfreezeOxsteedCreditCard = (cardId, payload = {}, idempotencyKey) =>
  api.post(`/oxsteed-credit/cards/${cardId}/unfreeze`, payload, { headers: { 'Idempotency-Key': idempotencyKey } }).then((response) => response.data);

export const reportOxsteedCreditCardLost = (cardId, payload = {}) =>
  api.post(`/oxsteed-credit/cards/${cardId}/report-lost`, payload).then((response) => response.data);

export const setOxsteedCreditCardPin = (cardId, payload, idempotencyKey) =>
  api.post(`/oxsteed-credit/cards/${cardId}/pin`, payload, { headers: { 'Idempotency-Key': idempotencyKey } }).then((response) => response.data);

export const issueCreditCardSecurityChallenge = (cardId, payload) =>
  api.post(`/oxsteed-credit/cards/${cardId}/security-challenges`, payload).then(response => response.data);
export const getCreditCardHistory = (cardId, offset = 0) =>
  api.get(`/oxsteed-credit/cards/${cardId}/history`, { params: { offset, limit: 25 } }).then(response => response.data);
export const markCreditCardFound = cardId => api.post(`/oxsteed-credit/cards/${cardId}/found`).then(response => response.data);
export const requestCreditCardReplacement = cardId => api.post(`/oxsteed-credit/cards/${cardId}/replacement`).then(response => response.data);

// Review P2-549: customer top-up (fiat money IN).
export const createOxsteedCreditTopup = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/topups', payload, { headers: { 'Idempotency-Key': idempotencyKey } }).then((response) => response.data);

export const getOxsteedCreditTopup = (topupId) =>
  api.get(`/oxsteed-credit/topups/${encodeURIComponent(topupId)}`).then((response) => response.data);

// Group 13 Slice 4f (680): retry a failed top-up from its own record. The
// idempotency key must be fresh per retry attempt; the server links the new
// attempt to the failed original and replays an existing retry.
export const retryOxsteedCreditTopup = (topupId, idempotencyKey) =>
  api.post(`/oxsteed-credit/topups/${encodeURIComponent(topupId)}/retry`, {}, { headers: { 'Idempotency-Key': idempotencyKey } }).then((response) => response.data);

export const listOxsteedCreditTopups = (params = {}) =>
  api.get('/oxsteed-credit/topups', { params }).then((response) => response.data?.topups || []);

// Group 13 Slice 4j (697): the customer's own consent history — every
// recorded terms/privacy acceptance plus the per-item disclosure
// acceptances, newest first. Read-only; the server scopes it to the caller.
export const getConsentHistory = () =>
  api.get('/consent/history').then((response) => response.data);

export const issueOxsteedCreditTopupStepup = (payload) =>
  api.post('/oxsteed-credit/stepup-challenges', payload).then((response) => response.data);

// P3-10-F05: credit-rail identity verification (KYC tier for fiat funding).
// Blocked users (tier 0) had no client path to request verification.
export const getOxsteedCreditIdentityVerification = () =>
  api.get('/oxsteed-credit/identity-verification').then((response) => response.data);

export const requestOxsteedCreditIdentityVerification = (payload = {}) =>
  api.post('/oxsteed-credit/identity-verification', payload).then((response) => response.data);

export const appealOxsteedCreditIdentityVerification = (verificationId, payload = {}) =>
  api.post(`/oxsteed-credit/identity-verification/${encodeURIComponent(verificationId)}/appeal`, payload).then((response) => response.data);
