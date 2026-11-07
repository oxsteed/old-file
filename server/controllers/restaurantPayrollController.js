'use strict';

// OxSteed Restaurants — payroll, tips, labor and team-activity surface
// (staff review S-04 / S-15 / S-16). Read-mostly and fail closed:
// anything that reveals wages or exports payroll requires the
// catalog `payroll.view` permission (owners hold every permission;
// managers do NOT get payroll.view by default — see migration 245 —
// so a manager needs an explicit grant). The team activity view
// requires `audit.view`. Mutations require the explicit `payroll.manage`
// grant. Brand policy changes also require all-store access.

const { AppError } = require('../middleware/errorHandler');
const pool = require('../db');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getEffectivePermissions } = require('../services/permissionsService');
const { logBusinessAction, listBusinessAudit, listBusinessAuditActors } = require('../services/businessAuditLog');
const payroll = require('../services/restaurantPayrollService');
const { getLocationScope, assertLocationAccess } = require('../services/restaurantLocationAccessService');
const { strictInteger } = require('../utils/strictInteger');
const { withTransaction } = require('../utils/transaction');
const { formatMinorUnits } = require('../utils/currencyPrecision');


function parsePositiveInt(value) {
  return strictInteger(value);
}

// Background-jobs audit (finding P1): client-generated idempotency keys
// for cash-tip declarations. Optional for backward compatibility; when
// present the key must look like an opaque token (same character class as
// the payment-refund request ids).
function normalizeCashTipIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') return null;
  const key = String(value).trim();
  if (!/^[A-Za-z0-9:._-]{8,128}$/.test(key)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { idempotencyKey: 'Idempotency key must be 8-128 characters (letters, digits, : . _ -)' });
  }
  return key;
}

async function restaurantAccess(req, { report = false } = {}) {
  const restaurantId = parsePositiveInt(req.params.restaurantId);
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);

  if(report && req.query?.locationId!==undefined){
    const locationId=strictInteger(req.query.locationId);if(!locationId)throw new AppError('Invalid store',400,'invalid_location_id');
    await assertLocationAccess(restaurant,req.user.id,locationId);
    const {rows:[store]}=await pool.query(`SELECT timezone FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2 AND status <> 'archived'`,[restaurant.id,locationId]);
    if(!store)throw new AppError('Store not found',404,'location_not_found');
    restaurant.timezone=store.timezone||restaurant.timezone;
  }
  return restaurant;
}
async function reportScope(req,restaurant){
  const scope=await getLocationScope(restaurant,req.user.id);
  return req.query?.locationId===undefined?scope:{mode:'assigned',location_ids:[strictInteger(req.query.locationId)]};
}

// Fail closed: any resolver error or a missing permission denies.
async function requireCatalogPermission(restaurant, userId, code, errorCode, message) {
  let allowed = false;
  try {
    const { permissions } = await getEffectivePermissions({
      businessId: restaurant.business_id,
      userId,
      role: restaurant.effective_role,
      membershipId: restaurant.effective_membership_id || null,
    });
    allowed = permissions.has('*') || permissions.has(code);
  } catch {
    allowed = false;
  }
  if (!allowed) throw new AppError(message, 403, errorCode);
}

function requirePayrollView(restaurant, userId) {
  return requireCatalogPermission(
    restaurant, userId, 'payroll.view',
    'payroll_permission_required',
    'Viewing payroll requires the payroll.view permission'
  );
}

function requireAuditView(restaurant, userId) {
  return requireCatalogPermission(
    restaurant, userId, 'audit.view',
    'audit_permission_required',
    'Viewing the team activity log requires the audit.view permission'
  );
}

function parseRangeOr400(query, restaurant) {
  const timezone = payroll.resolveReportTimezone(restaurant);
  try {
    return payroll.parseLocalRange(query, timezone);
  } catch (err) {
    throw new AppError(err.message, 400, err.code || 'invalid_range');
  }
}

// ── Labor + payroll ──────────────────────────────────────────────────

exports.laborSummary = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req,{report:true});
    await requirePayrollView(restaurant, req.user.id);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const scope = await reportScope(req,restaurant);
    const labor = await payroll.computeLabor({ restaurant, fromDate, toDate, locationIds: scope.location_ids });
    res.json(labor);
  } catch (err) { next(err); }
};

exports.getLaborPolicy = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const locationId = req.query?.locationId === undefined ? null : strictInteger(req.query.locationId);
    if (req.query?.locationId !== undefined && !locationId) throw new AppError('Invalid store', 400, 'invalid_location_id');
    if (locationId) await assertLocationAccess(restaurant, req.user.id, locationId);
    const policy = await payroll.getLaborPolicy(restaurant.id, locationId);
    res.json({ policy });
  } catch (err) { next(err); }
};

exports.updateLaborPolicy = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requireCatalogPermission(restaurant, req.user.id, 'payroll.manage', 'payroll_permission_required', 'Required permission: payroll.manage');
    const body = req.body || {};
    const locationId = body.locationId ?? body.location_id ?? req.query?.locationId;
    const parsedLocationId = locationId === undefined || locationId === null ? null : strictInteger(locationId);
    if (locationId !== undefined && locationId !== null && !parsedLocationId) throw new AppError('Invalid store', 400, 'invalid_location_id');
    if (parsedLocationId) {
      // A per-location policy needs access to that store, not
      // all-store access: a store manager sets their own store's policy.
      await assertLocationAccess(restaurant, req.user.id, parsedLocationId);
    } else {
      const scope = await getLocationScope(restaurant, req.user.id);
      if (scope.mode === 'assigned') throw new AppError('Brand settings require all-store access', 403, 'location_scope_forbidden');
    }
    const current = await payroll.getLaborPolicy(restaurant.id, parsedLocationId);
    const policy = await payroll.saveLaborPolicy(restaurant.id, {
      overtime_threshold_hours: body.overtime_threshold_hours ?? body.overtimeThresholdHours ?? current.overtime_threshold_hours,
      overtime_multiplier_bps: body.overtime_multiplier_bps ?? body.overtimeMultiplierBps ?? current.overtime_multiplier_bps,
      break_after_minutes: body.break_after_minutes ?? body.breakAfterMinutes ?? current.break_after_minutes,
      break_duration_minutes: body.break_duration_minutes ?? body.breakDurationMinutes ?? current.break_duration_minutes,
      country_code: body.country_code ?? body.countryCode ?? current.country_code,
      region_code: body.region_code ?? body.regionCode ?? current.region_code,
    }, req.user.id, parsedLocationId);
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.labor_policy.updated',
      target_type: 'restaurant',
      target_id: restaurant.id,
      after_state: policy,
    });
    res.json({ policy });
  } catch (err) {
    if (err && err.code === 'validation_failed') {
      return next(new AppError(err.message, 400, 'validation_failed'));
    }
    next(err);
  }
};

exports.payrollExportCsv = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req,{report:true});
    await requirePayrollView(restaurant, req.user.id);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const scope = await reportScope(req,restaurant);
    const labor = await payroll.computeLabor({ restaurant, fromDate, toDate, locationIds: scope.location_ids });
    const csv = payroll.buildPayrollCsv(labor);
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.payroll.exported',
      target_type: 'restaurant',
      target_id: restaurant.id,
      metadata: { from: fromDate, to: toDate, employees: labor.employees.length },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="payroll-${restaurant.id}-${fromDate}-to-${toDate}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
};

// ── Exceptions (S-16) ────────────────────────────────────────────────

exports.exceptionsReport = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req,{report:true});
    await requireCatalogPermission(restaurant, req.user.id, 'audit.view', 'payroll_permission_required', 'Required permission: audit.view');
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const scope = await reportScope(req,restaurant);
    const report = await payroll.computeExceptions({ restaurant, fromDate, toDate, locationIds: scope.location_ids });
    res.json(report);
  } catch (err) { next(err); }
};

// ── Team activity (S-16) ─────────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

exports.teamActivity = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req,{report:true});
    await requireAuditView(restaurant, req.user.id);
    const fromRaw = req.query.from ? String(req.query.from) : null;
    const toRaw = req.query.to ? String(req.query.to) : null;
    for (const value of [fromRaw, toRaw]) {
      if (value && (DATE_ONLY_RE.test(value) ? !payroll.isRealDateString(value) : !Number.isFinite(Date.parse(value)))) throw new AppError('Invalid activity date', 400, 'invalid_range');
    }
    const scope = await reportScope(req,restaurant);
    const auditScope = { restaurantId: restaurant.id, locationIds: scope.location_ids, timezone: payroll.resolveReportTimezone(restaurant) };
    const from = fromRaw;
    const to = toRaw;
    const [result, actors] = await Promise.all([
      listBusinessAudit(restaurant.business_id, {
        ...auditScope,
        limit: req.query.limit,
        offset: req.query.offset,
        action: req.query.action ? String(req.query.action) : undefined,
        actionPrefix: req.query.action_prefix ? String(req.query.action_prefix) : undefined,
        actorUserId: req.query.actor_user_id ? String(req.query.actor_user_id) : undefined,
        from: from || undefined,
        to: to || undefined,
      }),
      listBusinessAuditActors(restaurant.business_id, auditScope),
    ]);
    res.json({ entries: result.rows, total: result.total, actors });
  } catch (err) { next(err); }
};

// ── Tip pool settings + declared cash tips (S-15) ────────────────────

