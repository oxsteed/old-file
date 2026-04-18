import api from './axios';

// Customer: Create a lead request for a business
export const createLead = (businessId, data) =>
  api.post(`/leads/${businessId}/request`, data).then(r => r.data);

// Customer: Get my leads
export const getMyLeads = (status, page = 1, limit = 20) =>
  api.get('/leads/my', { params: { status, page, limit } }).then(r => r.data);

// Customer: Get single lead details
export const getLead = (leadId) =>
  api.get(`/leads/${leadId}`).then(r => r.data);

// Customer: Accept a quote
export const acceptQuote = (quoteId) =>
  api.post(`/leads/${quoteId}/accept-quote`).then(r => r.data);

// Business: Get my received leads
export const getBusinessLeads = (businessId, status, page = 1, limit = 20) =>
  api.get(`/leads/business/${businessId}`, { params: { status, page, limit } }).then(r => r.data);

// Business: Submit a quote for a lead
export const submitQuote = (leadId, data) =>
  api.post(`/leads/${leadId}/quote`, data).then(r => r.data);

// Business: Reject a lead
export const rejectLead = (leadId) =>
  api.post(`/leads/${leadId}/reject`).then(r => r.data);

// Business: Mark lead as completed
export const completeLead = (leadId) =>
  api.post(`/leads/${leadId}/complete`).then(r => r.data);
