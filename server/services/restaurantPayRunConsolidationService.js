'use strict';

// Phase 8 Track C — cross-restaurant payroll (baseline gap 18,
// second half).
//
// A consolidation groups finalized per-restaurant pay runs for one
// pay period into a single HQ view and a single dual-controlled
// finalize/approve. It never recomputes pay: the member runs stay
// the immutable records, and the consolidation snapshots their
// totals at join time. Per-store attribution rides on the member
// runs (Track B location_ids): a single-store run attributes fully
// to its store, a multi-store run attributes at run level, and a
// legacy unscoped run is flagged, never silently split.
//
// Overtime attribution across stores is NOT re-solved here: the
// member runs were already built from computeLabor, which computes
// overtime on each person's hours across every store and attributes
// it to the store where it was worked (S-18).
//
// Dual control (Phase 5): finalize is the maker, approve is the
// checker, and the DB CHECK is the second line of defense. A
// consolidation moves no money itself — disbursement still happens
// per member run through the Phase 5 ledger — so voiding a
// consolidation dissolves the group without touching any run.

const AppError = require('../utils/appError');
const fx = require('./restaurantFxService');

function normalizeId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`A valid ${field} is required`, 400, 'validation_failed');
  return id;
}

function dateOnly(value) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new AppError('A valid date (YYYY-MM-DD) is required', 400, 'validation_failed');
  }
  return text;
}

function memberAttribution(member) {
  const ids = Array.isArray(member.location_ids)
    ? member.location_ids.map((id) => Number(id))
    : [];
  if (!ids.length) return { type: 'unscoped_legacy', locationIds: [] };
  return {
    type: ids.length === 1 ? 'single_store' : 'multi_store',
    locationIds: ids,
  };
}

function memberShape(member) {
  return {
    payRunId: Number(member.pay_run_id),
    restaurantId: Number(member.restaurant_id),
    locationIds: Array.isArray(member.location_ids) ? member.location_ids.map((id) => Number(id)) : [],
    currencyCode: member.currency_code || (member.totals && member.totals.currency) || null,
    totals: member.totals || {},
    attribution: memberAttribution(member),
    status: member.run_status || null,
    approvedBy: member.run_approved_by || null,
    periodFrom: member.period_from ? dateOnly(member.period_from) : null,
    periodTo: member.period_to ? dateOnly(member.period_to) : null,
  };
}

// Cross-store pay-run view (read first): every run in the brand's
// accessible restaurants in the window, with per-store attribution.
async function listBrandPayRuns(client, { brandId, restaurantIds, from = null, to = null, status = null }) {
  const params = [restaurantIds];
  let where = 'pr.restaurant_id = ANY($1::bigint[])';
  if (from != null) {
    params.push(dateOnly(from));
    where += ` AND pr.period_from >= $${params.length}::date`;
  }
  if (to != null) {
    params.push(dateOnly(to));
    where += ` AND pr.period_to <= $${params.length}::date`;
  }
  if (status != null) {
    params.push(String(status));
    where += ` AND pr.status = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT pr.id, pr.restaurant_id, pr.period_from, pr.period_to, pr.status,
            pr.totals, pr.location_ids, pr.currency_code, pr.approved_by,
            (SELECT COUNT(*)::int FROM restaurant_pay_run_lines l WHERE l.pay_run_id = pr.id) AS line_count
       FROM restaurant_pay_runs pr
      WHERE ${where}
      ORDER BY pr.period_from DESC, pr.restaurant_id, pr.id DESC`,
    params
  );
  void brandId;
  return rows.map((row) => ({
    payRunId: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    periodFrom: dateOnly(row.period_from),
    periodTo: dateOnly(row.period_to),
    status: row.status,
    totals: row.totals || {},
    locationIds: Array.isArray(row.location_ids) ? row.location_ids.map((id) => Number(id)) : [],
    currencyCode: row.currency_code || (row.totals && row.totals.currency) || null,
    approvedBy: row.approved_by || null,
    lineCount: Number(row.line_count || 0),
    attribution: memberAttribution({ location_ids: row.location_ids }),
  }));
}

