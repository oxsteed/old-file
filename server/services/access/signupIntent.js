'use strict';

/**
 * Customer-first signup (WP-001..WP-003). Behind ACCESS_CUSTOMER_FIRST_SIGNUP.
 *
 * The signup choice is an intent, stored separately from access. Account
 * creation always yields a customer; a helper/business intent becomes a
 * resumable draft application. Every step here is best-effort AFTER the
 * account exists: a failure leaves a valid customer account and a durable
 * intent row the client can resume from.
 *
 * Intents are keyed by (user_id, intent): a user may express several
 * intents over time and each stays resumable until it is consumed. An
 * intent is consumed only when its owning flow completes (application
 * submitted, invitation accepted, enrollment created, credit application
 * filed, provisioning request decided); consumed rows are kept as
 * history. Re-expressing a consumed intent reopens it.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const registry = require('./policyRegistry');
const access = require('./accessService');

// Admission describes who owns the next step. It is deliberately separate
// from capability and never grants access. The client uses this only to show
// an accurate post-verification handoff for personas that do not use the
// generic platform application form.
const SIGNUP_ADMISSIONS = Object.freeze({
  find_help: Object.freeze({ kind: 'baseline', statusPath: '/dashboard' }),
  offer_services: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  run_business: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  run_restaurant: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  join_business_team: Object.freeze({ kind: 'organization_invitation', statusPath: '/vortex' }),
  join_restaurant_team: Object.freeze({ kind: 'organization_invitation', statusPath: '/vortex' }),
  ship_goods: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  consult: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  list_equipment: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  franchise: Object.freeze({ kind: 'domain_enrollment', statusPath: '/franchise/apply' }),
  request_reporting: Object.freeze({ kind: 'platform_review', statusPath: '/settings/applications' }),
  join_credit: Object.freeze({ kind: 'domain_enrollment', statusPath: '/credit/apply' }),
  join_partner: Object.freeze({ kind: 'domain_enrollment', statusPath: '/affiliate' }),
  join_workforce: Object.freeze({ kind: 'domain_enrollment', statusPath: '/learn' }),
  request_reviewer: Object.freeze({ kind: 'staff_provisioning', statusPath: '/settings/applications' }),
  request_support: Object.freeze({ kind: 'staff_provisioning', statusPath: '/settings/applications' }),
  request_operations: Object.freeze({ kind: 'staff_provisioning', statusPath: '/settings/applications' }),
  request_device: Object.freeze({ kind: 'nonhuman_provisioning', statusPath: '/settings/applications' }),
});

// Intents whose handoff is a visible provisioning request on Applications
// rather than a support page: the request record is the next step.
const PROVISIONING_INTENTS = Object.freeze({
  request_reviewer: 'staff_reviewer',
  request_support: 'staff_support',
  request_operations: 'staff_operations',
  request_device: 'service_account',
});

function admissionForIntent(intent) {
  return SIGNUP_ADMISSIONS[intent] || SIGNUP_ADMISSIONS.find_help;
}

/** Pending-registration fields for a start request (flag on). */
function startFields(body = {}) {
  const raw = body.signupIntent ?? body.signup_intent ?? body.intent ?? body.defaultMode ?? body.default_mode;
  return {
    intent: registry.normalizeSignupIntent(raw),
    returnTo: access.safeReturnTo(body.returnTo ?? body.return_to),
  };
}

/**
 * Stamp an intent consumed. Best-effort: never throws, so a consumption
 * hook can never fail the owning flow (application, invitation, enrollment).
 */
async function consumeIntent(userId, intent) {
  if (!userId || !intent) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE access_signup_intents SET consumed_at = NOW(), updated_at = NOW()
        WHERE user_id = $1 AND intent = $2 AND consumed_at IS NULL`,
      [userId, registry.normalizeSignupIntent(intent)],
    );
    return rowCount > 0;
  } catch (e) {
    logger.warn('signup intent consume failed', { userId, intent, error: e.message });
    return false;
  }
}

/**
 * Record the intent and open a draft application for it. Never throws.
 * @returns {{ signupIntent: string, nextStep: object }}
 */
async function finalize(userId, pending) {
  const intent = registry.normalizeSignupIntent(pending.signup_intent || pending.default_mode);
  const capability = registry.capabilityForIntent(intent);
  const returnTo = access.safeReturnTo(pending.signup_return_to);
  let requestId = null;
  try {
    await pool.query(
      `INSERT INTO access_signup_intents (user_id, intent, capability, return_to, source)
       VALUES ($1, $2, $3, $4, 'signup')
       ON CONFLICT (user_id, intent) DO UPDATE SET intent = EXCLUDED.intent, capability = EXCLUDED.capability,
         return_to = EXCLUDED.return_to, updated_at = NOW(), consumed_at = NULL`,
      [userId, intent, capability, returnTo],
    );
  } catch (e) {
    logger.warn('signup intent record failed', { userId, error: e.message });
  }
  if (capability) {
    try {
      const cap = registry.getCapability(capability);
      const subject = { type: cap.subjectTypes[0] };
      const out = await access.createRequest(userId, { capability, subject, answers: {}, source: 'signup', returnTo }, { idemKey: `signup-${userId}` });
      requestId = out.body.request.id;
    } catch (e) {
      if (e && e.code === 'request_already_open') requestId = e.requestId || null;
      else logger.warn('signup draft application failed; intent kept for resume', { userId, error: e && e.message });
    }
    if (requestId) {
      await pool.query('UPDATE access_signup_intents SET request_id = $2 WHERE user_id = $1 AND intent = $3', [userId, requestId, intent]).catch(() => {});
    }
  }
  // Staff / device intents open no access request (no capability exists for
  // them): record a visible provisioning request instead, so a reviewer can
  // see and decide the ask. Best-effort; the intent row above is the fallback.
  const provisioningKind = PROVISIONING_INTENTS[intent];
  if (provisioningKind) {
    try {
      const provisioning = require('../signupProvisioningService');
      await provisioning.createRequest(userId, { kind: provisioningKind, intent });
    } catch (e) {
      logger.warn('signup provisioning request failed; intent kept for resume', { userId, intent, error: e && e.message });
    }
  }
  return {
    signupIntent: intent,
    nextStep: capability
      ? { type: 'application', intent, capability, requestId, resumable: true, returnTo, ...admissionForIntent(intent) }
      : { type: 'none', intent, returnTo, ...admissionForIntent(intent) },
  };
}

function toResume(row) {
  return {
    intent: row.intent,
    capability: row.capability,
    requestId: row.request_id ? String(row.request_id) : null,
    returnTo: row.return_to,
    createdAt: row.created_at || null,
    ...admissionForIntent(row.intent),
  };
}

/** All unconsumed intents for the signed-in user, oldest first. */
async function pendingIntents(userId) {
  const { rows } = await pool.query(
    `SELECT intent, capability, request_id, return_to, created_at FROM access_signup_intents
      WHERE user_id = $1 AND consumed_at IS NULL ORDER BY created_at ASC, intent ASC`,
    [userId],
  );
  return rows.map(toResume);
}

/** Resume data for the signed-in user (GET /api/me/access includes it). */
async function pendingIntent(userId) {
  const intents = await pendingIntents(userId);
  return intents.length ? intents[0] : null;
}

module.exports = {
  SIGNUP_ADMISSIONS, PROVISIONING_INTENTS, admissionForIntent, startFields,
  finalize, pendingIntent, pendingIntents, consumeIntent,
};
