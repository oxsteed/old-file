'use strict';

/**
 * Privacy boundaries for progressive access.
 *
 * Applicant-owned request and grant history is exportable without reviewer
 * notes or reviewer identities. Deletion closes effective entitlements but
 * retains the request/decision records needed for platform audit and legal
 * retention. The resolver already fails closed for an inactive/deleted user;
 * revoking the grant makes that boundary explicit in durable state too.
 */

async function exportData(db, userId) {
  const [requests, grants, decisions] = await Promise.all([
    db.query(
      `SELECT id, capability, subject_type, subject_key, status, policy_version,
              public_reason_code, information_request, source, return_to,
              submitted_at, decided_at, created_at, updated_at
         FROM access_requests
        WHERE applicant_id = $1
        ORDER BY created_at, id`,
      [userId],
    ),
    db.query(
      `SELECT capability, subject_type, subject_key, status, provenance,
              policy_version, granted_at, expires_at, status_changed_at,
              status_reason_code, updated_at
         FROM access_grants
        WHERE user_id = $1
        ORDER BY granted_at, id`,
      [userId],
    ),
    db.query(
      `SELECT d.request_id, d.action, d.from_status, d.to_status,
              d.request_version, d.actor_type, d.reviewer_authority,
              d.evidence_revision, d.policy_version, d.public_reason_code,
              d.created_at
         FROM access_request_decisions d
         JOIN access_requests r ON r.id = d.request_id
        WHERE r.applicant_id = $1
        ORDER BY d.created_at, d.id`,
      [userId],
    ),
  ]);
  return {
    progressive_access_requests: requests.rows,
    progressive_access_grants: grants.rows,
    progressive_access_decisions: decisions.rows,
  };
}

async function revokeForDeletion(db, userId) {
  const revoked = await db.query(
    `UPDATE access_grants
        SET status = 'revoked',
            status_changed_at = NOW(),
            status_reason_code = 'account_deleted',
            version = version + 1,
            updated_at = NOW()
      WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  await db.query(
    `INSERT INTO access_projection_versions (user_id, version)
     VALUES ($1, 1)
     ON CONFLICT (user_id)
     DO UPDATE SET version = access_projection_versions.version + 1, updated_at = NOW()`,
    [userId],
  );
  await db.query(
    `UPDATE access_outbox
        SET status = 'failed', last_error = 'account_deleted'
      WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
  return { revokedGrants: revoked.rowCount || 0 };
}

module.exports = { exportData, revokeForDeletion };
