'use strict';

// Worker-side marketplace settings (docs/careers/marketplace.md §15):
//   • "Available now" (HOTS-style same-day hire signal): opt-in only; shows
//     to employers in talent search and shortlists while it lasts (max
//     24 h), never a live online/offline tracker.
//   • Careers SMS opt-in: separate consent recorded with a timestamp; the
//     existing notification_preferences.sms_careers column is turned on with
//     it and off when withdrawn. Nothing is texted unless
//     CAREERS_SMS_ENABLED=true and the phone is verified.

const { AppError } = require('../../../middleware/errorHandler');
const { smsConfig } = require('../providers/config');

async function ensureProfile(db, userId) {
  await db.query('INSERT INTO career_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function get(db, userId) {
  const { rows: [p] } = await db.query(
    'SELECT available_now_until, show_online_status, sms_opt_in, sms_opt_in_at FROM career_profiles WHERE user_id = $1', [userId]
  );
  const { rows: [u] } = await db.query('SELECT phone_verified FROM users WHERE id = $1', [userId]);
  return {
    show_online_status: Boolean(p?.show_online_status),
    available_now: Boolean(p?.show_online_status && p?.available_now_until && new Date(p.available_now_until) > new Date()),
    available_now_until: p?.available_now_until || null,
    sms_opt_in: Boolean(p?.sms_opt_in),
    sms_opt_in_at: p?.sms_opt_in_at || null,
    sms_available: smsConfig().enabled,
    phone_verified: Boolean(u?.phone_verified),
  };
}

async function update(db, userId, body = {}) {
  await ensureProfile(db, userId);
  if (typeof body.show_online_status === 'boolean') {
    await db.query(
      `UPDATE career_profiles SET show_online_status = $2,
              available_now_until = CASE WHEN $2 THEN available_now_until ELSE NULL END, updated_at = NOW() WHERE user_id = $1`,
      [userId, body.show_online_status]
    );
  }
  if (body.available_now_hours !== undefined) {
    const hours = body.available_now_hours === null || body.available_now_hours === 0 ? 0 : Number(body.available_now_hours);
    if (![0, 2, 4, 8, 12, 24].includes(hours)) throw new AppError('Validation failed', 400, 'validation_failed', { available_now_hours: 'Choose 2, 4, 8, 12 or 24 hours' });
    const { rows: [p] } = await db.query('SELECT show_online_status FROM career_profiles WHERE user_id = $1', [userId]);
    if (hours && !p?.show_online_status) throw new AppError('Validation failed', 400, 'validation_failed', { show_online_status: 'Turn on “Show employers when I am available” first' });
    await db.query(
      `UPDATE career_profiles SET available_now_until = CASE WHEN $2::int > 0 THEN NOW() + make_interval(hours => $2::int) END, last_active_at = NOW(), updated_at = NOW()
        WHERE user_id = $1`,
      [userId, hours]
    );
  }
  if (typeof body.sms_opt_in === 'boolean') {
    await db.query(
      `UPDATE career_profiles SET sms_opt_in = $2, sms_opt_in_at = CASE WHEN $2 THEN NOW() ELSE NULL END, updated_at = NOW() WHERE user_id = $1`,
      [userId, body.sms_opt_in]
    );
    const { rowCount } = await db.query('UPDATE notification_preferences SET sms_careers = $2 WHERE user_id = $1', [userId, body.sms_opt_in]);
    if (!rowCount) {
      await db.query('INSERT INTO notification_preferences (user_id, sms_careers) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET sms_careers = EXCLUDED.sms_careers', [userId, body.sms_opt_in]);
    }
  }
  return get(db, userId);
}

module.exports = { get, update };
