'use strict';

// Phase 8 Track D — inter-store labor borrowing / shared-roster
// scheduling (baseline gap 18: "no inter-store labor borrowing /
// shared-roster scheduling across locations").
//
// A borrow is one worker's shift at another store of the same
// restaurant: requested, then approved or declined by a different
// manager, then completed or cancelled. Approval re-checks the
// conflict the request checked (Phase 4 conflict validation, same
// rule: no overlapping shift for that worker on that day), so a
// shift published between request and approval still blocks the
// borrow instead of double-booking the worker.
//
// Borrowing moves no money and changes no pay rate: the hours are
// still the worker's hours, priced by the store where they were
// worked (computeLabor attributes by store). The shared-roster read
// is the scheduling surface: each worker's home store, their shifts
// in the window, and their approved borrows.

const AppError = require('../utils/appError');

function normalizeId(value, field = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(`A valid ${field} is required`, 400, 'validation_failed');
  return id;
}

function dateOnly(value, field = 'date') {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new AppError(`A valid ${field} (YYYY-MM-DD) is required`, 400, 'validation_failed');
  }
  return text;
}

function timeOnly(value, field = 'time') {
  const text = String(value || '').slice(0, 8);
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text)) {
    throw new AppError(`A valid ${field} (HH:MM) is required`, 400, 'validation_failed');
  }
  return text.length === 5 ? `${text}:00` : text;
}

function borrowShape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    staffUserId: row.staff_user_id,
    staffName: row.staff_name || null,
    homeLocationId: Number(row.home_location_id),
    homeLocationName: row.home_location_name || null,
    borrowLocationId: Number(row.borrow_location_id),
    borrowLocationName: row.borrow_location_name || null,
    shiftDate: dateOnly(row.shift_date),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    roleLabel: row.role_label || null,
    status: row.status,
    requestedBy: row.requested_by,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Overlap check: an approved borrow, or a published business shift,
// for the same worker on the same day whose time window intersects
// the requested window. Abutting shifts (one ends as the other
// starts) do not overlap.
async function assertNoConflict(client, { businessId, restaurantId, staffUserId, shiftDate, startTime, endTime, excludeBorrowId = null }) {
  const params = [businessId, staffUserId, shiftDate, startTime, endTime];
  const { rows: shifts } = await client.query(
    `SELECT id FROM business_staff_shifts
      WHERE business_id = $1 AND user_id = $2 AND shift_date = $3::date
        AND start_time < $5::time AND $4::time < end_time
      LIMIT 1`,
    params
  );
  if (shifts.length) {
    throw new AppError('This worker already has a shift overlapping that time', 409, 'borrow_shift_conflict');
  }
  const borrowParams = [restaurantId, staffUserId, shiftDate, startTime, endTime];
  let exclude = '';
  if (excludeBorrowId != null) {
    borrowParams.push(excludeBorrowId);
    exclude = ` AND id <> $${borrowParams.length}`;
  }
  const { rows: borrows } = await client.query(
    `SELECT id FROM restaurant_labor_borrows
      WHERE restaurant_id = $1 AND staff_user_id = $2 AND shift_date = $3::date
        AND status = 'approved'
        AND start_time < $5::time AND $4::time < end_time${exclude}
      LIMIT 1`,
    borrowParams
  );
  if (borrows.length) {
    throw new AppError('This worker already has an approved borrow overlapping that time', 409, 'borrow_overlap');
  }
}

async function assertBorrowParties(client, { restaurantId, businessId, staffUserId, homeLocationId, borrowLocationId }) {
  const { rows: locations } = await client.query(
    `SELECT id FROM restaurant_locations
      WHERE restaurant_id = $1 AND id = ANY($2::bigint[]) AND status <> 'archived'`,
    [restaurantId, [homeLocationId, borrowLocationId]]
  );
  if (locations.length !== 2) throw new AppError('Both stores must belong to this restaurant', 404, 'location_not_found');
  if (homeLocationId === borrowLocationId) {
    throw new AppError('The home store and the borrow store must differ', 400, 'validation_failed');
  }
  // The worker must be on the team and assigned to the home store.
  const { rows: [member] } = await client.query(
    `SELECT bm.id AS membership_id
       FROM business_members bm
      WHERE bm.business_id = $1 AND bm.member_id = $2 AND bm.status = 'active'
        AND EXISTS (
          SELECT 1 FROM restaurant_location_memberships lm
           WHERE lm.membership_id = bm.id AND lm.restaurant_id = $3
             AND lm.location_id = $4 AND lm.status = 'active'
        )
      LIMIT 1`,
    [businessId, staffUserId, restaurantId, homeLocationId]
  );
  if (!member) {
    throw new AppError('This worker is not assigned to the home store', 409, 'borrow_not_home_staff');
  }
}

