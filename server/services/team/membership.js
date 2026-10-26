'use strict';

// Team membership building blocks shared by Business Hub invites/rehires
// and the careers onboarding run (careers spec §14: "the onboarding run
// calls the same service functions as invite and rehire"). Every function
// takes the caller's transaction client.

const { canActOnRole } = require('../../utils/teamRanks');

const MEMBER_ROLES = Object.freeze(['manager', 'representative', 'employee', 'support_agent']);

async function loadJobRolePreset(db, code) {
  if (!code) return null;
  const { rows } = await db.query(
    `SELECT code, name, base_role, permission_codes
       FROM team_job_roles WHERE code = $1`,
    [String(code)]
  );
  return rows[0] || null;
}

// S-03: a job-role preset applies its permission codes as allow overrides
// on the membership, on top of the base role defaults.
async function applyJobRolePreset(db, membershipId, preset, grantedBy) {
  if (!preset || !Array.isArray(preset.permission_codes) || !preset.permission_codes.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO membership_permission_overrides
       (membership_id, permission_id, effect, granted_by_user_id)
     SELECT $1, p.id, 'allow', $2
       FROM team_permissions p
      WHERE p.code = ANY($3)
     ON CONFLICT (membership_id, permission_id) DO NOTHING`,
    [membershipId, grantedBy, preset.permission_codes]
  );
  return rowCount || 0;
}

/**
 * The latest offboarding record for this person at this business, and
 * whether it blocks a rehire (the former employer marked them ineligible).
 */
async function rehireStatus(db, { businessId, userId }) {
  const { rows: [record] } = await db.query(
    `SELECT id, removed_at, rehired_at, rehire_eligible, rehire_note_code
       FROM staff_offboarding_records
      WHERE business_id = $1 AND user_id = $2
      ORDER BY removed_at DESC LIMIT 1`,
    [businessId, userId]
  );
  return { record: record || null, blocked: Boolean(record && record.rehire_eligible === false && !record.rehired_at) };
}

/**
 * Create or reactivate an ACTIVE membership for a hire who accepted an
 * offer. Idempotent: an existing active membership is returned unchanged
 * (with `created: false`). Follows the rehire rules: a revoked prior row
 * stays as history, a new row is inserted and the offboarding record is
 * stamped rehired. A pending invite for the same person is converted.
 */
async function activateHireMembership(db, {
  businessId, ownerId, userId, email, role, actorRole, jobRole = null,
  payRateCents = null, payRatePeriod = null, employmentBasis = 'regular', careerOfferId = null, grantedBy,
}) {
  if (!MEMBER_ROLES.includes(role)) {
    const err = new Error('Unsupported team role'); err.code = 'invalid_role'; throw err;
  }
  if (actorRole && !canActOnRole(actorRole, role)) {
    const err = new Error('You can only hire into roles below your own'); err.code = 'role_rank_forbidden'; throw err;
  }
  const { rows: [active] } = await db.query(
    `SELECT * FROM business_members
      WHERE business_id = $1 AND member_id = $2 AND status = 'active'
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [businessId, userId]
  );
  if (active) return { member: active, created: false, rehired: false };

  const { record, blocked } = await rehireStatus(db, { businessId, userId });
  if (blocked) {
    const err = new Error('This person is not eligible for rehire at this business'); err.code = 'rehire_blocked'; throw err;
  }

  const preset = await loadJobRolePreset(db, jobRole);
  const { rows: [pending] } = await db.query(
    `SELECT id FROM business_members
      WHERE business_id = $1 AND status IN ('pending','expired')
        AND (member_id = $2 OR lower(invite_email) = lower($3))
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [businessId, userId, email || '']
  );
  let member;
  if (pending) {
    ({ rows: [member] } = await db.query(
      `UPDATE business_members
          SET member_id = $2, role = $3, status = 'active', accepted_at = NOW(), expires_at = NULL,
              job_role = COALESCE($4, job_role), pay_rate_cents = COALESCE($5, pay_rate_cents),
              pay_rate_period = COALESCE($6, pay_rate_period), employment_basis = $7, career_offer_id = $8,
              role_updated_at = NOW(), role_updated_by = $9
        WHERE id = $1
        RETURNING *`,
      [pending.id, userId, role, preset ? preset.code : null, payRateCents, payRatePeriod, employmentBasis, careerOfferId, grantedBy]
    ));
  } else {
    ({ rows: [member] } = await db.query(
      `INSERT INTO business_members
         (business_id, owner_id, member_id, role, invite_email, status, accepted_at,
          job_role, pay_rate_cents, pay_rate_period, employment_basis, career_offer_id)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW(), $6, $7, $8, $9, $10)
       RETURNING *`,
      [businessId, ownerId, userId, role, email ? String(email).toLowerCase() : null,
        preset ? preset.code : null, payRateCents, payRatePeriod, employmentBasis, careerOfferId]
    ));
  }
  await applyJobRolePreset(db, member.id, preset, grantedBy);
  let rehired = false;
  if (record && !record.rehired_at) {
    await db.query(
      'UPDATE staff_offboarding_records SET rehired_at = NOW(), rehired_membership_id = $1 WHERE id = $2',
      [member.id, record.id]
    );
    rehired = true;
  }
  return { member, created: true, rehired, jobRolePreset: preset };
}

module.exports = {
  MEMBER_ROLES,
  loadJobRolePreset,
  applyJobRolePreset,
  rehireStatus,
  activateHireMembership,
};
