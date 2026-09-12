import api from './axios';

export const getOxsteedCreditAccount = (params = {}) =>
  api.get('/oxsteed-credit/account', { params }).then((response) => response.data?.account || null);

export const listOxsteedCreditAccounts = () =>
  api.get('/oxsteed-credit/accounts').then((response) => response.data?.accounts || []);

export const listOxsteedCreditEligiblePartners = (params = {}) =>
  api.get('/oxsteed-credit/eligible-partners', { params })
    .then((response) => response.data?.partners || []);

export const listOxsteedCreditTransactions = (params = {}) =>
  api.get('/oxsteed-credit/transactions', { params })
    .then((response) => response.data?.transactions || []);

export const getOxsteedCreditStatement = (params = {}) =>
  api.get('/oxsteed-credit/statement', { params })
    .then((response) => response.data?.statement || null);

export const downloadOxsteedCreditStatement = (params = {}) =>
  api.get('/oxsteed-credit/statement.csv', { params, responseType: 'blob' });

export const getOxsteedCreditTransaction = (transactionId) =>
  api.get(`/oxsteed-credit/transactions/${transactionId}`).then((response) => response.data?.transaction || null);

export const createOxsteedCreditHold = (payload, idempotencyKey) =>
  api.post('/oxsteed-credit/holds', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((response) => response.data);

export const releaseOxsteedCreditHold = (holdId, payload = {}) =>
  api.post(`/oxsteed-credit/holds/${holdId}/release`, payload)
    .then((response) => response.data);

export const openOxsteedCreditDispute = (payload) =>
  api.post('/oxsteed-credit/disputes', payload).then((response) => response.data);

export const listOxsteedCreditDisputes = (params = {}) =>
  api.get('/oxsteed-credit/disputes', { params })
    .then((response) => response.data?.disputes || []);
