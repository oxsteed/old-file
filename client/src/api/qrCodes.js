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

  // ────────────────────────────────────────────────────────────
  // TEMPLATES
  // ────────────────────────────────────────────────────────────

  // Get available preset templates
  getTemplates: () => api.get('/qr-codes/templates/list'),

  // ────────────────────────────────────────────────────────────
  // PRESETS
  // ────────────────────────────────────────────────────────────

  // Save a new styling preset
  savePreset: (payload) => api.post('/qr-codes/presets/save', payload),

  // Get user's saved presets
  getPresets: () => api.get('/qr-codes/presets/list'),

  // Delete a preset
  deletePreset: (presetId) => api.delete(`/qr-codes/presets/${presetId}`),

  // ────────────────────────────────────────────────────────────
  // BATCH GENERATION
  // ────────────────────────────────────────────────────────────

  // Create a new batch
  createBatch: (payload) => api.post('/qr-codes/batches/create', payload),

  // Get user's batches
  getBatches: (limit = 20, offset = 0) =>
    api.get('/qr-codes/batches/list', { params: { limit, offset } }),

  // Generate multiple QR codes from a batch
  generateBatchQRCodes: (batchId, payload) =>
    api.post(`/qr-codes/batches/${batchId}/generate`, payload),
};

export default qrCodesApi;
