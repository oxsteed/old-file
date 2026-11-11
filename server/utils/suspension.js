'use strict';

/**
 * Lift a timed account suspension once its deadline has passed.
 *
 * Admin suspension writes set both is_suspended and is_active=false. Every
 * authentication path must clear both flags together; clearing only the
 * suspension flag leaves the account permanently deactivated.
 */
async function liftExpiredSuspension(pool, user) {
  if (!user?.id || user.is_suspended !== true || !user.suspended_until) return false;
  const deadline = new Date(user.suspended_until);
  if (Number.isNaN(deadline.getTime()) || deadline.getTime() > Date.now()) return false;

  await pool.query(
    `UPDATE users
        SET is_suspended = FALSE,
            is_active = TRUE,
            suspended_until = NULL,
            suspended_reason = NULL,
            suspension_reason = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND is_suspended = TRUE
        AND suspended_until IS NOT NULL
        AND suspended_until <= NOW()`,
    [user.id]
  );
  user.is_suspended = false;
  user.is_active = true;
  user.suspended_until = null;
  user.suspended_reason = null;
  user.suspension_reason = null;
  return true;
}

module.exports = { liftExpiredSuspension };
