import api from './axios';

export const getMaintenanceBusiness = (businessId) =>
  api.get(`/maintenance-requests/public/${businessId}`).then((r) => r.data);

export const createMaintenanceRequest = (businessId, formData) =>
  api.post(`/maintenance-requests/public/${businessId}`, formData).then((r) => r.data?.request);

export const listBusinessMaintenanceRequests = (businessId, params = {}) =>
  api.get(`/maintenance-requests/business/${businessId}`, { params }).then((r) => r.data);

export const updateMaintenanceRequest = (requestId, payload) =>
  api.patch(`/maintenance-requests/${requestId}`, payload).then((r) => r.data?.request);

export const convertMaintenanceRequestToJob = (requestId) =>
  api.post(`/maintenance-requests/${requestId}/convert-to-job`).then((r) => r.data);

export const getMaintenanceRequest = (requestId) =>
  api.get(`/maintenance-requests/${requestId}`).then((r) => r.data);
