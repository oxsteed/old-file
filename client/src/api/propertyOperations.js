import api from './axios';

export const getPublicPropertyOperations = (businessId, signal) =>
  api.get(`/property-operations/public/${businessId}`, { signal }).then((r) => r.data);

export const getPropertyOperationsWorkspace = (businessId) =>
  api.get(`/property-operations/business/${businessId}`).then((r) => r.data);

export const updatePropertyOperationsSettings = (businessId, payload) =>
  api.put(`/property-operations/business/${businessId}/settings`, payload).then((r) => r.data?.settings);

export const createPropertyUnit = (businessId, payload) =>
  api.post(`/property-operations/business/${businessId}/units`, payload).then((r) => r.data?.unit);

export const updatePropertyUnit = (businessId, unitId, payload) =>
  api.put(`/property-operations/business/${businessId}/units/${unitId}`, payload).then((r) => r.data?.unit);

export const deletePropertyUnit = (businessId, unitId) =>
  api.delete(`/property-operations/business/${businessId}/units/${unitId}`).then((r) => r.data);

export const createPropertyPackage = (businessId, payload) =>
  api.post(`/property-operations/business/${businessId}/packages`, payload).then((r) => r.data?.package);

export const updatePropertyPackage = (businessId, packageId, payload) =>
  api.put(`/property-operations/business/${businessId}/packages/${packageId}`, payload).then((r) => r.data?.package);

export const deletePropertyPackage = (businessId, packageId) =>
  api.delete(`/property-operations/business/${businessId}/packages/${packageId}`).then((r) => r.data);

export const createPropertyComplianceRecord = (businessId, payload) =>
  api.post(`/property-operations/business/${businessId}/compliance-records`, payload).then((r) => r.data?.record);

export const updatePropertyComplianceRecord = (businessId, recordId, payload) =>
  api.put(`/property-operations/business/${businessId}/compliance-records/${recordId}`, payload).then((r) => r.data?.record);

export const deletePropertyComplianceRecord = (businessId, recordId) =>
  api.delete(`/property-operations/business/${businessId}/compliance-records/${recordId}`).then((r) => r.data);
