'use strict';

// Design-review fix run, items 45 / 58 (goal goal_a0fc7c0f0394).
//
// Item 45: a store-scoped shared-roster read must not leak other
// stores' shifts or approved borrows.
// Item 58: a labor borrow may span midnight like a shift (end <=
// start ends the next morning; end == start is a 24h borrow), and
// the conflict check must be overnight-aware in both directions.
//
// Service-level, inside one rolled-back transaction, so no fixture
// rows survive.
//
// DB: disposable credit_statement_test only; the suite skips otherwise.
//
// Run with:
//   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
//     npx jest __tests__/restaurantLaborBorrowFixes.db.test.js

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Borrow-fix fixtures require the disposable statement test database');
  }
  process.env.DATABASE_URL = url;
}
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const db = require('../db');
const borrows = require('../services/restaurantLaborBorrowService');
const { validateShift } = require('../services/shiftConflictValidation');

const describeDb = url ? describe : describe.skip;
const TAG = 'BorrowFixTest';

describeDb('labor borrow fixes (items 45, 58)', () => {
  let client;
  let ownerId;
  let checkerId;
  let workerId;
  let worker2Id;
  let businessId;
  let restaurantId;
  let storeA1;
  let storeA2;
  let storeA3;

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerId = crypto.randomUUID();
    checkerId = crypto.randomUUID();
    workerId = crypto.randomUUID();
    worker2Id = crypto.randomUUID();
    for (const [id, email] of [
      [ownerId, `bf-owner-${ownerId.slice(0, 8)}@example.invalid`],
      [checkerId, `bf-checker-${checkerId.slice(0, 8)}@example.invalid`],
      [workerId, `bf-worker-${workerId.slice(0, 8)}@example.invalid`],
      [worker2Id, `bf-worker2-${worker2Id.slice(0, 8)}@example.invalid`],
    ]) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'BorrowFix', 'User', 'customer', TRUE, TRUE)`,
        [id, email]
      );
    }
    businessId = (await client.query(
      `INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`,
      [`${TAG} Biz`, ownerId]
    )).rows[0].id;
    restaurantId = (await client.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [businessId, ownerId, `${TAG} Diner`]
    )).rows[0].id;
    const storesOf = async () =>
      (await client.query(
        'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
        [restaurantId]
      )).rows.map((row) => Number(row.id));
    [storeA1] = await storesOf();
    await client.query(
      `UPDATE restaurant_locations SET currency_code = 'USD', is_primary = TRUE WHERE id = $1`,
      [storeA1]
    );
    storeA2 = Number((await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code)
       VALUES ($1, $2, 'America/New_York', 'USD') RETURNING id`,
      [restaurantId, `${TAG} Second Store`]
    )).rows[0].id);
    storeA3 = Number((await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code)
       VALUES ($1, $2, 'America/New_York', 'USD') RETURNING id`,
      [restaurantId, `${TAG} Third Store`]
    )).rows[0].id);
    // Worker: one membership, assigned to A1 and A2. Worker2: one
    // membership, assigned to A2 only. (business_members is unique
    // per business+member; extra stores attach via location rows.)
    const addMember = async (userId, locationIds) => {
      const { rows: [membership] } = await client.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
         VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
        [businessId, ownerId, userId, `bf-${userId.slice(0, 8)}@example.invalid`]
      );
      for (const locationId of locationIds) {
        await client.query(
          `INSERT INTO restaurant_location_memberships (membership_id, restaurant_id, location_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [membership.id, restaurantId, locationId]
        );
      }
    };
    await addMember(workerId, [storeA1, storeA2]);
    await addMember(worker2Id, [storeA2]);

    const addShift = async (userId, locationId, date, start, end) =>
      client.query(
        `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, location_id)
         VALUES ($1, $2, $3::date, $4::time, $5::time, 'Server', $6)`,
        [businessId, userId, date, start, end, locationId]
      );
    // Roster day (2026-10-20): the worker has a shift at each store,
    // plus a legacy shift with no location at all.
    await addShift(workerId, storeA1, '2026-10-20', '09:00', '13:00');
    await addShift(workerId, storeA2, '2026-10-20', '14:00', '18:00');
    await addShift(workerId, storeA3, '2026-10-20', '19:00', '21:00');
    await client.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label)
       VALUES ($1, $2, '2026-10-20'::date, '07:00'::time, '08:00'::time, 'Server')`,
      [businessId, workerId]
    );
    await addShift(worker2Id, storeA2, '2026-10-20', '09:00', '13:00');
    // Approved borrow that touches neither A1 endpoint: home A2, borrow A3.
    const requested = await borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: workerId,
      homeLocationId: storeA2, borrowLocationId: storeA3,
      shiftDate: '2026-10-20', startTime: '22:00', endTime: '23:00',
      requestedBy: ownerId,
    });
    await borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId, businessId,
      status: 'approved', reviewerUserId: checkerId,
    });
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.end();
  });

  // ── Item 45 ────────────────────────────────────────────────────

  test('store-scoped roster shows only that store shifts and borrows', async () => {
    const roster = await borrows.getSharedRoster(client, {
      restaurantId, businessId, locationIds: [storeA1], from: '2026-10-20', to: '2026-10-20',
    });
    // Worker2 is not a member of A1, so they are not listed at all.
    expect(roster.staff.map((entry) => entry.userId)).toEqual([workerId]);
    const worker = roster.staff[0];
    // Only the A1 shift: the A2/A3 shifts and the unlocated legacy
    // shift must not leak to a caller scoped to A1.
    expect(worker.shifts).toEqual([{
      shiftDate: '2026-10-20', startTime: '09:00', endTime: '13:00', roleLabel: 'Server',
    }]);
    // The approved A2 -> A3 borrow touches no visible store.
    expect(worker.approvedBorrows).toEqual([]);
  });

  test('unscoped roster is still bounded by the members home stores', async () => {
    const roster = await borrows.getSharedRoster(client, {
      restaurantId, businessId, locationIds: null, from: '2026-10-20', to: '2026-10-20',
    });
    const worker = roster.staff.find((entry) => entry.userId === workerId);
    // Homes are A1 and A2: the A3 shift and the unlocated legacy
    // shift stay out even for an all-locations caller.
    expect(worker.shifts.map((shift) => shift.startTime)).toEqual(['09:00', '14:00']);
    // The A2 -> A3 borrow involves a home store (A2), so it shows.
    expect(worker.approvedBorrows).toHaveLength(1);
    expect(worker.approvedBorrows[0].borrowLocationId).toBe(storeA3);
    const worker2 = roster.staff.find((entry) => entry.userId === worker2Id);
    expect(worker2.shifts).toHaveLength(1);
    expect(worker2.shifts[0].startTime).toBe('09:00');
  });

  // ── Item 58 ────────────────────────────────────────────────────

  test('an overnight borrow is accepted', async () => {
    const requested = await borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: workerId,
      homeLocationId: storeA1, borrowLocationId: storeA2,
      shiftDate: '2026-10-21', startTime: '22:00', endTime: '06:00',
      requestedBy: ownerId,
    });
    expect(requested.status).toBe('requested');
    const approved = await borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId, businessId,
      status: 'approved', reviewerUserId: checkerId,
    });
    expect(approved.status).toBe('approved');
  });

  test('an overnight borrow conflicts with a shift the next morning', async () => {
    await client.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, location_id)
       VALUES ($1, $2, '2026-10-22'::date, '05:00'::time, '09:00'::time, 'Server', $3)`,
      [businessId, worker2Id, storeA2]
    );
    await expect(borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: worker2Id,
      homeLocationId: storeA2, borrowLocationId: storeA1,
      shiftDate: '2026-10-21', startTime: '22:00', endTime: '06:00',
      requestedBy: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_shift_conflict' });
  });

  test('approval re-checks an overnight borrow against a later shift', async () => {
    const requested = await borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: worker2Id,
      homeLocationId: storeA2, borrowLocationId: storeA1,
      shiftDate: '2026-10-23', startTime: '22:00', endTime: '06:00',
      requestedBy: ownerId,
    });
    await client.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, location_id)
       VALUES ($1, $2, '2026-10-24'::date, '05:00'::time, '09:00'::time, 'Server', $3)`,
      [businessId, worker2Id, storeA2]
    );
    await expect(borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId, businessId,
      status: 'approved', reviewerUserId: checkerId,
    })).rejects.toMatchObject({ code: 'borrow_shift_conflict' });
  });

  test('a daytime borrow is not blocked by an overnight shift ending before it', async () => {
    await client.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, location_id)
       VALUES ($1, $2, '2026-10-23'::date, '22:00'::time, '06:00'::time, 'Server', $3)`,
      [businessId, worker2Id, storeA2]
    );
    // Abuts the 05:00-09:00 shift from the previous test (ends 09:00)
    // and starts after the overnight shift ends at 06:00: no overlap.
    const requested = await borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: worker2Id,
      homeLocationId: storeA2, borrowLocationId: storeA1,
      shiftDate: '2026-10-24', startTime: '09:00', endTime: '13:00',
      requestedBy: ownerId,
    });
    expect(requested.status).toBe('requested');
    // But a borrow inside the overnight shift's tail does conflict.
    await expect(borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: worker2Id,
      homeLocationId: storeA2, borrowLocationId: storeA1,
      shiftDate: '2026-10-24', startTime: '05:30', endTime: '06:30',
      requestedBy: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_shift_conflict' });
  });

  test('end == start is a 24h borrow, like a 24h shift', async () => {
    const requested = await borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: workerId,
      homeLocationId: storeA1, borrowLocationId: storeA2,
      shiftDate: '2026-10-26', startTime: '09:00', endTime: '09:00',
      requestedBy: ownerId,
    });
    await borrows.reviewBorrow(client, {
      borrowId: Number(requested.id), restaurantId, businessId,
      status: 'approved', reviewerUserId: checkerId,
    });
    // Inside the 24h span, same day and the next morning.
    await expect(borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: workerId,
      homeLocationId: storeA1, borrowLocationId: storeA2,
      shiftDate: '2026-10-26', startTime: '12:00', endTime: '13:00',
      requestedBy: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_overlap' });
    await expect(borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: workerId,
      homeLocationId: storeA1, borrowLocationId: storeA2,
      shiftDate: '2026-10-27', startTime: '08:00', endTime: '09:00',
      requestedBy: ownerId,
    })).rejects.toMatchObject({ code: 'borrow_overlap' });
    // Abutting the 24h end (09:00 next day) does not overlap.
    const abutting = await borrows.requestBorrow(client, {
      restaurantId, businessId, staffUserId: workerId,
      homeLocationId: storeA1, borrowLocationId: storeA2,
      shiftDate: '2026-10-27', startTime: '09:00', endTime: '10:00',
      requestedBy: ownerId,
    });
    expect(abutting.status).toBe('requested');
  });

  test('validateShift sees a previous-day overnight borrow', async () => {
    // The approved overnight borrow from the first item-58 test runs
    // 2026-10-21 22:00 to 2026-10-22 06:00.
    const { violations } = await validateShift(client, {
      businessId, userId: workerId, shiftDate: '2026-10-22',
      startTime: '05:00', endTime: '09:00', restaurantId,
    });
    expect(violations.map((v) => v.code)).toContain('borrow_overlap');
    const later = await validateShift(client, {
      businessId, userId: workerId, shiftDate: '2026-10-22',
      startTime: '09:00', endTime: '13:00', restaurantId,
    });
    expect(later.violations.map((v) => v.code)).not.toContain('borrow_overlap');
  });
});
