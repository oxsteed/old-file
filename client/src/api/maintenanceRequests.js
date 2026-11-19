import api from './axios';

export const getMaintenanceBusiness = (businessId) =>
  api.get(`/maintenance-requests/public/${businessId}`).then((r) => r.data);

export const createMaintenanceRequest = (businessId, formData) =>
  api.post(`/maintenance-requests/public/${businessId}`, formData).then((r) => r.data?.request);

export const listBusinessMaintenanceRequests = (businessId, params = {}) =>
  api.get(`/maintenance-requests/business/${businessId}`, { params }).then((r) => r.data);

// G-17: canonical properties for a business.
export const listBusinessProperties = (businessId) =>
  api.get(`/maintenance-requests/business/${businessId}/properties`).then((r) => r.data?.properties || []);

export const createBusinessProperty = (businessId, payload) =>
  api.post(`/maintenance-requests/business/${businessId}/properties`, payload).then((r) => r.data?.property);

// Requests assigned to the signed-in helper (their work queue).
export const listAssignedMaintenanceRequests = () =>
  api.get('/maintenance-requests/assigned').then((r) => r.data?.requests || []);

export const updateMaintenanceRequest = (requestId, payload) =>
  api.patch(`/maintenance-requests/${requestId}`, payload).then((r) => r.data?.request);

export const convertMaintenanceRequestToJob = (requestId) =>
  api.post(`/maintenance-requests/${requestId}/convert-to-job`).then((r) => r.data);

export const getMaintenanceRequest = (requestId) =>
  api.get(`/maintenance-requests/${requestId}`).then((r) => r.data);
