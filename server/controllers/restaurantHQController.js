'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const hq = require('../services/restaurantHQService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

function dateRange(req) {
  const to = req.query?.to ? new Date(`${req.query.to}T00:00:00.000Z`) : new Date();
  const from = req.query?.from ? new Date(`${req.query.from}T00:00:00.000Z`) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new AppError('Invalid HQ report date range', 400, 'validation_failed');
  return { from: from.toISOString(), to: to.toISOString() };
}

exports.rollup = async (req, res, next) => {
  try {
    const anchorId = Number.parseInt(req.params.restaurantId, 10);
    if (!Number.isSafeInteger(anchorId) || anchorId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const anchor = await resolveRestaurantAccess(req.user.id, anchorId);
    if (!(await permissions.hasRestaurantPermission(anchor, req.user.id, ['settings.manage']))) {
      throw new AppError('You do not have permission to view the HQ rollup', 403, 'forbidden');
    }
    const { rows } = await pool.query(
      `SELECT id, display_name, address_city, address_state, timezone, status
         FROM food_restaurants WHERE business_id = $1 ORDER BY id`,
      [anchor.business_id]
    );
    const accessible = [];
    for (const row of rows) {
      try {
        const restaurant = await resolveRestaurantAccess(req.user.id, row.id);
        if (await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage'])) accessible.push(row);
      } catch (_) { /* fail closed per store */ }
    }
    const ids = accessible.map((row) => Number(row.id));
    const range = dateRange(req);
    const { salesRows, healthRows, complianceRows } = await hq.rollup(pool, { businessId: anchor.business_id, restaurantIds: ids, ...range });
    const healthById = new Map(healthRows.map((row) => [Number(row.restaurant_id), row]));
    const complianceById = new Map(complianceRows.map((row) => [Number(row.restaurant_id), row]));
    const stores = accessible.map((row) => hq.storeShape(row, salesRows.filter((entry) => Number(entry.restaurant_id) === Number(row.id)), {
      latestAuditScorePercent: healthById.get(Number(row.id))?.latest_audit_score_percent,
      openFindings: healthById.get(Number(row.id))?.open_findings,
      checklistCompletionPercent: complianceById.get(Number(row.id))?.checklist_completion_percent,
      checklistRuns: complianceById.get(Number(row.id))?.checklist_runs,
      trainingCompletionPercent: complianceById.get(Number(row.id))?.training_completion_percent,
      trainingAssignments: complianceById.get(Number(row.id))?.training_assignments,
      overdueTraining: complianceById.get(Number(row.id))?.overdue_training,
    }));
    res.json({ scope: { businessId: Number(anchor.business_id), storeCount: stores.length, from: range.from, to: range.to }, stores });
  } catch (err) { next(err); }
};

exports.publishMenuOverrides = async (req, res, next) => {
  try {
    const restaurantId = Number.parseInt(req.params.restaurantId, 10);
    if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
    if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['settings.manage']))) {
      throw new AppError('You do not have permission to publish the HQ menu', 403, 'forbidden');
    }
    const request = hq.normalizePublishRequest(req.body || {});
    const scope = await getLocationScope(restaurant, req.user.id);
    if (scope.mode === 'assigned' && [request.sourceLocationId, ...request.targetLocationIds].some((id) => !scope.location_ids.includes(id))) {
      throw new AppError('You do not have access to every selected store', 403, 'location_scope_forbidden');
    }
    const result = await withTransaction(pool, async (client) => {
      const published = await hq.publishMenuOverrides(client, { restaurantId, ...request, actorUserId: req.user.id });
      for (const target of published.targets) {
        await logBusinessAction(req, {
          business_id: restaurant.business_id,
          actor_role: restaurant.effective_role,
          action: 'restaurant.hq_menu.published',
          target_type: 'restaurant_location',
          target_id: target.locationId,
          metadata: { source_location_id: published.sourceLocationId, copied_overrides: target.copiedOverrides },
          client,
          throwOnError: true,
        });
      }
      return published;
    }, 'restaurant_hq_menu_publish');
    res.status(200).json({ ...result, published: true });
  } catch (error) { next(error); }
};
