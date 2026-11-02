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
const { enqueueStorageDeletion } = require('./storageCleanupService');

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
  if(process.env.GROWTH_SUBJECT_PEPPER)await require('../utils/transaction').withTransaction(pool,
    conn=>require('../growth/rights').erase(conn,user.id),'growth_erasure_request');
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
  const request = rows[0] || null;
  if (request && request.blocked_reason === 'positive_credit_balance') {
    request.credit_balances = await creditBalancesFor(pool, user.id);
    request.resolution_options = ['redeem', 'unclaimed_property'];
  }
  return request;
}

/** Positive Credit balances a person still holds (wallets and wages). */
async function creditBalancesFor(db, userId) {
  const { rows } = await db.query(
    `SELECT a.account_type, a.currency_code, a.balance_cents, a.reserved_cents
       FROM oxsteed_credit_accounts a
      WHERE a.account_type = 'customer_wallet' AND a.customer_id = $1 AND (a.balance_cents > 0 OR a.reserved_cents > 0)
     UNION ALL
     SELECT a.account_type, a.currency_code, a.balance_cents, a.reserved_cents
       FROM oxsteed_credit_accounts a
       JOIN credit_participants p ON p.partner_id = a.partner_id AND p.user_id = $1
      WHERE a.account_type IN ('partner_payable', 'partner_reserve') AND (a.balance_cents > 0 OR a.reserved_cents > 0)`,
    [userId]
  );
  return (rows || []).map((r) => ({
    account_type: r.account_type,
    currency: String(r.currency_code).trim(),
    balance_minor: Number(r.balance_cents),
    reserved_minor: Number(r.reserved_cents),
  }));
}

async function blockerFor(client, userId) {
  const checks = [
    ['active_jobs', `SELECT 1 FROM jobs WHERE (client_id = $1 OR assigned_helper_id = $1) AND status::text IN ('accepted', 'in_progress') LIMIT 1`],
    ['held_payments', `SELECT 1 FROM payments WHERE (payer_id = $1 OR payee_id = $1) AND status IN ('pending', 'authorized') LIMIT 1`],
    ['held_credit', `SELECT 1 FROM job_credit_payments WHERE (customer_id = $1 OR helper_id = $1) AND status = 'held' LIMIT 1`],
    ['open_disputes', `SELECT 1 FROM disputes d JOIN jobs j ON j.id = d.job_id WHERE (j.client_id = $1 OR j.assigned_helper_id = $1) AND d.status IN ('open', 'under_review', 'in_progress') LIMIT 1`],
    ['pending_cashout', `SELECT 1 FROM credit_cashout_requests WHERE user_id = $1 AND status IN ('requested', 'held_for_review', 'submitting', 'submitted') LIMIT 1`],
    // Licence readiness (review bug 6): erasing a person who still holds
    // OxSteed Credit would destroy the record of money owed to them. A
    // positive (or reserved) wallet or helper wage balance blocks erasure
    // until it is redeemed (cash-out / withdrawal) or, with the owner's
    // consent, moved to the unclaimed-property liability (escheat path).
    ['positive_credit_balance', `SELECT 1 FROM oxsteed_credit_accounts a
       WHERE a.account_type = 'customer_wallet' AND a.customer_id = $1
         AND (a.balance_cents > 0 OR a.reserved_cents > 0)
      UNION ALL
      SELECT 1 FROM oxsteed_credit_accounts a
        JOIN credit_participants p ON p.partner_id = a.partner_id AND p.user_id = $1
       WHERE a.account_type IN ('partner_payable', 'partner_reserve')
         AND (a.balance_cents > 0 OR a.reserved_cents > 0)
      LIMIT 1`],
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
  const summary = await require('./privacyActivityData').erase(client,userId);
  Object.assign(summary, await require('./careers/privacy').erase(client,userId));
  if(process.env.GROWTH_SUBJECT_PEPPER) {
    const growthSummary = await require('../growth/rights').erase(client,userId);
    summary.growth = growthSummary;
  }
  // Review P3-6-F03: capture the profile photo before it is cleared so the
  // storage object can be queued for deletion instead of orphaned.
  let oldPhotoUrl = null;
  try {
    const { rows } = await client.query(
      'SELECT profile_photo_url FROM users WHERE id = $1',
      [userId]
    );
    oldPhotoUrl = rows[0]?.profile_photo_url || null;
  } catch (readErr) {
    logger.warn('privacy_erasure.photo_read_failed', { userId, error: readErr.message });
  }
  const { rowCount: users } = await client.query(
    `UPDATE users SET first_name = 'Deleted', last_name = 'User', username = NULL, bio = NULL, profile_photo_url = NULL,
            phone = NULL, phone_number = NULL, phone_e164 = NULL, zip_code = NULL,
            email = 'erased+' || id::text || '@invalid.oxsteed.com',
            pseudonymized_at = NOW(), deleted_at = COALESCE(deleted_at, NOW())
      WHERE id = $1`,
    [userId]
  );
  summary.users = users;
  if (oldPhotoUrl) {
    await enqueueStorageDeletion(oldPhotoUrl, 'erasure_profile_photo', { client });
  }
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
      await pool.query(`UPDATE privacy_erasure_requests SET status = 'requested' WHERE id = $1`, [request.id]).catch((resetErr) => {
        logger.error('privacy_erasure.reset_failed', { requestId: request.id, error: resetErr.message });
      });
    }
  }
  return rows.length;
}

