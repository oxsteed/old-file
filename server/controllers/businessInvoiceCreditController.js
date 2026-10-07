'use strict';

const { AppError } = require('../middleware/errorHandler');
const {
  loadPayableInvoiceForPayer,
  evaluateInvoiceCreditEligibility,
  payBusinessInvoiceWithCredit,
} = require('../services/businessInvoiceCreditPayService');
const { businessInvoiceCreditPayEnabled } = require('../utils/businessInvoiceHelpers');

function requestIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    null
  );
}

function parseBusinessInvoiceId(raw) {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('tr-')) return null;
  if (!/^\d+$/.test(value)) return null;
  return value;
}

exports.getInvoiceCreditEligibility = async (req, res, next) => {
  try {
    const invoiceId = parseBusinessInvoiceId(req.params.invoiceId || req.params.id);
    if (!invoiceId) {
      return res.status(404).json({ success: false, error: 'Invoice not found', code: 'invoice_not_found' });
    }

    if (!businessInvoiceCreditPayEnabled()) {
      return res.json({
        success: true,
        eligible: false,
        code: 'invoice_credit_pay_disabled',
        launchHidden: true,
      });
    }

    const invoice = await loadPayableInvoiceForPayer(invoiceId, req.user);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found', code: 'invoice_not_found' });
    }

    const eligibility = await evaluateInvoiceCreditEligibility(invoice, req.user);
    return res.json({ success: true, ...eligibility });
  } catch (err) {
    next(err);
  }
};

exports.payInvoiceWithOxsteedCredit = async (req, res, next) => {
  try {
    const invoiceId = parseBusinessInvoiceId(req.params.invoiceId || req.params.id);
    if (!invoiceId) {
      throw new AppError('Invoice not found', 404, 'invoice_not_found');
    }

    const idempotencyKey =
      req.headers['idempotency-key'] ||
      req.headers['Idempotency-Key'] ||
      req.body?.idempotencyKey ||
      req.body?.idempotency_key;

    const amountCents =
      req.body?.amountCents !== undefined
        ? req.body.amountCents
        : req.body?.amount_cents;

    const result = await payBusinessInvoiceWithCredit({
      invoiceId,
      user: req.user,
      idempotencyKey,
      amountCents,
      isImpersonated: Boolean(req.isImpersonated),
      requestIp: requestIp(req),
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
