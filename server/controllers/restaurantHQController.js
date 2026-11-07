'use strict';

const pool = require('../db');
const v = require('../utils/restaurantReviewValidation');
const { attachScope, requireBrand } = require('../services/restaurantReviewScope');
const payroll = require('../services/restaurantPayrollService');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const hq = require('../services/restaurantHQService');
const fx = require('../services/restaurantFxService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
// Phase 7 (gap 20): brand-wide labor rollups are cached with a
// documented staleness; the CSV export shares the same computation.
const rollupCache = require('../services/restaurantRollupCache');
const { csvCell } = require('../utils/csv');

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
    // Phase 8 Track A: converted totals sit ALONGSIDE the native
    // per-store sales above, never replacing them. Every converted
    // figure carries its source currency, rate, and rate date; a
    // missing rate leaves the converted total null and names the
    // currencies with no stored rate. Conversion is enrichment on a
    // read: when the FX lookup itself fails, the native rollup is
    // still returned with converted null, never a failed read.
    let converted = null;
    try {
      const policy = await fx.getFxPolicy(pool, { restaurantId: anchor.id });
      const rateDate = fx.resolveRateDate(policy, payroll.shiftDateString(range.to, -1));
      const breakdown = await fx.convertBreakdown(pool, {
        entries: salesRows.map((entry) => ({
          currencyCode: entry.currency_code,
          amountCents: Number(entry.net_collected_cents || 0),
        })),
        reportingCurrency: policy.reportingCurrency,
        rateDate,
        rateSource: policy.rateSource,
      });
      converted = { ...breakdown, isDefaultPolicy: policy.isDefault };
    } catch {
      converted = null;
    }
    res.json({
      scope: { businessId: Number(anchor.business_id), restaurantId: Number(anchor.id), storeCount: stores.length, from: range.from, to: range.to, timezone: range.timezone },
      stores,
      converted,
    });
  } catch (err) { next(err); }
};

// S-18: HQ cross-store labor rollup. Per-store hours, labor cost and
// labor % of sales for every accessible store, plus cross-store totals.
// Gated on settings.manage (HQ hierarchy) and payroll.view (pay data).
//
// Phase 7 (gap 20): the per-store loop runs one full labor computation
// per store in sequence, so brand-wide reads are cached for 15 minutes
// (restaurantRollupCache) and every response states its staleness
// (is_cached / computed_at / stale_after_seconds). Assigned-scope
// reads are NOT cached: the cache key cannot tell two different
// assigned store lists apart, so a scoped read always computes live.
async function buildLaborRollup(db, anchor, accessible, range) {
  const stores = [];
  let totalHours = 0;
  let totalLaborCostCents = 0;
  let totalRevenueCents = 0;
  let totalOvertimeHours = 0;
  const currencies = new Set();
  // Phase 8 Track A: converted totals alongside the native ones.
  // The native totals below still null on multi-currency; the
  // converted totals are the comparable number, with the rate and
  // rate date on every converted line. Conversion is enrichment on
  // a read: when the FX lookup itself fails, the native rollup is
  // still returned with converted null, never a failed read.
  let policy = null;
  let rateDate = null;
  try {
    policy = await fx.getFxPolicy(db, { restaurantId: anchor.id });
    rateDate = fx.resolveRateDate(policy, payroll.shiftDateString(range.to, -1));
  } catch {
    policy = null;
    rateDate = null;
  }
  const missingCurrencies = new Set();
  let convertedLaborCostCents = 0;
  let convertedRevenueCents = 0;
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
    let laborCostConvertedCents = null;
    let revenueConvertedCents = null;
    if (labor.currency && policy) {
      const cost = await fx.convertAmount(db, {
        amountCents: labor.labor_cost_cents || 0,
        fromCurrency: labor.currency,
        toCurrency: policy.reportingCurrency,
        rateDate,
        rateSource: policy.rateSource,
      });
      const revenue = await fx.convertAmount(db, {
        amountCents: labor.revenue_cents || 0,
        fromCurrency: labor.currency,
        toCurrency: policy.reportingCurrency,
        rateDate,
        rateSource: policy.rateSource,
      });
      if (cost.missingRate || revenue.missingRate) {
        missingCurrencies.add(labor.currency);
      } else {
        laborCostConvertedCents = cost.convertedCents;
        revenueConvertedCents = revenue.convertedCents;
        convertedLaborCostCents += cost.convertedCents;
        convertedRevenueCents += revenue.convertedCents;
      }
    }
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
      labor_cost_converted_cents: laborCostConvertedCents,
      revenue_converted_cents: revenueConvertedCents,
      employee_count: (labor.employees || []).length,
      missing_wage_count: (labor.missing_wage_user_ids || []).length,
    });
  }
  const missing = [...missingCurrencies];
  return {
    scope: { businessId: Number(anchor.business_id), restaurantId: Number(anchor.id), storeCount: stores.length, from: range.from, to: range.to, timezone: range.timezone },
    totals: {
      total_hours: Math.round(totalHours * 100) / 100,
      overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
      // Money totals only make sense in one currency.
      currency: currencies.size <= 1 ? [...currencies][0] || null : null,
      labor_cost_cents: currencies.size <= 1 ? totalLaborCostCents : null,
      revenue_cents: currencies.size <= 1 ? totalRevenueCents : null,
      labor_percent: currencies.size <= 1 && totalRevenueCents > 0 ? Math.round((totalLaborCostCents / totalRevenueCents) * 1000) / 10 : null,
      converted: policy ? {
        reportingCurrency: policy.reportingCurrency,
        rateDate,
        rateSource: policy.rateSource,
        isDefaultPolicy: policy.isDefault,
        laborCostCents: missing.length ? null : convertedLaborCostCents,
        revenueCents: missing.length ? null : convertedRevenueCents,
        laborPercent: missing.length || convertedRevenueCents <= 0
          ? null
          : Math.round((convertedLaborCostCents / convertedRevenueCents) * 1000) / 10,
        missingCurrencies: missing,
      } : null,
    },
    stores,
  };
}

