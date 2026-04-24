// QR Code Generator API Client

import api from './axios';

export const qrCodesApi = {
  // Create a new QR code
  create: (payload) => api.post('/qr-codes', payload),

  // Get all QR codes for the user
  getAll: (limit = 20, offset = 0) =>
    api.get('/qr-codes', { params: { limit, offset } }),

  // Get a single QR code by ID
  getById: (id) => api.get(`/qr-codes/${id}`),

  // Update QR code metadata
  update: (id, payload) => api.put(`/qr-codes/${id}`, payload),

  // Delete a QR code
  delete: (id) => api.delete(`/qr-codes/${id}`),

  // Download QR code (with tracking)
  download: (id, format = 'png') =>
    api.post(`/qr-codes/${id}/download`, { format }),
};

export default qrCodesApi;
