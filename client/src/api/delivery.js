import api from './axios';

export const quoteDelivery = (payload) => api.post('/delivery/quote', payload).then((response) => response.data);
export const createDelivery = (payload) => api.post('/delivery/jobs', payload).then((response) => response.data);
export const listDeliveryJobs = () => api.get('/delivery/jobs').then((response) => response.data);
export const claimDeliveryJob = (id) => api.post(`/delivery/jobs/${id}/claim`).then((response) => response.data);
export const updateDeliveryStatus = (id, status) => api.patch(`/delivery/jobs/${id}/status`, { status }).then((response) => response.data);