exports.getTipPoolSettings = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requireCatalogPermission(restaurant, req.user.id, 'payroll.view', 'payroll_permission_required', 'Required permission: payroll.view');
    const locationId = req.query?.locationId === undefined ? null : strictInteger(req.query.locationId);
    if (req.query?.locationId !== undefined && !locationId) throw new AppError('Invalid store', 400, 'invalid_location_id');
    if (locationId) await assertLocationAccess(restaurant, req.user.id, locationId);
    const settings = await payroll.getTipPoolSettings(restaurant.id, locationId);
    res.json({ settings });
  } catch (err) { next(err); }
};

exports.updateTipPoolSettings = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requireCatalogPermission(restaurant, req.user.id, 'payroll.manage', 'payroll_permission_required', 'Required permission: payroll.manage');
    const body = req.body || {};
    // Phase 8 Track B: a store manager sets their own store's pool;
    // the restaurant-level pool still needs all-store access, same
    // as the per-location labor policy.
    const locationId = body.locationId ?? body.location_id ?? req.query?.locationId;
    const parsedLocationId = locationId === undefined || locationId === null ? null : strictInteger(locationId);
    if (locationId !== undefined && locationId !== null && !parsedLocationId) throw new AppError('Invalid store', 400, 'invalid_location_id');
    if (parsedLocationId) {
      await assertLocationAccess(restaurant, req.user.id, parsedLocationId);
    } else {
      const scope = await getLocationScope(restaurant, req.user.id);
      if (scope.mode === 'assigned') throw new AppError('Brand settings require all-store access', 403, 'location_scope_forbidden');
    }
    let settings;
    try {
      settings = await payroll.saveTipPoolSettings(restaurant.id, {
        poolingEnabled: body.pooling_enabled ?? body.poolingEnabled,
        tipOutRules: body.tip_out_rules ?? body.tipOutRules ?? [],
        updatedBy: req.user.id,
      }, parsedLocationId);
    } catch (err) {
      if (err && err.code === 'validation_failed') {
        throw new AppError(err.message, 400, 'validation_failed');
      }
      throw err;
    }
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.tip_pool.updated',
      target_type: 'restaurant',
      target_id: restaurant.id,
      after_state: {
        pooling_enabled: settings.pooling_enabled,
        tip_out_rules: settings.tip_out_rules,
        location_id: settings.location_id ?? null,
        source: settings.source,
      },
    });
    res.json({ settings });
  } catch (err) { next(err); }
};

exports.declareCashTip = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requireCatalogPermission(restaurant, req.user.id, 'payroll.manage', 'payroll_permission_required', 'Required permission: payroll.manage');
    const body = req.body || {};
    const staffUserId = body.staffUserId || body.staff_user_id;
    const businessDate = body.date || body.businessDate || body.business_date;
    const amountCents = strictInteger(body.amountCents ?? body.amount_cents, { max: 1000000 });
    if (!staffUserId || typeof staffUserId !== 'string') {
      throw new AppError('Validation failed', 400, 'validation_failed', { staffUserId: 'A staff member is required' });
    }
    if (!payroll.isRealDateString(businessDate)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { date: 'A valid date (YYYY-MM-DD) is required' });
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1000000) {
      throw new AppError('Validation failed', 400, 'validation_failed', { amountCents: 'Amount must be a positive number of cents up to 1000000' });
    }
    const scope = await getLocationScope(restaurant, req.user.id);
    const locationId = body.locationId == null ? null : strictInteger(body.locationId);
    if ((body.locationId != null && !locationId) || (scope.mode === 'assigned' && !locationId)) throw new AppError('A valid store is required', 400, 'invalid_location_id');
    if (locationId) {
      const { rows } = await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2 AND status <> \'archived\'', [restaurant.id, locationId]);
      if (!rows.length) throw new AppError('Location not found', 404, 'location_not_found');
      await assertLocationAccess(restaurant, req.user.id, locationId);
    }
    const roster = await payroll.getRoster(restaurant.business_id, scope.location_ids, restaurant.id);
    if (!roster.some((m) => m.user_id === staffUserId)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { staffUserId: 'Staff member is not on this restaurant team' });
    }
    const declaration = await payroll.declareCashTip(restaurant.id, {
      staffUserId,
      locationId,
      businessDate: String(businessDate),
      amountCents,
      declaredBy: req.user.id,
      note: body.note ? String(body.note).slice(0, 500) : null,
      // Background-jobs audit (finding P1): a client-generated idempotency
      // key lets POS retries deduplicate instead of double-declaring.
      // Optional for backward compatibility; validated when present.
      idempotencyKey: normalizeCashTipIdempotencyKey(req.get?.('Idempotency-Key') || body.idempotencyKey || body.idempotency_key),
    });
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.cash_tip.declared',
      target_type: 'user',
      target_id: staffUserId,
      after_state: { location_id: locationId, amount_cents: amountCents, business_date: String(businessDate), declaration_id: declaration.id },
    });
    res.status(declaration.replayed ? 200 : 201).json({ declaration, replayed: !!declaration.replayed });
  } catch (err) { next(err); }
};

// ── Employee self-service (Phase 3 Track B) ─────────────────────────
// Self-scoped reads: the caller sees ONLY their own tips/pay, scoped
// server-side by req.user.id. No payroll.view is required (employees
// do not hold it); membership is enforced by restaurantAccess, and no
// client-supplied user id is ever read — a query/body user id cannot
// widen the scope. Draft pay runs never produce a stub.

exports.getMyTips = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const scope = await getLocationScope(restaurant, req.user.id);
    const mine = await payroll.getMyTips({
      restaurant, fromDate, toDate, userId: req.user.id, locationIds: scope.location_ids,
    });
    res.json(mine);
  } catch (err) { next(err); }
};

exports.getMyPay = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const scope = await getLocationScope(restaurant, req.user.id);
    const mine = await payroll.getMyPay({
      restaurant, fromDate, toDate, userId: req.user.id, locationIds: scope.location_ids,
    });
    res.json(mine);
  } catch (err) { next(err); }
};

exports.listMyPayStubs = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    const stubs = await payroll.listMyPayStubs(restaurant.id, req.user.id);
    res.json({ stubs });
  } catch (err) { next(err); }
};

exports.getMyPayStub = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay stub not found', 404, 'pay_stub_not_found');
    const stub = await payroll.getMyPayStub(restaurant.id, payRunId, req.user.id);
    if (!stub) throw new AppError('Pay stub not found', 404, 'pay_stub_not_found');
    res.json({ stub });
  } catch (err) { next(err); }
};

exports.listMyCashTips = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const rows = await payroll.listDeclaredCashTipsForUser(restaurant.id, req.user.id, fromDate, toDate);
    res.json({ declarations: rows.map(payroll.declarationShape) });
  } catch (err) { next(err); }
};

// Self-declared cash tips: the declaration is the caller's own
// (staff_user_id and declared_by both come from req.user.id), enters
// the manager-review state as 'pending', and does NOT flow into pay
// until a manager confirms it. Same amount/date/note validation and
// idempotency-key dedupe as the manager path.
exports.declareMyCashTip = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    const body = req.body || {};
    const businessDate = body.date || body.businessDate || body.business_date;
    const amountCents = strictInteger(body.amountCents ?? body.amount_cents, { max: 1000000 });
    if (!payroll.isRealDateString(businessDate)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { date: 'A valid date (YYYY-MM-DD) is required' });
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1000000) {
      throw new AppError('Validation failed', 400, 'validation_failed', { amountCents: 'Amount must be a positive number of cents up to 1000000' });
    }
    const scope = await getLocationScope(restaurant, req.user.id);
    const locationId = body.locationId == null ? null : strictInteger(body.locationId);
    if ((body.locationId != null && !locationId) || (scope.mode === 'assigned' && !locationId)) throw new AppError('A valid store is required', 400, 'invalid_location_id');
    if (locationId) {
      const { rows } = await pool.query('SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2 AND status <> \'archived\'', [restaurant.id, locationId]);
      if (!rows.length) throw new AppError('Location not found', 404, 'location_not_found');
      await assertLocationAccess(restaurant, req.user.id, locationId);
    }
    const roster = await payroll.getRoster(restaurant.business_id, scope.location_ids, restaurant.id);
    if (!roster.some((m) => m.user_id === req.user.id)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { staffUserId: 'Staff member is not on this restaurant team' });
    }
    const declaration = await payroll.declareCashTip(restaurant.id, {
      staffUserId: req.user.id,
      locationId,
      businessDate: String(businessDate),
      amountCents,
      declaredBy: req.user.id,
      note: body.note ? String(body.note).slice(0, 500) : null,
      status: 'pending',
      idempotencyKey: normalizeCashTipIdempotencyKey(req.get?.('Idempotency-Key') || body.idempotencyKey || body.idempotency_key),
    });
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.cash_tip.self_declared',
      target_type: 'user',
      target_id: req.user.id,
      after_state: { location_id: locationId, amount_cents: amountCents, business_date: String(businessDate), declaration_id: declaration.id, status: 'pending' },
    });
    res.status(declaration.replayed ? 200 : 201).json({ declaration: payroll.declarationShape(declaration), replayed: !!declaration.replayed });
  } catch (err) { next(err); }
};

// Manager review of a self-declared cash tip. payroll.manage only;
// the employee cannot confirm their own declaration. Only a pending
// row can move, so a confirm/reject can never double-apply.
async function reviewMyCashTip(req, res, next, status, action) {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const declarationId = parsePositiveInt(req.params.declarationId);
    if (!declarationId) throw new AppError('Cash tip declaration not found', 404, 'cash_tip_not_found');
    const reviewed = await payroll.reviewCashTip(restaurant.id, declarationId, { status, reviewedBy: req.user.id });
    if (!reviewed) {
      const { rows } = await pool.query(
        'SELECT id FROM restaurant_declared_cash_tips WHERE id = $1 AND restaurant_id = $2',
        [declarationId, restaurant.id]
      );
      if (!rows.length) throw new AppError('Cash tip declaration not found', 404, 'cash_tip_not_found');
      throw new AppError('Only a pending cash tip declaration can be reviewed', 409, 'cash_tip_not_pending');
    }
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action,
      target_type: 'user',
      target_id: reviewed.staff_user_id,
      after_state: { declaration_id: reviewed.id, status: reviewed.status, amount_cents: reviewed.amount_cents, business_date: reviewed.business_date },
    });
    res.json({ declaration: payroll.declarationShape(reviewed) });
  } catch (err) { next(err); }
}

