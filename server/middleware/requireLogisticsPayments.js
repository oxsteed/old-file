'use strict';
/**
 * Gate for Phase 3 logistics payment automation. New payment plumbing
 * stays DISABLED until merchant configuration and reconciliation checks
 * pass; enable with LOGISTICS_PAYMENTS_ENABLED=true. All new payment
 * endpoints answer 503 while disabled. Existing read endpoints are
 * unaffected.
 */
const { isLogisticsPaymentsEnabled } = require('../services/logisticsPaymentService');

module.exports = function requireLogisticsPayments(req, res, next) {
  if (isLogisticsPaymentsEnabled()) return next();
  return res.status(503).json({
    success: false,
    error: 'logistics_payments_disabled',
    code: 'logistics_payments_disabled',
    message: 'Logistics payments are not enabled yet. Checkout and payment webhooks are disabled until merchant configuration and reconciliation checks pass.',
  });
};
