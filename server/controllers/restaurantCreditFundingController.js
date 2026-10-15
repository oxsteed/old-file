'use strict';

/**
 * Restaurant credit approval funding endpoints.
 *
 * Approval isn't complete until the reserve is funded. These endpoints wire
 * the funding step into the approval flow:
 *
 *  Merchant:
 *   GET  /food/merchant/credit-approval/funding-path
 *     -> { method: 'stripe' } or { method: 'manual', instructions }
 *   POST /food/merchant/credit-approval/funding-proof
 *     -> submit proof of manual payment (idempotent)
 *
 *  Admin:
 *   GET  /food/admin/credit-funding/submissions
 *     -> pending manual funding submissions (review queue)
 *   POST /food/admin/credit-funding/submissions/:id/verify
 *     -> { approve: true } credits the reserve and flips funding_status
 *        to 'funded'; { approve: false } rejects with a reason
 *   GET/POST/PUT /food/admin/funding-instructions
 *     -> CRUD for OxSteed's per-country funding instructions
 *
 * Money-safety: the reserve moves only via Stripe confirm (existing) or
 * admin verify with approve=true. All writes are idempotent.
 */

const { AppError } = require('../middleware/errorHandler');
const pool = require('../db');
const fundingService = require('../services/restaurantCreditFundingService');
const instructionsService = require('../services/oxsteedFundingInstructionsService');

function parseRestaurantId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return id;
}

async function requireRestaurantAccess(userId, restaurantId) {
  // Canonical restaurant access check (mirrors foodWalletController):
  // owner via businesses.user_id or food_restaurants.owner_user_id, else the
  // member's active business_members role. The previous version joined
  // food_restaurant_operators, a table no migration ever creates, which made
  // every merchant funding call 500.
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id, fr.owner_user_id, fr.display_name, fr.currency_code,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS operator_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1
      LIMIT 1`,
    [restaurantId, userId]
  );
  if (!rows[0] || !rows[0].operator_role) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return rows[0];
}

/**
 * GET /food/merchant/credit-approval/funding-path
 * Which funding method this restaurant uses (Stripe vs manual instructions).
 */
exports.getFundingPath = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.query.restaurantId || req.body?.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const path = await fundingService.determineFundingPath({ restaurantId });

    // Include the approval's current funding status so the UI knows where
    // the restaurant stands.
    const { rows: [approval] } = await pool.query(
      `SELECT status, funding_method, funding_status, funded_at
         FROM restaurant_credit_approvals WHERE restaurant_id = $1 LIMIT 1`,
      [restaurantId]
    );

    res.json({
      fundingPath: path,
      approval: approval
        ? {
            status: approval.status,
            fundingMethod: approval.funding_method,
            fundingStatus: approval.funding_status,
            fundedAt: approval.funded_at,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /food/merchant/credit-approval/funding-proof
 * Restaurant submits proof it paid via OxSteed's manual instructions.
 */
exports.submitFundingProof = async (req, res, next) => {
  try {
    const restaurantId = parseRestaurantId(req.body?.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const submission = await fundingService.submitManualFundingProof({
      restaurantId,
      operatorUserId: req.user.id,
      amountCents: req.body?.amountCents,
      currencyCode: req.body?.currencyCode,
      proofUrl: req.body?.proofUrl,
      reference: req.body?.reference,
      note: req.body?.note,
      idempotencyKey: req.body?.idempotencyKey,
    });
    res.status(201).json({ submission });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /food/admin/credit-funding/submissions
 * Admin review queue for manual funding proofs.
 */
exports.listFundingSubmissions = async (req, res, next) => {
  try {
    const submissions = await fundingService.listPendingFundingSubmissions({
      limit: req.query.limit,
    });
    res.json({ submissions });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /food/admin/credit-funding/submissions/:id/verify
 * Admin verifies (or rejects) a manual funding proof.
 * Body: { approve: boolean, rejectionReason?: string }
 */
exports.verifyFundingSubmission = async (req, res, next) => {
  try {
    const approve = req.body?.approve === true;
    if (!approve && !String(req.body?.rejectionReason || '').trim()) {
      throw new AppError('A rejection reason is required', 400, 'credit_funding_rejection_reason_required');
    }
    const result = await fundingService.verifyManualFunding({
      submissionId: req.params.id,
      adminUserId: req.user.id,
      approve,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /food/admin/funding-instructions
 */
exports.listFundingInstructions = async (req, res, next) => {
  try {
    const instructions = await instructionsService.listFundingInstructions({
      activeOnly: req.query.activeOnly === 'true',
    });
    res.json({ instructions });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /food/admin/funding-instructions
 */
exports.upsertFundingInstructions = async (req, res, next) => {
  try {
    const instructions = await instructionsService.upsertFundingInstructions({
      countryCode: req.body?.countryCode,
      currencyCode: req.body?.currencyCode,
      instructions: req.body?.instructions,
      qrUrl: req.body?.qrUrl,
      referenceHint: req.body?.referenceHint,
      isActive: req.body?.isActive !== false,
      adminUserId: req.user.id,
    });
    res.json({ instructions });
  } catch (err) {
    next(err);
  }
};