// Per-currency sums over the member snapshots, plus a converted
// total in the brand reporting currency. A missing rate leaves the
// converted total null and names the gap — never a guessed rate.
// Finding 57: a member run with no currency anywhere fails visibly
// here (finalize/approve time) instead of silently summing as USD.
async function computeConsolidationTotals(client, { members, brandId, periodTo }) {
  const byCurrency = new Map();
  for (const member of members) {
    const currency = member.currencyCode || (member.totals && member.totals.currency) || null;
    if (!currency) {
      throw new AppError(`Pay run ${Number(member.payRunId)} has no currency; it cannot be consolidated`, 409, 'consolidation_member_currency_missing');
    }
    const total = Math.round(Number(member.totals?.total_pay_cents || 0));
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + total);
  }
  const perCurrency = [...byCurrency.entries()].map(([currencyCode, totalPayCents]) => ({ currencyCode, totalPayCents }));
  const policy = await fx.getFxPolicy(client, { brandId });
  const rateDate = fx.resolveRateDate(policy, periodTo);
  const converted = await fx.convertBreakdown(client, {
    entries: perCurrency.map((entry) => ({ currencyCode: entry.currencyCode, amountCents: entry.totalPayCents })),
    reportingCurrency: policy.reportingCurrency,
    rateDate,
    rateSource: policy.rateSource,
  });
  return {
    perCurrency,
    converted: { ...converted, isDefaultPolicy: policy.isDefault },
  };
}

async function createConsolidation(client, { brandId = null, anchorRestaurantId, payRunIds, actorUserId = null }) {
  const anchorId = normalizeId(anchorRestaurantId, 'anchor restaurant');
  if (!Array.isArray(payRunIds) || !payRunIds.length || payRunIds.length > 50) {
    throw new AppError('At least one and at most 50 pay runs are required', 400, 'validation_failed');
  }
  const ids = [...new Set(payRunIds.map((value) => normalizeId(value, 'pay run')))];
  if (ids.length !== payRunIds.length) throw new AppError('Pay runs must be unique', 400, 'validation_failed');
  const { rows: runs } = await client.query(
    `SELECT pr.*, fr.brand_id
       FROM restaurant_pay_runs pr
       JOIN food_restaurants fr ON fr.id = pr.restaurant_id
      WHERE pr.id = ANY($1::bigint[])
      ORDER BY pr.id
      FOR UPDATE OF pr`,
    [ids]
  );
  if (runs.length !== ids.length) throw new AppError('One or more pay runs were not found', 404, 'pay_run_not_found');
  if (brandId != null) {
    const outsiders = runs.filter((row) => Number(row.brand_id) !== Number(brandId));
    if (outsiders.length) throw new AppError('Every pay run must belong to this brand', 403, 'consolidation_brand_mismatch');
  }
  const notFinalized = runs.filter((row) => row.status !== 'finalized');
  if (notFinalized.length) {
    throw new AppError(
      'Only finalized pay runs can join a consolidation; draft, paid, and voided runs cannot',
      409,
      'pay_run_not_finalized'
    );
  }
  const periods = new Set(runs.map((row) => `${dateOnly(row.period_from)}:${dateOnly(row.period_to)}`));
  if (periods.size !== 1) {
    throw new AppError('A consolidation covers one pay period; every member run must share the same period', 409, 'consolidation_period_mismatch');
  }
  const { rows: alreadyGrouped } = await client.query(
    `SELECT m.pay_run_id, c.status
       FROM restaurant_pay_run_consolidation_members m
       JOIN restaurant_pay_run_consolidations c ON c.id = m.consolidation_id
      WHERE m.pay_run_id = ANY($1::bigint[]) AND c.status <> 'voided'`,
    [ids]
  );
  if (alreadyGrouped.length) {
    throw new AppError('One or more pay runs already belong to an open consolidation', 409, 'pay_run_already_consolidated');
  }
  // Finding 8: a finalized-but-never-approved member run must not
  // ride into a consolidation and get approved as part of the group.
  // Every member needs its own second-manager approval first; the
  // approver must differ from the finalizer (the DB CHECK is the
  // second line of defense, this is the fail-closed read of it).
  const unapproved = runs.filter((row) => row.approved_by == null
    || String(row.approved_by) === String(row.finalized_by));
  if (unapproved.length) {
    throw new AppError(
      `Only individually approved pay runs can join a consolidation; pay run ${unapproved.map((row) => Number(row.id)).join(', ')} has not been approved by a second payroll manager`,
      409,
      'pay_run_not_approved'
    );
  }
  const periodFrom = dateOnly(runs[0].period_from);
  const periodTo = dateOnly(runs[0].period_to);
  const members = runs.map((row) => ({
    payRunId: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    locationIds: Array.isArray(row.location_ids) ? row.location_ids.map((id) => Number(id)) : [],
    currencyCode: row.currency_code || (row.totals && row.totals.currency) || null,
    totals: row.totals || {},
  }));
  const totals = await computeConsolidationTotals(client, { members, brandId, periodTo });
  const { rows: [created] } = await client.query(
    `INSERT INTO restaurant_pay_run_consolidations
       (brand_id, anchor_restaurant_id, period_from, period_to, status, totals, created_by)
     VALUES ($1, $2, $3::date, $4::date, 'draft', $5::jsonb, $6)
     RETURNING *`,
    [brandId, anchorId, periodFrom, periodTo, JSON.stringify(totals), actorUserId || null]
  );
  for (const member of members) {
    await client.query(
      `INSERT INTO restaurant_pay_run_consolidation_members
         (consolidation_id, pay_run_id, restaurant_id, location_ids, currency_code, totals)
       VALUES ($1, $2, $3, $4::bigint[], $5, $6::jsonb)`,
      [created.id, member.payRunId, member.restaurantId, member.locationIds, member.currencyCode, JSON.stringify(member.totals)]
    );
  }
  return created.id;
}

