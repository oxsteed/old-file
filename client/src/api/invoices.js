import axios from './axios';

const listInvoices = (limit = 20, offset = 0) =>
  axios.get('/invoices', { params: { limit, offset } });

const getInvoice = (invoiceId) =>
  axios.get(`/invoices/${invoiceId}`);

const markInvoicePaid = (invoiceId) =>
  axios.patch(`/invoices/${invoiceId}/mark-paid`);

const updateInvoiceStatus = (invoiceId, status) =>
  axios.patch(`/invoices/${invoiceId}/status`, { status });

const resendInvoiceEmail = (invoiceId) =>
  axios.post(`/invoices/${invoiceId}/resend-email`);

export default {
  listInvoices,
  getInvoice,
  markInvoicePaid,
  updateInvoiceStatus,
  resendInvoiceEmail,
};
