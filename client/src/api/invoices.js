import axios from './axios';

const listInvoices = (limit = 20, offset = 0, view = 'all') =>
  axios.get('/invoices', { params: { limit, offset, view } });

const getInvoice = (invoiceId) =>
  axios.get(`/invoices/${invoiceId}`);

const markInvoicePaid = (invoiceId) =>
  axios.patch(`/invoices/${invoiceId}/mark-paid`);

const updateInvoiceStatus = (invoiceId, status) =>
  axios.patch(`/invoices/${invoiceId}/status`, { status });

const resendInvoiceEmail = (invoiceId) =>
  axios.post(`/invoices/${invoiceId}/resend-email`);

const getInvoiceCreditEligibility = (invoiceId) =>
  axios.get(`/invoices/${invoiceId}/credit-eligibility`);

const payInvoiceWithCredit = (invoiceId, body) =>
  axios.post(`/invoices/${invoiceId}/pay-with-credit`, body, {
    headers: body?.idempotencyKey
      ? { 'Idempotency-Key': body.idempotencyKey }
      : undefined,
  });

const getInvoiceCardEligibility = (invoiceId) =>
  axios.get(`/invoices/${invoiceId}/card-eligibility`);

const createInvoiceCardPaymentIntent = (invoiceId, body) =>
  axios.post(`/invoices/${invoiceId}/payment-intent`, body || {});

const confirmInvoiceCardPayment = (invoiceId, body) =>
  axios.post(`/invoices/${invoiceId}/confirm-payment`, body);

export default {
  listInvoices,
  getInvoice,
  markInvoicePaid,
  updateInvoiceStatus,
  resendInvoiceEmail,
  getInvoiceCreditEligibility,
  payInvoiceWithCredit,
  getInvoiceCardEligibility,
  createInvoiceCardPaymentIntent,
  confirmInvoiceCardPayment,
};
