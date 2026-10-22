'use strict';

/**
 * server/services/staffOffboarding.js
 *
 * Offboarding side effects for a removed team member (staff review S-11).
 * Runs inside the caller's transaction so the membership revoke, the
 * device/drawer cleanup, the work reassignment and the offboarding record
 * commit or roll back together:
 *
 *   - restaurant staff PINs for the user are deactivated at every
 *     restaurant owned by the business (previously a removed employee's
 *     PIN kept working at the POS);
 *   - open staff sub-sessions (restaurant_staff_sessions) for the user are
 *     ended at every restaurant owned by the business. Auth-audit item 3:
 *     a revoked employee's session used to keep stamping acting_staff_user_id
 *     on POS writes and tip attribution until idle expiry or the 12h cap;
 *     ending it here closes the gap. Fail closed: the UPDATE runs in the
 *     caller's transaction, so if it throws, the membership revoke and all
 *     sibling cleanup roll back with it.
 *   - POS drawers (restaurant_pos_shifts) the user left open are flagged
 *     for a manager close instead of silently staying open. They are NOT
 *     force-closed: the cash inside still has to be counted by a manager.
 *   - open crew tasks and corrective actions assigned to the user are
 *     REASSIGNED to a manager (never NULLed): the acting manager when
 *     they hold a manager/owner role on the business, else the business
 *     owner. Completed items keep their assignee: they are history.
 *   - a staff_offboarding_records row captures the whole outcome plus the
 *     retention deadline (businesses.staff_record_retention_years,
 *     default 7 years) before which the staff history must be kept.
 *
 * Staff history is deliberately NOT deleted here. Schedules, time entries
 * and training records are wage-and-hour history; migrations 946 and 1202
 * switched their user foreign keys to ON DELETE SET NULL so they also
 * survive an account hard-delete.
 *
 * @param {object} client  pg client inside an open transaction
 * @param {object} args
 * @param {number} args.businessId
 * @param {string} args.userId    the removed member's user id
 * @param {string} [args.reason]  recorded on flagged drawers and the record
 * @param {number} [args.membershipId] the revoked business_members id
 * @param {string} [args.removedBy]    the acting user id
 * @param {string} [args.reassignToUserId] preferred manager for open work
 * @returns {Promise<object>} counts, the reassignment target and the record
 */
async function resolveReassignTarget(client, businessId, preferredUserId) {
  if (preferredUserId) {
    const { rows } = await client.query(
      `SELECT 1 FROM business_members
        WHERE business_id = $1 AND member_id = $2 AND status = 'active' AND role = 'manager'
       UNION
       SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2`,
      [businessId, preferredUserId]
    );
    if (rows.length) return preferredUserId;
  }
  // The business always has an owner, so the chain never ends at NULL.
  const { rows: [biz] } = await client.query(
    'SELECT user_id FROM businesses WHERE id = $1',
    [businessId]
  );
  return (biz && biz.user_id) || null;
}

