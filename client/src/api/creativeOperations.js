import api from './axios';

export const getPublicCreativeOperations = (businessId, signal) =>
  api.get(`/creative-operations/public/${businessId}`, { signal }).then((r) => r.data);

export const createPublicCreativeIntake = (businessId, formData) =>
  api.post(`/creative-operations/public/${businessId}/intakes`, formData).then((r) => r.data?.request);

export const getCreativeOperationsWorkspace = (businessId) =>
  api.get(`/creative-operations/business/${businessId}`).then((r) => r.data);

export const updateCreativeOperationsSettings = (businessId, payload) =>
  api.put(`/creative-operations/business/${businessId}/settings`, payload).then((r) => r.data?.settings);

export const updateCreativeIntakeRequest = (businessId, requestId, payload) =>
  api.put(`/creative-operations/business/${businessId}/intakes/${requestId}`, payload).then((r) => r.data?.request);

export const createCreativePackage = (businessId, payload) =>
  api.post(`/creative-operations/business/${businessId}/packages`, payload).then((r) => r.data?.package);

export const updateCreativePackage = (businessId, packageId, payload) =>
  api.put(`/creative-operations/business/${businessId}/packages/${packageId}`, payload).then((r) => r.data?.package);

export const deleteCreativePackage = (businessId, packageId) =>
  api.delete(`/creative-operations/business/${businessId}/packages/${packageId}`).then((r) => r.data);

export const createCreativeApprovalRecord = (businessId, payload) =>
  api.post(`/creative-operations/business/${businessId}/approval-records`, payload).then((r) => r.data?.record);

export const updateCreativeApprovalRecord = (businessId, recordId, payload) =>
  api.put(`/creative-operations/business/${businessId}/approval-records/${recordId}`, payload).then((r) => r.data?.record);

export const deleteCreativeApprovalRecord = (businessId, recordId) =>
  api.delete(`/creative-operations/business/${businessId}/approval-records/${recordId}`).then((r) => r.data);