/**
 * Ledger-safe completion of admin-scheduled user deletion.
 *
 * Admin deletion (superAdminController.deleteUser) soft-deletes the account
 * and schedules permanent deletion 30 days out (users.deletion_scheduled_at,
 * migration 165), but no executor may hard-delete the row: the
 * food_customer_wallet_ledger no-delete rule swallows the ON DELETE CASCADE,
 * so a hard DELETE of a user with any ledger history fails schema-wide
 * with a referential-integrity error. The ledger-safe completion is therefore
 * anonymization, not removal, reusing the established erasure semantics:
 * PII is scrubbed, the account is pseudonymized, and financial records
 * (payments, ledgers, tips, cash-outs) are KEPT and stay linked only to the
 * pseudonymized account.
 *
 * For each due schedule, in its own transaction:
 *  - re-check blockers (erasure blockers + the admin-delete financial
 *    guard). A blocked user stays scheduled and is counted, never forfeited:
 *    money is never destroyed to complete a deletion.
 *  - run eraseUser, close zero-balance food-wallet accounts (ledger rows are
 *    never touched), clear the schedule, and stamp deletion_finalized_at.
 * A finalized account must never be reinstated; restoreUser refuses it.
 * Returns { finalized, blocked, errored }. Returns all zeros while the
 * PRIVACY_RETENTION flag is off, mirroring processErasureRequests.
 * opts.userIds (array of UUIDs) scopes the run to those users; it exists
 * so tests on a shared disposable database stay hermetic, and so ops can
 * re-run finalize for specific accounts. Production callers omit it.
 */
async function finalizeScheduledDeletions(limit = 20, opts = {}) {
  if (!flags.isEnabled('PRIVACY_RETENTION')) return { finalized: 0, blocked: 0, errored: 0 };
  const { findFinancialBlockers } = require('./accountDeletionGuard');
  const scoped = Array.isArray(opts.userIds) && opts.userIds.length > 0;
  const { rows: due } = await pool.query(
    `SELECT id FROM users
      WHERE deletion_scheduled_at IS NOT NULL
        AND deletion_scheduled_at <= NOW()
        AND deletion_finalized_at IS NULL
        ${scoped ? 'AND id = ANY($2::uuid[])' : ''}
      ORDER BY deletion_scheduled_at ASC
      LIMIT $1`,
    scoped ? [limit, opts.userIds] : [limit]
  );
  const result = { finalized: 0, blocked: 0, errored: 0 };
  for (const { id: userId } of due) {
    try {
      const outcome = await withTransaction(pool, async (client) => {
        const { rows: locked } = await client.query(
          `SELECT id FROM users
            WHERE id = $1
              AND deletion_scheduled_at IS NOT NULL
              AND deletion_scheduled_at <= NOW()
              AND deletion_finalized_at IS NULL
            FOR UPDATE`,
          [userId]
        );
        if (!locked.length) return 'gone';
        const erasureBlocker = await blockerFor(client, userId);
        const financialBlockers = await findFinancialBlockers(userId, client);
        if (erasureBlocker || financialBlockers.length) {
          logger.warn('privacy_deletion_finalize.blocked', {
            userId, erasureBlocker, financialBlockers,
          });
          return 'blocked';
        }
        await eraseUser(client, userId);
        const { rows: walletTable } = await client.query(
          `SELECT to_regclass('public.food_customer_wallet_accounts') AS t`
        );
        if (walletTable[0]?.t) {
          await client.query(
            `UPDATE food_customer_wallet_accounts
                SET status = 'closed', updated_at = NOW()
              WHERE customer_id = $1
                AND balance_cents = 0 AND reserved_cents = 0
                AND status <> 'closed'`,
            [userId]
          );
        }
        await client.query(
          `UPDATE users
              SET deletion_scheduled_at = NULL, deletion_finalized_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [userId]
        );
        return 'finalized';
      }, 'privacy_deletion_finalize');
      if (outcome === 'finalized') result.finalized += 1;
      else if (outcome === 'blocked') result.blocked += 1;
    } catch (err) {
      logger.error('privacy_deletion_finalize.failed', { userId, error: err.message });
      result.errored += 1;
    }
  }
  return result;
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
  creditBalancesFor,
  PRIVATE_FIELDS,
  PRIVATE_STRIP_DAYS,
  GDPR_HISTORY_MONTHS,
  GDPR_COUNTRIES,
  requestErasure,
  getErasureStatus,
  processErasureRequests,
  finalizeScheduledDeletions,
  retentionSweep,
  blockerFor,
  eraseUser,
};
