const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

const HELPER_ROLES = new Set(['helper', 'helper_pro', 'broker']);

/**
 * PATCH /api/settings/privacy
 * Body: {
 *   allow_guest_contact?: boolean,
 *   allow_booking?: boolean,
 *   allow_scheduling?: boolean,
 *   allow_live_chat?: boolean
 * }
 * Updates helper_profiles for helper-tier users only.
 */
async function patchPrivacySettings(req, res, next) {
  try {
    if (!HELPER_ROLES.has(req.user.role)) {
      throw new AppError('Only helpers can update this setting', 403, 'forbidden');
    }

    const {
      allow_guest_contact,
      allow_booking,
      allow_scheduling,
      allow_live_chat,
    } = req.body;

    // Validate that at least one setting is provided
    const settingsToUpdate = {};
    let hasValidSetting = false;

    if (typeof allow_guest_contact === 'boolean') {
      settingsToUpdate.allow_guest_contact = allow_guest_contact;
      hasValidSetting = true;
    }

    if (typeof allow_booking === 'boolean') {
      settingsToUpdate.allow_booking = allow_booking;
      hasValidSetting = true;
    }

    if (typeof allow_scheduling === 'boolean') {
      settingsToUpdate.allow_scheduling = allow_scheduling;
      hasValidSetting = true;
    }

    if (typeof allow_live_chat === 'boolean') {
      settingsToUpdate.allow_live_chat = allow_live_chat;
      hasValidSetting = true;
    }

    if (!hasValidSetting) {
      throw new AppError('At least one privacy setting must be provided as boolean', 400, 'validation_failed', {
        allow_guest_contact: 'Must be boolean if provided',
        allow_booking: 'Must be boolean if provided',
        allow_scheduling: 'Must be boolean if provided',
        allow_live_chat: 'Must be boolean if provided',
      });
    }

    // Build dynamic UPDATE query
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(settingsToUpdate)) {
      setClauses.push(`${key} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }

    params.push(req.user.id);

    const { rowCount } = await pool.query(
      `UPDATE helper_profiles SET ${setClauses.join(', ')} WHERE user_id = $${paramIndex}`,
      params,
    );

    if (!rowCount) {
      throw new AppError('Helper profile not found', 404, 'not_found');
    }

    // Return updated settings
    res.json(settingsToUpdate);
  } catch (err) {
    next(err);
  }
}

module.exports = { patchPrivacySettings };
