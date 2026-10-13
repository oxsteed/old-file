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
  if (!Number.isFinite(total)) {
    return { error: 'Invalid invoice total' };
  }
  if (remaining <= 0) {
    if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === '') {
      return { error: 'Invoice is already fully paid' };
    }
    const targetPaid = Number(rawAmount);
    if (!Number.isFinite(targetPaid) || targetPaid < 0 || targetPaid > total + 0.009) {
      return {
        error: 'Correction amount must be between zero and the invoice total.',
      };
    }
    const target = round2(targetPaid);
    const delta = round2(target - prior);
    if (Math.abs(delta) < 0.005) {
      return { error: 'Payment amount does not change the balance.' };
    }
    return { value: delta, targetPaid: target };
  }
  if (rawAmount === undefined || rawAmount === null || String(rawAmount).trim() === '') {
    return { value: remaining };
  }
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'Payment amount must be greater than zero and no greater than the remaining balance.' };
  }
  const target = round2(amount);
  if (target < prior - 0.009) {
    const incrementTotal = round2(prior + amount);
    const canBeIncrement = incrementTotal <= total + 0.009
      && incrementTotal > prior + 0.009
      && amount <= remaining + 0.009;
    if (!canBeIncrement) {
      if (target < 0 || target > total + 0.009) {
        return {
          error: 'Correction amount must be between zero and the invoice total.',
        };
      }
      const delta = round2(target - prior);
      if (Math.abs(delta) < 0.005) {
        return { error: 'Payment amount does not change the balance.' };
      }
      return { value: delta, targetPaid: target };
    }
  }
  if (target > remaining + 0.009) {
    if (Math.abs(target - round2(total)) < 0.005) {
      return { value: remaining };
    }
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

// P3-9-F13: business invoices support three line-item types. 'item' lines
// build the subtotal, 'discount' lines reduce it (before tax), and 'fee'
// lines are added after tax. Stored `subtotal` is items minus discounts;
// invoices without discount/fee lines compute exactly as before.
const INVOICE_LINE_ITEM_TYPES = new Set(['item', 'discount', 'fee']);

function normalizeLineItemType(lineItem) {
  const raw = String(lineItem?.type || lineItem?.kind || 'item').trim().toLowerCase();
  return INVOICE_LINE_ITEM_TYPES.has(raw) ? raw : null;
}

// Returns an error string for invalid line items, or null when valid.
// Fail closed: unknown types, negative amounts, and discounts larger than
// the items subtotal are rejected instead of silently corrected.
function validateLineItems(lineItems) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return 'At least one line item is required';
  }
  let itemsSubtotal = 0;
  let discountTotal = 0;
  for (let index = 0; index < lineItems.length; index += 1) {
    const li = lineItems[index] || {};
    const label = `Line item ${index + 1}`;
    const type = normalizeLineItemType(li);
    if (!type) {
      return `${label}: unknown type '${String(li.type ?? li.kind ?? '')}'. Expected item, discount, or fee.`;
    }
    const quantity = li.quantity === undefined || li.quantity === null || li.quantity === '' ? 1 : Number(li.quantity);
    const unitPrice = li.unit_price === undefined || li.unit_price === null || li.unit_price === '' ? 0 : Number(li.unit_price);
    if (!Number.isFinite(quantity) || quantity < 0) {
      return `${label}: quantity must be zero or greater`;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return `${label}: unit price must be zero or greater`;
    }
    const amount = round2(quantity * unitPrice);
    if (type === 'item') itemsSubtotal = round2(itemsSubtotal + amount);
    else if (type === 'discount') discountTotal = round2(discountTotal + amount);
  }
  if (discountTotal > itemsSubtotal + 0.009) {
    return 'Discount line items cannot exceed the items subtotal';
  }
  return null;
}

function computeInvoiceTotals(lineItems, invoiceTaxRate) {
  const validationError = validateLineItems(lineItems);
  if (validationError) throw new Error(validationError);
  let itemsSubtotal = 0;
  let discountTotal = 0;
  let feeTotal = 0;
  for (const li of lineItems) {
    const type = normalizeLineItemType(li);
    const quantity = li.quantity === undefined || li.quantity === null || li.quantity === '' ? 1 : Number(li.quantity);
    const unitPrice = li.unit_price === undefined || li.unit_price === null || li.unit_price === '' ? 0 : Number(li.unit_price);
    const amount = round2(quantity * unitPrice);
    if (type === 'item') itemsSubtotal = round2(itemsSubtotal + amount);
    else if (type === 'discount') discountTotal = round2(discountTotal + amount);
    else feeTotal = round2(feeTotal + amount);
  }
  const subtotal = round2(itemsSubtotal - discountTotal);
  const rate = parseFloat(invoiceTaxRate || 0) / 100;
  const taxAmount = round2(subtotal * rate);
  const total = round2(subtotal + taxAmount + feeTotal);
  return {
    subtotal,
    tax_amount: taxAmount,
    total,
    discount_total: discountTotal,
    fee_total: feeTotal,
  };
}

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
  validateLineItems,
  computeInvoiceTotals,
  normalizeLineItemType,
  INVOICE_LINE_ITEM_TYPES: ['item', 'discount', 'fee'],
  resolvePaymentDelta,
  isInvoicePayer,
  stripeInvoiceCurrency,
  businessInvoiceStripeConnectEnabled,
  businessInvoiceCreditPayEnabled,
  PAYABLE_INVOICE_STATUSES,
  invoiceBalanceCents,
};
