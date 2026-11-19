'use strict';

// PR #804 Track C — G-14: business booking mutations (accept / decline /
// counter-propose / cancel) require the business owner, a manager, or a
// member holding bookings.manage. Representatives keep read + message
// (isProviderForBooking) but cannot act.
//
// DB-backed; runs against the track-C database only
// (STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c).

const crypto = require('crypto');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('pr804TrackCBookingManager requires STATEMENT_TEST_DATABASE_URL for credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const db = require('../db');
const lifecycle = require('../services/bookingRequestLifecycle');

const ownerId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const repId = '44444444-4444-4444-8444-444444444444';
const repManagerId = '55555555-5555-4555-8555-555555555555';
const helperId = '77777777-7777-4777-8777-777777777777';
const customerId = '88888888-8888-4888-8888-888888888888';
const bizSuffix = crypto.randomBytes(4).toString('hex');
let bizId;
let businessBooking;
let helperBooking;

async function seedUser(id, email) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name)
     VALUES ($1, $2, 'x', 'Test', 'User') ON CONFLICT (id) DO NOTHING`,
    [id, email],
  );
}

describe('G-14 business booking manager gate (PR #804 track C)', () => {
  beforeAll(async () => {
    for (const [id, email] of [
      [ownerId, `pr804c-bk-owner-${bizSuffix}@example.test`],
      [managerId, `pr804c-bk-manager-${bizSuffix}@example.test`],
      [repId, `pr804c-bk-rep-${bizSuffix}@example.test`],
      [repManagerId, `pr804c-bk-repmgr-${bizSuffix}@example.test`],
      [helperId, `pr804c-bk-helper-${bizSuffix}@example.test`],
      [customerId, `pr804c-bk-customer-${bizSuffix}@example.test`],
    ]) await seedUser(id, email);

    const { rows } = await db.query(
      `INSERT INTO businesses (business_name, user_id, is_active)
       VALUES ($1, $2, TRUE) RETURNING id`,
      [`PR804C Booking Biz ${bizSuffix}`, ownerId],
    );
    bizId = rows[0].id;
    const addMember = async (memberId, role) => {
      const m = await db.query(
        `INSERT INTO business_members (business_id, member_id, owner_id, role, invite_email, status)
         VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
        [bizId, memberId, ownerId, role, `${role}-${memberId.slice(0, 8)}-${bizSuffix}@example.test`],
      );
      return m.rows[0].id;
    };
    await addMember(managerId, 'manager');
    await addMember(repId, 'representative');
    const repMgrMembershipId = await addMember(repManagerId, 'representative');
    // Representative explicitly granted bookings.manage.
    await db.query(
      `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
       SELECT $1, p.id, 'allow' FROM team_permissions p WHERE p.code = 'bookings.manage'
       ON CONFLICT DO NOTHING`,
      [repMgrMembershipId],
    );

    const biz = await db.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, business_id, service_name, requested_date, status)
       VALUES ($1, $2, $3, 'Deep clean', CURRENT_DATE + 1, 'pending') RETURNING *`,
      [customerId, helperId, bizId],
    );
    businessBooking = biz.rows[0];
    const helper = await db.query(
      `INSERT INTO booking_requests
         (customer_id, helper_id, service_name, requested_date, status)
       VALUES ($1, $2, 'Fix sink', CURRENT_DATE + 1, 'pending') RETURNING *`,
      [customerId, helperId],
    );
    helperBooking = helper.rows[0];
  });

  afterAll(async () => {
    const clean = async (sql, params) => { try { await db.query(sql, params); } catch (_) {} };
    await clean('DELETE FROM booking_requests WHERE business_id = $1', [bizId]);
    await clean('DELETE FROM booking_requests WHERE id = $1', [helperBooking.id]);
    await clean(`DELETE FROM membership_permission_overrides mpo
                  USING business_members bm
                 WHERE mpo.membership_id = bm.id AND bm.business_id = $1`, [bizId]);
    await clean('DELETE FROM business_members WHERE business_id = $1', [bizId]);
    await clean('DELETE FROM businesses WHERE id = $1', [bizId]);
    await clean('DELETE FROM users WHERE id = ANY($1::uuid[])',
      [[ownerId, managerId, repId, repManagerId, helperId, customerId]]);
    await db.end();
  });

  test('owner and manager may act on a business booking', async () => {
    expect(await lifecycle.isBookingManagerForBooking(ownerId, businessBooking)).toBe(true);
    expect(await lifecycle.isBookingManagerForBooking(managerId, businessBooking)).toBe(true);
  });

  test('representative may NOT act on a business booking, but may still read it', async () => {
    expect(await lifecycle.isBookingManagerForBooking(repId, businessBooking)).toBe(false);
    expect(await lifecycle.isProviderForBooking(repId, businessBooking)).toBe(true);
  });

  test('representative with a bookings.manage override may act', async () => {
    expect(await lifecycle.isBookingManagerForBooking(repManagerId, businessBooking)).toBe(true);
  });

  test('helper still manages their own non-business booking', async () => {
    expect(await lifecycle.isBookingManagerForBooking(helperId, helperBooking)).toBe(true);
    expect(await lifecycle.isBookingManagerForBooking(ownerId, helperBooking)).toBe(false);
  });
});
