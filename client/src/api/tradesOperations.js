import api from './axios';

export const getPublicTradesOperations = (businessId, signal) =>
  api.get(`/trades-operations/public/${businessId}`, { signal }).then((r) => r.data);

export const createPublicTradesRequest = (businessId, formData) =>
  api.post(`/trades-operations/public/${businessId}/requests`, formData).then((r) => r.data?.request);

export const getTradesOperationsWorkspace = (businessId) =>
  api.get(`/trades-operations/business/${businessId}`).then((r) => r.data);

export const updateTradesOperationsSettings = (businessId, payload) =>
  api.put(`/trades-operations/business/${businessId}/settings`, payload).then((r) => r.data?.settings);

export const createTradesDiagnosticRequest = (businessId, payload) =>
  api.post(`/trades-operations/business/${businessId}/requests`, payload).then((r) => r.data?.request);

export const updateTradesDiagnosticRequest = (businessId, requestId, payload) =>
  api.put(`/trades-operations/business/${businessId}/requests/${requestId}`, payload).then((r) => r.data?.request);

export const createTradesRecommendation = (businessId, payload) =>
  api.post(`/trades-operations/business/${businessId}/recommendations`, payload).then((r) => r.data?.recommendation);

export const updateTradesRecommendation = (businessId, recommendationId, payload) =>
  api.put(`/trades-operations/business/${businessId}/recommendations/${recommendationId}`, payload).then((r) => r.data?.recommendation);

export const deleteTradesRecommendation = (businessId, recommendationId) =>
  api.delete(`/trades-operations/business/${businessId}/recommendations/${recommendationId}`).then((r) => r.data);

export const createTradesTrustRecord = (businessId, payload) =>
  api.post(`/trades-operations/business/${businessId}/trust-records`, payload).then((r) => r.data?.record);

export const updateTradesTrustRecord = (businessId, recordId, payload) =>
  api.put(`/trades-operations/business/${businessId}/trust-records/${recordId}`, payload).then((r) => r.data?.record);

export const deleteTradesTrustRecord = (businessId, recordId) =>
  api.delete(`/trades-operations/business/${businessId}/trust-records/${recordId}`).then((r) => r.data);
