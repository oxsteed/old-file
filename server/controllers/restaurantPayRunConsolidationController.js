'use strict';

// Phase 8 Track C — cross-restaurant payroll endpoints (baseline
// gap 18, second half). Brand-scoped: the caller sees only the
// restaurants they can already access, through the brand
// controller's canonical loader. Creating, finalizing, or approving
// a consolidation needs payroll.manage on at least one accessible
// restaurant of the brand; reads need payroll.view.

const pool = require('../db');
const AppError = require('../utils/appError');
const { loadBrandRestaurants, brandIdParam } = require('./restaurantBrandController');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const consolidations = require('../services/restaurantPayRunConsolidationService');

async function requireBrandPayroll(req, brandId, permission) {
  const accessible = await loadBrandRestaurants(req, brandId, { permission });
  return accessible;
}

function dateParam(value, field) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new AppError(`A valid ${field} date (YYYY-MM-DD) is required`, 400, 'validation_failed');
  }
  return text;
}

exports.listBrandPayRuns = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await requireBrandPayroll(req, brandId, 'payroll.view');
    const restaurantIds = accessible.map((entry) => Number(entry.restaurant.id));
    const runs = await consolidations.listBrandPayRuns(pool, {
      brandId,
      restaurantIds,
      from: dateParam(req.query?.from, 'from'),
      to: dateParam(req.query?.to, 'to'),
      status: req.query?.status ? String(req.query.status) : null,
    });
    // Assigned-scope readers see only runs covering their stores.
    const scoped = [];
    for (const run of runs) {
      const entry = accessible.find((item) => Number(item.restaurant.id) === run.restaurantId);
      if (entry && entry.scope.mode === 'assigned') {
        const visible = entry.scope.location_ids || [];
        if (!run.locationIds.length || !run.locationIds.some((id) => visible.includes(id))) continue;
      }
      scoped.push(run);
    }
    res.json({ brandId, payRuns: scoped });
  } catch (error) { next(error); }
};

exports.listConsolidations = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    await requireBrandPayroll(req, brandId, 'payroll.view');
    const rows = await consolidations.listConsolidations(pool, {
      brandId,
      limit: req.query?.limit,
      offset: req.query?.offset,
    });
    res.json({ consolidations: rows });
  } catch (error) { next(error); }
};

exports.getConsolidation = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    await requireBrandPayroll(req, brandId, 'payroll.view');
    const row = await consolidations.getConsolidation(pool, {
      consolidationId: req.params.consolidationId,
      brandId,
    });
    if (!row) throw new AppError('Consolidation not found', 404, 'consolidation_not_found');
    res.json({ consolidation: consolidations.consolidationShape(row) });
  } catch (error) { next(error); }
};

exports.createConsolidation = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const accessible = await requireBrandPayroll(req, brandId, 'payroll.manage');
    const body = req.body || {};
    const payRunIds = body.payRunIds ?? body.pay_run_ids;
    if (!Array.isArray(payRunIds)) throw new AppError('payRunIds is required', 400, 'validation_failed');
    // Every member run must belong to a restaurant the caller can
    // manage payroll for — the service re-checks brand tenancy.
    const allowed = new Set(accessible.map((entry) => Number(entry.restaurant.id)));
    const { rows: owners } = await pool.query(
      'SELECT id, restaurant_id FROM restaurant_pay_runs WHERE id = ANY($1::bigint[])',
      [payRunIds.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0)]
    );
    for (const owner of owners) {
      if (!allowed.has(Number(owner.restaurant_id))) {
        throw new AppError('You do not have payroll access to every pay run in this consolidation', 403, 'forbidden');
      }
    }
    const anchorRestaurantId = accessible[0].restaurant.id;
    const id = await withTransaction(pool, async (client) => {
      const createdId = await consolidations.createConsolidation(client, {
        brandId,
        anchorRestaurantId,
        payRunIds,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: accessible[0].restaurant.business_id,
        actor_role: accessible[0].restaurant.effective_role,
        action: 'restaurant.pay_run_consolidation.created',
        target_type: 'pay_run_consolidation',
        target_id: createdId,
        after_state: { brand_id: brandId, pay_run_ids: payRunIds },
        client,
        throwOnError: true,
      });
      return createdId;
    }, 'restaurant_pay_run_consolidation_create');
    const row = await consolidations.getConsolidation(pool, { consolidationId: id, brandId });
    res.status(201).json({ consolidation: consolidations.consolidationShape(row) });
  } catch (error) { next(error); }
};

async function transition(req, res, next, action, fn) {
  try {
    const brandId = brandIdParam(req);
    const accessible = await requireBrandPayroll(req, brandId, 'payroll.manage');
    const row = await withTransaction(pool, async (client) => {
      const updated = await fn(client, {
        consolidationId: req.params.consolidationId,
        actorUserId: req.user.id,
      });
      // Money-flows audit R8: a void request is not a void. The
      // maker step logs as `<action>_requested` and answers 202
      // with the group still finalized/approved; the checker step
      // completes it and answers 200.
      const effectiveAction = updated.requested ? `${action}_requested` : action;
      await logBusinessAction(req, {
        business_id: accessible[0].restaurant.business_id,
        actor_role: accessible[0].restaurant.effective_role,
        action: `restaurant.pay_run_consolidation.${effectiveAction}`,
        target_type: 'pay_run_consolidation',
        target_id: Number(req.params.consolidationId),
        after_state: {
          status: updated.status,
          finalized_by: updated.finalized_by || null,
          approved_by: updated.approved_by || null,
          void_requested_by: updated.void_requested_by || null,
          void_approved_by: updated.void_approved_by || null,
        },
        client,
        throwOnError: true,
      });
      return updated;
    }, `restaurant_pay_run_consolidation_${action}`);
    res.status(row.requested ? 202 : 200).json({ consolidation: consolidations.consolidationShape(row) });
  } catch (error) { next(error); }
}

exports.finalizeConsolidation = (req, res, next) =>
  transition(req, res, next, 'finalized', consolidations.finalizeConsolidation);
exports.approveConsolidation = (req, res, next) =>
  transition(req, res, next, 'approved', consolidations.approveConsolidation);
exports.voidConsolidation = (req, res, next) =>
  transition(req, res, next, 'voided', consolidations.voidConsolidation);
exports.approveVoidConsolidation = (req, res, next) =>
  transition(req, res, next, 'voided', consolidations.approveVoidConsolidation);

exports._requireBrandPayroll = requireBrandPayroll;
