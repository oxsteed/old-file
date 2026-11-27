'use strict';

// G1-B8: customer-initiated refund requests.
// The requester queues for platform-admin approval and never executes.

const refundRequests = require('../services/customerRefundRequestService');
const { AppError } = require('../middleware/errorHandler');

exports.requestRefund = async (req, res, next) => {
  try {
    // Job ids are UUIDs (jobs.id is uuid): do not Number() them. The
    // business refund controller's Number(req.params.jobId) 400s every
    // real job for this reason; see the checkpoint report's sibling gaps.
    const jobId = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new AppError('A valid job is required.', 400, 'validation_failed');
    }
    const { approval, replay, requestId } = await refundRequests.requestCustomerRefund({
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
    const jobId = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new AppError('A valid job is required.', 400, 'validation_failed');
    }
    const requests = await refundRequests.listCustomerRefundRequests({
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
