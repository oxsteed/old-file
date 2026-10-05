import api from './axios';

export const getOxsteedCreditAccount = (params = {}) =>
  api.get('/oxsteed-credit/account', { params }).then((response) => response.data?.account || null);

export const getOxsteedCreditConversionQuote = (quoteId) =>
  api.get(`/oxsteed-credit/conversion-quotes/${quoteId}`).then((response) => response.data?.quote || null);

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

export const getOxsteedCreditTransaction = (transactionId, params = {}) =>
  api.get(`/oxsteed-credit/transactions/${transactionId}`, { params }).then((response) => response.data?.transaction || null);

export const createOxsteedCreditHold = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/holds', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const releaseOxsteedCreditHold = (holdId, payload = {}) =>
  api.post(`/oxsteed-credit/holds/${holdId}/release`, payload)
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
