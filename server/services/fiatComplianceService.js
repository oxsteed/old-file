'use strict';

/**
 * Fiat funding compliance choke point for the OxSteed Credit central-bank model.
 *
 * Every fiat-funded movement (Stripe top-ups today, bank rails tomorrow) MUST
 * pass through `evaluateFundingCompliance` before any persistent side effect.
 * It enforces:
 *   1. the credit-rail kill switch (fail closed when the rail is suspended),
 *   2. the existing velocity / issuance limits,
 *   3. identity verification tiers (Phase 5): tier 0 blocks all fiat
 *      funding, tier 1 caps per-transaction amounts,
 *   4. sanctions screening (Phase 5): every funding customer is screened;
 *      hits and provider errors block the funding, and
 *   5. a hash-chained compliance audit event for every decision, including
 *      denials (denials are written outside the rolled-back check
 *      transaction so the evidence survives).
 *
 * It is deliberately a single choke point so future KYC/AML plug-ins slot
 * in here without rework. Suspicious-activity reporting beyond the
 * transaction-monitoring case queue is not implemented here; fiat movement
 * must not be activated in production until the legal/compliance review
 * signs off (see the Phase 1 gap analysis, gap 8).
 */

const { withTransaction } = require('../utils/transaction');
const pool = require('../db');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const {
  assertCreditRailEnabled,
  assertSupportedCreditCurrency,
  assertIssuanceCapacity,
  MAX_TRANSACTION_CENTS,
} = require('./oxsteedCreditService');
const { assertIdentityVerificationTier } = require('./identityVerificationService');
const { assertSanctionsClear } = require('./sanctionsScreeningService');

const COMPLIANCE_ACTION_TYPE = 'fiat.funding_compliance_evaluated';
const COMPLIANCE_DENIED_ACTION_TYPE = 'fiat.funding_compliance_denied';

function normalizeString(value, max = 255) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

async function writeComplianceAudit(client, {
  actionType,
  actorUserId,
  customerId,
  resourceType,
  resourceId,
  reason,
  requestIp = null,
  beforeState = null,
  afterState = null,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, resource_type, resource_id,
        reason, request_ip, before_state, after_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      actionType,
      actorUserId || null,
      customerId || null,
      resourceType,
      String(resourceId),
      normalizeString(reason, 1000),
      requestIp || null,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
      JSON.stringify(metadata || {}),
    ]
  );
}

/**
 * Evaluate whether a fiat-funded load may proceed.
 *
 * @param {object} args
 * @param {string} args.customerId - UUID of the funding customer
 * @param {number} args.amountCents - positive integer minor units
 * @param {string} args.currencyCode - ISO 4217 code
 * @param {string} args.fundingMethod - e.g. 'stripe_topup'
 * @param {string} [args.actorUserId] - user performing the action (self for top-ups)
 * @param {string} [args.requestIp]
 * @param {string} [args.correlationId] - idempotency / trace id, recorded in audit
 * @returns {Promise<{allowed: true, checkedAt: string}>}
 * @throws {AppError} 503 when the rail is suspended, 402/409/429 on limit breaches
 */