async function loadLaborRollupScope(req) {
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
  return { anchor, accessible, range, locationScope };
}

exports.laborRollup = async (req, res, next) => {
  try {
    const { anchor, accessible, range, locationScope } = await loadLaborRollupScope(req);
    if (locationScope.mode === 'assigned') {
      const rollup = await buildLaborRollup(pool, anchor, accessible, range);
      return res.json({ ...rollup, is_cached: false, computed_at: new Date().toISOString(), stale_after_seconds: null });
    }
    const cached = await rollupCache.getCachedRollup(pool, {
      restaurantId: anchor.id,
      locationId: null,
      fromDate: range.from,
      toDate: range.to,
      kind: 'hq_labor',
      compute: () => buildLaborRollup(pool, anchor, accessible, range),
    });
    res.json({ ...cached.payload, is_cached: cached.is_cached, computed_at: cached.computed_at, stale_after_seconds: cached.stale_after_seconds });
  } catch (err) { next(err); }
};

// Phase 7 (gap 20): the labor rollup finally exports. Same rows as the
// JSON rollup, same computation (cached for brand-wide reads), one row
// per store plus a totals row. Multi-currency totals stay blank rather
// than adding dollars to gourdes.
exports.laborRollupCsv = async (req, res, next) => {
  try {
    const { anchor, accessible, range, locationScope } = await loadLaborRollupScope(req);
    let rollup;
    if (locationScope.mode === 'assigned') {
      rollup = await buildLaborRollup(pool, anchor, accessible, range);
    } else {
      const cached = await rollupCache.getCachedRollup(pool, {
        restaurantId: anchor.id,
        locationId: null,
        fromDate: range.from,
        toDate: range.to,
        kind: 'hq_labor',
        compute: () => buildLaborRollup(pool, anchor, accessible, range),
      });
      rollup = cached.payload;
    }
    const lines = [[
      'from_date', 'to_date', 'location_id', 'location_name', 'currency',
      'total_hours', 'scheduled_hours', 'overtime_hours', 'labor_cost_cents',
      'revenue_cents', 'labor_percent', 'sales_per_labor_hour_cents',
      'employee_count', 'missing_wage_count',
      // Phase 8 Track A: converted money alongside native money, with
      // the reporting currency and rate date on every row. Blank when
      // no stored rate covers the store currency as of the rate date.
      'converted_currency', 'converted_rate_date',
      'labor_cost_converted_cents', 'revenue_converted_cents',
    ].join(',')];
    for (const store of rollup.stores) {
      lines.push([
        rollup.scope.from, rollup.scope.to, store.location_id,
        csvCell(store.display_name), store.currency ?? '',
        store.total_hours ?? '', store.scheduled_hours ?? '', store.overtime_hours ?? '',
        store.labor_cost_cents ?? '', store.revenue_cents ?? '',
        store.labor_percent ?? '', store.sales_per_labor_hour_cents ?? '',
        store.employee_count ?? '', store.missing_wage_count ?? '',
        rollup.totals.converted?.reportingCurrency ?? '',
        rollup.totals.converted?.rateDate ?? '',
        store.labor_cost_converted_cents ?? '', store.revenue_converted_cents ?? '',
      ].join(','));
    }
    lines.push([
      rollup.scope.from, rollup.scope.to, '', csvCell('TOTAL'),
      rollup.totals.currency ?? '',
      rollup.totals.total_hours ?? '', '', rollup.totals.overtime_hours ?? '',
      rollup.totals.labor_cost_cents ?? '', rollup.totals.revenue_cents ?? '',
      rollup.totals.labor_percent ?? '', '', '', '',
      rollup.totals.converted?.reportingCurrency ?? '',
      rollup.totals.converted?.rateDate ?? '',
      rollup.totals.converted?.laborCostCents ?? '',
      rollup.totals.converted?.revenueCents ?? '',
    ].join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="labor-rollup-${rollup.scope.from}-to-${rollup.scope.to}.csv"`
    );
    res.send(`${lines.join('\n')}\n`);
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

// ── Phase 8 Track A: FX policy + stored rates ─────────────────────
// Rates are stored data entered by an admin (or imported); there is
// no live rate feed anywhere in this path. A stored policy row wins
// over the documented default (primary location currency, period
// end, any stored rate).
exports.getFxPolicy = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.view');
    const policy = await fx.getFxPolicy(pool, { restaurantId: restaurant.id });
    res.json({ policy });
  } catch (err) { next(err); }
};

exports.updateFxPolicy = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    const body = req.body || {};
    const policy = await withTransaction(pool, async (client) => {
      const saved = await fx.setFxPolicy(client, {
        restaurantId: restaurant.id,
        reportingCurrency: body.reportingCurrency ?? body.reporting_currency,
        rateSource: body.rateSource ?? body.rate_source,
        rateDateMode: body.rateDateMode ?? body.rate_date_mode,
        rateDate: body.rateDate ?? body.rate_date,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.hq_fx_policy.updated',
        target_type: 'restaurant',
        target_id: restaurant.id,
        after_state: saved,
        client,
        throwOnError: true,
      });
      return saved;
    }, 'restaurant_hq_fx_policy_update');
    res.json({ policy });
  } catch (err) { next(err); }
};

exports.listFxRates = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.view');
    void restaurant;
    const rates = await fx.listRates(pool, {
      baseCurrency: req.query?.base ?? req.query?.baseCurrency ?? null,
      quoteCurrency: req.query?.quote ?? req.query?.quoteCurrency ?? null,
      limit: req.query?.limit,
    });
    res.json({ rates });
  } catch (err) { next(err); }
};

exports.createFxRate = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    const body = req.body || {};
    const rate = await withTransaction(pool, async (client) => {
      const saved = await fx.createRate(client, {
        baseCurrency: body.baseCurrency ?? body.base_currency,
        quoteCurrency: body.quoteCurrency ?? body.quote_currency,
        rate: body.rate,
        rateDate: body.rateDate ?? body.rate_date,
        source: body.source,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.hq_fx_rate.created',
        target_type: 'restaurant',
        target_id: restaurant.id,
        after_state: saved,
        client,
        throwOnError: true,
      });
      return saved;
    }, 'restaurant_hq_fx_rate_create');
    res.status(201).json({ rate });
  } catch (err) { next(err); }
};

// ── Phase 8 Track D: HQ-level pay-run approval ─────────────────────
// An HQ approver (settings.manage on the hierarchy plus
// payroll.manage) approves a finalized run of any store under this
// restaurant. The checks are the same maker-checker core as the
// per-restaurant approve — the finalizer can never approve — with
// its own audit action so HQ approvals are distinguishable.
exports.approvePayRun = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['payroll.manage']))) {
      throw new AppError('Approving pay runs requires the payroll.manage permission', 403, 'payroll_permission_required');
    }
    const payRunId = v.integer(req.params.payRunId, 'payRunId');
    if (!Number.isSafeInteger(payRunId) || payRunId <= 0) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const payRuns = require('./restaurantPayrollController');
    const run = await withTransaction(pool, async (client) =>
      payRuns._approvePayRunTx(client, { restaurantId: restaurant.id, payRunId, approverUserId: req.user.id }),
    'restaurant_hq_approve_pay_run');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.hq_pay_run.approved',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { status: 'finalized', approved_by: req.user.id, finalized_by: run.finalized_by, hq: true },
    });
    res.json({ payRun: payRuns._payRunShape(await payRuns._getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

// ── Phase 8 Track D: per-location labor-policy administration ──────
// HQ lists the effective policy of every accessible store (the
// store's own row, or the restaurant fallback, named as such) and
// sets one store's policy. A store manager still sets their own
// store through the payroll endpoint; HQ administration needs
// all-store access.
exports.listLaborPolicies = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['payroll.view']))) {
      throw new AppError('Viewing labor policies requires the payroll.view permission', 403, 'payroll_permission_required');
    }
    const locationScope = await getLocationScope(restaurant, req.user.id);
    const locationParams = [restaurant.id];
    const locationFilter = locationScope.mode === 'assigned' ? ' AND l.id = ANY($2::bigint[])' : '';
    if (locationScope.mode === 'assigned') locationParams.push(locationScope.location_ids);
    const { rows: locations } = await pool.query(
      `SELECT l.id, l.name AS display_name, l.currency_code, l.address_country, l.address_state, l.timezone
         FROM restaurant_locations l
        WHERE l.restaurant_id = $1${locationFilter}
        ORDER BY l.is_primary DESC, l.id`,
      locationParams
    );
    const { rows: overrides } = await pool.query(
      `SELECT location_id FROM restaurant_location_labor_policies WHERE restaurant_id = $1`,
      [restaurant.id]
    );
    const overridden = new Set(overrides.map((row) => Number(row.location_id)));
    const policies = [];
    for (const location of locations) {
      const policy = await payroll.getLaborPolicy(restaurant.id, Number(location.id));
      policies.push({
        locationId: Number(location.id),
        displayName: location.display_name,
        currencyCode: location.currency_code || null,
        countryCode: location.address_country || null,
        regionCode: location.address_state || null,
        timezone: location.timezone || null,
        source: overridden.has(Number(location.id)) ? 'location' : 'restaurant_fallback',
        policy,
      });
    }
    res.json({ policies });
  } catch (err) { next(err); }
};

exports.updateStoreLaborPolicy = async (req, res, next) => {
  try {
    const restaurant = await loadHQRestaurant(req, 'settings.manage');
    if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, ['payroll.manage']))) {
      throw new AppError('Managing labor policies requires the payroll.manage permission', 403, 'payroll_permission_required');
    }
    const locationId = v.integer(req.params.locationId, 'locationId');
    if (!Number.isSafeInteger(locationId) || locationId <= 0) throw new AppError('Invalid store', 400, 'invalid_location_id');
    const scope = await getLocationScope(restaurant, req.user.id);
    if (scope.mode === 'assigned' && !scope.location_ids.includes(locationId)) {
      throw new AppError('You do not have access to this store', 403, 'location_scope_forbidden');
    }
    const body = req.body || {};
    const current = await payroll.getLaborPolicy(restaurant.id, locationId);
    let policy;
    try {
      policy = await payroll.saveLaborPolicy(restaurant.id, {
        overtime_threshold_hours: body.overtime_threshold_hours ?? body.overtimeThresholdHours ?? current.overtime_threshold_hours,
        overtime_multiplier_bps: body.overtime_multiplier_bps ?? body.overtimeMultiplierBps ?? current.overtime_multiplier_bps,
        doubletime_multiplier_bps: body.doubletime_multiplier_bps ?? body.doubletimeMultiplierBps ?? current.doubletime_multiplier_bps,
        break_after_minutes: body.break_after_minutes ?? body.breakAfterMinutes ?? current.break_after_minutes,
        break_duration_minutes: body.break_duration_minutes ?? body.breakDurationMinutes ?? current.break_duration_minutes,
        country_code: body.country_code ?? body.countryCode ?? current.country_code,
        region_code: body.region_code ?? body.regionCode ?? current.region_code,
      }, req.user.id, locationId);
    } catch (error) {
      if (error && error.code === 'validation_failed') throw new AppError(error.message, 400, 'validation_failed');
      throw error;
    }
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role,
      action: 'restaurant.hq_labor_policy.updated',
      target_type: 'restaurant_location',
      target_id: locationId,
      after_state: policy,
    });
    res.json({ policy });
  } catch (err) { next(err); }
};

exports._dateRange = dateRange;

exports.previewMenuOverrides=(req,res,next)=>{req.hqPreview=true;return exports.publishMenuOverrides(req,res,next);};
