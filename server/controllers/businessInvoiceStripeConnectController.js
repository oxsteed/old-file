'use strict';

const { loadPayableInvoiceForPayer } = require('../services/businessInvoiceCreditPayService');
const { evaluateInvoiceCardEligibility } = require('../services/businessInvoiceStripeConnectService');
const { businessInvoiceStripeConnectEnabled } = require('../utils/businessInvoiceHelpers');

function parseBusinessInvoiceId(raw) {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('tr-')) return null;
  if (!/^\d+$/.test(value)) return null;
  return value;
}

exports.getInvoiceCardEligibility = async (req, res, next) => {
  try {
    const invoiceId = parseBusinessInvoiceId(req.params.invoiceId || req.params.id);
    if (!invoiceId) {
      return res.status(404).json({ success: false, error: 'Invoice not found', code: 'invoice_not_found' });
    }

    if (!businessInvoiceStripeConnectEnabled()) {
      return res.json({
        success: true,
        eligible: false,
        code: 'invoice_card_pay_disabled',
        launchHidden: true,
      });
    }

    const invoice = await loadPayableInvoiceForPayer(invoiceId, req.user);
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found', code: 'invoice_not_found' });
    }

    const eligibility = await evaluateInvoiceCardEligibility(invoice, req.user);
    return res.json({ success: true, ...eligibility });
  } catch (err) {
    next(err);
  }
};
