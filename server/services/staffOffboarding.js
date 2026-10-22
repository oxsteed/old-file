'use strict';

/**
 * server/services/staffOffboarding.js
 *
 * Offboarding side effects for a removed team member (staff review S-11).
 * Runs inside the caller's transaction so the membership revoke and the
 * device/drawer cleanup commit or roll back together:
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
 *     unassigned (returned to the manager's pool) instead of pointing at
 *     a person who can no longer act on them. Completed items keep their
 *     assignee: they are history.
 *
 * Staff history is deliberately NOT deleted here. Schedules, time entries
 * and training records are wage-and-hour history; migration 946 switched
 * their user foreign keys to ON DELETE SET NULL so they also survive an
 * account hard-delete.
 *
 * @param {object} client  pg client inside an open transaction
 * @param {object} args
 * @param {number} args.businessId
 * @param {string} args.userId    the removed member's user id
 * @param {string} [args.reason]  recorded on flagged drawers
 * @returns {Promise<{pinsDeactivated:number, sessionsEnded:number,
 *   drawersFlagged:number, crewTasksUnassigned:number,
 *   correctiveActionsUnassigned:number}>}
 */
async function applyStaffOffboarding(client, { businessId, userId, reason } = {}) {
  if (!client || !businessId || !userId) {
    return { pinsDeactivated: 0, sessionsEnded: 0, drawersFlagged: 0, crewTasksUnassigned: 0, correctiveActionsUnassigned: 0, refreshTokensRevoked: 0 };
  }

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
    [userId, businessId, reason || 'Staff member removed from the team']
  );

  const crewTasks = await client.query(
    `UPDATE restaurant_crew_tasks t
        SET assigned_to = NULL, updated_at = NOW()
      WHERE t.assigned_to = $1
        AND t.status IN ('not_started', 'in_progress', 'needs_approval')
        AND t.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING t.id`,
    [userId, businessId]
  );

  const correctiveActions = await client.query(
    `UPDATE restaurant_corrective_actions a
        SET assignee_id = NULL, updated_at = NOW()
      WHERE a.assignee_id = $1
        AND a.status IN ('open', 'in_progress')
        AND a.audit_id IN (
          SELECT au.id FROM restaurant_audits au
            JOIN food_restaurants r ON r.id = au.restaurant_id
           WHERE r.business_id = $2
        )
      RETURNING a.id`,
    [userId, businessId]
  );

  // Audit fix (finding 32): a refresh token is a long-lived credential, not
  // a membership row. Revoke every refresh token for the offboarded user
  // inside the same transaction, so a revoked member cannot silently mint
  // new access tokens. Any failure rolls the offboarding back (fail closed).
  const refreshTokens = await client.query(
    `DELETE FROM refresh_tokens WHERE user_id = $1 RETURNING id`,
    [userId]
  );

  return {
    pinsDeactivated: pins.rowCount || 0,
    sessionsEnded: sessions.rowCount || 0,
    drawersFlagged: drawers.rowCount || 0,
    crewTasksUnassigned: crewTasks.rowCount || 0,
    correctiveActionsUnassigned: correctiveActions.rowCount || 0,
    refreshTokensRevoked: refreshTokens.rowCount || 0,
  };
}

module.exports = { applyStaffOffboarding };
