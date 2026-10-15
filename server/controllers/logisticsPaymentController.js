'use strict';
/**
 * OxSteed Logistics — Phase 3 payment controller (HTTP layer).
 * All handlers assume the LOGISTICS_PAYMENTS_ENABLED gate (503) has run
 * via middleware/requireLogisticsPayments before them.
 */
const AppError = require('../utils/appError');
const payments = require('../services/logisticsPaymentService');
const { resolveLogisticsRole } = require('../middleware/requireLogisticsAccess');

async function requireStaff(req) {
  const role = await resolveLogisticsRole(req.user);
  if (!payments.isStaffRole(role)) {
    throw new AppError('Not authorized', 403, 'forbidden');
  }
  return role;
}

/** POST /api/logistics/checkout/attempt — create (or replay) a payment attempt. */
exports.createAttempt = async (req, res, next) => {
  try {
    const {
      idempotency_key: idempotencyKey,
      subject_type: subjectType,
      purchase_order_id: purchaseOrderId,
      participant_id: participantId,
      installment,
      method,
      amount_cents: amountCents,
    } = req.body || {};
    const result = await payments.createPaymentAttempt(req.user.id, {
      idempotencyKey,
      subjectType,
      purchaseOrderId: purchaseOrderId === undefined || purchaseOrderId === null
        ? undefined
        : Number(purchaseOrderId),
      participantId: participantId === undefined || participantId === null
        ? undefined
        : Number(participantId),
      installment,
      method,
      amountCents: amountCents === undefined || amountCents === null
        ? undefined
        : Number(amountCents),
    });
    res.status(result.idempotentReplay ? 200 : 201).json({
      success: true,
      idempotent_replay: result.idempotentReplay,
      data: {
        attempt: result.attempt,
        client_secret: result.clientSecret,
        credit: result.credit,
      },
    });
  } catch (err) { next(err); }
};

/** GET /api/logistics/checkout/attempt/:id — buyer or staff only. */
exports.getAttempt = async (req, res, next) => {
  try {
    const attempt = await payments.getPaymentAttempt(req.params.id);
    if (!attempt) return next(new AppError('Payment attempt not found', 404, 'not_found'));
    if (String(attempt.buyer_user_id) !== String(req.user.id)) {
      // Non-owners who are not staff get 404 (not 403) so attempt ids
      // cannot be enumerated by probing.
      const role = await resolveLogisticsRole(req.user);
      if (!payments.isStaffRole(role)) {
        return next(new AppError('Payment attempt not found', 404, 'not_found'));
      }
    }
    res.json({ success: true, data: { attempt: payments.publicAttempt(attempt) } });
  } catch (err) { next(err); }
};

/** GET /api/logistics/checkout/reconciliation — staff list. */
exports.listReconciliation = async (req, res, next) => {
  try {
    await requireStaff(req);
    const items = await payments.listReconciliation({
      status: req.query.status,
      kind: req.query.kind,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, data: { items } });
  } catch (err) { next(err); }
};

/** PATCH /api/logistics/checkout/reconciliation/:id — staff resolve. */
exports.resolveReconciliation = async (req, res, next) => {
  try {
    const role = await requireStaff(req);
    const item = await payments.resolveReconciliation(req.params.id, {
      status: req.body && req.body.status,
      notes: req.body && req.body.notes,
      resolvedBy: req.user.id,
    });
    res.json({ success: true, data: { item, resolved_by_role: role } });
  } catch (err) { next(err); }
};

/** POST /api/logistics/checkout/reconciliation/sweep — flag stuck attempts. */
exports.sweepStuck = async (req, res, next) => {
  try {
    await requireStaff(req);
    const result = await payments.sweepStuckAttempts();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
};
