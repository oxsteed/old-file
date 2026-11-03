'use strict';

/**
 * Written consent to receive wages in OxSteed Credit (review §7: state
 * wage-payment laws and Reg E payroll-card rules require that the worker
 * can choose another way to be paid).
 *
 * - The consent history is append-only (DB trigger). Each grant records the
 *   SHA-256 of the exact wage-payment terms the worker saw; withdrawing
 *   records the alternative method they chose.
 * - OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED=true (default off until counsel
 *   sets the rule per jurisdiction): a customer cannot pay a helper in
 *   Credit unless that helper's latest decision is 'granted'
 *   (creditRail.placePaymentHold). The customer then pays another way.
 */

const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { insertComplianceAudit } = require('./audit');
const disclosures = require('./disclosureService');

const ALTERNATIVES = Object.freeze(['bank_transfer', 'cash', 'check', 'other']);
// Roles that can be paid for work (and therefore be paid wages in Credit).
const WORKER_ROLES = Object.freeze(['helper', 'helper_pro', 'helper_free', 'broker']);

function required() {
  return String(process.env.OXSTEED_CREDIT_WAGE_CONSENT_REQUIRED || '').trim().toLowerCase() === 'true';
}

async function latest(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM credit_wage_payment_consents WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getWageConsent({ user, language = 'en', currency = 'USD', db = pool }) {
  const row = await latest(db, user.id);
  const terms = await disclosures.getDisclosure('wage_payment_terms', language || user.preferred_language, { currency, db });
  // Gap fill 2: the choice is shown to every worker on its own, whether or
  // not cash-out is on, and to anyone who has already made a choice.
  const relevant = WORKER_ROLES.includes(String(user.role || '')) || Boolean(row);
  return {
    status: row ? row.decision : 'none',
    since: row ? row.created_at : null,
    alternative_method: row?.alternative_method || null,
    required: required(),
    relevant,
    terms,
  };
}

async function grantConsent({ user, language, termsSha256, currency = 'USD', isImpersonated = false, requestIp = null, userAgent = null, db = pool }) {
  if (isImpersonated) throw new AppError('Only you can give this consent', 403, 'impersonation_blocked');
  const terms = await disclosures.getDisclosure('wage_payment_terms', language || user.preferred_language, { currency, db });
  if (String(termsSha256 || '') !== terms.sha256) {
    throw new AppError('These terms have changed. Please read the current version.', 409, 'credit_disclosure_changed', { kind: 'wage_payment_terms' });
  }
  const { rows } = await db.query(
    `INSERT INTO credit_wage_payment_consents
       (user_id, decision, terms_content_sha256, terms_version_id, language, request_ip, user_agent)
     VALUES ($1, 'granted', $2, $3, $4, $5, $6) RETURNING *`,
    [user.id, terms.sha256, terms.version_id, terms.language, requestIp, userAgent ? String(userAgent).slice(0, 300) : null]
  );
  await db.query(
    `INSERT INTO credit_disclosure_acceptances
       (user_id, disclosure_kind, language, disclosure_version_id, content_sha256, context, request_ip, user_agent)
     VALUES ($1, 'wage_payment_terms', $2, $3, $4, 'wage_consent', $5, $6)
     ON CONFLICT (user_id, disclosure_kind, content_sha256) DO NOTHING`,
    [user.id, terms.language, terms.version_id, terms.sha256, requestIp, userAgent ? String(userAgent).slice(0, 300) : null]
  );
  await insertComplianceAudit(db, {
    actionType: 'credit.wage_consent.granted', actorUserId: user.id, customerId: user.id,
    resourceType: 'credit_wage_consent', resourceId: String(rows[0].id), reason: 'Worker chose to be paid in Credit', requestIp,
    afterState: { termsSha256: terms.sha256, termsVersion: terms.version, language: terms.language },
  });
  return { status: 'granted', since: rows[0].created_at };
}

async function withdrawConsent({ user, alternativeMethod, language, isImpersonated = false, requestIp = null, userAgent = null, db = pool }) {
  if (isImpersonated) throw new AppError('Only you can change this choice', 403, 'impersonation_blocked');
  if (!ALTERNATIVES.includes(alternativeMethod)) {
    throw new AppError('Choose how you want to be paid instead', 400, 'validation_failed', { alternative_method: 'required' });
  }
  const terms = await disclosures.getDisclosure('wage_payment_terms', language || user.preferred_language, { db });
  const { rows } = await db.query(
    `INSERT INTO credit_wage_payment_consents
       (user_id, decision, alternative_method, terms_content_sha256, terms_version_id, language, request_ip, user_agent)
     VALUES ($1, 'withdrawn', $2, $3, $4, $5, $6, $7) RETURNING *`,
    [user.id, alternativeMethod, terms.sha256, terms.version_id, terms.language, requestIp, userAgent ? String(userAgent).slice(0, 300) : null]
  );
  await insertComplianceAudit(db, {
    actionType: 'credit.wage_consent.withdrawn', actorUserId: user.id, customerId: user.id,
    resourceType: 'credit_wage_consent', resourceId: String(rows[0].id), reason: `Worker chose ${alternativeMethod}`, requestIp,
  });
  return { status: 'withdrawn', since: rows[0].created_at, alternative_method: alternativeMethod };
}

/** True when the helper may be paid in Credit. No query unless required. */
async function helperAcceptsCreditWages(db, helperUserId) {
  if (!required()) return true;
  const row = await latest(db, helperUserId);
  return row?.decision === 'granted';
}

async function assertHelperAcceptsCreditWages(db, helperUserId) {
  if (!(await helperAcceptsCreditWages(db, helperUserId))) {
    throw new AppError('This helper has not chosen to be paid in OxSteed Credit. Please pay another way.', 409, 'credit_wage_consent_required');
  }
}

/** Consent counts for the admin dashboard. */
async function summary() {
  const { rows } = await pool.query(
    `SELECT decision, COUNT(*)::int AS n FROM (
       SELECT DISTINCT ON (user_id) user_id, decision FROM credit_wage_payment_consents ORDER BY user_id, created_at DESC, id DESC
     ) latest GROUP BY decision`
  );
  return { required: required(), counts: Object.fromEntries(rows.map((r) => [r.decision, r.n])) };
}

module.exports = {
  ALTERNATIVES,
  WORKER_ROLES,
  required,
  getWageConsent,
  grantConsent,
  withdrawConsent,
  helperAcceptsCreditWages,
  assertHelperAcceptsCreditWages,
  summary,
};
