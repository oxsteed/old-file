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
 *   - POS drawers (restaurant_pos_shifts) the user left open are flagged
 *     for a manager close instead of silently staying open. They are NOT
 *     force-closed: the cash inside still has to be counted by a manager.
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
 * @returns {Promise<{pinsDeactivated:number, drawersFlagged:number}>}
 */
async function applyStaffOffboarding(client, { businessId, userId, reason } = {}) {
  if (!client || !businessId || !userId) {
    return { pinsDeactivated: 0, drawersFlagged: 0 };
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

  return { pinsDeactivated: pins.rowCount || 0, drawersFlagged: drawers.rowCount || 0 };
}

module.exports = { applyStaffOffboarding };
