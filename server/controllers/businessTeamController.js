'use strict';

/**
 * Extended team / membership controller — sits alongside the existing
 * server/controllers/businessMembersController (which still handles
 * list/invite/revoke via /api/businesses/:id/members).
 *
 * New endpoints (per OxSteed team-role spec):
 *   GET    /api/businesses/:businessId/memberships              — list with permissions
 *   PATCH  /api/businesses/:businessId/memberships/:mid/role    — change role (owner only)
 *   PUT    /api/businesses/:businessId/memberships/:mid/overrides — set permission overrides
 *   GET    /api/businesses/:businessId/team/catalog             — roles + permissions catalog
 *   GET    /api/me/businesses                                   — owned + memberships for switcher
 *   POST   /api/me/workspace-context                            — update last_selected_at
 *   GET    /api/businesses/:businessId/me                       — current user's role + perms here
 */

const pool = require('../db');
const { sendError } = require('../utils/apiError');
const permissionsService = require('../services/permissionsService');
const { logBusinessAction } = require('../services/businessAuditLog');

const VALID_ROLES = ['manager', 'representative', 'employee', 'support_agent'];

exports.listMemberships = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT bm.id, bm.business_id, bm.member_id, bm.role, bm.status,
              bm.invite_email, bm.invited_at, bm.accepted_at,
              u.first_name, u.last_name, u.email AS user_email, u.profile_photo_url
         FROM business_members bm
         LEFT JOIN users u ON u.id = bm.member_id
        WHERE bm.business_id = $1
        ORDER BY (bm.status = 'active') DESC, (bm.status = 'pending') DESC, bm.id ASC`,
      [req.business.id]
    );

    // Attach effective permissions per active membership (parallel)
    const enriched = await Promise.all(
      rows.map(async (row) => {
        if (row.status !== 'active' || !row.member_id) {
          return { ...row, permissions: [] };
        }
        const { permissions } = await permissionsService.getEffectivePermissions({
          businessId: req.business.id,
          userId: row.member_id,
          role: row.role,
          membershipId: row.id,
        });
        return { ...row, permissions: Array.from(permissions) };
      })
    );

    res.json({ data: enriched });
  } catch (err) {
    next(err);
  }
};

exports.getMyMembership = async (req, res, next) => {
  try {
    // requireBusinessAccess already populated req.businessRole + req.permissions
    res.json({
      data: {
        business_id: req.business.id,
        business_name: req.business.business_name,
        role: req.businessRole,
        membership_id: req.membership ? req.membership.id : null,
        is_owner: req.businessRole === 'owner',
        permissions: req.permissions ? Array.from(req.permissions) : [],
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.changeMembershipRole = async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner') {
      return sendError(res, 403, 'Only the business owner can change roles.', 'owner_only');
    }
    const mid = parseInt(req.params.membershipId, 10);
    const newRole = String(req.body.role || '').trim();
    if (!Number.isFinite(mid) || !VALID_ROLES.includes(newRole)) {
      return sendError(res, 400, 'Invalid role.', 'invalid_role', { allowed: VALID_ROLES });
    }

    const existing = await pool.query(
      'SELECT id, role, member_id, status FROM business_members WHERE id = $1 AND business_id = $2',
      [mid, req.business.id]
    );
    if (existing.rowCount === 0) {
      return sendError(res, 404, 'Membership not found.', 'membership_not_found');
    }
    if (existing.rows[0].status === 'revoked') {
      return sendError(res, 409, 'Cannot change role on a revoked membership.', 'membership_revoked');
    }
    if (existing.rows[0].role === newRole) {
      return res.json({ data: existing.rows[0] });
    }

    const { rows } = await pool.query(
      `UPDATE business_members
          SET role = $1, role_updated_at = NOW(), role_updated_by = $2
        WHERE id = $3 AND business_id = $4
        RETURNING id, role, member_id, status`,
      [newRole, req.user.id, mid, req.business.id]
    );

    if (rows[0].member_id) {
      permissionsService.invalidateCache(req.business.id, rows[0].member_id);
    }
    await logBusinessAction(req, {
      action: 'business.member.role_changed',
      target_type: 'business_member',
      target_id: mid,
      before_state: { role: existing.rows[0].role },
      after_state:  { role: newRole },
    });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/businesses/:businessId/memberships/:membershipId/overrides
 * Body: { overrides: [{ permission_code, effect, reason?, expires_at? }, ...] }
 * Replaces the override set for that membership.
 *
 * A manager cannot grant overrides above their own privilege level —
 * we enforce that by requiring the granter to ALSO hold the permission
 * being allow-overridden (i.e. you cannot give what you don't have).
 */
exports.setMembershipOverrides = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const mid = parseInt(req.params.membershipId, 10);
    if (!Number.isFinite(mid)) {
      return sendError(res, 400, 'Invalid membership id.', 'invalid_membership_id');
    }
    const overrides = Array.isArray(req.body.overrides) ? req.body.overrides : [];
    for (const o of overrides) {
      if (!o || typeof o.permission_code !== 'string' || !['allow','deny'].includes(o.effect)) {
        return sendError(res, 400, 'Each override needs permission_code and effect.', 'invalid_override');
      }
    }

    // Granter must have the team.assign_permissions permission OR be owner.
    const isOwner = req.businessRole === 'owner';
    const canAssign = isOwner || (req.permissions && req.permissions.has('team.assign_permissions'));
    if (!canAssign) {
      return sendError(res, 403, 'You cannot assign permissions.', 'permission_denied');
    }

    await client.query('BEGIN');

    const exists = await client.query(
      'SELECT id, member_id FROM business_members WHERE id = $1 AND business_id = $2',
      [mid, req.business.id]
    );
    if (exists.rowCount === 0) {
      await client.query('ROLLBACK');
      return sendError(res, 404, 'Membership not found.', 'membership_not_found');
    }

    // Filter: managers cannot grant ALLOW for a permission they themselves lack.
    if (!isOwner && req.permissions) {
      for (const o of overrides) {
        if (o.effect === 'allow' && !req.permissions.has(o.permission_code)) {
          await client.query('ROLLBACK');
          return sendError(res, 403, `You cannot grant a permission you do not hold: ${o.permission_code}`, 'cannot_grant_above_level', { permission: o.permission_code });
        }
      }
    }

    await client.query('DELETE FROM membership_permission_overrides WHERE membership_id = $1', [mid]);

    for (const o of overrides) {
      await client.query(
        `INSERT INTO membership_permission_overrides
           (membership_id, permission_id, effect, reason, granted_by_user_id, expires_at)
         SELECT $1, p.id, $2, $3, $4, $5
           FROM team_permissions p
          WHERE p.code = $6`,
        [mid, o.effect, o.reason ? String(o.reason).slice(0, 500) : null, req.user.id, o.expires_at || null, o.permission_code]
      );
    }

    await client.query('COMMIT');

    if (exists.rows[0].member_id) {
      permissionsService.invalidateCache(req.business.id, exists.rows[0].member_id);
    }
    await logBusinessAction(req, {
      action: 'business.member.permissions_updated',
      target_type: 'business_member',
      target_id: mid,
      after_state: { overrides },
    });

    res.json({ data: { ok: true, count: overrides.length } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/businesses/:businessId/team/catalog
 * Returns the roles + permission catalog the UI uses to render the
 * override modal and role picker.
 */
exports.getCatalog = async (req, res, next) => {
  try {
    const catalog = await permissionsService.getCatalog();
    res.json({ data: catalog });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/me/businesses
 * One unified payload for the workspace switcher.
 * Returns owned + active memberships + pending invites, with the
 * "last selected" business surfaced.
 */
exports.getMyBusinesses = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Authentication required.', 'auth_required');
    }
    const [owned, memberships, contexts] = await Promise.all([
      pool.query(
        `SELECT b.id, b.business_name, b.is_primary, b.is_active,
                b.business_kind, b.business_mode, b.setup_status,
                b.currency_code, b.address_country,
                (SELECT fr.id
                   FROM food_restaurants fr
                  WHERE fr.business_id = b.id
                  ORDER BY fr.id
                  LIMIT 1) AS restaurant_id,
                (SELECT COUNT(*)::int
                   FROM business_members count_members
                  WHERE count_members.business_id = b.id
                    AND count_members.status = 'active') AS member_count
           FROM businesses b
          WHERE b.user_id = $1 AND (b.deleted_at IS NULL) AND b.is_active != FALSE
          ORDER BY b.is_primary DESC, b.business_name ASC`,
        [req.user.id]
      ),
      pool.query(
        `SELECT bm.id AS membership_id, bm.business_id, bm.role, bm.status,
                b.business_name, b.is_active, b.business_kind, b.business_mode,
                b.setup_status, b.currency_code, b.address_country,
                (SELECT fr.id
                   FROM food_restaurants fr
                  WHERE fr.business_id = b.id
                  ORDER BY fr.id
                  LIMIT 1) AS restaurant_id,
                (SELECT COUNT(*)::int
                   FROM business_members count_members
                  WHERE count_members.business_id = b.id
                    AND count_members.status = 'active') AS member_count
           FROM business_members bm
           JOIN businesses b ON b.id = bm.business_id
          WHERE bm.member_id = $1
            AND bm.status IN ('active','pending')
            AND b.deleted_at IS NULL
            AND b.is_active != FALSE
          ORDER BY bm.status = 'active' DESC, b.business_name ASC`,
        [req.user.id]
      ),
      pool.query(
        `SELECT business_id, last_selected_at
           FROM user_workspace_contexts
          WHERE user_id = $1
          ORDER BY last_selected_at DESC
          LIMIT 50`,
        [req.user.id]
      ),
    ]);

    const lastSelectedMap = new Map(contexts.rows.map((r) => [r.business_id, r.last_selected_at]));

    const ownedItems = owned.rows.map((r) => ({
      business_id: r.id,
      business_name: r.business_name,
      role: 'owner',
      status: 'active',
      is_primary: r.is_primary,
      is_owner: true,
      business_kind: r.business_kind || (r.business_mode === 'food' ? 'restaurant' : 'service'),
      business_mode: r.business_mode,
      setup_status: r.setup_status,
      currency_code: r.currency_code,
      address_country: r.address_country,
      restaurant_id: r.restaurant_id,
      member_count: r.member_count,
      membership_id: null,
      last_selected_at: lastSelectedMap.get(r.id) || null,
    }));
    const memberItems = memberships.rows.map((r) => ({
      business_id: r.business_id,
      business_name: r.business_name,
      role: r.role,
      status: r.status,
      is_primary: false,
      is_owner: false,
      business_kind: r.business_kind || (r.business_mode === 'food' ? 'restaurant' : 'service'),
      business_mode: r.business_mode,
      setup_status: r.setup_status,
      currency_code: r.currency_code,
      address_country: r.address_country,
      restaurant_id: r.restaurant_id,
      member_count: r.member_count,
      membership_id: r.membership_id,
      last_selected_at: lastSelectedMap.get(r.business_id) || null,
    }));

    const items = [...ownedItems, ...memberItems];
    // Sort by last_selected (DESC, nulls last), then by name
    items.sort((a, b) => {
      const la = a.last_selected_at ? new Date(a.last_selected_at).getTime() : 0;
      const lb = b.last_selected_at ? new Date(b.last_selected_at).getTime() : 0;
      if (lb !== la) return lb - la;
      return String(a.business_name).localeCompare(String(b.business_name));
    });

    res.json({
      data: {
        items,
        last_selected: items.find((x) => x.last_selected_at) || items[0] || null,
        owned_count: ownedItems.length,
        membership_count: memberItems.filter((m) => m.status === 'active').length,
        pending_count: memberItems.filter((m) => m.status === 'pending').length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/me/workspace-context
 * Body: { business_id }
 * Used by the switcher to record the user's current active workspace
 * so we can auto-select it next time.
 */
exports.setWorkspaceContext = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Authentication required.', 'auth_required');
    }
    const businessId = parseInt(req.body.business_id, 10);
    const restaurantId = req.body.restaurant_id == null ? null : parseInt(req.body.restaurant_id, 10);
    if (!Number.isFinite(businessId)) {
      return sendError(res, 400, 'Invalid business id.', 'invalid_business_id');
    }
    if (req.body.restaurant_id != null && !Number.isFinite(restaurantId)) {
      return sendError(res, 400, 'Invalid restaurant id.', 'invalid_restaurant_id');
    }

    // Verify the user actually has access
    const acc = await pool.query(
      `SELECT b.id,
              CASE
                WHEN b.user_id = $2 THEN 'owner'
                ELSE (SELECT role FROM business_members WHERE business_id = b.id AND member_id = $2 AND status = 'active' LIMIT 1)
              END AS effective_role,
              CASE
                WHEN b.user_id = $2 THEN NULL
                ELSE (SELECT id FROM business_members WHERE business_id = b.id AND member_id = $2 AND status = 'active' LIMIT 1)
              END AS membership_id
         FROM businesses b
        WHERE b.id = $1 AND b.deleted_at IS NULL AND b.is_active != FALSE`,
      [businessId, req.user.id]
    );
    if (acc.rowCount === 0 || !acc.rows[0].effective_role) {
      return sendError(res, 404, 'Business not found.', 'business_not_found');
    }
    if (restaurantId != null) {
      const restaurant = await pool.query(
        `SELECT 1 FROM food_restaurants
          WHERE id = $1 AND business_id = $2 AND status = 'active'`,
        [restaurantId, businessId]
      );
      if (restaurant.rowCount === 0) {
        return sendError(res, 404, 'Restaurant not found.', 'restaurant_not_found');
      }
    }

    await pool.query(
      `INSERT INTO user_workspace_contexts (user_id, business_id, membership_id, restaurant_id, last_selected_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, business_id) DO UPDATE
         SET membership_id = EXCLUDED.membership_id,
             restaurant_id = EXCLUDED.restaurant_id,
             last_selected_at = NOW()`,
      [req.user.id, businessId, acc.rows[0].membership_id, restaurantId]
    );
    res.json({ data: { ok: true, business_id: businessId, restaurant_id: restaurantId, role: acc.rows[0].effective_role } });
  } catch (err) {
    next(err);
  }
};