exports.confirmCashTip = (req, res, next) => reviewMyCashTip(req, res, next, 'confirmed', 'restaurant.cash_tip.confirmed');
exports.rejectCashTip = (req, res, next) => reviewMyCashTip(req, res, next, 'rejected', 'restaurant.cash_tip.rejected');

// ── Pay runs (F-22) ──────────────────────────────────────────────────
// A pay run is an immutable snapshot of one payroll period: wages and tips
// per employee as computed at finalization time, so the exported CSV
// always matches what was approved even if wages or time entries change
// afterwards. Drafts may be rebuilt; finalized runs are append-only
// (voiding moves to the voided state, never deletes).

function requirePayrollManage(restaurant, userId) {
  return requireCatalogPermission(
    restaurant, userId, 'payroll.manage',
    'payroll_permission_required',
    'Managing pay runs requires the payroll.manage permission'
  );
}

function parsePayRunPeriodOr400(body, restaurant) {
  const periodFrom = body.periodFrom ?? body.period_from;
  const periodTo = body.periodTo ?? body.period_to;
  if (!periodFrom || !periodTo) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      period: 'periodFrom and periodTo are required',
    });
  }
  const timezone = payroll.resolveReportTimezone(restaurant);
  try {
    return payroll.parseLocalRange({ from: periodFrom, to: periodTo }, timezone);
  } catch (err) {
    throw new AppError(err.message, 400, err.code || 'invalid_range');
  }
}

function payRunLinesFromLabor(labor) {
  return (labor.employees || []).map((e) => ({
    staff_user_id: e.user_id || null,
    staff_label: e.name || null,
    regular_hours: Number(e.regular_hours) || 0,
    overtime_hours: Number(e.overtime_hours) || 0,
    doubletime_hours: Number(e.doubletime_hours) || 0,
    hourly_wage_cents: e.hourly_wage_cents == null ? null : Math.round(Number(e.hourly_wage_cents)),
    regular_wages_cents: e.regular_wages_cents == null ? null : Math.round(Number(e.regular_wages_cents)),
    overtime_wages_cents: e.overtime_wages_cents == null ? null : Math.round(Number(e.overtime_wages_cents)),
    doubletime_wages_cents: e.doubletime_wages_cents == null ? null : Math.round(Number(e.doubletime_wages_cents)),
    wages_cents: e.wages_cents == null ? null : Math.round(Number(e.wages_cents)),
    meal_break_premium_cents: Math.round(Number(e.meal_break_premium_cents) || 0),
    predictability_premium_cents: Math.round(Number(e.predictability_premium_cents) || 0),
    unpriced_premium_hours: Math.round((Number(e.unpriced_premium_hours) || 0) * 100) / 100,
    gross_tips_cents: Math.round(Number(e.gross_tips_cents) || 0),
    tip_out_cents: Math.round(Number(e.tip_out_cents) || 0),
    tip_in_cents: Math.round(Number(e.tip_in_cents) || 0),
    net_tips_cents: Math.round(Number(e.net_tips_cents) || 0),
    total_pay_cents: Math.round(Number(e.total_pay_cents) || 0),
  }));
}

async function insertPayRunLines(client, payRunId, lines, lineLocationId = null) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_user_id, staff_label, regular_hours, overtime_hours,
          doubletime_hours, hourly_wage_cents, regular_wages_cents, overtime_wages_cents,
          doubletime_wages_cents, wages_cents, meal_break_premium_cents,
          predictability_premium_cents, unpriced_premium_hours,
          gross_tips_cents, tip_out_cents, tip_in_cents, net_tips_cents, total_pay_cents,
          location_id, carry_forward_source_run_id, carry_forward_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        payRunId,
        line.staff_user_id,
        line.staff_label,
        line.regular_hours,
        line.overtime_hours,
        line.doubletime_hours,
        line.hourly_wage_cents,
        line.regular_wages_cents,
        line.overtime_wages_cents,
        line.doubletime_wages_cents,
        line.wages_cents,
        line.meal_break_premium_cents,
        line.predictability_premium_cents,
        line.unpriced_premium_hours,
        line.gross_tips_cents,
        line.tip_out_cents,
        line.tip_in_cents,
        line.net_tips_cents,
        line.total_pay_cents,
        lineLocationId,
        line.carry_forward_source_run_id ?? null,
        line.carry_forward_kind ?? null,
      ]
    );
  }
}

// Phase 8 Track B: the explicit store list a run was computed from.
// An all-store caller has location_ids null, so the run records the
// restaurant's stores explicitly — a later store list change cannot
// rewrite what the run covered.
async function resolveRunLocationIds(clientOrPool, restaurantId, scope) {
  if (Array.isArray(scope.location_ids) && scope.location_ids.length) {
    return scope.location_ids.map((id) => Number(id));
  }
  const { rows } = await clientOrPool.query(
    `SELECT id FROM restaurant_locations
      WHERE restaurant_id = $1 AND status <> 'archived' ORDER BY id`,
    [restaurantId]
  );
  return rows.map((row) => Number(row.id));
}

// A run's scope label for per-store views. Legacy runs predate
// scoping (location_ids empty): they covered the whole restaurant
// and are never silently attributed to one store.
function payRunScopeLabel(run) {
  const ids = Array.isArray(run.location_ids) ? run.location_ids.map((id) => Number(id)) : [];
  if (!ids.length) return 'unscoped_legacy';
  return ids.length === 1 ? 'single_store' : 'multi_store';
}

async function getPayRunWithLines(clientOrPool, restaurantId, payRunId) {
  const { rows: [run] } = await clientOrPool.query(
    'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2',
    [payRunId, restaurantId]
  );
  if (!run) return null;
  const { rows: lines } = await clientOrPool.query(
    'SELECT * FROM restaurant_pay_run_lines WHERE pay_run_id = $1 ORDER BY id',
    [payRunId]
  );
  // Finding 25: payout linkage rides with the run everywhere it is read.
  const { rows: payoutLinks } = await clientOrPool.query(
    `SELECT l.*, p.status AS payout_status
       FROM restaurant_pay_run_payout_links l
       JOIN restaurant_payouts p ON p.id = l.restaurant_payout_id
      WHERE l.pay_run_id = $1 ORDER BY l.id`,
    [payRunId]
  ).catch(() => ({ rows: [] }));
  // Nov 3 audit items 1-2: the linked total counts only links in the
  // restaurant's currency. A legacy cross-currency link must never push
  // a run to paid on a mixed-currency sum.
  let runCurrency = null;
  try {
    const { rows: [restaurantRow] } = await clientOrPool.query(
      'SELECT currency_code FROM food_restaurants WHERE id = $1',
      [restaurantId]
    );
    if (restaurantRow?.currency_code) runCurrency = String(restaurantRow.currency_code).toUpperCase();
  } catch { /* unknown currency: fall back to the unfiltered sum below */ }
  const linkedPayoutCents = payoutLinks.reduce((sum, link) => {
    if (runCurrency && link.currency_code && String(link.currency_code).toUpperCase() !== runCurrency) return sum;
    return sum + Number(link.amount_cents || 0);
  }, 0);
  // Phase 5: the disbursement ledger rides with the run too, with the
  // coverage summary the merchant UI and the paid flip both read.
  const { rows: disbursements } = await clientOrPool.query(
    `SELECT * FROM restaurant_pay_run_disbursements
      WHERE pay_run_id = $1 ORDER BY id`,
    [payRunId]
  ).catch(() => ({ rows: [] }));
  const runTotalCents = (run.totals && typeof run.totals === 'object')
    ? Math.round(Number(run.totals.total_pay_cents || 0))
    : (lines || []).reduce((sum, line) => sum + (Number(line.total_pay_cents) || 0), 0);
  // Finding 9: a voided (reversed) disbursement stays visible in the
  // ledger but no longer counts toward coverage — its line is unpaid
  // again until a new disbursement is recorded for it.
  const recordedDisbursements = disbursements.filter((d) => d.status !== 'voided');
  const disbursedCents = recordedDisbursements.reduce((sum, d) => sum + (Number(d.amount_cents) || 0), 0);
  const coveredLineIds = new Set(recordedDisbursements.map((d) => Number(d.pay_run_line_id)));
  const disbursementCoverage = {
    run_total_cents: runTotalCents,
    disbursed_cents: disbursedCents,
    lines_total: (lines || []).length,
    lines_covered: (lines || []).filter((line) => coveredLineIds.has(Number(line.id))).length,
    fully_covered: (lines || []).length > 0
      && (lines || []).every((line) => coveredLineIds.has(Number(line.id)))
      && disbursedCents === runTotalCents,
  };
  // Finding 5 (half b): a finalized run reports inputs recorded after
  // its finalization that have not been carried forward yet, so the
  // money is flagged instead of silently vanishing. The indicator is
  // advisory: a failed lookup must never break the run read itself.
  let inputsChangedSinceFinalization = null;
  if (run.finalized_at) {
    try {
      const { rows: [bizRow] } = await clientOrPool.query(
        'SELECT business_id FROM food_restaurants WHERE id = $1',
        [restaurantId]
      );
      if (bizRow) {
        inputsChangedSinceFinalization = await payroll.getLateInputsSummary(clientOrPool, {
          businessId: bizRow.business_id,
          restaurantId,
          run,
          currency: run.currency_code,
        });
      }
    } catch { /* indicator unavailable; the run read still succeeds */ }
  }
  return { ...run, lines, payout_links: payoutLinks, linked_payout_cents: linkedPayoutCents, disbursements, disbursement_coverage: disbursementCoverage, inputs_changed_since_finalization: inputsChangedSinceFinalization };
}

