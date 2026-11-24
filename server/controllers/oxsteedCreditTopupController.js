'use strict';

/**
 * OxSteed Credit Stripe top-up controller (fiat money IN).
 *
 * POST /api/oxsteed-credit/topups      create a top-up intent (customer)
 * GET  /api/oxsteed-credit/topups/:id  read a top-up's status (owner only)
 *
 * The compliance gate (evaluateFundingCompliance, fundingMethod
 * 'stripe_topup') runs BEFORE any persistent side effect, per the fiat
 * funding contract. The idempotency key comes from the Idempotency-Key
 * header or the request body and is required.
 */

const { AppError } = require('../middleware/errorHandler');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const { verifyStepupChallenge, topupRequiresStepup, issueStepupChallenge } = require('../services/stepupChallengeService');
const topupService = require('../services/oxsteedCreditTopupService');

function getIdempotencyKey(req) {
  const raw = req.get('Idempotency-Key') || req.body?.idempotencyKey || req.body?.idempotency_key;
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    throw new AppError('Idempotency-Key is required for credit top-ups', 400, 'credit_topup_idempotency_key_required');
  }
  return key;
}

function getRequestContext(req) {
  return {
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  };
}

function formatTopup(topup) {
  if (!topup) return null;
  return {
    id: String(topup.id),
    amountCents: Number(topup.amount_cents),
    currencyCode: topup.currency_code,
    status: topup.status,
    stripePaymentIntentId: topup.stripe_payment_intent_id || null,
    expiresAt: topup.expires_at,
    createdAt: topup.created_at,
    updatedAt: topup.updated_at,
    // Group 13 Slice 4f (680): the failed top-up this attempt retries, if
    // any — so the record view can link the chain both ways.
    retriedFromTopupId: topup.retried_from_topup_id ? String(topup.retried_from_topup_id) : null,
  };
}

// Group 13 Slice 4f (680): the retry attempt started from this top-up, if
// any — the "retry link" on the failed record. Looked up only on single
// record reads, never on lists.
async function retryTopupIdFor(topupId) {
  const child = await topupService.getTopupRetryChild({ topupId });
  return child ? String(child.id) : null;
}

async function createTopup(req, res, next) {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const idempotencyKey = getIdempotencyKey(req);
    const { amountCents, currencyCode } = req.body || {};
    const { requestIp, correlationId } = getRequestContext(req);

    // Step-up authentication (Phase 5): large top-ups require a fresh
    // single-use challenge verified before any persistent side effect.
    if (topupRequiresStepup(amountCents)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: customerId,
        actionType: 'topup',
        code: req.body?.stepupCode || req.body?.stepup_code,
        // Auth audit item 6: the challenge must have been issued for
        // this top-up amount, not just any top-up.
        expectedAmountCents: amountCents,
      });
    }

    // Compliance gate first: no persistent side effect happens before this.
    await evaluateFundingCompliance({
      customerId,
      amountCents,
      currencyCode,
      fundingMethod: 'stripe_topup',
      actorUserId: customerId,
      requestIp,
      correlationId,
    });

    const { topup, clientSecret, replayed } = await topupService.createTopup({
      customerId,
      amountCents,
      currencyCode,
      idempotencyKey,
    });

    res.status(replayed ? 200 : 201).json({
      topup: formatTopup(topup),
      clientSecret,
      replayed,
    });
  } catch (err) {
    next(err);
  }
}

async function getTopup(req, res, next) {
  try {
    const topup = await topupService.getCustomerTopup({
      customerId: req.user?.id,
      topupId: req.params.id,
    });
    if (!topup) {
      throw new AppError('Credit top-up not found', 404, 'credit_topup_not_found');
    }
    res.json({ topup: { ...formatTopup(topup), retryTopupId: await retryTopupIdFor(topup.id) } });
  } catch (err) {
    next(err);
  }
}

// Group 13 Slice 4f (680, D-376/D-377/D-378): retry a failed top-up from
// its own record. The service creates a new attempt through the existing
// createTopup path (same amount/currency, fresh idempotency key); the
// compliance gate runs first here, exactly as on create, and the router
// carries the same limiter / impersonation / checkout-restriction gates.
async function retryTopup(req, res, next) {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const idempotencyKey = getIdempotencyKey(req);
    const { requestIp, correlationId } = getRequestContext(req);

    // The original's amount/currency are the retry's terms; the
    // compliance gate re-runs for them before any persistent side effect.
    const original = await topupService.getCustomerTopup({
      customerId,
      topupId: req.params.id,
    });
    if (!original) {
      throw new AppError('Credit top-up not found', 404, 'credit_topup_not_found');
    }
    if (original.status !== 'failed') {
      throw new AppError('Only a failed top-up can be retried', 409, 'credit_topup_state_invalid');
    }
    if (original.funded_by_business_id) {
      throw new AppError('A business-funded top-up can only be retried by the business that funded it', 403, 'credit_topup_retry_funder_required');
    }
    if (topupRequiresStepup(Number(original.amount_cents))) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: customerId,
        actionType: 'topup',
        code: req.body?.stepupCode || req.body?.stepup_code,
        expectedAmountCents: Number(original.amount_cents),
      });
    }
    await evaluateFundingCompliance({
      customerId,
      amountCents: Number(original.amount_cents),
      currencyCode: original.currency_code,
      fundingMethod: 'stripe_topup',
      actorUserId: customerId,
      requestIp,
      correlationId,
    });

    const { topup, clientSecret, replayed } = await topupService.retryTopup({
      customerId,
      topupId: req.params.id,
      idempotencyKey,
    });

    res.status(replayed ? 200 : 201).json({
      topup: { ...formatTopup(topup), retryTopupId: null },
      clientSecret,
      replayed,
    });
  } catch (err) {
    next(err);
  }
}

