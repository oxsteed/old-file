import api from './axios';

export const getOxsteedCreditAccount = (params = {}) =>
  api.get('/oxsteed-credit/account', { params }).then((response) => response.data?.account || null);

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
