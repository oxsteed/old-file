'use strict';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const PUBLIC_VIEW_STATUSES = new Set(['sent', 'partial', 'overdue', 'paid']);
const LOCKED_LINE_ITEM_STATUSES = new Set(['sent', 'partial', 'overdue', 'paid']);

function assertCreatableStatus(status) {
  const normalized = String(status || 'draft').toLowerCase();
  if (normalized !== 'draft') {
    return 'New invoices must be created with draft status';
  }
  return null;
}

function validateInvoiceUpdate(existing, body) {
  const status = String(existing.status || '').toLowerCase();
  if (status === 'paid' || status === 'cancelled') {
    return `Cannot edit an invoice in '${existing.status}' status`;
  }

  const requestedStatus = body.status != null ? String(body.status).toLowerCase() : null;
  if (LOCKED_LINE_ITEM_STATUSES.has(status)) {
    const forbiddenFields = ['line_items', 'invoice_tax_rate', 'subtotal', 'tax_amount', 'total'];
    for (const field of forbiddenFields) {
      if (body[field] !== undefined && body[field] !== null) {
        return 'Line items and totals cannot be changed after an invoice has been sent';
      }
    }
    if (requestedStatus && !['cancelled', status, 'partial', 'overdue', 'sent'].includes(requestedStatus)) {
      return 'Invalid status transition for a sent invoice';
    }
    if (requestedStatus === 'paid') {
      return 'Use the payment endpoint to record payments on sent invoices';
    }
  }

  return null;
}

function resolvePaymentDelta(rawAmount, invoiceTotal, amountAlreadyPaid) {
  const total = Number(invoiceTotal);
  const prior = round2(amountAlreadyPaid);
  const remaining = round2(total - prior);
  if (!Number.isFinite(total) || remaining <= 0) {
    return { error: 'Invoice is already fully paid' };
  }
  if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === '') {
    return { value: remaining };
  }
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > remaining + 0.009) {
    return { error: 'Payment amount must be greater than zero and no greater than the remaining balance.' };
  }
  return { value: round2(amount) };
}

function isInvoicePayer(invoice, user) {
  if (!invoice || !user?.id) return false;
  if (String(invoice.user_id) === String(user.id)) return false;
  const clientEmail = String(invoice.client_email || '').trim().toLowerCase();
  const payerEmail = String(user.email || '').trim().toLowerCase();
  return Boolean(clientEmail && payerEmail && clientEmail === payerEmail);
}

function stripeInvoiceCurrency(invoice) {
  return String(invoice?.currency_code || 'USD').trim().toLowerCase();
}

function businessInvoiceStripeConnectEnabled() {
  return process.env.BUSINESS_INVOICE_STRIPE_CONNECT_ENABLED === '1';
}

function businessInvoiceCreditPayEnabled() {
  return process.env.BUSINESS_INVOICE_CREDIT_PAY_ENABLED === '1';
}

const PAYABLE_INVOICE_STATUSES = new Set(['sent', 'partial', 'overdue']);

function invoiceBalanceCents(invoice) {
  const totalCents = Math.round(Number(invoice.total || 0) * 100);
  const paidCents = Math.round(Number(invoice.amount_paid || 0) * 100);
  return Math.max(0, totalCents - paidCents);
}

module.exports = {
  round2,
  PUBLIC_VIEW_STATUSES,
  assertCreatableStatus,
  validateInvoiceUpdate,
  resolvePaymentDelta,
  isInvoicePayer,
  stripeInvoiceCurrency,
  businessInvoiceStripeConnectEnabled,
  businessInvoiceCreditPayEnabled,
  PAYABLE_INVOICE_STATUSES,
  invoiceBalanceCents,
};
