'use strict';

/**
 * Identity verification tiers for the OxSteed Credit compliance perimeter
 * (Phase 5, gap 8).
 *
 * Tiers:
 *   0 = unverified. No fiat funding at all.
 *   1 = basic. Fiat funding up to OXSTEED_CREDIT_TIER1_TOPUP_MAX_CENTS.
 *   2 = verified. Fiat funding up to the rail transaction ceiling.
 *
 * Provider interface: a verification provider exposes
 *   createVerificationRequest({ customerId, requestedTier }) ->
 *     { provider, providerReference, status }
 *   getVerificationResult({ providerReference }) ->
 *     { status: 'pending'|'verified'|'rejected', tier, details }
 * Add a vendor (e.g. Stripe Identity) by implementing those two methods and
 * registering it in VERIFICATION_PROVIDERS below. Call sites only touch
 * requestIdentityVerification / reviewIdentityVerification /
 * getCustomerVerificationTier / assertIdentityVerificationTier, so a new
 * provider never requires touching the money paths.
 *
 * The shipped implementation is a manual admin review queue
 * (provider 'manual_review'): a customer requests verification, a
 * super-admin approves or rejects it in the compliance queue with a
 * recorded reason. Only provider references and review metadata are
 * stored here; raw ID document images, document numbers, and biometric
 * data must never be persisted in this rail.
 *
 * Thresholds:
 *   OXSTEED_CREDIT_TIER1_TOPUP_MAX_CENTS (default 50000 = $500)
 *   OXSTEED_CREDIT_TIER2_TOPUP_MAX_CENTS (default 250000 = $2,500)
 *   OXSTEED_CREDIT_IDENTITY_VERIFICATION_TTL_DAYS (default 730)
 */

const pool = require('../db');
const AppError = require('../utils/appError');
const { withTransaction } = require('../utils/transaction');
const { insertAudit } = require('./oxsteedCreditAdminService');

const TIER1_TOPUP_MAX_CENTS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_TIER1_TOPUP_MAX_CENTS || '50000', 10) || 50000
);
const TIER2_TOPUP_MAX_CENTS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_TIER2_TOPUP_MAX_CENTS || '250000', 10) || 250000
);
const VERIFICATION_TTL_DAYS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_IDENTITY_VERIFICATION_TTL_DAYS || '730', 10) || 730
);

const VERIFIED_TIER_FOR_REQUEST = { 1: 1, 2: 2 };

function normalizeString(value, max = 255) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text.slice(0, max);
}

/**
 * Manual review provider: verification is a human decision in the admin
 * compliance queue. createVerificationRequest opens a pending row; the
 * result only changes when reviewIdentityVerification records the admin
 * decision. getVerificationResult reads the row back so a future vendor
 * can be polled through the same call shape.
 */
