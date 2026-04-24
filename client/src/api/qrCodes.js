import api from './axios';

export const qrCodesApi = {
  generateQRCode: (config) =>
    api.post('/qr-codes/generate', config),

  getTemplates: () =>
    api.get('/qr-codes/templates'),

  saveQRCode: (qrCodeData) =>
    api.post('/qr-codes', qrCodeData),

  getMyQRCodes: () =>
    api.get('/qr-codes'),

  getQRCode: (id) =>
    api.get(`/qr-codes/${id}`),

  updateQRCode: (id, updates) =>
    api.put(`/qr-codes/${id}`, updates),

  deleteQRCode: (id) =>
    api.delete(`/qr-codes/${id}`),
};

export default qrCodesApi;
