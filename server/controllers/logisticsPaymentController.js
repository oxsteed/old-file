'use strict';
/**
 * OxSteed Logistics — Phase 3 payment controller (HTTP layer).
 * All handlers assume the LOGISTICS_PAYMENTS_ENABLED gate (503) has run
 * via middleware/requireLogisticsPayments before them.
 */
const AppError = require('../utils/appError');
const payments = require('../services/logisticsPaymentService');
const quotes = require('../services/logisticsQuoteService');
const { resolveLogisticsRole, countryOnFile } = require('../middleware/requireLogisticsAccess');

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

// ─── Checkout context / quotes / payment history (Phase 3) ───
// All handlers assume the LOGISTICS_PAYMENTS_ENABLED gate (503) has run
// via middleware/requireLogisticsPayments before them.

/** GET /api/logistics/finance/checkout-context?orderId= | ?participantId= */
exports.getCheckoutContext = async (req, res, next) => {
  try {
    const role = await resolveLogisticsRole(req.user);
    const data = await quotes.getCheckoutContext(req.user.id, {
      orderId: req.query.orderId !== undefined ? req.query.orderId : req.query.purchase_order_id,
      participantId: req.query.participantId !== undefined ? req.query.participantId : req.query.participant_id,
      isStaff: payments.isStaffRole(role),
    });
    // The checkout UI prompts for a country before payment when none is on
    // file; POST /checkout/attempt enforces it (428 country_required).
    const buyerCountry = await countryOnFile(req.user.id);
    res.json({ success: true, data: data ? { ...data, buyer_country: buyerCountry, country_required: !buyerCountry } : data });
  } catch (err) { next(err); }
};

/** POST /api/logistics/finance/quotes — staff creates a draft quote version. */
exports.createQuote = async (req, res, next) => {
  try {
    await requireStaff(req);
    const quote = await quotes.createQuote(req.user.id, req.body || {});
    res.status(201).json({ success: true, data: { quote } });
  } catch (err) { next(err); }
};

/** POST /api/logistics/finance/quotes/:id/publish — staff publishes a draft. */
exports.publishQuote = async (req, res, next) => {
  try {
    await requireStaff(req);
    const quote = await quotes.publishQuote(req.user.id, req.params.id);
    res.json({ success: true, data: { quote } });
  } catch (err) { next(err); }
};

/** POST /api/logistics/finance/quotes/:id/accept — buyer accepts the pending version. */
exports.acceptQuote = async (req, res, next) => {
  try {
    const result = await quotes.acceptQuote(req.user.id, req.params.id, {
      idempotencyKey: req.body && req.body.idempotency_key,
    });
    res.json({
      success: true,
      idempotent_replay: result.idempotentReplay,
      data: { quote: result.quote },
    });
  } catch (err) { next(err); }
};

/** GET /api/logistics/finance/payment-history — the buyer's own attempts. */
exports.getPaymentHistory = async (req, res, next) => {
  try {
    const data = await quotes.getPaymentHistory(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
      subjectType: req.query.subject_type,
      purchaseOrderId: req.query.purchase_order_id,
      participantId: req.query.participant_id,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

exports.listExceptions=async(req,res,next)=>{try{await requireStaff(req);
 const {rows}=await require('../db').query(`SELECT e.*,p.title FROM logistics_review_exceptions e
 LEFT JOIN pooled_orders p ON p.id=e.pooled_order_id WHERE e.status='open' ORDER BY e.created_at LIMIT 200`);
 res.json({success:true,data:{items:rows}});
}catch(e){next(e)}};
exports.resolveException=async(req,res,next)=>{try{await requireStaff(req);
 const notes=String(req.body.notes||'').trim();if(!notes)throw new AppError('Resolution notes required',400,'validation_failed');
 const {rows}=await require('../db').query(`UPDATE logistics_review_exceptions SET status='resolved',
 resolution_notes=$2,resolved_by=$3,resolved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='open' RETURNING *`,[req.params.id,notes,req.user.id]);
 if(!rows[0])throw new AppError('Exception not found',404,'not_found');
 require('../services/logisticsAuditService').logLogisticsAction('pooled_order',rows[0].pooled_order_id,'exception_resolved',{actorUserId:req.user.id,notes});
 res.json({success:true,data:{item:rows[0]}});
}catch(e){next(e)}};

exports.listStaffQuotes=async(req,res,next)=>{try{await requireStaff(req);res.json({success:true,data:{quotes:await quotes.listStaffQuotes(req.query)}});}catch(e){next(e)}};
exports.cancelAttempt=async(req,res,next)=>{try{const attempt=await payments.getPaymentAttempt(req.params.id);
 if(!attempt)throw new AppError('Payment not found',404,'not_found');
 if(String(attempt.buyer_user_id)!==String(req.user.id))await requireStaff(req);
 const result=await payments.cancelAttempt(attempt.id);res.json({success:true,data:{attempt:result}});
}catch(e){next(e)}};
