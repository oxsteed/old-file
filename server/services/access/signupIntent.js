'use strict';

/**
 * Customer-first signup (WP-001..WP-003). Behind ACCESS_CUSTOMER_FIRST_SIGNUP.
 *
 * The signup choice is an intent, stored separately from access. Account
 * creation always yields a customer; a helper/business intent becomes a
 * resumable draft application. Every step here is best-effort AFTER the
 * account exists: a failure leaves a valid customer account and a durable
 * intent row the client can resume from.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const registry = require('./policyRegistry');
const access = require('./accessService');

/** Pending-registration fields for a start request (flag on). */
function startFields(body = {}) {
  const raw = body.signupIntent ?? body.signup_intent ?? body.intent ?? body.defaultMode ?? body.default_mode;
  return {
    intent: registry.normalizeSignupIntent(raw),
    returnTo: access.safeReturnTo(body.returnTo ?? body.return_to),
  };
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
       ON CONFLICT (user_id) DO UPDATE SET intent = EXCLUDED.intent, capability = EXCLUDED.capability,
         return_to = EXCLUDED.return_to, updated_at = NOW()`,
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
      await pool.query('UPDATE access_signup_intents SET request_id = $2 WHERE user_id = $1', [userId, requestId]).catch(() => {});
    }
  }
  return {
    signupIntent: intent,
    nextStep: capability
      ? { type: 'application', capability, requestId, resumable: true }
      : { type: 'none', returnTo },
  };
}

/** Resume data for the signed-in user (GET /api/me/access includes it). */
async function pendingIntent(userId) {
  const { rows } = await pool.query(
    `SELECT intent, capability, request_id, return_to FROM access_signup_intents
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
  if (!rows.length || !rows[0].capability) return null;
  return { intent: rows[0].intent, capability: rows[0].capability, requestId: rows[0].request_id ? String(rows[0].request_id) : null, returnTo: rows[0].return_to };
}

module.exports = { startFields, finalize, pendingIntent };
