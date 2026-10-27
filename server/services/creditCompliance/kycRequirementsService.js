'use strict';

/**
 * KYC tiers and re-verification (licence readiness §5).
 *
 * Tiers live in oxsteed_credit_identity_verifications (0 none, 1 basic,
 * 2 identity document, 3 enhanced due diligence). Cash-out requires
 * OXSTEED_CREDIT_CASHOUT_MIN_KYC_TIER (default 2) and no open requirement.
 *
 * Requirements (credit_kyc_requirements) open on:
 *   - identity_expiry: a verification expires within 30 days (periodic job);
 *   - periodic_review: last verification older than OXSTEED_KYC_REVIEW_MONTHS
 *     (default 24, 12 for tier 3);
 *   - new_payout_destination: any payout account after the first;
 *   - legal_name_change: DB trigger on users;
 *   - aml_case: high/critical AML case (amlRules batch).
 * A requirement is satisfied by a verification at or above its tier that is
 * newer than the requirement. Waiving needs two administrators.
 */

const pool = require('../../db');
const AppError = require('../../utils/appError');
const { insertComplianceAudit } = require('./audit');

const REVIEW_MONTHS = () => Math.max(1, Number.parseInt(process.env.OXSTEED_KYC_REVIEW_MONTHS || '24', 10) || 24);
const EDD_REVIEW_MONTHS = () => Math.max(1, Number.parseInt(process.env.OXSTEED_KYC_EDD_REVIEW_MONTHS || '12', 10) || 12);

/** Open requirement, auto-satisfied by a newer verification at its tier. */
async function getOpenRequirement(client, userId) {
  const { rows } = await client.query(
    `SELECT r.*, v.id AS verification_id
       FROM credit_kyc_requirements r
       LEFT JOIN LATERAL (
         SELECT id FROM oxsteed_credit_identity_verifications v
          WHERE v.customer_id = r.user_id AND v.status = 'verified' AND v.tier >= r.required_tier
            AND v.updated_at > r.created_at AND (v.expires_at IS NULL OR v.expires_at > NOW())
          ORDER BY v.updated_at DESC LIMIT 1
       ) v ON TRUE
      WHERE r.user_id = $1 AND r.status = 'open'
      ORDER BY r.created_at`,
    [userId]
  );
  let open = null;
  for (const r of rows) {
    if (r.verification_id) {
      await client.query(
        `UPDATE credit_kyc_requirements SET status = 'satisfied', satisfied_at = NOW(), satisfied_by_verification = $2
          WHERE id = $1 AND status = 'open'`,
        [r.id, r.verification_id]
      );
    } else if (!open) {
      open = { id: r.id, trigger: r.trigger, requiredTier: Number(r.required_tier), createdAt: r.created_at };
    }
  }
  return open;
}

async function openRequirement(client, { userId, trigger, sourceId = null, requiredTier = 2 }) {
  const { rows } = await client.query(
    `INSERT INTO credit_kyc_requirements (user_id, trigger, source_id, required_tier)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, trigger) WHERE status = 'open' DO NOTHING
     RETURNING *`,
    [userId, trigger, sourceId, requiredTier]
  );
  return rows[0] || null;
}

