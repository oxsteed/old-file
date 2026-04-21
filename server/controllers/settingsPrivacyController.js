const pool = require('../db');
const logger = require('../utils/logger');

const HELPER_ROLES = new Set(['helper', 'helper_pro', 'broker']);

/**
 * PATCH /api/settings/privacy
 * Body: { allow_guest_contact: boolean }
 * Updates helper_profiles for helper-tier users only.
 */
async function patchPrivacySettings(req, res) {
  try {
    if (!HELPER_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Only helpers can update this setting' });
    }
    const raw = req.body?.allow_guest_contact;
    if (typeof raw !== 'boolean') {
      return res.status(400).json({ error: 'allow_guest_contact must be a boolean' });
    }
    const { rowCount } = await pool.query(
      `UPDATE helper_profiles SET allow_guest_contact = $1 WHERE user_id = $2`,
      [raw, req.user.id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Helper profile not found' });
    }
    return res.json({ allow_guest_contact: raw });
  } catch (err) {
    logger.error('[patchPrivacySettings]', { err });
    return res.status(500).json({ error: 'Failed to update privacy settings' });
  }
}

module.exports = { patchPrivacySettings };
