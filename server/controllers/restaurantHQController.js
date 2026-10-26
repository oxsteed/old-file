'use strict';

const pool = require('../db');
const v = require('../utils/restaurantReviewValidation');
const { attachScope, requireBrand } = require('../services/restaurantReviewScope');
const payroll = require('../services/restaurantPayrollService');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const hq = require('../services/restaurantHQService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

function dateRange(req, restaurant) {
  try {
    const timezone = payroll.resolveReportTimezone(restaurant);
    const { fromDate, toDate } = payroll.parseLocalRange(req.query || {}, timezone);
    return { from: fromDate, to: payroll.shiftDateString(toDate, 1), timezone };
  } catch (error) { throw new AppError(error.message, 400, 'validation_failed'); }
}

async function loadHQRestaurant(req, permission) {
  const restaurantId = v.integer(req.params.restaurantId, 'restaurantId');
  if (!Number.isSafeInteger(restaurantId) || restaurantId <= 0) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, [permission]))) {
    throw new AppError('You do not have permission to manage the HQ hierarchy', 403, 'forbidden');
  }
  const scoped = await attachScope(restaurant, req.user.id);
  requireBrand(scoped);
  return scoped;
}

exports.listRegions = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.view');
    const regions = await hq.listRegions(pool, restaurant.id);
    res.json({ regions });
  } catch (error) { next(error); }
};

exports.createRegion = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    const parentRegionId = req.body?.parentRegionId ?? req.body?.parent_region_id ?? null;
    const region = await withTransaction(pool, async (client) => {
      const created = await hq.createRegion(client, {
        restaurantId: restaurant.id,
        code: req.body?.code,
        name: req.body?.name,
        parentRegionId: parentRegionId == null || parentRegionId === '' ? null : v.integer(parentRegionId, 'parentRegionId'),
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.hq_region.created',
        target_type: 'restaurant_region',
        target_id: created.id,
        after_state: created,
        client,
        throwOnError: true,
      });
      return created;
    }, 'restaurant_hq_region_create');
    res.status(201).json({ region });
  } catch (error) { next(error); }
};

exports.updateRegion = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    const regionId = v.integer(req.params.regionId, 'regionId');
    const patch = {};
    for (const key of ['code', 'name', 'status']) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'parentRegionId')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'parent_region_id')) {
      const value = req.body.parentRegionId ?? req.body.parent_region_id;
      patch.parentRegionId = value == null || value === '' ? null : v.integer(value, 'parentRegionId');
    }
    if (!Object.keys(patch).length) throw new AppError('No region fields provided', 400, 'validation_failed');
    const result = await withTransaction(pool, async (client) => {
      const updated = await hq.updateRegion(client, {
        restaurantId: restaurant.id,
        regionId,
        patch,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.hq_region.updated',
        target_type: 'restaurant_region',
        target_id: regionId,
        before_state: updated.before,
        after_state: updated.after,
        client,
        throwOnError: true,
      });
      return updated;
    }, 'restaurant_hq_region_update');
    res.json({ region: result.after });
  } catch (error) { next(error); }
};