async function evaluateFundingCompliance({
  customerId,
  amountCents,
  currencyCode,
  fundingMethod,
  actorUserId = null,
  requestIp = null,
  correlationId = null,
}) {
  if (!customerId) {
    throw new AppError('Customer is required for fiat funding compliance', 400, 'fiat_compliance_customer_required');
  }
  const normalizedMethod = normalizeString(fundingMethod, 64);
  if (!normalizedMethod) {
    throw new AppError('Funding method is required for fiat funding compliance', 400, 'fiat_compliance_method_required');
  }
  const auditContext = {
    actorUserId,
    customerId,
    resourceType: 'fiat_funding',
    requestIp,
    fundingMethod: normalizedMethod,
    correlationId: correlationId || null,
  };
  let decision;
  try {
    decision = await withTransaction(pool, async (client) => {
      // 1. Kill switch: fail closed when the rail is suspended.
      await assertCreditRailEnabled(client);

      // 2. Amount and currency validation against the existing limits.
      const amount = Number(amountCents);
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new AppError('Top-up amount must be a positive integer number of cents', 400, 'fiat_compliance_amount_invalid');
      }
      if (amount > MAX_TRANSACTION_CENTS) {
        throw new AppError('Top-up amount exceeds the maximum transaction size', 402, 'fiat_compliance_amount_limit');
      }
      const currency = assertSupportedCreditCurrency(currencyCode);

      // 3. Global + daily issuance capacity (same caps as admin loads).
      await assertIssuanceCapacity(client, amount, currency, customerId);

      // 4. Identity verification tier (Phase 5): tier 0 = no fiat funding,
      //    tier 1 = per-transaction cap, tier 2 = rail ceiling.
      const identity = await assertIdentityVerificationTier(client, {
        customerId,
        amountCents: amount,
        fundingMethod: normalizedMethod,
      });

      // 5. Sanctions screening (Phase 5): the funding customer must screen
      //    clear (or carry a fresh admin clearance); hits and provider
      //    errors fail closed.
      const sanctions = await assertSanctionsClear(client, {
        subjectType: 'customer',
        subjectId: customerId,
        context: { fundingMethod: normalizedMethod },
      });

      // 6. Record the pass in the hash-chained audit trail.
      const checkedAt = new Date().toISOString();
      await writeComplianceAudit(client, {
        actionType: COMPLIANCE_ACTION_TYPE,
        actorUserId,
        customerId,
        resourceType: 'fiat_funding',
        resourceId: correlationId || `${normalizedMethod}:${customerId}:${checkedAt}`,
        reason: `Fiat funding compliance passed for ${normalizedMethod}`,
        requestIp,
        afterState: {
          allowed: true,
          amountCents: amount,
          currencyCode: currency,
          fundingMethod: normalizedMethod,
          identityTier: identity.tier,
          sanctionsCleared: sanctions.cleared,
        },
        metadata: { fundingMethod: normalizedMethod, correlationId: correlationId || null, checkedAt },
      });

      return { allowed: true, checkedAt, identityTier: identity.tier };
    }, 'fiat_compliance_check');
  } catch (error) {
    // The check transaction rolled back, so the denial is recorded in its
    // own transaction: blocked attempts are compliance evidence too. A
    // failing denial write must never mask the original denial.
    if (error instanceof AppError) {
      try {
        await withTransaction(pool, async (client) => {
          await writeComplianceAudit(client, {
            actionType: COMPLIANCE_DENIED_ACTION_TYPE,
            actorUserId: auditContext.actorUserId,
            customerId: auditContext.customerId,
            resourceType: auditContext.resourceType,
            resourceId: auditContext.correlationId || `${auditContext.fundingMethod}:${auditContext.customerId}:${new Date().toISOString()}`,
            reason: `Fiat funding compliance denied for ${auditContext.fundingMethod}: ${error.code}`,
            requestIp: auditContext.requestIp,
            afterState: {
              allowed: false,
              amountCents: Number(amountCents),
              currencyCode: String(currencyCode || ''),
              fundingMethod: auditContext.fundingMethod,
              denialCode: error.code,
              denialStatus: error.status,
            },
            metadata: { fundingMethod: auditContext.fundingMethod, correlationId: auditContext.correlationId },
          });
        }, 'fiat_compliance_denied_audit');
      } catch (auditError) {
        logger.error('Fiat compliance denial audit write failed', {
          error: auditError.message,
          denialCode: error.code,
          customerId,
        });
      }
    }
    throw error;
  }
  return decision;
}

module.exports = {
  evaluateFundingCompliance,
  COMPLIANCE_ACTION_TYPE,
  COMPLIANCE_DENIED_ACTION_TYPE,
};