// Group 13 Slice 4b (657): the customer's own top-ups, newest first.
// Read-only; the router's authenticate + requireRole('customer') gate
// applies and the service filters by the caller's id, so a customer sees
// only their own top-ups. `status` filters to one top-up status
// (pending/completed/failed/requires_attention); anything else is ignored
// and the unfiltered list is returned.
const CUSTOMER_TOPUP_STATUSES = new Set(['pending', 'completed', 'failed', 'requires_attention']);

async function listMyTopups(req, res, next) {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const rawStatus = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
    const status = CUSTOMER_TOPUP_STATUSES.has(rawStatus) ? rawStatus : null;
    const topups = await topupService.listCustomerTopups({
      customerId,
      status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ topups: topups.map(formatTopup) });
  } catch (err) {
    next(err);
  }
}

// ─── G-22: business-funded Credit ───────────────────────────────────────
// "Business-funded Credit implemented: owner/manager initiates, names a
// member, funds from the business payment method, with explicit
// authorization and an audit record; funds never move silently."
//
// The owner/manager pays with their own card (the returned client secret is
// confirmed by the funder, exactly like a self-service top-up); settlement
// credits the named member. The self-service path above is untouched:
// its requireRole('customer') + rejectImpersonated gates live on the
// /api/oxsteed-credit router, and this handler lives on the business
// router with its own owner/manager gate.
const db = require('../db');
const { canManageBusinessFinance } = require('../utils/businessOwnership');

function formatBusinessTopup(topup) {
  return {
    ...formatTopup(topup),
    fundedByUserId: topup.funded_by_user_id ? String(topup.funded_by_user_id) : null,
    fundedByBusinessId: topup.funded_by_business_id ? String(topup.funded_by_business_id) : null,
    fundingReason: topup.funding_reason || null,
    recipientCustomerId: topup.customer_id ? String(topup.customer_id) : null,
  };
}

async function createBusinessTopup(req, res, next) {
  try {
    const businessId = Number(req.params.businessId);
    const funderId = req.user?.id;
    if (!Number.isSafeInteger(businessId) || !funderId) {
      throw new AppError('A valid business is required', 400, 'validation_failed');
    }
    // Owner/manager only. No team permission code exists for funding
    // Credit, and none is invented: the decision is role-based.
    const access = await canManageBusinessFinance(funderId, businessId);
    if (!access) {
      throw new AppError('Only the business owner or a manager can fund member Credit.', 403, 'business_credit_fund_required');
    }
    const memberId = req.body?.memberId || req.body?.member_id;
    const reason = String(req.body?.reason || '').trim();
    if (!memberId) throw new AppError('A member to fund is required', 400, 'credit_topup_member_required');
    if (!reason) throw new AppError('A funding reason is required', 400, 'credit_topup_reason_required');
    if (reason.length > 500) throw new AppError('Funding reason is too long', 400, 'credit_topup_reason_too_long');
    const { rows: [member] } = await db.query(
      `SELECT bm.member_id, u.id AS user_id
         FROM business_members bm JOIN users u ON u.id = bm.member_id
        WHERE bm.business_id = $1 AND bm.member_id = $2 AND bm.status = 'active'`,
      [businessId, String(memberId)]);
    if (!member) {
      throw new AppError('Member not found for this business', 404, 'credit_topup_member_not_found');
    }
    const idempotencyKey = getIdempotencyKey(req);
    const { amountCents, currencyCode } = req.body || {};
    const { requestIp, correlationId } = getRequestContext(req);

    // The funder pays: step-up binds to the funder, not the recipient.
    if (topupRequiresStepup(amountCents)) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: funderId,
        actionType: 'topup',
        code: req.body?.stepupCode || req.body?.stepup_code,
        expectedAmountCents: amountCents,
      });
    }

    // Compliance gate for the recipient, with the funder as actor.
    await evaluateFundingCompliance({
      customerId: member.user_id,
      amountCents,
      currencyCode,
      fundingMethod: 'stripe_topup',
      actorUserId: funderId,
      requestIp,
      correlationId,
    });

    const { topup, clientSecret, replayed } = await topupService.createTopup({
      customerId: member.user_id,
      amountCents,
      currencyCode,
      idempotencyKey,
      fundedBy: { userId: funderId, businessId, reason },
    });

    res.status(replayed ? 200 : 201).json({
      topup: formatBusinessTopup(topup),
      clientSecret,
      replayed,
    });
  } catch (err) {
    next(err);
  }
}

