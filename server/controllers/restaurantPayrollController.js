'use strict';

// OxSteed Restaurants — payroll, tips, labor and team-activity surface
// (staff review S-04 / S-15 / S-16). Read-mostly and fail closed:
// anything that reveals wages or exports payroll requires the
// catalog `payroll.view` permission (owners hold every permission;
// managers do NOT get payroll.view by default — see migration 245 —
// so a manager needs an explicit grant). The team activity view
// requires `audit.view`. Tip pool settings and cash-tip declarations
// write audit rows.

const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getEffectivePermissions } = require('../services/permissionsService');
const { logBusinessAction, listBusinessAudit, listBusinessAuditActors } = require('../services/businessAuditLog');
const payroll = require('../services/restaurantPayrollService');

const MANAGE_ROLES = new Set(['owner', 'manager']);

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function requireManager(req) {
  const restaurantId = parsePositiveInt(req.params.restaurantId);
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to view reports', 403, 'forbidden');
  }
  return restaurant;
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
    const restaurant = await requireManager(req);
    await requirePayrollView(restaurant, req.user.id);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const labor = await payroll.computeLabor({ restaurant, fromDate, toDate });
    res.json(labor);
  } catch (err) { next(err); }
};

exports.getLaborPolicy = async (req, res, next) => {
  try {
    const restaurant = await requireManager(req);
    await requirePayrollView(restaurant, req.user.id);
    const policy = await payroll.getLaborPolicy(restaurant.id);
    res.json({ policy });
  } catch (err) { next(err); }
};

exports.updateLaborPolicy = async (req, res, next) => {
  try {
    const restaurant = await requireManager(req);
    await requirePayrollView(restaurant, req.user.id);
    const body = req.body || {};
    const current = await payroll.getLaborPolicy(restaurant.id);
    const policy = await payroll.saveLaborPolicy(restaurant.id, {
      overtime_threshold_hours: body.overtime_threshold_hours ?? body.overtimeThresholdHours ?? current.overtime_threshold_hours,
      overtime_multiplier_bps: body.overtime_multiplier_bps ?? body.overtimeMultiplierBps ?? current.overtime_multiplier_bps,
      break_after_minutes: body.break_after_minutes ?? body.breakAfterMinutes ?? current.break_after_minutes,
      break_duration_minutes: body.break_duration_minutes ?? body.breakDurationMinutes ?? current.break_duration_minutes,
    }, req.user.id);
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
    const restaurant = await requireManager(req);
    await requirePayrollView(restaurant, req.user.id);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const labor = await payroll.computeLabor({ restaurant, fromDate, toDate });
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
    const restaurant = await requireManager(req);
    const { fromDate, toDate } = parseRangeOr400(req.query, restaurant);
    const report = await payroll.computeExceptions({ restaurant, fromDate, toDate });
    res.json(report);
  } catch (err) { next(err); }
};

// ── Team activity (S-16) ─────────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

exports.teamActivity = async (req, res, next) => {
  try {
    const restaurant = await requireManager(req);
    await requireAuditView(restaurant, req.user.id);
    const fromRaw = req.query.from ? String(req.query.from) : null;
    const toRaw = req.query.to ? String(req.query.to) : null;
    const from = fromRaw && DATE_ONLY_RE.test(fromRaw) ? `${fromRaw}T00:00:00.000Z` : fromRaw;
    const to = toRaw && DATE_ONLY_RE.test(toRaw) ? `${toRaw}T23:59:59.999Z` : toRaw;
    const [result, actors] = await Promise.all([
      listBusinessAudit(restaurant.business_id, {
        limit: req.query.limit,
        offset: req.query.offset,
        action: req.query.action ? String(req.query.action) : undefined,
        actionPrefix: req.query.action_prefix ? String(req.query.action_prefix) : undefined,
        actorUserId: req.query.actor_user_id ? String(req.query.actor_user_id) : undefined,
        from: from || undefined,
        to: to || undefined,
      }),
      listBusinessAuditActors(restaurant.business_id),
    ]);
    res.json({ entries: result.rows, total: result.total, actors });
  } catch (err) { next(err); }
};

// ── Tip pool settings + declared cash tips (S-15) ────────────────────

exports.getTipPoolSettings = async (req, res, next) => {
  try {
    const restaurant = await requireManager(req);
    const settings = await payroll.getTipPoolSettings(restaurant.id);
    res.json({ settings });
  } catch (err) { next(err); }
};

exports.updateTipPoolSettings = async (req, res, next) => {
  try {
    const restaurant = await requireManager(req);
    const body = req.body || {};
    let settings;
    try {
      settings = await payroll.saveTipPoolSettings(restaurant.id, {
        poolingEnabled: body.pooling_enabled ?? body.poolingEnabled,
        tipOutRules: body.tip_out_rules ?? body.tipOutRules ?? [],
        updatedBy: req.user.id,
      });
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
      },
    });
    res.json({ settings });
  } catch (err) { next(err); }
};

exports.declareCashTip = async (req, res, next) => {
  try {
    const restaurant = await requireManager(req);
    const body = req.body || {};
    const staffUserId = body.staffUserId || body.staff_user_id;
    const businessDate = body.date || body.businessDate || body.business_date;
    const amountCents = Number(body.amountCents ?? body.amount_cents);
    if (!staffUserId || typeof staffUserId !== 'string') {
      throw new AppError('Validation failed', 400, 'validation_failed', { staffUserId: 'A staff member is required' });
    }
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate))) {
      throw new AppError('Validation failed', 400, 'validation_failed', { date: 'A valid date (YYYY-MM-DD) is required' });
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1000000) {
      throw new AppError('Validation failed', 400, 'validation_failed', { amountCents: 'Amount must be a positive number of cents up to 1000000' });
    }
    const roster = await payroll.getRoster(restaurant.business_id);
    if (!roster.some((m) => m.user_id === staffUserId)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { staffUserId: 'Staff member is not on this restaurant team' });
    }
    const declaration = await payroll.declareCashTip(restaurant.id, {
      staffUserId,
      businessDate: String(businessDate),
      amountCents,
      declaredBy: req.user.id,
      note: body.note ? String(body.note).slice(0, 500) : null,
    });
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.cash_tip.declared',
      target_type: 'user',
      target_id: staffUserId,
      after_state: { amount_cents: amountCents, business_date: String(businessDate), declaration_id: declaration.id },
    });
    res.status(201).json({ declaration });
  } catch (err) { next(err); }
};
