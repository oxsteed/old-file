'use strict';

/**
 * Admin controller for restaurant customer top-up eligibility + clawback.
 *
 * GET  /api/admin/restaurant-topups/applications?status=pending
 * POST /api/admin/restaurant-topups/applications/:restaurantId/approve
 * POST /api/admin/restaurant-topups/applications/:restaurantId/reject   {reason}
 * POST /api/admin/restaurant-topups/applications/:restaurantId/suspend  {reason}
 * POST /api/admin/restaurant-topups/topups/:topupId/clawback            {reason}
 *
 * All routes sit behind requireAdmin + the manage_financials money gate
 * (requireSuperAdminOrPermission), following the agent credit-adjustment
 * pattern. Every decision records decided_by / decided_at / decision_reason
 * and writes a transactional admin audit entry. Clawback additionally writes
 * the food-wallet operator audit inside the same transaction.
 */

const { AppError } = require('../middleware/errorHandler');
const topupService = require('../services/restaurantTopupService');

function parseRestaurantId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function formatApplication(row) {
  if (!row) return null;
  return {
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    restaurantStatus: row.restaurant_status || null,
    restaurantCurrency: row.restaurant_currency || null,
    status: row.status,
    appliedAt: row.applied_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decisionReason: row.decision_reason || null,
    updatedAt: row.updated_at,
  };
}

function getRequestContext(req) {
  return {
    requestIp: req.ip || null,
    correlationId: req.correlationId || req.get('X-Request-ID') || null,
  };
}

async function listApplications(req, res, next) {
  try {
    const { applications, total, limit, offset } = await topupService.listApplications({
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({
      applications: applications.map(formatApplication),
      total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
}

function decideApplication(decision) {
  return async (req, res, next) => {
    try {
      const restaurantId = parseRestaurantId(req.params.restaurantId);
      if (!restaurantId) {
        throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
      }
      const adminId = req.user?.id;
      if (!adminId) {
        throw new AppError('Authentication is required', 401, 'auth_required');
      }
      const { restaurant, eligibility, previousStatus } = await topupService.decideApplication({
        restaurantId,
        adminId,
        decision,
        reason: req.body?.reason,
      });
      res.json({
        application: formatApplication({
          ...eligibility,
          restaurant_name: restaurant.display_name,
          restaurant_status: restaurant.status,
          restaurant_currency: restaurant.currency_code,
        }),
        previousStatus,
      });
    } catch (err) {
      next(err);
    }
  };
}

async function clawbackTopup(req, res, next) {
  try {
    const adminId = req.user?.id;
    if (!adminId) {
      throw new AppError('Authentication is required', 401, 'auth_required');
    }
    const { requestIp, correlationId } = getRequestContext(req);
    const result = await topupService.clawbackTopup({
      topupId: req.params.topupId,
      adminId,
      reason: req.body?.reason,
      requestIp,
      correlationId,
    });
    res.json({ clawback: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listApplications,
  approveApplication: decideApplication('approve'),
  rejectApplication: decideApplication('reject'),
  suspendApplication: decideApplication('suspend'),
  clawbackTopup,
};
