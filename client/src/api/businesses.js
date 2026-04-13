// client/src/api/businesses.js
// Business Hub API helpers — businesses, analytics, invoices, tax, goals.
import api from './axios';

// ── Businesses ────────────────────────────────────────────────────────────────
export const listBusinesses  = ()              => api.get('/businesses').then(r => r.data?.businesses || []);
export const createBusiness  = (payload)       => api.post('/businesses', payload).then(r => r.data?.business);
export const updateBusiness  = (id, payload)   => api.put(`/businesses/${id}`, payload).then(r => r.data?.business);
export const setPrimary      = (id)            => api.put(`/businesses/${id}/primary`).then(r => r.data?.business);
export const deleteBusiness  = (id)            => api.delete(`/businesses/${id}`).then(r => r.data);

// ── Analytics ─────────────────────────────────────────────────────────────────
export const getAnalytics    = (id)            => api.get(`/businesses/${id}/analytics`).then(r => r.data);

// ── Invoices ──────────────────────────────────────────────────────────────────
export const listInvoices    = (id, params={}) => api.get(`/businesses/${id}/invoices`, { params }).then(r => r.data);
export const getInvoice      = (id, invId)     => api.get(`/businesses/${id}/invoices/${invId}`).then(r => r.data?.invoice);
export const createInvoice   = (id, payload)   => api.post(`/businesses/${id}/invoices`, payload).then(r => r.data?.invoice);
export const updateInvoice   = (id, invId, p)  => api.put(`/businesses/${id}/invoices/${invId}`, p).then(r => r.data?.invoice);
export const markInvoicePaid = (id, invId, amount) => api.post(`/businesses/${id}/invoices/${invId}/pay`, { amount }).then(r => r.data?.invoice);
export const deleteInvoice   = (id, invId)     => api.delete(`/businesses/${id}/invoices/${invId}`).then(r => r.data);

// ── Tax estimates ─────────────────────────────────────────────────────────────
export const getTax          = (id)            => api.get(`/businesses/${id}/tax`).then(r => r.data);
export const refreshTax      = (id)            => api.post(`/businesses/${id}/tax/refresh`).then(r => r.data);
export const markTaxPaid     = (id, estId, amount) => api.post(`/businesses/${id}/tax/${estId}/pay`, { amount }).then(r => r.data?.estimate);

// ── Goals ─────────────────────────────────────────────────────────────────────
export const listGoals       = (id)            => api.get(`/businesses/${id}/goals`).then(r => r.data?.goals || []);
export const createGoal      = (id, payload)   => api.post(`/businesses/${id}/goals`, payload).then(r => r.data?.goal);
export const updateGoal      = (id, goalId, p) => api.put(`/businesses/${id}/goals/${goalId}`, p).then(r => r.data?.goal);
export const deleteGoal      = (id, goalId)    => api.delete(`/businesses/${id}/goals/${goalId}`).then(r => r.data);