async function getConsolidation(client, { consolidationId, brandId = null }) {
  const id = normalizeId(consolidationId, 'consolidation');
  const params = [id];
  let brandFilter = '';
  if (brandId != null) {
    params.push(brandId);
    brandFilter = ' AND c.brand_id = $2';
  }
  const { rows: [row] } = await client.query(
    `SELECT c.* FROM restaurant_pay_run_consolidations c WHERE c.id = $1${brandFilter}`,
    params
  );
  if (!row) return null;
  const { rows: members } = await client.query(
    `SELECT m.*, pr.status AS run_status, pr.approved_by AS run_approved_by, pr.period_from, pr.period_to
       FROM restaurant_pay_run_consolidation_members m
       JOIN restaurant_pay_runs pr ON pr.id = m.pay_run_id
      WHERE m.consolidation_id = $1
      ORDER BY m.restaurant_id, m.pay_run_id`,
    [id]
  );
  return { ...row, members: members.map(memberShape) };
}

function consolidationShape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    brandId: row.brand_id == null ? null : Number(row.brand_id),
    anchorRestaurantId: Number(row.anchor_restaurant_id),
    periodFrom: dateOnly(row.period_from),
    periodTo: dateOnly(row.period_to),
    status: row.status,
    totals: row.totals || {},
    createdBy: row.created_by,
    finalizedBy: row.finalized_by || null,
    finalizedAt: row.finalized_at || null,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: (row.members || []).map((member) => (member.payRunId ? member : memberShape(member))),
  };
}