function payRunShape(run) {
  if (!run) return null;
  return {
    id: Number(run.id),
    restaurant_id: Number(run.restaurant_id),
    period_from: run.period_from,
    period_to: run.period_to,
    status: run.status,
    totals: run.totals || {},
    // Phase 8 Track B: the store scope the run was built from and
    // the currency it was priced in (snapshotted at creation).
    location_ids: Array.isArray(run.location_ids) ? run.location_ids.map((id) => Number(id)) : [],
    locationIds: Array.isArray(run.location_ids) ? run.location_ids.map((id) => Number(id)) : [],
    scope: payRunScopeLabel(run),
    currency_code: run.currency_code || null,
    currencyCode: run.currency_code || null,
    created_by: run.created_by,
    finalized_by: run.finalized_by,
    finalized_at: run.finalized_at,
    approved_by: run.approved_by || null,
    approved_at: run.approved_at || null,
    // Finding 41: the two-step void. void_requested_by/at is the maker
    // (the manager who asked for the void); void_approved_by/at is the
    // checker who completed it. voidPending is true while a finalized
    // run waits for that second manager.
    void_requested_by: run.void_requested_by || null,
    void_requested_at: run.void_requested_at || null,
    void_approved_by: run.void_approved_by || null,
    void_approved_at: run.void_approved_at || null,
    voidPending: run.void_requested_by != null && run.void_approved_by == null && run.status !== 'voided',
    created_at: run.created_at,
    updated_at: run.updated_at,
    payoutLinks: (run.payout_links || run.payoutLinks || []).map((link) => ({
      id: Number(link.id),
      payRunId: Number(link.pay_run_id ?? link.payRunId),
      restaurantPayoutId: link.restaurant_payout_id ?? link.restaurantPayoutId,
      amountCents: Number(link.amount_cents ?? link.amountCents),
      currencyCode: link.currency_code || link.currencyCode || 'USD',
      linkedBy: link.linked_by || link.linkedBy || null,
      note: link.note || null,
      payoutStatus: link.payout_status || link.payoutStatus || null,
      createdAt: link.created_at || link.createdAt || null,
    })),
    linkedPayoutCents: Number(run.linked_payout_cents ?? run.linkedPayoutCents ?? 0),
    disbursements: (run.disbursements || []).map((d) => ({
      id: Number(d.id),
      payRunLineId: Number(d.pay_run_line_id ?? d.payRunLineId),
      staff_user_id: d.staff_user_id,
      staff_label: d.staff_label || null,
      amountCents: Number(d.amount_cents ?? d.amountCents),
      currencyCode: d.currency_code || d.currencyCode || 'USD',
      method: d.method,
      reference: d.reference || null,
      note: d.note || null,
      recordedBy: d.recorded_by || d.recordedBy || null,
      recordedAt: d.recorded_at || d.recordedAt || null,
      // Finding 9: a reversed disbursement stays in the ledger as
      // reversed, never deleted.
      status: d.status || 'recorded',
      voidedBy: d.voided_by || d.voidedBy || null,
      voidedAt: d.voided_at || d.voidedAt || null,
      voidReason: d.void_reason || d.voidReason || null,
    })),
    disbursementCoverage: run.disbursement_coverage || run.disbursementCoverage || null,
    // Finding 5 (half b): late inputs outstanding on this finalized run.
    inputsChangedSinceFinalization: run.inputs_changed_since_finalization || run.inputsChangedSinceFinalization || null,
    lines: (run.lines || []).map((line) => ({
      id: Number(line.id),
      staff_user_id: line.staff_user_id,
      staff_label: line.staff_label,
      location_id: line.location_id == null ? null : Number(line.location_id),
      regular_hours: Number(line.regular_hours),
      overtime_hours: Number(line.overtime_hours),
      doubletime_hours: Number(line.doubletime_hours || 0),
      hourly_wage_cents: line.hourly_wage_cents == null ? null : Number(line.hourly_wage_cents),
      regular_wages_cents: line.regular_wages_cents == null ? null : Number(line.regular_wages_cents),
      overtime_wages_cents: line.overtime_wages_cents == null ? null : Number(line.overtime_wages_cents),
      doubletime_wages_cents: line.doubletime_wages_cents == null ? null : Number(line.doubletime_wages_cents),
      wages_cents: line.wages_cents == null ? null : Number(line.wages_cents),
      meal_break_premium_cents: Number(line.meal_break_premium_cents || 0),
      predictability_premium_cents: Number(line.predictability_premium_cents || 0),
      unpriced_premium_hours: Number(line.unpriced_premium_hours || 0),
      gross_tips_cents: Number(line.gross_tips_cents),
      tip_out_cents: Number(line.tip_out_cents || 0),
      tip_in_cents: Number(line.tip_in_cents || 0),
      net_tips_cents: Number(line.net_tips_cents),
      total_pay_cents: Number(line.total_pay_cents),
      // Finding 5 (half a): a carried-forward line says so, with the
      // source run it was carried from. It is never silently merged
      // into the employee's regular line.
      is_carry_forward: line.carry_forward_source_run_id != null,
      carried_forward_from_run_id: line.carry_forward_source_run_id == null
        ? null : Number(line.carry_forward_source_run_id),
      carry_forward_kind: line.carry_forward_kind || null,
    })),
  };
}

exports.createPayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const { fromDate, toDate } = parsePayRunPeriodOr400(req.body || {}, restaurant);
    const scope = await getLocationScope(restaurant, req.user.id);
    const labor = await payroll.computeLabor({ restaurant, fromDate, toDate, locationIds: scope.location_ids });
    // Phase 8 Track B: the run records the stores it was computed
    // from and the currency it was priced in. Lines carry a store
    // only when the run covers exactly one store — computeLabor
    // attributes overtime across stores per employee, so a
    // multi-store line cannot be split by store after the fact.
    const locationIds = await resolveRunLocationIds(pool, restaurant.id, scope);
    const lineLocationId = locationIds.length === 1 ? locationIds[0] : null;
    // Finding 5 (half a): inputs recorded after an earlier run
    // finalized ride into this run as clearly-marked carry-forward
    // lines. Priced from the current wage of record.
    const wagesByUser = new Map(
      (labor.employees || [])
        .filter((e) => e.user_id != null && e.hourly_wage_cents != null)
        .map((e) => [String(e.user_id), Number(e.hourly_wage_cents)])
    );
    const carryItems = await payroll.buildCarryForwardItems(pool, {
      restaurant,
      targetPeriodFrom: fromDate,
      targetPeriodTo: toDate,
      locationIds,
      currency: restaurant.currency_code || 'USD',
      wagesByUser,
    });
    const run = await withTransaction(pool, async (client) => {
      const { rows: [created] } = await client.query(
        `INSERT INTO restaurant_pay_runs (restaurant_id, period_from, period_to, status, created_by, location_ids, currency_code)
         VALUES ($1, $2, $3, 'draft', $4, $5::bigint[], $6)
         RETURNING *`,
        [restaurant.id, fromDate, toDate, req.user.id, locationIds, restaurant.currency_code || 'USD']
      );
      await insertPayRunLines(client, created.id, payRunLinesFromLabor(labor), lineLocationId);
      if (carryItems.length) {
        const carryLines = await payroll.applyCarryForward(client, created.id, carryItems);
        if (carryLines.length) await insertPayRunLines(client, created.id, carryLines, lineLocationId);
      }
      return created;
    }, 'restaurant_create_pay_run');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.created',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { period_from: fromDate, period_to: toDate, status: 'draft', lines: labor.employees.length, location_ids: locationIds },
    });
    res.status(201).json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

exports.listPayRuns = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    // Phase 8 Track B: per-store views. ?locationId= lists runs that
    // cover that store. A store-scoped reader only ever sees runs
    // covering their stores — and never a legacy unscoped run, whose
    // lines span stores they cannot see. An all-store reader sees
    // every run, with unscoped legacy runs flagged on the shape.
    const scope = await getLocationScope(restaurant, req.user.id);
    const requestedLocationId = req.query?.locationId === undefined ? null : strictInteger(req.query.locationId);
    if (req.query?.locationId !== undefined && !requestedLocationId) throw new AppError('Invalid store', 400, 'invalid_location_id');
    if (requestedLocationId) await assertLocationAccess(restaurant, req.user.id, requestedLocationId);
    const params = [restaurant.id];
    let where = 'pr.restaurant_id = $1';
    if (scope.mode === 'assigned') {
      const visible = (Array.isArray(scope.location_ids) ? scope.location_ids.map((id) => Number(id)) : [])
        .filter((id) => !requestedLocationId || id === requestedLocationId);
      if (!visible.length) return res.json({ payRuns: [], total: 0, limit, offset });
      params.push(visible);
      where += ` AND pr.location_ids && $${params.length}::bigint[]`;
    } else if (requestedLocationId) {
      params.push([requestedLocationId]);
      where += ` AND pr.location_ids @> $${params.length}::bigint[]`;
    }
    const countParams = params.slice();
    const { rows } = await pool.query(
      `SELECT pr.*, (SELECT COUNT(*)::int FROM restaurant_pay_run_lines l WHERE l.pay_run_id = pr.id) AS line_count,
              (SELECT COALESCE(SUM(amount_cents), 0)::int FROM restaurant_pay_run_payout_links l WHERE l.pay_run_id = pr.id) AS linked_payout_cents
         FROM restaurant_pay_runs pr
        WHERE ${where}
        ORDER BY pr.period_from DESC, pr.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM restaurant_pay_runs pr WHERE ${where}`,
      countParams
    );
    res.json({
      payRuns: rows.map((row) => ({ ...payRunShape({ ...row, lines: [] }), line_count: row.line_count })),
      total: Number(countRow?.total || 0), limit, offset,
    });
  } catch (err) { next(err); }
};

