import api from './axios';

export const getPublicBeautyOperations = (businessId, signal) =>
  api.get(`/beauty-operations/public/${businessId}`, { signal }).then((r) => r.data);

export const createPublicBeautyIntake = (businessId, formData) =>
  api.post(`/beauty-operations/public/${businessId}/intakes`, formData).then((r) => r.data?.request);

export const getBeautyOperationsWorkspace = (businessId) =>
  api.get(`/beauty-operations/business/${businessId}`).then((r) => r.data);

export const updateBeautyOperationsSettings = (businessId, payload) =>
  api.put(`/beauty-operations/business/${businessId}/settings`, payload).then((r) => r.data?.settings);

export const updateBeautyIntakeRequest = (businessId, requestId, payload) =>
  api.put(`/beauty-operations/business/${businessId}/intakes/${requestId}`, payload).then((r) => r.data?.request);

export const createBeautyPackage = (businessId, payload) =>
  api.post(`/beauty-operations/business/${businessId}/packages`, payload).then((r) => r.data?.package);

export const updateBeautyPackage = (businessId, packageId, payload) =>
  api.put(`/beauty-operations/business/${businessId}/packages/${packageId}`, payload).then((r) => r.data?.package);

export const deleteBeautyPackage = (businessId, packageId) =>
  api.delete(`/beauty-operations/business/${businessId}/packages/${packageId}`).then((r) => r.data);

export const createBeautyTrustRecord = (businessId, payload) =>
  api.post(`/beauty-operations/business/${businessId}/trust-records`, payload).then((r) => r.data?.record);

export const updateBeautyTrustRecord = (businessId, recordId, payload) =>
  api.put(`/beauty-operations/business/${businessId}/trust-records/${recordId}`, payload).then((r) => r.data?.record);

export const deleteBeautyTrustRecord = (businessId, recordId) =>
  api.delete(`/beauty-operations/business/${businessId}/trust-records/${recordId}`).then((r) => r.data);