const manualReviewProvider = {
  name: 'manual_review',
  async createVerificationRequest(client, { customerId, requestedTier }) {
    const providerReference = `manual:${customerId}:${Date.now()}`;
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_identity_verifications
         (customer_id, requested_tier, tier, status, provider, provider_reference)
       VALUES ($1, $2, 0, 'pending', 'manual_review', $3)
       ON CONFLICT (customer_id) WHERE status IN ('pending', 'verified')
       DO NOTHING
       RETURNING id, status`,
      [customerId, requestedTier, providerReference]
    );
    if (!rows[0]) {
      const existing = await client.query(
        `SELECT id, status FROM oxsteed_credit_identity_verifications
          WHERE customer_id = $1 AND status IN ('pending', 'verified')
          ORDER BY created_at DESC LIMIT 1`,
        [customerId]
      );
      return {
        provider: 'manual_review',
        providerReference: existing.rows[0] ? `manual:${customerId}:existing` : providerReference,
        status: existing.rows[0]?.status || 'pending',
        verificationId: existing.rows[0]?.id || null,
        replayed: true,
      };
    }
    return {
      provider: 'manual_review',
      providerReference,
      status: 'pending',
      verificationId: rows[0].id,
      replayed: false,
    };
  },
  async getVerificationResult(client, { verificationId }) {
    const { rows } = await client.query(
      `SELECT id, status, tier FROM oxsteed_credit_identity_verifications WHERE id = $1`,
      [verificationId]
    );
    if (!rows[0]) return { status: 'unknown', tier: 0, details: {} };
    return { status: rows[0].status, tier: Number(rows[0].tier), details: {} };
  },
};

/**
 * Didit provider: if the customer already has a verified, unexpired Didit
 * identity anchored to their entity ID, grant tier 2 with no human review.
 * Otherwise fall back to the manual review queue.
 *
 * Fail-closed: any database error while checking the Didit row raises instead
 * of granting a tier. The money paths never see a tier that was guessed.
 */
const diditProvider = {
  name: 'didit',
  async createVerificationRequest(client, { customerId, requestedTier }) {
    const ttlCutoff = new Date(Date.now() - VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let diditRows;
    try {
      ({ rows: diditRows } = await client.query(
        `SELECT id, provider_session_id, updated_at
           FROM identity_verifications
          WHERE provider = 'didit'
            AND status = 'verified'
            AND user_id = $1
            AND COALESCE(updated_at, created_at) > $2
          ORDER BY COALESCE(updated_at, created_at) DESC
          LIMIT 1`,
        [customerId, ttlCutoff]
      ));
    } catch (err) {
      throw new AppError('Identity lookup failed; verification not granted', 503, 'credit_identity_lookup_failed');
    }
    const diditRow = diditRows[0];
    if (!diditRow) {
      // No usable Didit verification: open (or reuse) a manual review request.
      return manualReviewProvider.createVerificationRequest(client, { customerId, requestedTier });
    }

    const grantedTier = VERIFIED_TIER_FOR_REQUEST[Number(requestedTier)] || 2;
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const providerReference = `didit:${diditRow.provider_session_id || diditRow.id}`;
    const reviewReason = 'Auto-approved: verified Didit identity on file';

    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_identity_verifications
         (customer_id, requested_tier, tier, status, provider, provider_reference,
          reviewed_at, review_reason, expires_at)
       VALUES ($1, $2, $3, 'verified', 'didit', $4, NOW(), $5, $6)
       ON CONFLICT (customer_id) WHERE status IN ('pending', 'verified')
       DO NOTHING
       RETURNING id, status`,
      [customerId, requestedTier, grantedTier, providerReference, reviewReason, expiresAt]
    );
    if (rows[0]) {
      return { provider: 'didit', providerReference, status: 'verified', verificationId: rows[0].id, replayed: false };
    }
    // An active row already exists: upgrade a pending one to verified, or
    // replay the existing verified one. Never downgrade.
    const { rows: existing } = await client.query(
      `SELECT id, status, tier, provider FROM oxsteed_credit_identity_verifications
        WHERE customer_id = $1 AND status IN ('pending', 'verified')
        ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    const current = existing[0];
    if (current && current.status === 'pending') {
      const { rows: upgraded } = await client.query(
        `UPDATE oxsteed_credit_identity_verifications
            SET tier = $2, status = 'verified', provider = 'didit',
                provider_reference = $3, reviewed_at = NOW(),
                review_reason = $4, expires_at = $5, updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING id`,
        [current.id, grantedTier, providerReference, reviewReason, expiresAt]
      );
      if (upgraded[0]) {
        return { provider: 'didit', providerReference, status: 'verified', verificationId: upgraded[0].id, replayed: false };
      }
    }
    return {
      provider: current?.provider || 'didit',
      providerReference: providerReference,
      status: current?.status || 'verified',
      verificationId: current?.id || null,
      replayed: true,
    };
  },
  async getVerificationResult(client, { verificationId }) {
    return manualReviewProvider.getVerificationResult(client, { verificationId });
  },
};

const VERIFICATION_PROVIDERS = Object.freeze({
  manual_review: manualReviewProvider,
  didit: diditProvider,
});

function getVerificationProvider(name) {
  const provider = VERIFICATION_PROVIDERS[name || 'manual_review'];
  if (!provider) throw new AppError(`Unknown identity verification provider '${name}'`, 500, 'credit_identity_provider_unknown');
  return provider;
}

function formatVerification(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    requestedTier: Number(row.requested_tier),
    tier: Number(row.tier),
    status: row.status,
    provider: row.provider,
    providerReference: row.provider_reference,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Effective tier for a customer: the tier of the newest verified,
 * unexpired row, else 0. Pending/rejected/expired rows grant nothing.
 */
async function getCustomerVerificationTier(client, customerId) {
  const { rows } = await client.query(
    `SELECT id, tier, status, expires_at
       FROM oxsteed_credit_identity_verifications
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 5`,
    [customerId]
  );
  for (const row of rows) {
    if (row.status === 'verified' && (!row.expires_at || new Date(row.expires_at) > new Date())) {
      return { tier: Number(row.tier), status: row.status, verificationId: String(row.id) };
    }
  }
  const pending = rows.find((row) => row.status === 'pending');
  return {
    tier: 0,
    status: pending ? 'pending' : rows[0]?.status || 'none',
    verificationId: pending ? String(pending.id) : null,
  };
}

/**
 * Customer-facing: open (or replay) a verification request. Fail closed
 * when the rail is disabled is enforced by the caller (the request rides
 * on an authenticated customer session; the money gate re-checks).
 */
async function requestIdentityVerification({ customerId, requestedTier = 2, providerName = 'manual_review', actorUserId = null, requestIp = null }) {
  if (!customerId) throw new AppError('Customer is required', 400, 'credit_identity_customer_required');
  const tier = Number(requestedTier);
  if (tier !== 1 && tier !== 2) throw new AppError('Requested tier must be 1 or 2', 400, 'credit_identity_tier_invalid');
  const provider = getVerificationProvider(providerName);
  return withTransaction(pool, async (client) => {
    const created = await provider.createVerificationRequest(client, { customerId, requestedTier: tier });
    await insertAudit(client, {
      actionType: 'credit.identity.verification_requested',
      actorUserId: actorUserId || customerId,
      customerId,
      resourceType: 'credit_identity_verification',
      resourceId: created.verificationId,
      reason: `Identity verification requested for tier ${tier} via ${provider.name}`,
      requestIp,
      afterState: { requestedTier: tier, provider: provider.name, status: created.status },
      metadata: { providerReference: created.providerReference, replayed: created.replayed },
    });
    return { ...created, requestedTier: tier };
  }, 'credit_identity_request');
}

/**
 * Admin decision on a pending verification. Approving sets the tier and an
 * expiry; rejecting closes the row so the customer may request again.
 * Append-only evidence: the decision is recorded on the row plus an audit
 * event, never a delete.
 */
async function reviewIdentityVerification({ verificationId, decision, actorUserId, reason, requestIp = null }) {
  if (!verificationId) throw new AppError('Verification id is required', 400, 'credit_identity_verification_required');
  if (decision !== 'approve' && decision !== 'reject') {
    throw new AppError("Decision must be 'approve' or 'reject'", 400, 'credit_identity_decision_invalid');
  }
  const normalizedReason = normalizeString(reason, 1000);
  if (!normalizedReason) throw new AppError('A review reason is required', 400, 'credit_identity_reason_required');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_identity_verifications WHERE id = $1 FOR UPDATE`,
      [verificationId]
    );
    const verification = rows[0];
    if (!verification) throw new AppError('Identity verification not found', 404, 'credit_identity_not_found');
    if (verification.status !== 'pending') {
      throw new AppError(`Verification is already ${verification.status}`, 409, 'credit_identity_state_conflict');
    }
    const grantedTier = decision === 'approve' ? (VERIFIED_TIER_FOR_REQUEST[Number(verification.requested_tier)] || 1) : 0;
    const newStatus = decision === 'approve' ? 'verified' : 'rejected';
    const expiresAt = decision === 'approve'
      ? new Date(Date.now() + VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const { rows: updated } = await client.query(
      `UPDATE oxsteed_credit_identity_verifications
          SET tier = $2, status = $3, reviewed_by = $4, reviewed_at = NOW(),
              review_reason = $5, expires_at = $6, updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [verificationId, grantedTier, newStatus, actorUserId, normalizedReason, expiresAt]
    );
    if (!updated[0]) throw new AppError('Verification was already decided', 409, 'credit_identity_state_conflict');
    await insertAudit(client, {
      actionType: 'credit.identity.verification_reviewed',
      actorUserId,
      customerId: verification.customer_id,
      resourceType: 'credit_identity_verification',
      resourceId: verificationId,
      reason: normalizedReason,
      requestIp,
      beforeState: { status: 'pending', tier: 0 },
      afterState: { status: newStatus, tier: grantedTier, expiresAt },
      metadata: { decision, requestedTier: Number(verification.requested_tier) },
    });
    return { verification: formatVerification(updated[0]), replayed: false };
  }, 'credit_identity_review');
}

/**
 * Gate for the fiat funding choke point. Throws AppError on denial; the
 * caller (evaluateFundingCompliance) records the denial in the audit
 * trail. Tier 0 blocks all fiat funding; tier 1 caps per top-up; tier 2
 * rides the rail ceiling.
 */
async function assertIdentityVerificationTier(client, { customerId, amountCents, fundingMethod }) {
  const { tier, status } = await getCustomerVerificationTier(client, customerId);
  if (tier <= 0) {
    throw new AppError(
      'Identity verification is required before fiat funding. Request verification to continue.',
      403,
      'credit_funding_verification_required',
      { verificationStatus: String(status) }
    );
  }
  const amount = Number(amountCents);
  const cap = tier === 1 ? TIER1_TOPUP_MAX_CENTS : TIER2_TOPUP_MAX_CENTS;
  if (amount > cap) {
    throw new AppError(
      `This funding amount exceeds the tier ${tier} per-transaction limit. Complete tier ${tier + 1} verification for larger amounts.`,
      403,
      'credit_funding_tier_limit',
      {
        tier: String(tier),
        amountCents: String(amount),
        tierLimitCents: String(cap),
        fundingMethod: String(fundingMethod || ''),
      }
    );
  }
  return { tier, tierLimitCents: cap };
}

async function listPendingVerifications(client, { limit = 50, offset = 0 } = {}) {
  const { rows } = await client.query(
    `SELECT v.*, u.email AS customer_email
       FROM oxsteed_credit_identity_verifications v
       LEFT JOIN users u ON u.id = v.customer_id
      WHERE v.status = 'pending'
      ORDER BY v.created_at ASC
      LIMIT $1 OFFSET $2`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0)]
  );
  return rows.map((row) => ({ ...formatVerification(row), customerEmail: row.customer_email || null }));
}

module.exports = {
  TIER1_TOPUP_MAX_CENTS,
  TIER2_TOPUP_MAX_CENTS,
  VERIFICATION_TTL_DAYS,
  VERIFICATION_PROVIDERS,
  getVerificationProvider,
  getCustomerVerificationTier,
  requestIdentityVerification,
  reviewIdentityVerification,
  assertIdentityVerificationTier,
  listPendingVerifications,
  formatVerification,
};
