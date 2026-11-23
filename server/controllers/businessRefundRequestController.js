'use strict';

// PR804 Track C — G-20: business-initiated refund requests.
// The requester queues for platform-admin approval and never executes.

const refundRequests = require('../services/businessRefundRequestService');
const { AppError } = require('../middleware/errorHandler');

exports.requestRefund = async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const jobId = Number(req.params.jobId);
    if (!Number.isSafeInteger(businessId) || !Number.isSafeInteger(jobId)) {
      throw new AppError('A valid business and job are required.', 400, 'validation_failed');
    }
    // Groups 5-6 item 226: business refund approval threshold (owner only above it).
    await require('../services/businessOwner/policyService').assertRefundRequestAllowed(businessId, req.businessRole,
      req.body?.amount_cents ?? req.body?.amountCents ?? null, req.body?.fullRefund === true || req.body?.full_refund === true);
    const { approval, replay, requestId } = await refundRequests.requestBusinessRefund({
      businessId,
      userId: req.user.id,
      jobId,
      amountCents: req.body?.amount_cents ?? req.body?.amountCents ?? null,
      fullRefund: req.body?.fullRefund === true || req.body?.full_refund === true,
      reason: req.body?.reason,
      idempotencyKey: req.get('Idempotency-Key') || null,
    });
    return res.status(202).json({
      message: 'Refund request queued for platform-admin approval.',
      approvalId: approval.id,
      status: approval.status,
      amountCents: Number(approval.amount_cents),
      currencyCode: approval.currency_code,
      requestId,
      replay: Boolean(replay),
    });
  } catch (err) {
    next(err);
  }
};

exports.listRefundRequests = async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const jobId = Number(req.params.jobId);
    if (!Number.isSafeInteger(businessId) || !Number.isSafeInteger(jobId)) {
      throw new AppError('A valid business and job are required.', 400, 'validation_failed');
    }
    const requests = await refundRequests.listBusinessRefundRequests({
      businessId,
      userId: req.user.id,
      jobId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ requests });
  } catch (err) {
    next(err);
  }
};
