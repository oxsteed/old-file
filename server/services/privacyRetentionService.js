'use strict';

/**
 * Erasure and retention (decision #12), behind FEATURE_PRIVACY_RETENTION.
 *
 *  - Erasure: personal data is removed or pseudonymized; financial records
 *    (payments, ledgers, tips, cash-outs) are KEPT for the legal period and
 *    stay linked only to the pseudonymized account. Requests with live money
 *    or work (active jobs, held payments, open disputes) are blocked until
 *    those settle.
 *  - Retention: private fields are stripped from job revision history after
 *    90 days; EU/EEA/UK revision history is deleted after 24 months.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const flags = require('./paymentLayerFlags');
const { COUNTRIES } = require('../validation/countries');

const PRIVATE_FIELDS = Object.freeze([
  'location_address', 'location_lat', 'location_lng', 'location_point', 'location_zip',
  'private_notes', 'notes', 'contact_phone', 'contact_email', 'access_instructions',
]);
const PRIVATE_STRIP_DAYS = 90;
const GDPR_HISTORY_MONTHS = 24;
const GDPR_COUNTRIES = Object.freeze(Object.entries(COUNTRIES)
  .filter(([, c]) => ['EU', 'EEA', 'UK'].includes(c.region)).map(([code]) => code));

function assertEnabled() {
  if (!flags.isEnabled('PRIVACY_RETENTION')) throw new AppError('Not available', 404, 'feature_disabled');
}

async function requestErasure(user) {
  assertEnabled();
  const { rows } = await pool.query(
    `INSERT INTO privacy_erasure_requests (user_id) VALUES ($1)
     ON CONFLICT (user_id) WHERE status IN ('requested', 'processing') DO NOTHING
     RETURNING *`,
    [user.id]
  );
  if (rows[0]) return rows[0];
  const { rows: open } = await pool.query(
    `SELECT * FROM privacy_erasure_requests WHERE user_id = $1 AND status IN ('requested', 'processing')`,
    [user.id]
  );
  return open[0];
}

async function getErasureStatus(user) {
  assertEnabled();
  const { rows } = await pool.query(
    'SELECT id, status, blocked_reason, requested_at, processed_at FROM privacy_erasure_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [user.id]
  );
  return rows[0] || null;
}

async function blockerFor(client, userId) {
  const checks = [
    ['active_jobs', `SELECT 1 FROM jobs WHERE (client_id = $1 OR assigned_helper_id = $1) AND status::text IN ('accepted', 'in_progress') LIMIT 1`],
    ['held_payments', `SELECT 1 FROM payments WHERE (payer_id = $1 OR payee_id = $1) AND status IN ('pending', 'authorized') LIMIT 1`],
    ['held_credit', `SELECT 1 FROM job_credit_payments WHERE (customer_id = $1 OR helper_id = $1) AND status = 'held' LIMIT 1`],
    ['open_disputes', `SELECT 1 FROM disputes d JOIN jobs j ON j.id = d.job_id WHERE (j.client_id = $1 OR j.assigned_helper_id = $1) AND d.status IN ('open', 'under_review', 'in_progress') LIMIT 1`],
    ['pending_cashout', `SELECT 1 FROM credit_cashout_requests WHERE user_id = $1 AND status IN ('requested', 'submitted') LIMIT 1`],
  ];
  for (const [reason, sql] of checks) {
    const { rows } = await client.query(sql, [userId]);
    if (rows[0]) return reason;
  }
  return null;
}

function stripSql(column) {
  return PRIVATE_FIELDS.reduce((expr, key) => `(${expr}) - '${key}'`, `COALESCE(${column}, '{}'::jsonb)`);
}

async function eraseUser(client, userId) {
  const summary = {};
  const { rowCount: users } = await client.query(
    `UPDATE users SET first_name = 'Deleted', last_name = 'User', username = NULL, bio = NULL, profile_photo_url = NULL,
            phone = NULL, phone_number = NULL, phone_e164 = NULL, zip_code = NULL,
            email = 'erased+' || id::text || '@invalid.oxsteed.com',
            pseudonymized_at = NOW(), deleted_at = COALESCE(deleted_at, NOW())
      WHERE id = $1`,
    [userId]
  );
  summary.users = users;
  const { rowCount: jobs } = await client.query(
    `UPDATE jobs SET location_address = NULL, location_lat = NULL, location_lng = NULL, location_zip = NULL,
            private_notes = NULL, notes = NULL
      WHERE client_id = $1 AND status::text NOT IN ('accepted', 'in_progress')`,
    [userId]
  );
  summary.jobs = jobs;
  const { rowCount: revisions } = await client.query(
    `UPDATE job_revisions SET changes = ${stripSql('changes')}, snapshot = ${stripSql('snapshot')}, reason = NULL,
            actor_id = CASE WHEN actor_id = $1 THEN NULL ELSE actor_id END, private_stripped_at = NOW()
      WHERE actor_id = $1 OR job_id IN (SELECT id FROM jobs WHERE client_id = $1)`,
    [userId]
  );
  summary.job_revisions = revisions;
  const { rowCount: messages } = await client.query(
    `UPDATE messages SET content = '[erased]', deleted_at = COALESCE(deleted_at, NOW()) WHERE sender_id = $1`,
    [userId]
  );
  summary.messages = messages;
  return summary;
}

async function processErasureRequests(limit = 20) {
  if (!flags.isEnabled('PRIVACY_RETENTION')) return 0;
  const { rows } = await pool.query(
    `UPDATE privacy_erasure_requests SET status = 'processing'
      WHERE id IN (SELECT id FROM privacy_erasure_requests WHERE status = 'requested' ORDER BY requested_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limit]
  );
  for (const request of rows) {
    try {
      await withTransaction(pool, async (client) => {
        const blocked = await blockerFor(client, request.user_id);
        if (blocked) {
          await client.query(
            `UPDATE privacy_erasure_requests SET status = 'blocked', blocked_reason = $2, processed_at = NOW() WHERE id = $1`,
            [request.id, blocked]
          );
          return;
        }
        const summary = await eraseUser(client, request.user_id);
        await client.query(
          `UPDATE privacy_erasure_requests SET status = 'completed', summary = $2::jsonb, processed_at = NOW() WHERE id = $1`,
          [request.id, JSON.stringify(summary)]
        );
      }, 'privacy_erasure');
    } catch (err) {
      logger.error('privacy_erasure.failed', { requestId: request.id, error: err.message });
      await pool.query(`UPDATE privacy_erasure_requests SET status = 'requested' WHERE id = $1`, [request.id]).catch(() => {});
    }
  }
  return rows.length;
}

async function retentionSweep() {
  if (!flags.isEnabled('PRIVACY_RETENTION')) return { stripped: 0, deleted: 0 };
  const { rowCount: stripped } = await pool.query(
    `UPDATE job_revisions SET changes = ${stripSql('changes')}, snapshot = ${stripSql('snapshot')}, private_stripped_at = NOW()
      WHERE private_stripped_at IS NULL AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [PRIVATE_STRIP_DAYS]
  );
  const { rowCount: deleted } = await pool.query(
    `DELETE FROM job_revisions r USING jobs j
      WHERE j.id = r.job_id AND j.location_country_code = ANY($1::text[])
        AND r.created_at < NOW() - ($2::int * INTERVAL '1 month')`,
    [GDPR_COUNTRIES, GDPR_HISTORY_MONTHS]
  );
  await pool.query(`DELETE FROM payment_fx_quotes WHERE consumed_at IS NULL AND expires_at < NOW() - INTERVAL '30 days'`);
  return { stripped: stripped || 0, deleted: deleted || 0 };
}

module.exports = {
  PRIVATE_FIELDS,
  PRIVATE_STRIP_DAYS,
  GDPR_HISTORY_MONTHS,
  GDPR_COUNTRIES,
  requestErasure,
  getErasureStatus,
  processErasureRequests,
  retentionSweep,
  blockerFor,
  eraseUser,
};