// Phase 8 Track B: a store-scoped reader only sees runs covering
// their stores. A legacy unscoped run spans stores they cannot see,
// so it reads as not found rather than leaking its contents.
async function assertPayRunInScope(restaurant, userId, run) {
  const scope = await getLocationScope(restaurant, userId);
  if (scope.mode !== 'assigned') return;
  const ids = Array.isArray(run.location_ids) ? run.location_ids.map((id) => Number(id)) : [];
  const visible = Array.isArray(scope.location_ids) ? scope.location_ids.map((id) => Number(id)) : [];
  if (!ids.length || !ids.some((id) => visible.includes(id))) {
    throw new AppError('Pay run not found', 404, 'pay_run_not_found');
  }
}

exports.getPayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const run = await getPayRunWithLines(pool, restaurant.id, payRunId);
    if (!run) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    await assertPayRunInScope(restaurant, req.user.id, run);
    res.json({ payRun: payRunShape(run) });
  } catch (err) { next(err); }
};

exports.rebuildPayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const scope = await getLocationScope(restaurant, req.user.id);
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status !== 'draft') {
        throw new AppError('Only draft pay runs can be rebuilt', 409, 'pay_run_not_draft');
      }
      // Phase 8 Track B: a rebuild recomputes the run's own stored
      // scope, not the caller's current scope — the run's stores are
      // part of the run. Legacy unscoped runs keep the caller scope.
      const storedLocationIds = Array.isArray(existing.location_ids)
        ? existing.location_ids.map((id) => Number(id))
        : [];
      const rebuildLocationIds = storedLocationIds.length ? storedLocationIds : scope.location_ids;
      const labor = await payroll.computeLabor({
        restaurant,
        fromDate: existing.period_from instanceof Date
          ? existing.period_from.toISOString().slice(0, 10)
          : String(existing.period_from).slice(0, 10),
        toDate: existing.period_to instanceof Date
          ? existing.period_to.toISOString().slice(0, 10)
          : String(existing.period_to).slice(0, 10),
        locationIds: rebuildLocationIds,
      });
      await client.query('DELETE FROM restaurant_pay_run_lines WHERE pay_run_id = $1', [payRunId]);
      // Finding 5: a rebuild re-derives the carry-forward lines too;
      // this run's own old claims are dropped first so they do not
      // block re-claiming the same inputs.
      await client.query('DELETE FROM restaurant_pay_run_carry_forwards WHERE target_pay_run_id = $1', [payRunId]);
      await insertPayRunLines(
        client,
        payRunId,
        payRunLinesFromLabor(labor),
        rebuildLocationIds && rebuildLocationIds.length === 1 ? Number(rebuildLocationIds[0]) : null
      );
      const rebuildWagesByUser = new Map(
        (labor.employees || [])
          .filter((e) => e.user_id != null && e.hourly_wage_cents != null)
          .map((e) => [String(e.user_id), Number(e.hourly_wage_cents)])
      );
      const rebuildCarryItems = await payroll.buildCarryForwardItems(pool, {
        restaurant,
        targetPeriodFrom: existing.period_from instanceof Date
          ? existing.period_from.toISOString().slice(0, 10)
          : String(existing.period_from).slice(0, 10),
        targetPeriodTo: existing.period_to instanceof Date
          ? existing.period_to.toISOString().slice(0, 10)
          : String(existing.period_to).slice(0, 10),
        locationIds: rebuildLocationIds,
        currency: restaurant.currency_code || 'USD',
        wagesByUser: rebuildWagesByUser,
        excludeTargetRunId: payRunId,
      });
      if (rebuildCarryItems.length) {
        const rebuildCarryLines = await payroll.applyCarryForward(client, payRunId, rebuildCarryItems);
        if (rebuildCarryLines.length) {
          await insertPayRunLines(
            client,
            payRunId,
            rebuildCarryLines,
            rebuildLocationIds && rebuildLocationIds.length === 1 ? Number(rebuildLocationIds[0]) : null
          );
        }
      }
      const { rows: [updated] } = await client.query(
        'UPDATE restaurant_pay_runs SET updated_at = NOW() WHERE id = $1 RETURNING *',
        [payRunId]
      );
      return updated;
    }, 'restaurant_rebuild_pay_run');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.rebuilt',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { status: 'draft' },
    });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