async function requestBorrow(client, {
  restaurantId, businessId, staffUserId, homeLocationId, borrowLocationId,
  shiftDate, startTime, endTime, roleLabel = null, requestedBy = null,
}) {
  const staff = String(staffUserId || '');
  if (!staff) throw new AppError('A staff member is required', 400, 'validation_failed');
  const home = normalizeId(homeLocationId, 'home store');
  const borrow = normalizeId(borrowLocationId, 'borrow store');
  const date = dateOnly(shiftDate, 'shift date');
  const start = timeOnly(startTime, 'start time');
  const end = timeOnly(endTime, 'end time');
  if (start >= end) throw new AppError('The borrow must end after it starts', 400, 'validation_failed');
  await assertBorrowParties(client, { restaurantId, businessId, staffUserId: staff, homeLocationId: home, borrowLocationId: borrow });
  await assertNoConflict(client, { businessId, restaurantId, staffUserId: staff, shiftDate: date, startTime: start, endTime: end });
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_labor_borrows
       (restaurant_id, staff_user_id, home_location_id, borrow_location_id,
        shift_date, start_time, end_time, role_label, status, requested_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::time, $7::time, $8, 'requested', $9)
     RETURNING *`,
    [restaurantId, staff, home, borrow, date, start, end, roleLabel ? String(roleLabel).slice(0, 100) : null, requestedBy || null]
  );
  return row;
}

async function getBorrow(client, { borrowId, restaurantId }) {
  const { rows: [row] } = await client.query(
    `SELECT b.*,
            (SELECT COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email)
               FROM users u WHERE u.id = b.staff_user_id) AS staff_name,
            (SELECT name FROM restaurant_locations WHERE id = b.home_location_id) AS home_location_name,
            (SELECT name FROM restaurant_locations WHERE id = b.borrow_location_id) AS borrow_location_name
       FROM restaurant_labor_borrows b
      WHERE b.id = $1 AND b.restaurant_id = $2`,
    [normalizeId(borrowId, 'borrow'), restaurantId]
  );
  return row || null;
}

async function listBorrows(client, { restaurantId, locationIds = null, from = null, to = null, status = null, staffUserId = null, limit = 100, offset = 0 } = {}) {
  const params = [restaurantId];
  let where = 'b.restaurant_id = $1';
  if (Array.isArray(locationIds) && locationIds.length) {
    params.push(locationIds.map((id) => Number(id)));
    where += ` AND (b.home_location_id = ANY($${params.length}::bigint[]) OR b.borrow_location_id = ANY($${params.length}::bigint[]))`;
  }
  if (from != null) {
    params.push(dateOnly(from, 'from date'));
    where += ` AND b.shift_date >= $${params.length}::date`;
  }
  if (to != null) {
    params.push(dateOnly(to, 'to date'));
    where += ` AND b.shift_date <= $${params.length}::date`;
  }
  if (status != null) {
    params.push(String(status));
    where += ` AND b.status = $${params.length}`;
  }
  if (staffUserId != null) {
    params.push(String(staffUserId));
    where += ` AND b.staff_user_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await client.query(
    `SELECT b.*,
            (SELECT COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email)
               FROM users u WHERE u.id = b.staff_user_id) AS staff_name,
            (SELECT name FROM restaurant_locations WHERE id = b.home_location_id) AS home_location_name,
            (SELECT name FROM restaurant_locations WHERE id = b.borrow_location_id) AS borrow_location_name
       FROM restaurant_labor_borrows b
      WHERE ${where}
      ORDER BY b.shift_date DESC, b.start_time, b.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(borrowShape);
}

async function reviewBorrow(client, { borrowId, restaurantId, businessId, status, reviewerUserId }) {
  const next = status === 'approved' ? 'approved' : 'declined';
  const row = await getBorrow(client, { borrowId, restaurantId });
  if (!row) throw new AppError('Borrow request not found', 404, 'borrow_not_found');
  if (row.status !== 'requested') throw new AppError('Only a requested borrow can be reviewed', 409, 'borrow_not_requested');
  if (row.requested_by && String(row.requested_by) === String(reviewerUserId)) {
    throw new AppError('The manager who requested a borrow cannot approve it', 403, 'borrow_self_approval');
  }
  if (next === 'approved') {
    // Re-check at approve time: a shift published after the request
    // still blocks the borrow instead of double-booking the worker.
    await assertNoConflict(client, {
      businessId,
      restaurantId,
      staffUserId: row.staff_user_id,
      shiftDate: dateOnly(row.shift_date),
      startTime: String(row.start_time).slice(0, 8),
      endTime: String(row.end_time).slice(0, 8),
      excludeBorrowId: Number(row.id),
    });
  }
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_labor_borrows
        SET status = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [Number(row.id), next, reviewerUserId || null]
  );
  return updated;
}

async function transitionBorrow(client, { borrowId, restaurantId, fromStatuses, toStatus, code }) {
  const row = await getBorrow(client, { borrowId, restaurantId });
  if (!row) throw new AppError('Borrow request not found', 404, 'borrow_not_found');
  if (!fromStatuses.includes(row.status)) {
    throw new AppError(`Only a ${fromStatuses.join(' or ')} borrow can move to ${toStatus}`, 409, code);
  }
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_labor_borrows
        SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [Number(row.id), toStatus]
  );
  return updated;
}

// Shared roster: every active team member with a home store, their
// published shifts in the window, and their approved borrows there.
// The read a scheduler uses to place a worker at another store.
async function getSharedRoster(client, { restaurantId, businessId, locationIds = null, from, to }) {
  const fromDate = dateOnly(from, 'from date');
  const toDate = dateOnly(to, 'to date');
  const params = [businessId, restaurantId];
  let locationFilter = '';
  if (Array.isArray(locationIds) && locationIds.length) {
    params.push(locationIds.map((id) => Number(id)));
    locationFilter = ` AND lm.location_id = ANY($${params.length}::bigint[])`;
  }
  const { rows: members } = await client.query(
    `SELECT bm.member_id AS user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                     u.email) AS name,
            lm.location_id AS home_location_id,
            loc.name AS home_location_name
       FROM business_members bm
       JOIN users u ON u.id = bm.member_id
       JOIN restaurant_location_memberships lm
         ON lm.membership_id = bm.id AND lm.restaurant_id = $2 AND lm.status = 'active'
       JOIN restaurant_locations loc ON loc.id = lm.location_id
      WHERE bm.business_id = $1 AND bm.status = 'active' AND bm.member_id IS NOT NULL${locationFilter}
      ORDER BY loc.name, name`,
    params
  );
  const userIds = members.map((row) => row.user_id);
  let shiftsByUser = new Map();
  let borrowsByUser = new Map();
  if (userIds.length) {
    const { rows: shifts } = await client.query(
      `SELECT user_id, shift_date, start_time, end_time, role_label
         FROM business_staff_shifts
        WHERE business_id = $1 AND user_id = ANY($2::uuid[])
          AND shift_date >= $3::date AND shift_date <= $4::date
        ORDER BY shift_date, start_time`,
      [businessId, userIds, fromDate, toDate]
    );
    for (const shift of shifts) {
      if (!shiftsByUser.has(shift.user_id)) shiftsByUser.set(shift.user_id, []);
      shiftsByUser.get(shift.user_id).push({
        shiftDate: dateOnly(shift.shift_date),
        startTime: String(shift.start_time).slice(0, 5),
        endTime: String(shift.end_time).slice(0, 5),
        roleLabel: shift.role_label || null,
      });
    }
    const borrows = await listBorrows(client, {
      restaurantId,
      from: fromDate,
      to: toDate,
      status: 'approved',
      limit: 500,
    });
    for (const borrow of borrows) {
      if (!borrowsByUser.has(borrow.staffUserId)) borrowsByUser.set(borrow.staffUserId, []);
      borrowsByUser.get(borrow.staffUserId).push(borrow);
    }
  }
  return {
    from: fromDate,
    to: toDate,
    staff: members.map((row) => ({
      userId: row.user_id,
      name: row.name,
      homeLocationId: Number(row.home_location_id),
      homeLocationName: row.home_location_name,
      shifts: shiftsByUser.get(row.user_id) || [],
      approvedBorrows: borrowsByUser.get(row.user_id) || [],
    })),
  };
}

module.exports = {
  requestBorrow,
  getBorrow,
  listBorrows,
  reviewBorrow,
  transitionBorrow,
  getSharedRoster,
  borrowShape,
};
