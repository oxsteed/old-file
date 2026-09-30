// server/controllers/profileVisibilityController.js
// Admin control over public profile visibility for helpers, businesses, and
// restaurants. Each profile type already has an owner-facing visibility flag
// (helper_profiles.is_listed, businesses.is_listed,
// food_restaurants.discovery_status), but owners can flip those back, so they
// cannot serve as compliance holds. This controller manages the sticky admin
// override instead: when is_hidden_by_admin is TRUE the public profile
// endpoints treat the profile as hidden no matter what the owner-facing flag
// says. Requires the manage_profile_visibility grant (see routes/admin.js).

const db     = require('../db');
const logger = require('../utils/logger');
const { logAdminAction } = require('../services/auditService');

const PROFILE_TYPES = ['helper', 'business', 'restaurant'];
const REASONS = ['incomplete_profile', 'non_compliance', 'admin_decision', 'other'];

// ─── GET /api/admin/profile-visibility/search?q=…&type=… ─────────────────────
// Searches helpers, businesses, and restaurants by name/email and returns the
// current public-visibility state for each match.

exports.searchProfiles = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'all').toLowerCase();
    if (q.length < 2) {
      return res.json({ results: [] });
    }
    if (!['all', ...PROFILE_TYPES].includes(type)) {
      return res.status(400).json({ error: 'Invalid profile type.' });
    }
    const like = `%${q}%`;
    const results = [];

    if (type === 'all' || type === 'helper') {
      const { rows } = await db.query(
        `SELECT u.id AS profile_id,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS display_name,
                u.email AS detail,
                hp.is_hidden_by_admin, hp.hidden_reason,
                COALESCE(hp.is_listed, TRUE) AS owner_listed
           FROM users u
           JOIN helper_profiles hp ON hp.user_id = u.id
          WHERE (u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR u.email ILIKE $1
                 OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE $1)
            AND u.deleted_at IS NULL
          ORDER BY u.created_at DESC
          LIMIT 15`,
        [like]
      );
      for (const r of rows) {
        results.push({
          profile_type: 'helper',
          profile_id: r.profile_id,
          display_name: r.display_name || r.detail,
          detail: r.detail,
          is_hidden_by_admin: !!r.is_hidden_by_admin,
          hidden_reason: r.hidden_reason,
          owner_visible: !!r.owner_listed,
          is_visible: !r.is_hidden_by_admin && !!r.owner_listed,
        });
      }
    }

    if (type === 'all' || type === 'business') {
      const { rows } = await db.query(
        `SELECT b.id AS profile_id,
                b.business_name AS display_name,
                u.email AS detail,
                b.is_hidden_by_admin, b.hidden_reason,
                COALESCE(b.is_listed, TRUE) AS owner_listed,
                COALESCE(b.is_active, TRUE) AS owner_active
           FROM businesses b
           LEFT JOIN users u ON u.id = b.user_id
          WHERE b.business_name ILIKE $1
            AND b.deleted_at IS NULL
          ORDER BY b.created_at DESC
          LIMIT 15`,
        [like]
      );
      for (const r of rows) {
        results.push({
          profile_type: 'business',
          profile_id: r.profile_id,
          display_name: r.display_name,
          detail: r.detail,
          is_hidden_by_admin: !!r.is_hidden_by_admin,
          hidden_reason: r.hidden_reason,
          owner_visible: !!r.owner_listed && !!r.owner_active,
          is_visible: !r.is_hidden_by_admin && !!r.owner_listed && !!r.owner_active,
        });
      }
    }

    if (type === 'all' || type === 'restaurant') {
      const { rows } = await db.query(
        `SELECT fr.id AS profile_id,
                fr.display_name AS display_name,
                b.business_name AS detail,
                fr.is_hidden_by_admin, fr.hidden_reason,
                fr.discovery_status
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
          WHERE (fr.display_name ILIKE $1 OR b.business_name ILIKE $1)
            AND b.deleted_at IS NULL
          ORDER BY fr.id DESC
          LIMIT 15`,
        [like]
      );
      for (const r of rows) {
        const ownerVisible = r.discovery_status === 'visible';
        results.push({
          profile_type: 'restaurant',
          profile_id: r.profile_id,
          display_name: r.display_name || r.detail,
          detail: r.detail,
          is_hidden_by_admin: !!r.is_hidden_by_admin,
          hidden_reason: r.hidden_reason,
          owner_visible: ownerVisible,
          is_visible: !r.is_hidden_by_admin && ownerVisible,
        });
      }
    }

    return res.json({ results });
  } catch (err) {
    logger.error('profileVisibility search error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Search failed.' });
  }
};

// ─── PUT /api/admin/profile-visibility ───────────────────────────────────────
// Body: { profile_type: 'helper'|'business'|'restaurant', profile_id,
//         is_visible: boolean, reason?: 'incomplete_profile'|'non_compliance'|
//         'admin_decision'|'other', note?: string }

const TABLE_BY_TYPE = {
  helper:     { table: 'helper_profiles',  idCol: 'user_id', targetType: 'helper_profile' },
  business:   { table: 'businesses',       idCol: 'id',      targetType: 'business' },
  restaurant: { table: 'food_restaurants',  idCol: 'id',      targetType: 'restaurant' },
};

exports.setProfileVisibility = async (req, res) => {
  try {
    const { profile_type, profile_id, is_visible, reason, note } = req.body || {};
    const spec = TABLE_BY_TYPE[profile_type];
    if (!spec) {
      return res.status(400).json({ error: 'profile_type must be helper, business, or restaurant.' });
    }
    if (profile_id === undefined || profile_id === null || String(profile_id).trim() === '') {
      return res.status(400).json({ error: 'profile_id is required.' });
    }
    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({ error: 'is_visible must be a boolean.' });
    }
    if (reason !== undefined && reason !== null && reason !== '' && !REASONS.includes(reason)) {
      return res.status(400).json({ error: `reason must be one of: ${REASONS.join(', ')}.` });
    }

    const hide = !is_visible;
    const reasonCode = hide ? (reason || 'admin_decision') : null;
    const { rows } = await db.query(
      `UPDATE ${spec.table}
          SET is_hidden_by_admin = $1,
              hidden_reason      = $2,
              hidden_at          = CASE WHEN $1 THEN NOW() ELSE NULL END,
              hidden_by          = CASE WHEN $1 THEN $3 ELSE NULL END,
              updated_at         = NOW()
        WHERE ${spec.idCol} = $4
        RETURNING is_hidden_by_admin, hidden_reason, hidden_at`,
      [hide, reasonCode, req.user.id, profile_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    try {
      await logAdminAction({
        adminId: req.user.id,
        action: hide ? 'profile_visibility_hidden' : 'profile_visibility_restored',
        targetType: spec.targetType,
        targetId: String(profile_id),
        before: { is_hidden_by_admin: !hide },
        after: { is_hidden_by_admin: hide, hidden_reason: reasonCode },
        description: [reasonCode, note].filter(Boolean).join(' - ') || null,
        req,
      });
    } catch (e) { /* audit logging must not block the moderation action */ }

    return res.json({
      success: true,
      profile_type,
      profile_id,
      is_hidden_by_admin: rows[0].is_hidden_by_admin,
      hidden_reason: rows[0].hidden_reason,
      is_visible,
    });
  } catch (err) {
    logger.error('profileVisibility set error', { err, adminId: req.user?.id });
    return res.status(500).json({ error: 'Could not update profile visibility.' });
  }
};

exports.PROFILE_TYPES = PROFILE_TYPES;
exports.REASONS = REASONS;
