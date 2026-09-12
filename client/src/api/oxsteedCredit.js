import api from './axios';

export const getOxsteedCreditAccount = () =>
  api.get('/oxsteed-credit/account').then((response) => response.data?.account || null);

export const listOxsteedCreditEligiblePartners = (params = {}) =>
  api.get('/oxsteed-credit/eligible-partners', { params })
    .then((response) => response.data?.partners || []);

export const listOxsteedCreditTransactions = (params = {}) =>
  api.get('/oxsteed-credit/transactions', { params })
    .then((response) => response.data?.transactions || []);

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
