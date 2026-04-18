// client/src/api/businesses.js
// Business Hub API helpers — businesses, analytics, invoices, tax, goals.
import api from './axios';

// ── Businesses ────────────────────────────────────────────────────────────────
export const listBusinesses        = ()              => api.get('/businesses').then(r => r.data?.businesses || []);
export const createBusiness        = (payload)       => api.post('/businesses', payload).then(r => r.data?.business);
export const updateBusiness        = (id, payload)   => api.put(`/businesses/${id}`, payload).then(r => r.data?.business);
export const setPrimary            = (id)            => api.put(`/businesses/${id}/primary`).then(r => r.data?.business);
export const deleteBusiness        = (id)            => api.delete(`/businesses/${id}`).then(r => r.data);
// Upload logo and/or cover photo (multipart/form-data)
export const uploadBusinessPhotos  = (id, logoFile, coverFile) => {
  const fd = new FormData();
  if (logoFile)  fd.append('logo',  logoFile);
  if (coverFile) fd.append('cover', coverFile);
  // Let the browser set multipart boundary (manual Content-Type breaks uploads).
  return api.put(`/businesses/${id}/photos`, fd).then(r => r.data);
};
// Public — no auth required
export const getBusinessPublicProfile = (id)         => api.get(`/businesses/${id}/public`).then(r => r.data);
// Owner/manager — full address for Business Hub editor
export const getBusinessProfileForEditor = (id)      => api.get(`/businesses/${id}/profile-edit`).then(r => r.data);

// ── Analytics ─────────────────────────────────────────────────────────────────
export const getAnalytics    = (id)            => api.get(`/businesses/${id}/analytics`).then(r => r.data);

// ── Invoices ──────────────────────────────────────────────────────────────────
export const listInvoices    = (id, params={}) => api.get(`/businesses/${id}/invoices`, { params }).then(r => r.data);
export const getInvoice      = (id, invId)     => api.get(`/businesses/${id}/invoices/${invId}`).then(r => r.data?.invoice);
export const createInvoice   = (id, payload)   => api.post(`/businesses/${id}/invoices`, payload).then(r => r.data?.invoice);
export const updateInvoice   = (id, invId, p)  => api.put(`/businesses/${id}/invoices/${invId}`, p).then(r => r.data?.invoice);
export const sendInvoice     = (id, invId)     => api.post(`/businesses/${id}/invoices/${invId}/send`).then(r => r.data);
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

// ── Team members ──────────────────────────────────────────────────────────────
export const listMembers         = (id)           => api.get(`/businesses/${id}/members`).then(r => r.data?.members || []);
export const inviteMember        = (id, payload)  => api.post(`/businesses/${id}/members`, payload).then(r => r.data);
export const revokeMember        = (id, memberId) => api.delete(`/businesses/${id}/members/${memberId}`).then(r => r.data);

// ── Invitations (received by the logged-in user) ──────────────────────────────
export const listMyInvitations   = ()             => api.get('/businesses/invitations').then(r => r.data?.invitations || []);
export const acceptInvitation    = (id)           => api.post(`/businesses/invitations/${id}/accept`).then(r => r.data);
export const declineInvitation   = (id)           => api.post(`/businesses/invitations/${id}/decline`).then(r => r.data);

// ── Businesses I manage as a representative / manager ─────────────────────────
export const listManagedBusinesses = ()           => api.get('/businesses/managed').then(r => r.data?.businesses || []);

// ── Vortex tokens ─────────────────────────────────────────────────────────────
export const listVortexTokens    = (bizId)               => api.get(`/businesses/${bizId}/vortex-tokens`).then(r => r.data?.tokens || []);
export const generateVortexToken = (bizId, payload)      => api.post(`/businesses/${bizId}/vortex-tokens`, payload).then(r => r.data?.token);
export const revokeVortexToken   = (bizId, tokenId)      => api.delete(`/businesses/${bizId}/vortex-tokens/${tokenId}`).then(r => r.data);
export const redeemVortexToken   = (token)               => api.post('/businesses/vortex/redeem', { token }).then(r => r.data);

// ── Business content: Services ─────────────────────────────────────────────────
export const listBusinessServices  = (bizId)             => api.get(`/businesses/${bizId}/services`).then(r => r.data || []);
export const createBusinessService = (bizId, payload)    => api.post(`/businesses/${bizId}/services`, payload).then(r => r.data);
export const updateBusinessService = (bizId, svcId, p)   => api.put(`/businesses/${bizId}/services/${svcId}`, p).then(r => r.data);
export const deleteBusinessService = (bizId, svcId)      => api.delete(`/businesses/${bizId}/services/${svcId}`).then(r => r.data);

// ── Business content: Gallery ──────────────────────────────────────────────────
export const listBusinessGallery   = (bizId)             => api.get(`/businesses/${bizId}/gallery`).then(r => r.data || []);
export const addBusinessPhoto      = (bizId, payload)    => api.post(`/businesses/${bizId}/gallery`, payload).then(r => r.data);
export const updateBusinessPhoto   = (bizId, photoId, p) => api.put(`/businesses/${bizId}/gallery/${photoId}`, p).then(r => r.data);
export const deleteBusinessPhoto   = (bizId, photoId)    => api.delete(`/businesses/${bizId}/gallery/${photoId}`).then(r => r.data);

// ── Business content: Policies ─────────────────────────────────────────────────
export const listBusinessPolicies  = (bizId)             => api.get(`/businesses/${bizId}/policies`).then(r => r.data || []);
export const createBusinessPolicy  = (bizId, payload)    => api.post(`/businesses/${bizId}/policies`, payload).then(r => r.data);
export const updateBusinessPolicy  = (bizId, policyId, p) => api.put(`/businesses/${bizId}/policies/${policyId}`, p).then(r => r.data);
export const deleteBusinessPolicy  = (bizId, policyId)   => api.delete(`/businesses/${bizId}/policies/${policyId}`).then(r => r.data);

// ── Business content: FAQs ─────────────────────────────────────────────────────
export const listBusinessFAQs      = (bizId)             => api.get(`/businesses/${bizId}/faqs`).then(r => r.data || []);
export const createBusinessFAQ     = (bizId, payload)    => api.post(`/businesses/${bizId}/faqs`, payload).then(r => r.data);
export const updateBusinessFAQ     = (bizId, faqId, p)   => api.put(`/businesses/${bizId}/faqs/${faqId}`, p).then(r => r.data);
export const deleteBusinessFAQ     = (bizId, faqId)      => api.delete(`/businesses/${bizId}/faqs/${faqId}`).then(r => r.data);

// ── Business content: Hours ────────────────────────────────────────────────────
export const listBusinessHours     = (bizId)             => api.get(`/businesses/${bizId}/hours`).then(r => r.data || []);
export const updateBusinessHours   = (bizId, payload)    => api.put(`/businesses/${bizId}/hours`, payload).then(r => r.data);
