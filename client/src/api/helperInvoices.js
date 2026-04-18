// client/src/api/helperInvoices.js
// Helper-scoped invoice API helpers — for helpers without a business

import api from './axios';

export const listHelperInvoices    = (params={})    => api.get('/helpers/invoices', { params }).then(r => r.data);
export const createHelperInvoice   = (payload)      => api.post('/helpers/invoices', payload).then(r => r.data?.invoice);
export const updateHelperInvoice   = (invId, p)     => api.put(`/helpers/invoices/${invId}`, p).then(r => r.data?.invoice);
export const sendHelperInvoice     = (invId)        => api.post(`/helpers/invoices/${invId}/send`).then(r => r.data);
export const markHelperInvoicePaid = (invId, amount) => api.post(`/helpers/invoices/${invId}/pay`, { amount }).then(r => r.data?.invoice);
export const deleteHelperInvoice   = (invId)        => api.delete(`/helpers/invoices/${invId}`).then(r => r.data);
