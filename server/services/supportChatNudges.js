'use strict';

/**
 * State-based proactive nudges for the AI support chat (item 9).
 *
 * Computed from the signed-in user's own records only. Each nudge has a
 * stable key (trigger + record) so the widget can dismiss it per trigger;
 * the widget also caps how often any nudge is shown. Nothing here depends on
 * analytics consent: the inputs are the user's own transactional state.
 */

const db = require('../db');
const logger = require('../utils/logger');

const TRIGGER_ORDER = Object.freeze(['payment_failed', 'dispute_waiting', 'verification_stalled', 'email_unverified', 'job_no_bids']);

function noBidsDays(env = process.env) {
  const n = Number.parseInt(env.SUPPORT_NUDGE_NO_BIDS_DAYS, 10);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : 3;
}

async function safe(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('support nudge check failed', { check: name, err: err.message });
    return null;
  }
}

async function getSupportNudges(userId, { query = db.query.bind(db), env = process.env } = {}) {
  if (!userId) return [];
  const days = noBidsDays(env);
  const [payment, dispute, identity, email, job] = await Promise.all([
    safe('payment_failed', async () => {
      const { rows } = await query(
        `SELECT id FROM food_orders
          WHERE customer_id = $1 AND payment_status = 'failed'
            AND created_at > NOW() - INTERVAL '7 days'
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows[0] ? { trigger: 'payment_failed', key: `payment_failed:${rows[0].id}`, path: `/orders/${rows[0].id}` } : null;
    }),
    safe('dispute_waiting', async () => {
      // A dispute someone else opened against the user that is still open
      // is waiting on the user's response.
      const { rows } = await query(
        `SELECT id FROM disputes
          WHERE against_user = $1 AND status = 'open'
          ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return rows[0] ? { trigger: 'dispute_waiting', key: `dispute_waiting:${rows[0].id}`, path: `/disputes/${rows[0].id}` } : null;
    }),
    safe('verification_stalled', async () => {
      const { rows } = await query(
        `SELECT id, status, created_at FROM identity_verifications
          WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      const v = rows[0];
      if (!v) return null;
      const stalledPending = v.status === 'pending' && new Date(v.created_at).getTime() < Date.now() - 3 * 86400000;
      return ['rejected', 'expired'].includes(v.status) || stalledPending
        ? { trigger: 'verification_stalled', key: `verification_stalled:${v.id}`, path: '/verify-identity' }
        : null;
    }),
    safe('email_unverified', async () => {
      const { rows } = await query(
        `SELECT id FROM users
          WHERE id = $1 AND email_verified = FALSE AND created_at < NOW() - INTERVAL '2 days'`,
        [userId]
      );
      return rows[0] ? { trigger: 'email_unverified', key: 'email_unverified', path: '/verify-email' } : null;
    }),
    safe('job_no_bids', async () => {
      const { rows } = await query(
        `SELECT j.id FROM jobs j
          WHERE j.client_id = $1 AND j.deleted_at IS NULL AND j.status::text = 'published'
            AND j.created_at < NOW() - make_interval(days => $2::int)
            AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.job_id = j.id)
          ORDER BY j.created_at ASC LIMIT 1`,
        [userId, days]
      );
      return rows[0] ? { trigger: 'job_no_bids', key: `job_no_bids:${rows[0].id}`, path: `/jobs/${rows[0].id}`, days } : null;
    }),
  ]);
  return [payment, dispute, identity, email, job]
    .filter(Boolean)
    .sort((a, b) => TRIGGER_ORDER.indexOf(a.trigger) - TRIGGER_ORDER.indexOf(b.trigger));
}

module.exports = { TRIGGER_ORDER, getSupportNudges, noBidsDays };