async function applyStaffOffboarding(client, {
  businessId,
  userId,
  reason = null,
  membershipId = null,
  removedBy = null,
  reassignToUserId = null,
} = {}) {
  const empty = {
    pinsDeactivated: 0,
    sessionsEnded: 0,
    drawersFlagged: 0,
    crewTasksReassigned: 0,
    correctiveActionsReassigned: 0,
    reassignedToUserId: null,
    offboardingRecord: null,
    refreshTokensRevoked: 0,
  };
  if (!client || !businessId || !userId) return empty;

  const pins = await client.query(
    `UPDATE restaurant_staff_pins p
        SET is_active = FALSE, updated_at = NOW()
      WHERE p.staff_user_id = $1
        AND p.is_active = TRUE
        AND p.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING p.id`,
    [userId, businessId]
  );

  // Auth-audit item 3: end every open staff sub-session for the user at
  // every restaurant owned by the business, inside the same transaction.
  // resolveStaffSession checks only token/restaurant/expiry, so without
  // this a revoked employee's session would keep stamping
  // acting_staff_user_id on POS writes (and tip attribution) until the
  // idle expiry or the 12h absolute cap. Any failure here throws and rolls
  // the whole offboarding transaction back (fail closed).
  const sessions = await client.query(
    `UPDATE restaurant_staff_sessions s
        SET ended_at = NOW(), end_reason = 'offboarded'
      WHERE s.staff_user_id = $1
        AND s.ended_at IS NULL
        AND s.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING s.id`,
    [userId, businessId]
  );

  const drawers = await client.query(
    `UPDATE restaurant_pos_shifts s
        SET flagged_for_close_at = NOW(),
            flagged_for_close_reason = $3
      WHERE s.staff_user_id = $1
        AND s.status = 'open'
        AND s.flagged_for_close_at IS NULL
        AND s.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING s.id`,
    [userId, businessId, reason ? `${reason}: staff member removed from the team` : 'Staff member removed from the team']
  );

  // S-11: open work is reassigned to a manager, never orphaned to NULL.
  const reassignTo = await resolveReassignTarget(client, businessId, reassignToUserId);

  const crewTasks = await client.query(
    `UPDATE restaurant_crew_tasks t
        SET assigned_to = $3, updated_at = NOW()
      WHERE t.assigned_to = $1
        AND t.status IN ('not_started', 'in_progress', 'needs_approval')
        AND t.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING t.id`,
    [userId, businessId, reassignTo]
  );

  const correctiveActions = await client.query(
    `UPDATE restaurant_corrective_actions a
        SET assignee_id = $3, updated_at = NOW()
      WHERE a.assignee_id = $1
        AND a.status IN ('open', 'in_progress')
        AND a.audit_id IN (
          SELECT au.id FROM restaurant_audits au
            JOIN food_restaurants r ON r.id = au.restaurant_id
           WHERE r.business_id = $2
        )
      RETURNING a.id`,
    [userId, businessId, reassignTo]
  );

  // Audit fix (finding 32): a refresh token is a long-lived credential, not
  // a membership row. Revoke every refresh token for the offboarded user
  // inside the same transaction, so a revoked member cannot silently mint
  // new access tokens. Any failure rolls the offboarding back (fail closed).
  const refreshTokens = await client.query(
    `DELETE FROM refresh_tokens WHERE user_id = $1 RETURNING id`,
    [userId]
  );

  const counts = {
    pinsDeactivated: pins.rowCount || 0,
    sessionsEnded: sessions.rowCount || 0,
    drawersFlagged: drawers.rowCount || 0,
    crewTasksReassigned: crewTasks.rowCount || 0,
    correctiveActionsReassigned: correctiveActions.rowCount || 0,
    reassignedToUserId: reassignTo,
    refreshTokensRevoked: refreshTokens.rowCount || 0,
  };

  // S-11: the offboarding record + retention deadline, written in the
  // same transaction as everything it describes.
  const { rows: [record] } = await client.query(
    `INSERT INTO staff_offboarding_records
       (business_id, membership_id, user_id, removed_by, reason,
        pins_deactivated, sessions_ended, drawers_flagged,
        crew_tasks_reassigned, corrective_actions_reassigned,
        reassigned_to_user_id, retain_until)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            (CURRENT_DATE + (COALESCE(b.staff_record_retention_years, 7) * INTERVAL '1 year'))::date
       FROM businesses b
      WHERE b.id = $1
     RETURNING *`,
    [
      businessId, membershipId, userId, removedBy, reason,
      counts.pinsDeactivated, counts.sessionsEnded, counts.drawersFlagged,
      counts.crewTasksReassigned, counts.correctiveActionsReassigned,
      reassignTo,
    ]
  );

  return { ...counts, offboardingRecord: record || null };
}

module.exports = { applyStaffOffboarding };