exports.rollup = async (req, res, next) => {
  try {
    const anchorId = v.integer(req.params.restaurantId, 'restaurantId');
    if (!Number.isSafeInteger(anchorId) || anchorId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const anchor = await resolveRestaurantAccess(req.user.id, anchorId);
    if (!(await permissions.hasRestaurantPermission(anchor, req.user.id, ['settings.manage','reports.view']))) {
      throw new AppError('You do not have permission to view the HQ rollup', 403, 'forbidden');
    }
    const locationScope = await getLocationScope(anchor, req.user.id);
    const locationParams = [anchor.id];
    const locationFilter = locationScope.mode === 'assigned' ? ' AND l.id = ANY($2::bigint[])' : '';
    if (locationScope.mode === 'assigned') locationParams.push(locationScope.location_ids);
    const { rows: accessible } = await pool.query(
      `SELECT l.id, l.name AS display_name, l.address_city, l.address_state,
              l.timezone, l.status, l.region_id, rr.name AS region_name
         FROM restaurant_locations l
         LEFT JOIN restaurant_regions rr
           ON rr.restaurant_id = l.restaurant_id AND rr.id = l.region_id
        WHERE l.restaurant_id = $1${locationFilter}
        ORDER BY l.is_primary DESC, l.id`,
      locationParams
    );
    const ids = accessible.map((row) => Number(row.id));
    if (!ids.length) throw new AppError('No accessible stores found', 403, 'hq_scope_empty');
    const range = dateRange(req, anchor);
    const { salesRows, healthRows, complianceRows } = await hq.rollupLocations(pool, { restaurantId: anchor.id, locationIds: ids, ...range });
    const healthById = new Map(healthRows.map((row) => [Number(row.location_id), row]));
    const complianceById = new Map(complianceRows.map((row) => [Number(row.location_id), row]));
    const stores = accessible.map((row) => hq.storeShape(row, salesRows.filter((entry) => Number(entry.location_id) === Number(row.id)), {
      latestAuditScorePercent: healthById.get(Number(row.id))?.latest_audit_score_percent,
      openFindings: healthById.get(Number(row.id))?.open_findings,
      checklistCompletionPercent: complianceById.get(Number(row.id))?.checklist_completion_percent,
      checklistRuns: complianceById.get(Number(row.id))?.checklist_runs,
      trainingCompletionPercent: complianceById.get(Number(row.id))?.training_completion_percent,
      trainingAssignments: complianceById.get(Number(row.id))?.training_assignments,
      overdueTraining: complianceById.get(Number(row.id))?.overdue_training,
    }));
    res.json({ scope: { businessId: Number(anchor.business_id), restaurantId: Number(anchor.id), storeCount: stores.length, from: range.from, to: range.to, timezone: range.timezone }, stores });
  } catch (err) { next(err); }
};

// S-18: HQ cross-store labor rollup. Per-store hours, labor cost and
// labor % of sales for every accessible store, plus cross-store totals.
// Gated on settings.manage (HQ hierarchy) and payroll.view (pay data).
exports.laborRollup = async (req, res, next) => {
  try {
    const anchorId = v.integer(req.params.restaurantId, 'restaurantId');
    if (!Number.isSafeInteger(anchorId) || anchorId <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const anchor = await resolveRestaurantAccess(req.user.id, anchorId);
    if (!(await permissions.hasRestaurantPermission(anchor, req.user.id, ['settings.manage','reports.view']))) {
      throw new AppError('You do not have permission to view the HQ rollup', 403, 'forbidden');
    }
    if (!(await permissions.hasRestaurantPermission(anchor, req.user.id, ['payroll.view']))) {
      throw new AppError('Viewing payroll requires the payroll.view permission', 403, 'payroll_permission_required');
    }
    const locationScope = await getLocationScope(anchor, req.user.id);
    const locationParams = [anchor.id];
    const locationFilter = locationScope.mode === 'assigned' ? ' AND l.id = ANY($2::bigint[])' : '';
    if (locationScope.mode === 'assigned') locationParams.push(locationScope.location_ids);
    const { rows: accessible } = await pool.query(
      `SELECT l.id, l.name AS display_name
         FROM restaurant_locations l
        WHERE l.restaurant_id = $1${locationFilter}
        ORDER BY l.is_primary DESC, l.id`,
      locationParams
    );
    const ids = accessible.map((row) => Number(row.id));
    if (!ids.length) throw new AppError('No accessible stores found', 403, 'hq_scope_empty');
    const range = dateRange(req, anchor);
    const stores = [];
    let totalHours = 0;
    let totalLaborCostCents = 0;
    let totalRevenueCents = 0;
    let totalOvertimeHours = 0;
    const currencies = new Set();
    for (const store of accessible) {
      const labor = await payroll.computeLabor({
        restaurant: anchor,
        fromDate: range.from,
        toDate: range.to,
        locationIds: [Number(store.id)],
      });
      totalHours += labor.total_hours || 0;
      totalLaborCostCents += labor.labor_cost_cents || 0;
      totalRevenueCents += labor.revenue_cents || 0;
      // S-18: overtime is computed on each person's hours across every store
      // of the business, then attributed to the store where it was worked.
      totalOvertimeHours += labor.overtime_hours || 0;
      if (labor.currency) currencies.add(labor.currency);
      stores.push({
        location_id: Number(store.id),
        display_name: store.display_name,
        total_hours: labor.total_hours,
        scheduled_hours: labor.scheduled_hours,
        overtime_hours: labor.overtime_hours,
        labor_cost_cents: labor.labor_cost_cents,
        labor_percent: labor.labor_percent,
        sales_per_labor_hour_cents: labor.sales_per_labor_hour_cents,
        revenue_cents: labor.revenue_cents,
        currency: labor.currency,
        employee_count: (labor.employees || []).length,
        missing_wage_count: (labor.missing_wage_user_ids || []).length,
      });
    }
    res.json({
      scope: { businessId: Number(anchor.business_id), restaurantId: Number(anchor.id), storeCount: stores.length, from: range.from, to: range.to, timezone: range.timezone },
      totals: {
        total_hours: Math.round(totalHours * 100) / 100,
        overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
        // Money totals only make sense in one currency.
        currency: currencies.size <= 1 ? [...currencies][0] || null : null,
        labor_cost_cents: currencies.size <= 1 ? totalLaborCostCents : null,
        revenue_cents: currencies.size <= 1 ? totalRevenueCents : null,
        labor_percent: currencies.size <= 1 && totalRevenueCents > 0 ? Math.round((totalLaborCostCents / totalRevenueCents) * 1000) / 10 : null,
      },
      stores,
    });
  } catch (err) { next(err); }
};

exports.publishMenuOverrides = async (req, res, next) => {  try {
    const restaurantId = v.integer(req.params.restaurantId, 'restaurantId');
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
      if(req.hqPreview)return hq.previewMenuOverrides(client,{restaurantId,...request});
      const published = await hq.publishMenuOverrides(client, { restaurantId, ...request, actorUserId: req.user.id,expectedRevision:req.body?.expectedRevision });
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
    res.status(200).json(req.hqPreview?result:{ ...result, published: true });
  } catch (error) { next(error); }
};

exports._dateRange = dateRange;

exports.previewMenuOverrides=(req,res,next)=>{req.hqPreview=true;return exports.publishMenuOverrides(req,res,next);};
