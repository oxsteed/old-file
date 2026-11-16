'use strict';

/**
 * WP-007: verification evidence is a dependency of an application, keyed to
 * the verified subject (the account the provider session belongs to).
 *
 * When a provider callback changes a user's identity facts, every OPEN
 * application of that same user gets `evidence_revision + 1`. A reviewer
 * decision prepared against the old evidence then fails with
 * `request_version_conflict` (reviewService.decide checks evidenceRevision),
 * so a delayed, duplicate or stale callback can never ride on an earlier
 * review, and a callback can only ever touch the account it resolved to.
 * Nothing here creates or changes a grant.
 *
 * Best-effort by design: a failure is logged and never fails the webhook.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const { OPEN_REQUEST_STATUSES } = require('./policyRegistry');

async function recordIdentityEvidence(userId, { provider, outcome } = {}, db = pool) {
  if (!userId) return { updated: 0 };
  try {
    const { rows } = await db.query(
      `UPDATE access_requests
          SET evidence_revision = evidence_revision + 1, updated_at = NOW()
        WHERE applicant_id = $1 AND status = ANY($2::text[])
        RETURNING id`,
      [userId, [...OPEN_REQUEST_STATUSES].filter((s) => s !== 'draft')],
    );
    if (rows.length) {
      await db.query(
        `INSERT INTO access_projection_versions (user_id, version) VALUES ($1, 1)
         ON CONFLICT (user_id) DO UPDATE SET version = access_projection_versions.version + 1, updated_at = NOW()`,
        [userId],
      );
    }
    logger.info('access.evidence_recorded', { provider: provider || null, outcome: outcome || null, requests: rows.length });
    return { updated: rows.length };
  } catch (err) {
    logger.warn('access.evidence_record_failed', { provider: provider || null, err: err.message });
    return { updated: 0, error: true };
  }
}

/** Readiness facts a reviewer sees next to the activation requirements. */
async function readinessFor(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(identity_verified, FALSE) OR COALESCE(id_verified, FALSE) AS identity_verified,
            didit_status, didit_verified_at
       FROM users WHERE id = $1`,
    [userId],
  );
  const u = rows[0] || {};
  return {
    identity_verified: !!u.identity_verified && u.didit_status !== 'duplicate',
    identityStatus: u.didit_status === 'duplicate' ? 'duplicate' : (u.identity_verified ? 'verified' : (u.didit_status || 'not_started')),
    identityVerifiedAt: u.didit_verified_at || null,
  };
}

module.exports = { recordIdentityEvidence, readinessFor };
