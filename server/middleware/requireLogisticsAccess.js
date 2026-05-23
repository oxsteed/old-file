'use strict';
/**
 * Logistics middleware:
 *  - requireLogisticsRole(...roles)  → gate on logistics_user_role values, plus admin/super_admin
 *  - requireLaneAccess(getLaneId)    → resolve a lane from req, evaluate access, attach req.laneAccess
 *  - enforceCountryRestriction()     → 403 if buyer country / role can't see the route's resource
 *
 * Designed to compose AFTER authenticate (req.user is set).
 */
const pool = require('../db');
const logger = require('../utils/logger');
const laneService = require('../services/logisticsLaneService');
const accessService = require('../services/logisticsAccessService');

const LOGISTICS_ROLES = new Set([
  'individual_buyer', 'business_buyer', 'organizer', 'reseller',
  'franchise_buyer', 'sourcing_operator', 'logistics_coordinator',
  'warehouse_operator', 'compliance_reviewer', 'admin', 'super_admin',
]);

/**
 * Resolve the user's effective logistics role.
 *   - Stored in users.logistics_role (TEXT) if migration added it, otherwise derived:
 *     - role='super_admin' → super_admin
 *     - role='admin'       → admin
 *     - has active business with verified KYB → business_buyer
 *     - default → individual_buyer
 */
async function resolveLogisticsRole(user) {
  if (!user) return null;
  if (user.logistics_role && LOGISTICS_ROLES.has(user.logistics_role)) return user.logistics_role;
  if (user.role === 'super_admin') return 'super_admin';
  if (user.role === 'admin')       return 'admin';
  try {
    const r = await pool.query(
      `SELECT id FROM businesses WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
      [user.id]
    );
    if (r.rows.length) return 'business_buyer';
  } catch (_) { /* table may not exist in some envs */ }
  return 'individual_buyer';
}

function requireLogisticsRole(...roles) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
      const effective = await resolveLogisticsRole(req.user);
      req.logisticsRole = effective;
      // super_admin + admin always pass
      if (effective === 'super_admin' || effective === 'admin') return next();
      if (roles.length === 0) return next();
      if (!roles.includes(effective)) {
        return res.status(403).json({
          error: 'logistics_role_required',
          required: roles,
          actual: effective,
        });
      }
      return next();
    } catch (err) {
      logger.error('requireLogisticsRole failed', { err: err.message });
      return res.status(500).json({ error: 'logistics_role_check_failed' });
    }
  };
}

/**
 * Resolve the lane referenced by this request and attach `req.lane` and
 * `req.laneAccess` (the result of accessService.evaluateAccess).
 *
 *   getLaneId(req) → number | null    (sync or async)
 *
 * Returns 403 if the buyer is blocked; warnings/requiresApproval don't block.
 */
function requireLaneAccess(getLaneId) {
  return async (req, res, next) => {
    try {
      const laneId = await Promise.resolve(getLaneId(req));
      if (!laneId) return next();
      const lane = await laneService.getLane(laneId);
      if (!lane) return res.status(404).json({ error: 'lane_not_found' });
      req.lane = lane;

      const userCountry =
        req.user?.country ||
        req.user?.location_country ||
        req.headers['x-buyer-country'] ||
        null;
      const role = req.logisticsRole || (req.user ? await resolveLogisticsRole(req.user) : null);
      // Probe business verification status (best-effort)
      let isBusinessVerified = false;
      if (req.user?.id) {
        try {
          const r = await pool.query(
            `SELECT id FROM businesses WHERE user_id = $1 AND is_active = TRUE AND kyb_verified = TRUE LIMIT 1`,
            [req.user.id]
          );
          isBusinessVerified = r.rows.length > 0;
        } catch (_) { /* column may not exist */ }
      }

      const access = await accessService.evaluateAccess({
        laneId,
        category: req.query?.category || null,
        buyerCountry: userCountry,
        userRole: role,
        isBusinessVerified,
      });
      req.laneAccess = access;
      // Allow admins through regardless
      if (role === 'admin' || role === 'super_admin') return next();
      if (!access.allowed) {
        return res.status(403).json({
          error: 'lane_access_denied',
          blockers: access.blockers,
          warnings: access.warnings,
        });
      }
      return next();
    } catch (err) {
      logger.error('requireLaneAccess failed', { err: err.message });
      return res.status(500).json({ error: 'lane_access_check_failed' });
    }
  };
}

/**
 * Generic country gate for a given category. Reads category from
 * req.params.category, req.query.category, or req.body.category.
 */
function enforceCountryRestriction() {
  return async (req, res, next) => {
    try {
      const category = req.params?.category || req.query?.category || req.body?.category;
      if (!category) return next();
      const country = req.user?.country || req.user?.location_country || req.headers['x-buyer-country'];
      if (!country) return next();
      const role = req.logisticsRole || (req.user ? await resolveLogisticsRole(req.user) : null);
      const access = await accessService.evaluateAccess({
        category, buyerCountry: country, userRole: role,
      });
      req.categoryAccess = access;
      if (role === 'admin' || role === 'super_admin') return next();
      if (!access.allowed) {
        return res.status(403).json({
          error: 'category_country_restricted',
          blockers: access.blockers,
        });
      }
      return next();
    } catch (err) {
      logger.error('enforceCountryRestriction failed', { err: err.message });
      return next(); // fail open — not a blocking gate
    }
  };
}

module.exports = {
  resolveLogisticsRole,
  requireLogisticsRole,
  requireLaneAccess,
  enforceCountryRestriction,
  LOGISTICS_ROLES: Array.from(LOGISTICS_ROLES),
};