async function listConsolidations(client, { brandId = null, anchorRestaurantId = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (brandId != null) {
    params.push(brandId);
    where.push(`brand_id = $${params.length}`);
  }
  if (anchorRestaurantId != null) {
    params.push(anchorRestaurantId);
    where.push(`anchor_restaurant_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 100));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await client.query(
    `SELECT * FROM restaurant_pay_run_consolidations
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY period_from DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map((row) => consolidationShape(row));
}

// Finding 8: the join-time check is not enough on its own — a member
// run's approval is never revoked, but the finalize/approve steps
// re-verify it anyway so a consolidation can never finalize or
// approve over a member that was never individually approved.
function assertMembersApproved(members) {
  const unapproved = (members || []).filter((member) => member.approvedBy == null);
  if (unapproved.length) {
    throw new AppError(
      `Only individually approved pay runs can join a consolidation; pay run ${unapproved.map((member) => Number(member.payRunId)).join(', ')} has not been approved by a second payroll manager`,
      409,
      'pay_run_not_approved'
    );
  }
}

// Maker step: finalize the draft. Every member run must still be
// finalized — a member voided after joining blocks the group.
async function finalizeConsolidation(client, { consolidationId, actorUserId }) {
  const id = normalizeId(consolidationId, 'consolidation');
  const { rows: [existing] } = await client.query(
    'SELECT * FROM restaurant_pay_run_consolidations WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!existing) throw new AppError('Consolidation not found', 404, 'consolidation_not_found');
  if (existing.status !== 'draft') throw new AppError('Only draft consolidations can be finalized', 409, 'consolidation_not_draft');
  const current = await getConsolidation(client, { consolidationId: id });
  const broken = current.members.filter((member) => member.status !== 'finalized');
  if (broken.length) {
    throw new AppError('A member pay run is no longer finalized; remove it or wait for it to finalize again', 409, 'consolidation_member_not_finalized');
  }
  assertMembersApproved(current.members);
  const totals = await computeConsolidationTotals(client, {
    members: current.members,
    brandId: existing.brand_id,
    periodTo: dateOnly(existing.period_to),
  });
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_pay_run_consolidations
        SET status = 'finalized', totals = $1::jsonb,
            finalized_by = $2, finalized_at = NOW(), updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [JSON.stringify(totals), actorUserId, id]
  );
  return { ...updated, members: current.members };
}

// Checker step: a second, distinct payroll manager approves. The
// maker can never approve their own consolidation; the DB CHECK is
// the second line of defense.
async function approveConsolidation(client, { consolidationId, actorUserId }) {
  const id = normalizeId(consolidationId, 'consolidation');
  const { rows: [existing] } = await client.query(
    'SELECT * FROM restaurant_pay_run_consolidations WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!existing) throw new AppError('Consolidation not found', 404, 'consolidation_not_found');
  if (existing.status !== 'finalized') throw new AppError('Only finalized consolidations can be approved', 409, 'consolidation_not_finalized');
  if (existing.approved_by) throw new AppError('This consolidation is already approved', 409, 'consolidation_already_approved');
  if (String(existing.finalized_by) === String(actorUserId)) {
    throw new AppError(
      'The user who finalized a consolidation cannot approve it; a different payroll manager must approve',
      403,
      'consolidation_self_approval'
    );
  }
  const current = await getConsolidation(client, { consolidationId: id });
  assertMembersApproved(current.members);
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_pay_run_consolidations
        SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, actorUserId]
  );
  const after = await getConsolidation(client, { consolidationId: id });
  return { ...updated, members: after.members };
}

// Voiding dissolves the group; the member runs are untouched and
// keep their own finalized status, so a voided consolidation never
// erases payroll history.
async function voidConsolidation(client, { consolidationId }) {
  const id = normalizeId(consolidationId, 'consolidation');
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_pay_run_consolidations
        SET status = 'voided', updated_at = NOW()
      WHERE id = $1 AND status <> 'voided'
      RETURNING *`,
    [id]
  );
  if (!updated) {
    const { rows: [existing] } = await client.query(
      'SELECT id FROM restaurant_pay_run_consolidations WHERE id = $1',
      [id]
    );
    if (!existing) throw new AppError('Consolidation not found', 404, 'consolidation_not_found');
    throw new AppError('This consolidation is already voided', 409, 'consolidation_already_voided');
  }
  const current = await getConsolidation(client, { consolidationId: id });
  return { ...updated, members: current.members };
}

module.exports = {
  listBrandPayRuns,
  computeConsolidationTotals,
  createConsolidation,
  getConsolidation,
  listConsolidations,
  finalizeConsolidation,
  approveConsolidation,
  voidConsolidation,
  consolidationShape,
  memberAttribution,
};
