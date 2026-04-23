const pool = require('../db');
const logger = require('../utils/logger');

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
async function patchPrivacySettings(req, res) {
  try {
    if (!HELPER_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Only helpers can update this setting' });
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
      return res.status(400).json({
        error: 'At least one privacy setting must be a boolean',
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
      return res.status(404).json({ error: 'Helper profile not found' });
    }

    // Return updated settings
    return res.json(settingsToUpdate);
  } catch (err) {
    logger.error('[patchPrivacySettings]', { err });
    return res.status(500).json({ error: 'Failed to update privacy settings' });
  }
}

module.exports = { patchPrivacySettings };