/** Event hook called by money paths. */
async function recordTrigger(client, { userId, trigger, sourceId = null }) {
  if (trigger === 'new_payout_destination') {
    // The first account is covered by onboarding KYC; later ones re-verify.
    const { rows: [c] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM credit_payout_destinations
        WHERE user_id = $1 AND status IN ('verified', 'disabled') AND id::text <> COALESCE($2, '')`,
      [userId, sourceId]
    );
    if (Number(c.n) === 0) return null;
  }
  return openRequirement(client, { userId, trigger, sourceId });
}

/** Daily: expiry and periodic review; then notify (localized) once. */
async function runPeriodicTriggers() {
  await pool.query(
    `INSERT INTO credit_kyc_requirements (user_id, trigger, source_id, required_tier)
     SELECT DISTINCT ON (v.customer_id) v.customer_id, 'identity_expiry', v.id::text, GREATEST(v.tier, 1)
       FROM oxsteed_credit_identity_verifications v
      WHERE v.status = 'verified' AND v.expires_at IS NOT NULL AND v.expires_at < NOW() + INTERVAL '30 days'
        AND NOT EXISTS (SELECT 1 FROM oxsteed_credit_identity_verifications n
                         WHERE n.customer_id = v.customer_id AND n.status = 'verified'
                           AND (n.expires_at IS NULL OR n.expires_at >= NOW() + INTERVAL '30 days'))
      ORDER BY v.customer_id, v.expires_at DESC
     ON CONFLICT (user_id, trigger) WHERE status = 'open' DO NOTHING`
  );
  await pool.query(
    `INSERT INTO credit_kyc_requirements (user_id, trigger, source_id, required_tier)
     SELECT latest.customer_id, 'periodic_review', latest.id::text, latest.tier
       FROM (SELECT DISTINCT ON (customer_id) id, customer_id, tier, updated_at
               FROM oxsteed_credit_identity_verifications WHERE status = 'verified' AND tier >= 2
              ORDER BY customer_id, updated_at DESC) latest
      WHERE latest.updated_at < NOW() - (CASE WHEN latest.tier >= 3 THEN $2::int ELSE $1::int END * INTERVAL '1 month')
     ON CONFLICT (user_id, trigger) WHERE status = 'open' DO NOTHING`,
    [REVIEW_MONTHS(), EDD_REVIEW_MONTHS()]
  );
  const { rows } = await pool.query(
    `SELECT id, user_id FROM credit_kyc_requirements WHERE status = 'open' AND notified_at IS NULL LIMIT 500`
  );
  const notices = require('./notices');
  for (const r of rows) {
    await notices.sendUserNotice({ userId: r.user_id, key: 'reverification_required', params: {}, idempotencyKey: `kyc-req:${r.id}` });
    await pool.query('UPDATE credit_kyc_requirements SET notified_at = NOW() WHERE id = $1', [r.id]);
  }
  return { notified: rows.length };
}

function validateWaive(payload) {
  if (!/^[0-9a-f-]{36}$/i.test(String(payload?.requirementId || ''))) throw new AppError('requirementId is required', 400, 'validation_failed');
  const reason = String(payload?.reason || '').trim();
  if (reason.length < 10) throw new AppError('A waiver reason of at least 10 characters is required', 400, 'validation_failed');
  return { requirementId: payload.requirementId, reason: reason.slice(0, 2000) };
}

async function applyWaive({ client, payload, requestedBy, actorUserId }) {
  const v = validateWaive(payload);
  const { rows } = await client.query(
    `UPDATE credit_kyc_requirements
        SET status = 'waived', waived_by = $2, waive_approved_by = $3, waive_reason = $4
      WHERE id = $1 AND status = 'open' RETURNING user_id, trigger`,
    [v.requirementId, requestedBy, actorUserId, v.reason]
  );
  if (!rows[0]) throw new AppError('Requirement not found or not open', 404, 'kyc_requirement_not_found');
  await insertComplianceAudit(client, {
    actionType: 'credit.kyc.requirement_waived', actorUserId, customerId: rows[0].user_id,
    resourceType: 'credit_kyc_requirement', resourceId: v.requirementId, reason: v.reason,
    afterState: { trigger: rows[0].trigger, waivedBy: requestedBy },
  });
  return { id: v.requirementId };
}
applyWaive.validate = validateWaive;

async function listOpen({ limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT r.*, u.email FROM credit_kyc_requirements r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'open' ORDER BY r.created_at LIMIT $1`, [Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

function registerOversightActions(register) {
  register('credit_kyc_requirement_waive', applyWaive);
}

module.exports = { getOpenRequirement, openRequirement, recordTrigger, runPeriodicTriggers, applyWaive, validateWaive, listOpen, registerOversightActions };