exports.finalizePayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status !== 'draft') {
        throw new AppError('Only draft pay runs can be finalized', 409, 'pay_run_not_draft');
      }
      const { rows: lines } = await client.query(
        'SELECT * FROM restaurant_pay_run_lines WHERE pay_run_id = $1 ORDER BY id',
        [payRunId]
      );
      // Money fails closed: a finalized run with unknown wage rates would
      // undercount pay. Set the rates first, then finalize.
      const missingWageLines = lines.filter(
        (line) => line.hourly_wage_cents == null
          && (Number(line.regular_hours) > 0 || Number(line.overtime_hours) > 0)
      );
      if (missingWageLines.length) {
        throw new AppError(
          'Some employees have hours but no wage rate; set wage rates before finalizing',
          409,
          'pay_run_missing_wages',
          { count: missingWageLines.length }
        );
      }
      // Money fails closed: premium hours with no wage to price them
      // would finalize as zero-owed. Set the wage rates first.
      const unpricedLines = lines.filter((line) => Number(line.unpriced_premium_hours || 0) > 0);
      if (unpricedLines.length) {
        throw new AppError(
          'Some premium hours have no wage rate to price them; set wage rates before finalizing',
          409,
          'pay_run_unpriced_premiums',
          { count: unpricedLines.length }
        );
      }
      // Finding 15: finalize also fails closed on work still in
      // flight in the run period. A system-closed punch, a pending
      // punch correction, or a pending cash-tip declaration means
      // the period's pay basis is not settled yet; the manager
      // clears the named item and finalizes again. No silent
      // override, and the error names exactly what is pending.
      const periodFrom = existing.period_from instanceof Date
        ? existing.period_from.toISOString().slice(0, 10)
        : String(existing.period_from).slice(0, 10);
      const periodTo = existing.period_to instanceof Date
        ? existing.period_to.toISOString().slice(0, 10)
        : String(existing.period_to).slice(0, 10);
      const runLocationIds = Array.isArray(existing.location_ids)
        ? existing.location_ids.map((id) => Number(id))
        : [];
      const scoped = runLocationIds.length > 0;
      const { rows: [systemClosedRow] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM business_time_entries
          WHERE business_id = $1 AND entry_date >= $2 AND entry_date <= $3
            AND system_closed_at IS NOT NULL AND voided_at IS NULL
            ${scoped ? 'AND (location_id IS NULL OR location_id = ANY($4::bigint[]))' : ''}`,
        scoped
          ? [restaurant.business_id, periodFrom, periodTo, runLocationIds]
          : [restaurant.business_id, periodFrom, periodTo]
      );
      if (Number(systemClosedRow?.n || 0) > 0) {
        throw new AppError(
          'Some punches in this period were closed by the system and still need review; review them before finalizing',
          409,
          'pay_run_finalize_system_closed_entries',
          { count: Number(systemClosedRow.n) }
        );
      }
      const { rows: [pendingCorrectionRow] } = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM business_time_entry_corrections c
           JOIN business_time_entries e ON e.id = c.entry_id
          WHERE c.business_id = $1 AND c.status = 'pending'
            AND e.entry_date >= $2 AND e.entry_date <= $3 AND e.voided_at IS NULL
            ${scoped ? 'AND (e.location_id IS NULL OR e.location_id = ANY($4::bigint[]))' : ''}`,
        scoped
          ? [restaurant.business_id, periodFrom, periodTo, runLocationIds]
          : [restaurant.business_id, periodFrom, periodTo]
      );
      if (Number(pendingCorrectionRow?.n || 0) > 0) {
        throw new AppError(
          'Some punch corrections in this period are still pending; decide them before finalizing',
          409,
          'pay_run_finalize_pending_corrections',
          { count: Number(pendingCorrectionRow.n) }
        );
      }
      const { rows: [pendingTipRow] } = await client.query(
        `SELECT COUNT(*)::int AS n FROM restaurant_declared_cash_tips
          WHERE restaurant_id = $1 AND business_date >= $2 AND business_date <= $3
            AND status = 'pending'
            ${scoped ? 'AND (location_id IS NULL OR location_id = ANY($4::bigint[]))' : ''}`,
        scoped
          ? [restaurant.id, periodFrom, periodTo, runLocationIds]
          : [restaurant.id, periodFrom, periodTo]
      );
      if (Number(pendingTipRow?.n || 0) > 0) {
        throw new AppError(
          'Some cash-tip declarations in this period are still pending review; confirm or reject them before finalizing',
          409,
          'pay_run_finalize_pending_cash_tips',
          { count: Number(pendingTipRow.n) }
        );
      }
      const sum = (pick) => lines.reduce((total, line) => total + (Number(pick(line)) || 0), 0);
      const totals = {
        // Phase 8 Track B: the run's own currency snapshot prices the
        // finalized totals, not the restaurant's current currency.
        currency: existing.currency_code || restaurant.currency_code || 'USD',
        employees: lines.length,
        total_regular_hours: Math.round(sum((l) => l.regular_hours) * 100) / 100,
        total_overtime_hours: Math.round(sum((l) => l.overtime_hours) * 100) / 100,
        total_doubletime_hours: Math.round(sum((l) => l.doubletime_hours) * 100) / 100,
        total_wages_cents: Math.round(sum((l) => l.wages_cents)),
        total_doubletime_wages_cents: Math.round(sum((l) => l.doubletime_wages_cents)),
        total_meal_break_premium_cents: Math.round(sum((l) => l.meal_break_premium_cents)),
        total_predictability_premium_cents: Math.round(sum((l) => l.predictability_premium_cents)),
        total_gross_tips_cents: Math.round(sum((l) => l.gross_tips_cents)),
        total_net_tips_cents: Math.round(sum((l) => l.net_tips_cents)),
        total_pay_cents: Math.round(sum((l) => l.total_pay_cents)),
      };
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_pay_runs
            SET status = 'finalized', totals = $1::jsonb,
                finalized_by = $2, finalized_at = NOW(), updated_at = NOW()
          WHERE id = $3
          RETURNING *`,
        [JSON.stringify(totals), req.user.id, payRunId]
      );
      return updated;
    }, 'restaurant_finalize_pay_run');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.finalized',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { status: 'finalized', totals: run.totals, finalized_by: req.user.id },
    });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

// Shared maker-checker approve core: the HQ pay-run approval
// endpoint (Phase 8 Track D) runs the same checks as the
// per-restaurant approve, with a different audit action.
async function approvePayRunTx(client, { restaurantId, payRunId, approverUserId }) {
  const { rows: [existing] } = await client.query(
    'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
    [payRunId, restaurantId]
  );
  if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
  if (existing.status !== 'finalized') {
    throw new AppError('Only finalized pay runs can be approved', 409, 'pay_run_not_finalized');
  }
  if (existing.approved_by) {
    throw new AppError('This pay run is already approved', 409, 'pay_run_already_approved');
  }
  // Maker-checker, same pattern as dualApprovalService: the user
  // who finalized the run can never approve it. The DB CHECK on
  // restaurant_pay_runs is the second line of defense.
  if (String(existing.finalized_by) === String(approverUserId)) {
    throw new AppError(
      'The user who finalized a pay run cannot approve it; a different payroll manager must approve',
      403,
      'pay_run_self_approval'
    );
  }
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_pay_runs
        SET approved_by = $2, approved_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [payRunId, approverUserId]
  );
  return updated;
}

exports.approvePayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const run = await withTransaction(pool, async (client) =>
      approvePayRunTx(client, { restaurantId: restaurant.id, payRunId, approverUserId: req.user.id }),
    'restaurant_approve_pay_run');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.approved',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { status: 'finalized', approved_by: req.user.id, finalized_by: run.finalized_by },
    });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

exports._approvePayRunTx = approvePayRunTx;
exports._payRunShape = payRunShape;
exports._getPayRunWithLines = getPayRunWithLines;

// Phase 5: nothing leaves a finalized run (export file or payout
// link) until a second payroll manager has approved it. Paid runs
// already released money through an approved path, so they stay
// exportable as the settled record.
function assertPayRunApprovedForRelease(run) {
  if (run.status === 'paid') return;
  if (!run.approved_by) {
    throw new AppError(
      'This pay run needs approval from a second payroll manager before it can be exported or linked to a payout',
      409,
      'pay_run_not_approved'
    );
  }
}

// Shared void guards (findings 40 and 9): a member run of a live
// (finalized or approved) consolidation, or a run with recorded
// disbursements, cannot be voided. Checked at the void-request step
// and re-verified at the void-approval step, so nothing changes
// underneath a pending request.
async function assertPayRunVoidable(client, payRunId) {
  // Finding 40: a member run of a live consolidation cannot be voided
  // away underneath it — the consolidation snapshot would go stale.
  // Void the consolidation first (which dissolves the group without
  // touching the runs), then void the run. Draft consolidations do
  // not block: their finalize re-verifies members are still finalized.
  const { rows: [liveConsolidation] } = await client.query(
    `SELECT c.id FROM restaurant_pay_run_consolidation_members m
       JOIN restaurant_pay_run_consolidations c ON c.id = m.consolidation_id
      WHERE m.pay_run_id = $1 AND c.status IN ('finalized', 'approved')`,
    [payRunId]
  );
  if (liveConsolidation) {
    throw new AppError(
      `This pay run belongs to live consolidation ${liveConsolidation.id}; void the consolidation first`,
      409,
      'pay_run_in_live_consolidation',
      { consolidation_id: Number(liveConsolidation.id) }
    );
  }
  // Phase 5: money already recorded as disbursed cannot be voided
  // away; the disbursement ledger is the record of what left.
  // Finding 9: only live ('recorded') disbursements block — a
  // reversed disbursement no longer holds the run hostage.
  const { rows: [disbursedRow] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM restaurant_pay_run_disbursements
      WHERE pay_run_id = $1 AND status = 'recorded'`,
    [payRunId]
  );
  if (Number(disbursedRow?.n || 0) > 0) {
    throw new AppError('A pay run with recorded disbursements cannot be voided', 409, 'pay_run_has_disbursements');
  }
}

// Finding 41: voiding a finalized or approved pay run needs a second
// manager's approval, like every other release step (finalize is the
// maker, approve is the checker). This endpoint is the maker step: for
// a finalized run it records the void request and returns 202 with the
// run still finalized; approveVoidPayRun is the checker step that
// completes the void. A draft run still voids in one step, because
// nothing has been finalized or approved yet.
exports.voidPayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    // Finding 25: a paid run has money attached; voiding it away would
    // erase the linkage. Paid runs stay paid.
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status === 'paid') throw new AppError('A paid pay run cannot be voided', 409, 'pay_run_paid');
      if (existing.status === 'voided') throw new AppError('This pay run is already voided', 409, 'pay_run_already_voided');
      await assertPayRunVoidable(client, payRunId);
      if (existing.status === 'draft') {
        const { rows: [voided] } = await client.query(
          `UPDATE restaurant_pay_runs
              SET status = 'voided', updated_at = NOW()
            WHERE id = $1 AND restaurant_id = $2 AND status = 'draft'
            RETURNING *`,
          [payRunId, restaurant.id]
        );
        return { run: voided, requested: false };
      }
      if (existing.void_requested_by) {
        throw new AppError('A void has already been requested for this pay run; a different payroll manager must approve it', 409, 'pay_run_void_already_requested');
      }
      const { rows: [requested] } = await client.query(
        `UPDATE restaurant_pay_runs
            SET void_requested_by = $2, void_requested_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $3 AND status = 'finalized' AND void_requested_by IS NULL
          RETURNING *`,
        [payRunId, req.user.id, restaurant.id]
      );
      if (!requested) throw new AppError('This pay run is already voided', 409, 'pay_run_already_voided');
      return { run: requested, requested: true };
    }, 'restaurant_void_pay_run');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: run.requested ? 'restaurant.pay_run.void_requested' : 'restaurant.pay_run.voided',
      target_type: 'restaurant_pay_run',
      target_id: run.run.id,
      after_state: run.requested
        ? { status: 'finalized', void_requested_by: req.user.id }
        : { status: 'voided' },
    });
    if (run.requested) return res.status(202).json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.run.id)) });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.run.id)) });
  } catch (err) { next(err); }
};

