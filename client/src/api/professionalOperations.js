import api from './axios';

export const getPublicProfessionalOperations = (businessId, signal) =>
  api.get(`/professional-operations/public/${businessId}`, { signal }).then((r) => r.data);

export const createPublicProfessionalIntake = (businessId, payload) =>
  api.post(`/professional-operations/public/${businessId}/intakes`, payload).then((r) => r.data?.request);

export const getProfessionalOperationsWorkspace = (businessId) =>
  api.get(`/professional-operations/business/${businessId}`).then((r) => r.data);

export const updateProfessionalOperationsSettings = (businessId, payload) =>
  api.put(`/professional-operations/business/${businessId}/settings`, payload).then((r) => r.data?.settings);

export const updateProfessionalEngagementRequest = (businessId, requestId, payload) =>
  api.put(`/professional-operations/business/${businessId}/intakes/${requestId}`, payload).then((r) => r.data?.request);

export const createProfessionalPackage = (businessId, payload) =>
  api.post(`/professional-operations/business/${businessId}/packages`, payload).then((r) => r.data?.package);

export const updateProfessionalPackage = (businessId, packageId, payload) =>
  api.put(`/professional-operations/business/${businessId}/packages/${packageId}`, payload).then((r) => r.data?.package);

export const deleteProfessionalPackage = (businessId, packageId) =>
  api.delete(`/professional-operations/business/${businessId}/packages/${packageId}`).then((r) => r.data);

export const createProfessionalComplianceRecord = (businessId, payload) =>
  api.post(`/professional-operations/business/${businessId}/compliance-records`, payload).then((r) => r.data?.record);

export const updateProfessionalComplianceRecord = (businessId, recordId, payload) =>
  api.put(`/professional-operations/business/${businessId}/compliance-records/${recordId}`, payload).then((r) => r.data?.record);

export const deleteProfessionalComplianceRecord = (businessId, recordId) =>
  api.delete(`/professional-operations/business/${businessId}/compliance-records/${recordId}`).then((r) => r.data);