async function getBusinessTopup(req, res, next) {
  try {
    const businessId = Number(req.params.businessId);
    const access = await canManageBusinessFinance(req.user?.id, businessId);
    if (!access) throw new AppError('Business finance access is required.', 403, 'business_finance_required');
    const topup = await topupService.getBusinessTopup({ businessId, topupId: req.params.topupId });
    if (!topup) throw new AppError('Credit top-up not found', 404, 'credit_topup_not_found');
    res.json({ topup: { ...formatBusinessTopup(topup), retryTopupId: await retryTopupIdFor(topup.id) } });
  } catch (err) {
    next(err);
  }
}

// Group 13 Slice 4f (680, D-379): the funder retries a failed
// business-funded top-up from its own record. Same funder, business, and
// reason as the original (the service reuses the stored funding row);
// the recipient cannot retry it as self-service. The compliance gate
// re-runs for the recipient with the funder as actor, exactly as on
// create, before any persistent side effect.
async function retryBusinessTopup(req, res, next) {
  try {
    const businessId = Number(req.params.businessId);
    const funderId = req.user?.id;
    if (!Number.isSafeInteger(businessId) || !funderId) {
      throw new AppError('A valid business is required', 400, 'validation_failed');
    }
    const access = await canManageBusinessFinance(funderId, businessId);
    if (!access) {
      throw new AppError('Only the business owner or a manager can fund member Credit.', 403, 'business_credit_fund_required');
    }
    const original = await topupService.getBusinessTopup({ businessId, topupId: req.params.topupId });
    if (!original) {
      throw new AppError('Credit top-up not found', 404, 'credit_topup_not_found');
    }
    if (original.status !== 'failed') {
      throw new AppError('Only a failed top-up can be retried', 409, 'credit_topup_state_invalid');
    }
    const idempotencyKey = getIdempotencyKey(req);
    const { requestIp, correlationId } = getRequestContext(req);

    if (topupRequiresStepup(Number(original.amount_cents))) {
      await verifyStepupChallenge({
        challengeId: req.body?.stepupChallengeId || req.body?.stepup_challenge_id,
        actorUserId: funderId,
        actionType: 'topup',
        code: req.body?.stepupCode || req.body?.stepup_code,
        expectedAmountCents: Number(original.amount_cents),
      });
    }
    await evaluateFundingCompliance({
      customerId: original.customer_id,
      amountCents: Number(original.amount_cents),
      currencyCode: original.currency_code,
      fundingMethod: 'stripe_topup',
      actorUserId: funderId,
      requestIp,
      correlationId,
    });

    const { topup, clientSecret, replayed } = await topupService.retryBusinessTopup({
      businessId,
      funderId,
      topupId: req.params.topupId,
      idempotencyKey,
    });

    res.status(replayed ? 200 : 201).json({
      topup: { ...formatBusinessTopup(topup), retryTopupId: null },
      clientSecret,
      replayed,
    });
  } catch (err) {
    next(err);
  }
}

async function listBusinessTopups(req, res, next) {
  try {
    const businessId = Number(req.params.businessId);
    const access = await canManageBusinessFinance(req.user?.id, businessId);
    if (!access) throw new AppError('Business finance access is required.', 403, 'business_finance_required');
    const topups = await topupService.listBusinessTopups({
      businessId, limit: req.query.limit, offset: req.query.offset,
    });
    res.json({ topups: topups.map(formatBusinessTopup) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/oxsteed-credit/stepup-challenges
 *
 * Issue a step-up challenge for a large top-up. The 6-digit code is emailed
 * to the customer; the response carries only the challenge id and expiry.
 * The client then calls POST /topups with { stepupChallengeId, stepupCode }.
 */
async function issueTopupStepupChallenge(req, res, next) {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const { amountCents, currencyCode } = req.body || {};
    if (!topupRequiresStepup(amountCents)) {
      throw new AppError('A step-up challenge is not required for this amount', 400, 'credit_stepup_not_required');
    }
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: customerId,
      actorEmail: req.user?.email,
      actionType: 'topup',
      amountCents,
      currencyCode: currencyCode || 'USD',
    });
    res.status(201).json({
      challenge: {
        id: challenge.id,
        actionType: challenge.actionType,
        amountCents: challenge.amountCents,
        currencyCode: challenge.currencyCode,
        expiresAt: challenge.expiresAt,
      },
      delivery,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createTopup,
  getTopup,
  retryTopup,
  listMyTopups,
  issueTopupStepupChallenge,
  createBusinessTopup,
  getBusinessTopup,
  retryBusinessTopup,
  listBusinessTopups,
};