// Finding 41, checker step: a second payroll manager completes a
// pending void request. The approver must differ from both the void
// requester and the finalizer, where those are known; the DB CHECK on
// restaurant_pay_runs is the second line of defense. The void guards
// (live consolidation, recorded disbursements) are re-verified here,
// so a request cannot complete over a run that changed underneath it.
exports.approveVoidPayRun = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status === 'voided') throw new AppError('This pay run is already voided', 409, 'pay_run_already_voided');
      if (existing.status !== 'finalized' || !existing.void_requested_by) {
        throw new AppError('No void has been requested for this pay run; request the void first', 409, 'pay_run_void_not_requested');
      }
      if (String(existing.void_requested_by) === String(req.user.id)) {
        throw new AppError(
          'The user who requested a pay-run void cannot approve it; a different payroll manager must approve',
          403,
          'pay_run_void_self_approval'
        );
      }
      if (existing.finalized_by != null && String(existing.finalized_by) === String(req.user.id)) {
        throw new AppError(
          'The user who finalized a pay run cannot approve its void; a different payroll manager must approve',
          403,
          'pay_run_void_finalizer_approval'
        );
      }
      await assertPayRunVoidable(client, payRunId);
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_pay_runs
            SET status = 'voided', void_approved_by = $2, void_approved_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $3 AND status = 'finalized' AND void_requested_by IS NOT NULL
          RETURNING *`,
        [payRunId, req.user.id, restaurant.id]
      );
      if (!updated) throw new AppError('This pay run is already voided', 409, 'pay_run_already_voided');
      return updated;
    }, 'restaurant_approve_pay_run_void');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.voided',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { status: 'voided', void_requested_by: run.void_requested_by, void_approved_by: req.user.id },
    });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

exports.exportPayRunCsv = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const run = await getPayRunWithLines(pool, restaurant.id, payRunId);
    if (!run) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    await assertPayRunInScope(restaurant, req.user.id, run);
    if (run.status === 'draft') {
      throw new AppError('Only finalized pay runs can be exported', 409, 'pay_run_not_finalized');
    }
    // Finding 25: a voided run must not export as a clean payroll
    // document. Paid runs export (they are the settled record); voided
    // runs are refused outright rather than watermarked into ambiguity.
    if (run.status === 'voided') {
      throw new AppError('Voided pay runs cannot be exported', 409, 'pay_run_voided');
    }
    assertPayRunApprovedForRelease(run);
    const periodFrom = run.period_from instanceof Date
      ? run.period_from.toISOString().slice(0, 10)
      : String(run.period_from).slice(0, 10);
    const periodTo = run.period_to instanceof Date
      ? run.period_to.toISOString().slice(0, 10)
      : String(run.period_to).slice(0, 10);
    // Phase 8 Track B: the run's own currency snapshot prices the
    // export, not the restaurant's current currency.
    const runCurrency = run.currency_code || restaurant.currency_code || 'USD';
    // Per-store export: a run's lines carry a store only when the run
    // covers exactly one store. Exporting one store out of a
    // multi-store run would misattribute shared lines, so it fails
    // closed — the per-store labor report is the store-level view
    // for multi-store runs.
    const exportLocationId = req.query?.locationId === undefined ? null : strictInteger(req.query.locationId);
    if (req.query?.locationId !== undefined && !exportLocationId) throw new AppError('Invalid store', 400, 'invalid_location_id');
    let exportLines = run.lines || [];
    if (exportLocationId) {
      const runLocationIds = Array.isArray(run.location_ids) ? run.location_ids.map((id) => Number(id)) : [];
      if (runLocationIds.length !== 1 || runLocationIds[0] !== exportLocationId) {
        throw new AppError(
          'Only a pay run built for exactly that store can be exported per store; this run covers other stores',
          409,
          'pay_run_not_store_scoped'
        );
      }
      exportLines = exportLines.filter((line) => line.location_id == null || Number(line.location_id) === exportLocationId);
    }
    const runTotal = exportLines.reduce((sum, line) => sum + (Number(line.total_pay_cents) || 0), 0);
    // Phase 5 provider export: the same approved, finalized lines in a
    // payroll-provider import shape (ADP / Gusto / QuickBooks Payroll).
    // No tax columns: withholding and filing stay with the provider.
    // Amounts are integer minor units in the run currency, stated on
    // every row so a multi-currency file can never be misread.
    const format = String(req.query?.format || 'native').toLowerCase();
    if (!['native', 'provider'].includes(format)) {
      throw new AppError('Unknown pay-run export format', 400, 'pay_run_export_format_unknown');
    }
    if (format === 'provider') {
      const providerHeader = [
        'employee_name', 'employee_id', 'period_from', 'period_to',
        'regular_hours', 'overtime_hours', 'doubletime_hours',
        'regular_wages_cents', 'overtime_wages_cents', 'doubletime_wages_cents',
        'meal_break_premium_cents', 'predictability_premium_cents',
        'gross_tips_cents', 'tip_out_cents', 'tip_in_cents', 'net_tips_cents',
        'total_pay_cents', 'currency_code', 'location_id',
      ];
      const providerLines = [
        `# Payroll provider export — run ${run.id}, ${periodFrom} to ${periodTo}, status ${run.status}, approved ${run.approved_at || 'n/a'}, total ${formatMinorUnits(runTotal, runCurrency)}`,
        providerHeader.join(','),
        ...exportLines.map((line) => [
          line.staff_label, line.staff_user_id, periodFrom, periodTo,
          line.regular_hours, line.overtime_hours, line.doubletime_hours,
          line.regular_wages_cents, line.overtime_wages_cents, line.doubletime_wages_cents,
          line.meal_break_premium_cents, line.predictability_premium_cents,
          line.gross_tips_cents, line.tip_out_cents, line.tip_in_cents, line.net_tips_cents,
          line.total_pay_cents, runCurrency, line.location_id ?? '',
        ].map(csvCell).join(',')),
      ];
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role || null,
        action: 'restaurant.pay_run.exported',
        target_type: 'restaurant_pay_run',
        target_id: run.id,
        metadata: { status: run.status, employees: exportLines.length, format: 'provider', location_id: exportLocationId },
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pay-run-${run.id}-${periodFrom}-to-${periodTo}-provider.csv"`);
      res.send(`${providerLines.join('\n')}\n`);
      return;
    }
    const header = [
      'employee_name', 'user_id', 'regular_hours', 'overtime_hours', 'doubletime_hours',
      'hourly_wage_cents', 'regular_wages_cents', 'overtime_wages_cents', 'doubletime_wages_cents', 'wages_cents',
      'meal_break_premium_cents', 'predictability_premium_cents',
      'gross_tips_cents', 'tip_out_cents', 'tip_in_cents', 'net_tips_cents', 'total_pay_cents',
      'location_id',
    ];
    const lines = [
      `# OxSteed payroll export — run ${run.id}, ${periodFrom} to ${periodTo}, status ${run.status}, finalized ${run.finalized_at || 'n/a'}, approved ${run.approved_at || 'n/a'}, total ${formatMinorUnits(runTotal, runCurrency)}`,
      header.join(','),
      ...exportLines.map((line) => [
        line.staff_label, line.staff_user_id, line.regular_hours, line.overtime_hours, line.doubletime_hours,
        line.hourly_wage_cents, line.regular_wages_cents, line.overtime_wages_cents, line.doubletime_wages_cents, line.wages_cents,
        line.meal_break_premium_cents, line.predictability_premium_cents,
        line.gross_tips_cents, line.tip_out_cents, line.tip_in_cents, line.net_tips_cents, line.total_pay_cents,
        line.location_id ?? '',
      ].map(csvCell).join(',')),
    ];
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.exported',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      metadata: { status: run.status, employees: exportLines.length, location_id: exportLocationId },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pay-run-${run.id}-${periodFrom}-to-${periodTo}.csv"`);
    res.send(`${lines.join('\n')}\n`);
  } catch (err) { next(err); }
};

