// server/services/profileVisibilityActiveWork.js
// Workstream A: counts of genuinely active work attached to a profile so the
// admin UI can warn (and the backend can require approval) before a profile
// is hidden. Queries are deliberately cheap: EXISTS-style capped counts with
// LIMIT so a profile with heavy history does not blow up the admin page.
//
// profileType: 'helper' | 'business' | 'restaurant'
// profileId:   helper -> users.id (uuid text)
//              business -> businesses.id (bigint text)
//              restaurant -> food_restaurants.id (bigint text)

const db = require('../db');

const COUNT_CAP = 10; // reported count saturates here; LIMIT COUNT_CAP + 1 to detect overflow

// Jobs that are neither terminal nor drafts count as active work for either
// side of the job (helper as assignee or as the client posting it).
const NON_TERMINAL_JOB_STATUSES = ['published', 'matched', 'negotiating', 'accepted', 'in_progress'];

async function resolveOwnerUserId(profileType, profileId) {
  if (profileType === 'helper') {
    const { rows } = await db.query(
      'SELECT user_id FROM helper_profiles WHERE user_id = $1::uuid LIMIT 1',
      [profileId]
    );
    return rows.length ? String(rows[0].user_id) : null;
  }
  if (profileType === 'business') {
    const { rows } = await db.query(
      'SELECT user_id FROM businesses WHERE id = $1::bigint LIMIT 1',
      [profileId]
    );
    return rows.length ? String(rows[0].user_id) : null;
  }
  // restaurant
  const { rows } = await db.query(
    `SELECT b.user_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1::bigint
      LIMIT 1`,
    [profileId]
  );
  return rows.length ? String(rows[0].user_id) : null;
}

async function cappedCount(sql, params) {
  const { rows } = await db.query(`${sql} LIMIT ${COUNT_CAP + 1}`, params);
  return rows.length;
}

async function getActiveWork(profileType, profileId) {
  const result = {
    has_active_work: false,
    active_jobs: 0,
    upcoming_bookings: 0,
    open_orders: 0,
    recent_payments: 0,
  };

  const ownerId = await resolveOwnerUserId(profileType, profileId);
  if (!ownerId) return result; // unknown profile: nothing to warn about, caller 404s

  // Active jobs where the owner is the assigned helper or the client.
  result.active_jobs = await cappedCount(
    `SELECT id FROM jobs
      WHERE (assigned_helper_id = $1::uuid OR client_id = $1::uuid)
        AND status = ANY($2)`,
    [ownerId, NON_TERMINAL_JOB_STATUSES]
  );

  if (profileType === 'helper') {
    // Future or in-flight appointments for the helper.
    result.upcoming_bookings += await cappedCount(
      `SELECT id FROM appointments
        WHERE helper_id = $1::uuid
          AND status IN ('requested', 'confirmed', 'in_progress')
          AND scheduled_start_time > NOW()`,
      [ownerId]
    );
    // Pending booking requests aimed at the helper.
    result.upcoming_bookings += await cappedCount(
      `SELECT id FROM booking_requests
        WHERE helper_id = $1::uuid
          AND status IN ('pending', 'accepted')`,
      [ownerId]
    );
  }

  if (profileType === 'business' || profileType === 'restaurant') {
    const businessId = profileType === 'business'
      ? Number(profileId)
      : (await db.query('SELECT business_id FROM food_restaurants WHERE id = $1::bigint LIMIT 1', [profileId])).rows[0]?.business_id;
    if (businessId) {
      // Upcoming business appointments on the book.
      result.upcoming_bookings += await cappedCount(
        `SELECT id FROM business_appointments
          WHERE business_id = $1
            AND status IN ('pending', 'confirmed', 'in_progress')
            AND start_time > NOW()`,
        [businessId]
      );
    }
  }

  if (profileType === 'restaurant') {
    const restaurantId = Number(profileId);
    // Orders that are still being worked, not terminal (completed/cancelled/refunded).
    result.open_orders = await cappedCount(
      `SELECT id FROM food_orders
        WHERE restaurant_id = $1
          AND status IN ('received', 'accepted', 'preparing', 'ready')`,
      [restaurantId]
    );
  }

  // Money movement in the last 30 days touching the owner, so hiding does not
  // strand a payout or an in-flight dispute. Failed payments are excluded.
  result.recent_payments = await cappedCount(
    `SELECT id FROM payments
      WHERE (payer_id = $1::uuid OR payee_id = $1::uuid)
        AND created_at > NOW() - INTERVAL '30 days'
        AND status <> 'failed'`,
    [ownerId]
  );

  result.has_active_work =
    result.active_jobs > 0 ||
    result.upcoming_bookings > 0 ||
    result.open_orders > 0 ||
    result.recent_payments > 0;
  return result;
}

module.exports = { getActiveWork, COUNT_CAP };
