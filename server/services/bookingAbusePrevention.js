// VULN #26 FIX: Prevent booking abuse (slot blocking DoS)

const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Detect abusive booking patterns
 * Red flags:
 * - User booking many slots from same helper without completing jobs
 * - User cancelling bookings right before appointment (preventing last-minute fills)
 * - Abnormal booking-to-completion ratio
 */
async function detectBookingAbuse(userId, helperId) {
  try {
    // Get user's booking history with this helper
    const { rows: bookingStats } = await pool.query(
      `SELECT
        COUNT(*) as total_bookings,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_bookings,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bookings,
        SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_show_bookings,
        AVG(EXTRACT(EPOCH FROM (cancelled_at - scheduled_start_at)) / 3600)::INT as hours_before_cancel
       FROM appointments
       WHERE customer_id = $1 AND helper_id = $2`,
      [userId, helperId]
    );

    const stats = bookingStats[0];
    const abuseFlags = [];

    // RED FLAG #1: High cancellation rate (>50%)
    if (stats.total_bookings > 5) {
      const cancelRate = (stats.cancelled_bookings / stats.total_bookings);
      if (cancelRate > 0.5) {
        abuseFlags.push({
          flag: 'high_cancellation_rate',
          severity: 'medium',
          rate: cancelRate
        });
      }
    }

    // RED FLAG #2: Cancellations close to appointment time
    if (stats.hours_before_cancel && stats.hours_before_cancel < 2) {
      abuseFlags.push({
        flag: 'last_minute_cancellations',
        severity: 'high',
        avg_hours_before: stats.hours_before_cancel
      });
    }

    // RED FLAG #3: No-shows
    if (stats.no_show_bookings > 2) {
      abuseFlags.push({
        flag: 'multiple_no_shows',
        severity: 'high',
        no_show_count: stats.no_show_bookings
      });
    }

    return {
      user_id: userId,
      helper_id: helperId,
      is_abusive: abuseFlags.length > 0,
      flags: abuseFlags,
      should_block: abuseFlags.some(f => f.severity === 'high'),
      stats: stats
    };
  } catch (err) {
    logger.error('Booking abuse detection error', { userId, helperId, error: err.message });
    return null;
  }
}

/**
 * Rate limit bookings per user
 * Max 10 active bookings at a time
 */
async function checkBookingRateLimit(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as active_bookings FROM appointments
       WHERE customer_id = $1 AND status IN ('confirmed', 'in_progress')
       AND scheduled_start_at > NOW()`,
      [userId]
    );

    const activeBookings = parseInt(rows[0]?.active_bookings || 0);
    if (activeBookings >= 10) {
      return {
        allowed: false,
        reason: 'Too many active bookings',
        active_count: activeBookings,
        limit: 10
      };
    }

    return { allowed: true };
  } catch (err) {
    logger.error('Booking rate limit check failed', { userId, error: err.message });
    return { allowed: true }; // Fail open to prevent legitimate blocks
  }
}

module.exports = {
  detectBookingAbuse,
  checkBookingRateLimit
};
