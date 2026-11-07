'use strict';

// Phase 8 Track D — inter-store labor borrowing endpoints.
// Reads need payroll.view; mutations need payroll.manage. A
// store-scoped caller can only touch borrows that involve one of
// their stores, and only sees borrows involving their stores.

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getEffectivePermissions } = require('../services/permissionsService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { strictInteger } = require('../utils/strictInteger');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const payroll = require('../services/restaurantPayrollService');
const borrows = require('../services/restaurantLaborBorrowService');

async function restaurantAccess(req) {
  const restaurantId = strictInteger(req.params.restaurantId);
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(req.user.id, restaurantId);
}

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
  return requireCatalogPermission(restaurant, userId, 'payroll.view', 'payroll_permission_required', 'Viewing payroll requires the payroll.view permission');
}

function requirePayrollManage(restaurant, userId) {
  return requireCatalogPermission(restaurant, userId, 'payroll.manage', 'payroll_permission_required', 'Managing payroll requires the payroll.manage permission');
}

async function scopeFilter(restaurant, userId) {
  const scope = await getLocationScope(restaurant, userId);
  return scope.mode === 'assigned' ? (scope.location_ids || []) : null;
}

function assertBorrowVisible(scopeLocationIds, borrow) {
  if (scopeLocationIds == null) return;
  if (!scopeLocationIds.includes(Number(borrow.home_location_id)) && !scopeLocationIds.includes(Number(borrow.borrow_location_id))) {
    throw new AppError('Borrow request not found', 404, 'borrow_not_found');
  }
}

exports.listBorrows = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const locationIds = await scopeFilter(restaurant, req.user.id);
    const rows = await borrows.listBorrows(pool, {
      restaurantId: restaurant.id,
      locationIds,
      from: req.query?.from || null,
      to: req.query?.to || null,
      status: req.query?.status || null,
      staffUserId: req.query?.staffUserId || req.query?.staff_user_id || null,
      limit: req.query?.limit,
      offset: req.query?.offset,
    });
    res.json({ borrows: rows });
  } catch (err) { next(err); }
};

exports.requestBorrow = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const body = req.body || {};
    const homeLocationId = strictInteger(body.homeLocationId ?? body.home_location_id);
    const borrowLocationId = strictInteger(body.borrowLocationId ?? body.borrow_location_id);
    if (!homeLocationId || !borrowLocationId) throw new AppError('Both stores are required', 400, 'validation_failed');
    const locationIds = await scopeFilter(restaurant, req.user.id);
    if (locationIds != null && (!locationIds.includes(homeLocationId) || !locationIds.includes(borrowLocationId))) {
      throw new AppError('You do not have access to both stores in this borrow', 403, 'location_scope_forbidden');
    }
    const row = await withTransaction(pool, async (client) => {
      const created = await borrows.requestBorrow(client, {
        restaurantId: restaurant.id,
        businessId: restaurant.business_id,
        staffUserId: body.staffUserId ?? body.staff_user_id,
        homeLocationId,
        borrowLocationId,
        shiftDate: body.shiftDate ?? body.shift_date,
        startTime: body.startTime ?? body.start_time,
        endTime: body.endTime ?? body.end_time,
        roleLabel: body.roleLabel ?? body.role_label ?? null,
        requestedBy: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role || null,
        action: 'restaurant.labor_borrow.requested',
        target_type: 'labor_borrow',
        target_id: Number(created.id),
        after_state: borrows.borrowShape(created),
        client,
        throwOnError: true,
      });
      return created;
    }, 'restaurant_labor_borrow_request');
    const full = await borrows.getBorrow(pool, { borrowId: Number(row.id), restaurantId: restaurant.id });
    res.status(201).json({ borrow: borrows.borrowShape(full) });
  } catch (err) { next(err); }
};

async function review(req, res, next, status) {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const borrowId = strictInteger(req.params.borrowId);
    if (!borrowId) throw new AppError('Borrow request not found', 404, 'borrow_not_found');
    const locationIds = await scopeFilter(restaurant, req.user.id);
    const row = await withTransaction(pool, async (client) => {
      const before = await borrows.getBorrow(client, { borrowId, restaurantId: restaurant.id });
      if (!before) throw new AppError('Borrow request not found', 404, 'borrow_not_found');
      assertBorrowVisible(locationIds, borrows.borrowShape(before));
      const updated = await borrows.reviewBorrow(client, {
        borrowId,
        restaurantId: restaurant.id,
        businessId: restaurant.business_id,
        status,
        reviewerUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role || null,
        action: `restaurant.labor_borrow.${status}`,
        target_type: 'labor_borrow',
        target_id: borrowId,
        after_state: borrows.borrowShape(updated),
        client,
        throwOnError: true,
      });
      return updated;
    }, `restaurant_labor_borrow_${status}`);
    const full = await borrows.getBorrow(pool, { borrowId, restaurantId: restaurant.id });
    res.json({ borrow: borrows.borrowShape(full || row) });
  } catch (err) { next(err); }
}

exports.approveBorrow = (req, res, next) => review(req, res, next, 'approved');
exports.declineBorrow = (req, res, next) => review(req, res, next, 'declined');

async function transition(req, res, next, fromStatuses, toStatus, action) {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollManage(restaurant, req.user.id);
    const borrowId = strictInteger(req.params.borrowId);
    if (!borrowId) throw new AppError('Borrow request not found', 404, 'borrow_not_found');
    const locationIds = await scopeFilter(restaurant, req.user.id);
    const row = await withTransaction(pool, async (client) => {
      const before = await borrows.getBorrow(client, { borrowId, restaurantId: restaurant.id });
      if (!before) throw new AppError('Borrow request not found', 404, 'borrow_not_found');
      assertBorrowVisible(locationIds, borrows.borrowShape(before));
      const updated = await borrows.transitionBorrow(client, {
        borrowId,
        restaurantId: restaurant.id,
        fromStatuses,
        toStatus,
        code: `borrow_not_${toStatus}`,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role || null,
        action: `restaurant.labor_borrow.${action}`,
        target_type: 'labor_borrow',
        target_id: borrowId,
        after_state: borrows.borrowShape(updated),
        client,
        throwOnError: true,
      });
      return updated;
    }, `restaurant_labor_borrow_${action}`);
    const full = await borrows.getBorrow(pool, { borrowId, restaurantId: restaurant.id });
    res.json({ borrow: borrows.borrowShape(full || row) });
  } catch (err) { next(err); }
}

exports.cancelBorrow = (req, res, next) =>
  transition(req, res, next, ['requested', 'approved'], 'cancelled', 'cancelled');
exports.completeBorrow = (req, res, next) =>
  transition(req, res, next, ['approved'], 'completed', 'completed');

exports.getSharedRoster = async (req, res, next) => {
  try {
    const restaurant = await restaurantAccess(req);
    await requirePayrollView(restaurant, req.user.id);
    const locationIds = await scopeFilter(restaurant, req.user.id);
    const timezone = payroll.resolveReportTimezone(restaurant);
    let fromDate;
    let toDate;
    try {
      ({ fromDate, toDate } = payroll.parseLocalRange(req.query || {}, timezone));
    } catch (error) {
      throw new AppError(error.message, 400, 'validation_failed');
    }
    const roster = await borrows.getSharedRoster(pool, {
      restaurantId: restaurant.id,
      businessId: restaurant.business_id,
      locationIds,
      from: fromDate,
      to: toDate,
    });
    res.json(roster);
  } catch (err) { next(err); }
};