// Finding 25: record actual payout linkage for a finalized run. Only a
// COMPLETED restaurant payout belonging to the same restaurant can be
// linked, and only up to the run's unpaid remainder, so linkage can never
// claim more than the run owes. Nov 3 audit items 1-2: the link is also
// capped by the payout's unattributed remainder across all pay runs, and
// a payout in another currency than the run is rejected, so one payout
// cannot mark two runs paid and a mixed-currency sum cannot flip a run
// to paid. When linked payouts cover the run's
// total pay, the run moves to 'paid': finalized alone never again reads
// as paid. Link rows are append-only; the payout itself is untouched.
exports.linkPayRunPayout = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    // Payout ids are UUIDs (restaurant_payouts.id is uuid), never integers:
    // parsePositiveInt would reject every real payout id.
    const rawPayoutId = req.body?.restaurantPayoutId || req.body?.payoutId;
    const payoutId = typeof rawPayoutId === 'string' ? rawPayoutId.trim() : null;
    if (!payoutId) throw new AppError('A restaurant payout id is required', 400, 'pay_run_payout_id_required');
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status !== 'finalized') {
        throw new AppError('Only finalized pay runs can be linked to payouts', 409, 'pay_run_not_finalized');
      }
      // Phase 5: a finalized-but-unapproved run cannot link payouts.
      assertPayRunApprovedForRelease(existing);
      const { rows: [payout] } = await client.query(
        'SELECT * FROM restaurant_payouts WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payoutId, restaurant.id]
      );
      if (!payout) throw new AppError('Restaurant payout not found', 404, 'restaurant_payout_not_found');
      if (payout.status !== 'completed') {
        throw new AppError('Only completed payouts can be linked to a pay run', 409, 'pay_run_payout_not_completed');
      }
      // Nov 3 audit items 1-2: the run's currency is the restaurant's
      // currency. A payout in another currency can never fund this run,
      // and a mixed-currency sum must never flip it to paid.
      const runCurrency = (restaurant.currency_code || 'USD').toUpperCase();
      const payoutCurrency = (payout.currency_code || runCurrency).toUpperCase();
      if (payoutCurrency !== runCurrency) {
        throw new AppError('This payout is in a different currency from the pay run', 409, 'pay_run_payout_currency_mismatch');
      }
      const totals = existing.totals && typeof existing.totals === 'object' ? existing.totals : {};
      const totalPayCents = Math.round(Number(totals.total_pay_cents || 0));
      const { rows: [linkedRow] } = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS linked FROM restaurant_pay_run_payout_links
          WHERE pay_run_id = $1 AND currency_code = $2`,
        [payRunId, runCurrency]
      );
      const alreadyLinked = Number(linkedRow?.linked || 0);
      const remaining = totalPayCents - alreadyLinked;
      if (remaining <= 0) {
        throw new AppError('This pay run is already fully linked', 409, 'pay_run_already_linked');
      }
      // Item 1: cap the link by what this payout still has unattributed
      // across ALL pay runs, not just this one, so one completed payout
      // cannot mark two runs paid. The same payout linked twice to this
      // run is a duplicate, not a second attribution.
      const { rows: [sameRunLink] } = await client.query(
        'SELECT id FROM restaurant_pay_run_payout_links WHERE pay_run_id = $1 AND restaurant_payout_id = $2',
        [payRunId, payoutId]
      );
      if (sameRunLink) {
        throw new AppError('This payout is already linked to this pay run', 409, 'pay_run_payout_already_linked');
      }
      const { rows: [elsewhereRow] } = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS linked FROM restaurant_pay_run_payout_links
          WHERE restaurant_payout_id = $1 AND currency_code = $2`,
        [payoutId, payoutCurrency]
      );
      const payoutAvailable = Number(payout.amount_cents || 0) - Number(elsewhereRow?.linked || 0);
      if (payoutAvailable <= 0) {
        throw new AppError('This payout is already fully attributed to other pay runs', 409, 'pay_run_payout_already_linked');
      }
      const linkAmount = Math.min(Number(payout.amount_cents || 0), remaining, payoutAvailable);
      if (linkAmount <= 0) {
        throw new AppError('This payout has no linkable amount for this pay run', 409, 'pay_run_payout_empty');
      }
      await client.query(
        `INSERT INTO restaurant_pay_run_payout_links
           (pay_run_id, restaurant_payout_id, amount_cents, currency_code, linked_by, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [payRunId, payoutId, linkAmount, payout.currency_code || restaurant.currency_code || 'USD', req.user.id, note]
      );
      const newLinked = alreadyLinked + linkAmount;
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_pay_runs
            SET status = CASE WHEN $2 >= $3 THEN 'paid' ELSE status END, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [payRunId, newLinked, totalPayCents]
      );
      return updated;
    }, 'restaurant_pay_run_link_payout');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.payout_linked',
      target_type: 'restaurant_pay_run',
      target_id: run.id,
      after_state: { status: run.status, payout_id: payoutId },
    });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.id)) });
  } catch (err) { next(err); }
};

// ── Pay-run disbursement ledger (Phase 5) ───────────────────────────
// Per-employee payment records linked to run lines. A disbursement
// records money that actually left for one employee: its amount must
// equal that employee's line total exactly (no partial, no overpay),
// one record per line, and the run flips to 'paid' only when every
// line is covered and the per-employee amounts sum to the run total.
// The ledger never moves money itself; it records disbursements made
// through the restaurant's bank, cash, check, or payroll provider.

const DISBURSEMENT_METHODS = ['bank_transfer', 'cash', 'check', 'provider_export'];

exports.listPayRunDisbursements = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const run = await getPayRunWithLines(pool, restaurant.id, payRunId);
    if (!run) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    res.json({ payRun: payRunShape(run) });
  } catch (err) { next(err); }
};

exports.recordPayRunDisbursement = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    if (!payRunId) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
    const payRunLineId = strictInteger(req.body?.payRunLineId ?? req.body?.pay_run_line_id);
    if (!payRunLineId) throw new AppError('A pay-run line id is required', 400, 'pay_run_disbursement_line_required');
    // Zero-total lines (no hours, no tips) still need a zero-amount
    // record to be covered, so the minimum here is 0, not 1.
    const amountCents = strictInteger(req.body?.amountCents ?? req.body?.amount_cents, { min: 0 });
    if (amountCents == null || amountCents < 0) {
      throw new AppError('A non-negative integer amount in minor units is required', 400, 'pay_run_disbursement_amount_required');
    }
    const method = typeof req.body?.method === 'string' ? req.body.method.trim() : 'bank_transfer';
    if (!DISBURSEMENT_METHODS.includes(method)) {
      throw new AppError('Unknown disbursement method', 400, 'pay_run_disbursement_method_unknown');
    }
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim().slice(0, 160) || null : null;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) || null : null;
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status !== 'finalized') {
        throw new AppError('Disbursements can only be recorded for finalized pay runs', 409, 'pay_run_not_finalized');
      }
      // Disbursement is a release of money: it needs the same second
      // approver as an export or payout link.
      assertPayRunApprovedForRelease(existing);
      const { rows: [line] } = await client.query(
        'SELECT * FROM restaurant_pay_run_lines WHERE id = $1 AND pay_run_id = $2 FOR UPDATE',
        [payRunLineId, payRunId]
      );
      if (!line) throw new AppError('Pay-run line not found', 404, 'pay_run_line_not_found');
      const lineTotal = Math.round(Number(line.total_pay_cents) || 0);
      if (amountCents !== lineTotal) {
        throw new AppError(
          'A disbursement must equal the employee line total exactly',
          409,
          'pay_run_disbursement_amount_mismatch',
          { expected_cents: lineTotal, received_cents: amountCents }
        );
      }
      // Finding 9: a voided disbursement frees its line for a
      // corrected re-recording; only a live one is a duplicate.
      const { rows: [duplicate] } = await client.query(
        `SELECT id FROM restaurant_pay_run_disbursements
          WHERE pay_run_line_id = $1 AND status = 'recorded'`,
        [payRunLineId]
      );
      if (duplicate) {
        throw new AppError('This pay-run line already has a disbursement', 409, 'pay_run_disbursement_duplicate');
      }
      const currencyCode = (restaurant.currency_code || 'USD').toUpperCase();
      const { rows: [recorded] } = await client.query(
        `INSERT INTO restaurant_pay_run_disbursements
           (pay_run_id, pay_run_line_id, staff_user_id, staff_label,
            amount_cents, currency_code, method, reference, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [payRunId, payRunLineId, line.staff_user_id, line.staff_label,
          amountCents, currencyCode, method, reference, note, req.user.id]
      );
      // Reconcile: the run is paid only when every line is covered and
      // the per-employee amounts sum to the run total. Anything short
      // stays finalized, never half-paid.
      const { rows: lines } = await client.query(
        'SELECT id, total_pay_cents FROM restaurant_pay_run_lines WHERE pay_run_id = $1',
        [payRunId]
      );
      const { rows: disbursements } = await client.query(
        `SELECT pay_run_line_id, amount_cents FROM restaurant_pay_run_disbursements
          WHERE pay_run_id = $1 AND status = 'recorded'`,
        [payRunId]
      );
      const covered = new Set(disbursements.map((d) => Number(d.pay_run_line_id)));
      const runTotal = lines.reduce((sum, l) => sum + (Number(l.total_pay_cents) || 0), 0);
      const disbursed = disbursements.reduce((sum, d) => sum + (Number(d.amount_cents) || 0), 0);
      const fullyCovered = lines.length > 0
        && lines.every((l) => covered.has(Number(l.id)))
        && disbursed === runTotal;
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_pay_runs
            SET status = CASE WHEN $2 THEN 'paid' ELSE status END, updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [payRunId, fullyCovered]
      );
      return { run: updated, disbursement: recorded, fullyCovered };
    }, 'restaurant_pay_run_disbursement');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.disbursement_recorded',
      target_type: 'restaurant_pay_run',
      target_id: run.run.id,
      after_state: {
        status: run.run.status,
        pay_run_line_id: payRunLineId,
        amount_cents: amountCents,
        method,
        fully_covered: run.fullyCovered,
      },
    });
    res.status(201).json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.run.id)) });
  } catch (err) { next(err); }
};

// Finding 9: a wrongly recorded disbursement used to block voiding
// the run forever. Reversing it is an audit-visible correction, not
// an edit: the row stays in the ledger with status 'voided', its line
// reads unpaid again, and a paid run drops back to finalized so the
// run can then be voided normally or re-disbursed correctly. Allowed
// while the run is finalized or paid, under the same gates as
// recording (payroll.manage + a second approver's approval), and the
// user who recorded it cannot void it themselves.
exports.voidPayRunDisbursement = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const payRunId = parsePositiveInt(req.params.payRunId);
    const disbursementId = parsePositiveInt(req.params.disbursementId);
    if (!payRunId || !disbursementId) {
      throw new AppError('Pay-run disbursement not found', 404, 'pay_run_disbursement_not_found');
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || null : null;
    const run = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        'SELECT * FROM restaurant_pay_runs WHERE id = $1 AND restaurant_id = $2 FOR UPDATE',
        [payRunId, restaurant.id]
      );
      if (!existing) throw new AppError('Pay run not found', 404, 'pay_run_not_found');
      if (existing.status !== 'finalized' && existing.status !== 'paid') {
        throw new AppError('Only disbursements of a finalized pay run can be voided', 409, 'pay_run_not_finalized');
      }
      assertPayRunApprovedForRelease(existing);
      const { rows: [disbursement] } = await client.query(
        `SELECT * FROM restaurant_pay_run_disbursements
          WHERE id = $1 AND pay_run_id = $2 FOR UPDATE`,
        [disbursementId, payRunId]
      );
      if (!disbursement) throw new AppError('Pay-run disbursement not found', 404, 'pay_run_disbursement_not_found');
      if (disbursement.status === 'voided') {
        throw new AppError('This disbursement has already been voided', 409, 'pay_run_disbursement_already_voided');
      }
      if (disbursement.recorded_by && String(disbursement.recorded_by) === String(req.user.id)) {
        throw new AppError(
          'The user who recorded a disbursement cannot void it; a different payroll manager must void it',
          403,
          'pay_run_disbursement_self_void'
        );
      }
      const { rows: [voided] } = await client.query(
        `UPDATE restaurant_pay_run_disbursements
            SET status = 'voided', voided_by = $2, voided_at = NOW(), void_reason = $3
          WHERE id = $1
          RETURNING *`,
        [disbursementId, req.user.id, reason]
      );
      // A paid run is paid only while every line is covered; with a
      // line uncovered again it returns to finalized.
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_pay_runs
            SET status = CASE WHEN status = 'paid' THEN 'finalized' ELSE status END,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [payRunId]
      );
      return { run: updated, disbursement: voided };
    }, 'restaurant_pay_run_disbursement_void');
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.pay_run.disbursement_voided',
      target_type: 'restaurant_pay_run',
      target_id: run.run.id,
      after_state: {
        status: run.run.status,
        disbursement_id: disbursementId,
        pay_run_line_id: run.disbursement.pay_run_line_id,
        amount_cents: run.disbursement.amount_cents,
        voided_by: req.user.id,
        reason,
      },
    });
    res.json({ payRun: payRunShape(await getPayRunWithLines(pool, restaurant.id, run.run.id)) });
  } catch (err) { next(err); }
};
