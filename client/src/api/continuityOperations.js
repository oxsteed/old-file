import api from './axios';

export const getPublicContinuityOperations = (businessId) =>
  api.get(`/continuity-operations/public/${businessId}`).then((r) => r.data);

export const createPublicContinuityIntake = (businessId, payload) =>
  api.post(`/continuity-operations/public/${businessId}/intakes`, payload).then((r) => r.data?.request);

export const getContinuityOperationsWorkspace = (businessId) =>
  api.get(`/continuity-operations/business/${businessId}`).then((r) => r.data);

export const updateContinuityOperationsSettings = (businessId, payload) =>
  api.put(`/continuity-operations/business/${businessId}/settings`, payload).then((r) => r.data?.settings);

export const updateContinuityIntakeRequest = (businessId, requestId, payload) =>
  api.put(`/continuity-operations/business/${businessId}/intakes/${requestId}`, payload).then((r) => r.data?.request);

export const createContinuityPlan = (businessId, payload) =>
  api.post(`/continuity-operations/business/${businessId}/plans`, payload).then((r) => r.data?.plan);

export const updateContinuityPlan = (businessId, planId, payload) =>
  api.put(`/continuity-operations/business/${businessId}/plans/${planId}`, payload).then((r) => r.data?.plan);

export const deleteContinuityPlan = (businessId, planId) =>
  api.delete(`/continuity-operations/business/${businessId}/plans/${planId}`).then((r) => r.data);

export const createContinuityTrustRecord = (businessId, payload) =>
  api.post(`/continuity-operations/business/${businessId}/trust-records`, payload).then((r) => r.data?.record);

export const updateContinuityTrustRecord = (businessId, recordId, payload) =>
  api.put(`/continuity-operations/business/${businessId}/trust-records/${recordId}`, payload).then((r) => r.data?.record);

export const deleteContinuityTrustRecord = (businessId, recordId) =>
  api.delete(`/continuity-operations/business/${businessId}/trust-records/${recordId}`).then((r) => r.data);
