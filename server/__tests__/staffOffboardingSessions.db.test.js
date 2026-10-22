'use strict';

/**
 * DB tests: offboarding ends staff sub-sessions (auth-audit item 3).
 *
 * Before the fix, applyStaffOffboarding deactivated PINs but never touched
 * restaurant_staff_sessions, so a revoked employee's session kept stamping
 * acting_staff_user_id on POS writes until idle expiry or the 12h cap.
 * The session revocation must run inside the caller's transaction: a
 * failure rolls the whole offboarding back (fail closed).
 *
 * Run with:
 *   ST_T3_TEST_DATABASE_URL=<redacted> \
 *     npx jest __tests__/staffOffboardingSessions.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.ST_T3_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_t3';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_t3 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'test-secret-for-db-tests';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { applyStaffOffboarding } = require('../services/staffOffboarding');

jest.setTimeout(60000);

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Offboard', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `staff-offboard-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('staff offboarding ends sub-sessions (auth-audit item 3)', () => {
  let F = {};

  async function openSession(userId, { restaurantId, pinId, ended = false } = {}) {
    const tokenHash = crypto.createHash('sha256').update(`session-${crypto.randomUUID()}`).digest('hex');
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_staff_sessions
         (restaurant_id, device_id, staff_pin_id, staff_user_id, token_hash, created_by, expires_at, ended_at, end_reason)
       VALUES ($1, NULL, $2, $3, $4, $3, NOW() + INTERVAL '1 hour',
               ${ended ? "NOW() - INTERVAL '1 hour'" : 'NULL'}, ${ended ? "'manual_lock'" : 'NULL'})
       RETURNING id`,
      [restaurantId || F.restaurantId, pinId || F.pinId, userId, tokenHash]
    );
    return Number(row.id);
  }

  beforeAll(async () => {
    const owner = await newUser('owner');
    const departed = await newUser('departed');
    const departed2 = await newUser('departed2');
    const other = await newUser('other');

    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Offboard Sessions ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Offboard Diner', ['pickup']]
    );
    // A second business: its restaurants must be untouched by this offboarding.
    const { rows: [otherBiz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [other, `Other Biz ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [otherRest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [otherBiz.id, other, 'Other Diner', ['pickup']]
    );

    const { rows: [pin] } = await pool.query(
      `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, staff_label, pin_hash, is_active)
       VALUES ($1, $2, 'Departed', 'x', TRUE) RETURNING id`,
      [rest.id, departed]
    );
    const { rows: [pin2] } = await pool.query(
      `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, staff_label, pin_hash, is_active)
       VALUES ($1, $2, 'Departed2', 'x', TRUE) RETURNING id`,
      [rest.id, departed2]
    );
    const { rows: [otherPin] } = await pool.query(
      `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, staff_label, pin_hash, is_active)
       VALUES ($1, $2, 'Other', 'x', TRUE) RETURNING id`,
      [otherRest.id, departed]
    );

    const openSessionId = await openSession(departed, { restaurantId: Number(rest.id), pinId: Number(pin.id) });
    const alreadyEndedId = await openSession(departed, { restaurantId: Number(rest.id), pinId: Number(pin.id), ended: true });
    const rollbackSessionId = await openSession(departed2, { restaurantId: Number(rest.id), pinId: Number(pin2.id) });
    const otherBusinessSessionId = await openSession(departed, {
      restaurantId: Number(otherRest.id),
      pinId: Number(otherPin.id),
    });

    F = {
      owner, departed, departed2,
      businessId: Number(biz.id),
      restaurantId: Number(rest.id),
      pinId: Number(pin.id),
      openSessionId, alreadyEndedId, rollbackSessionId, otherBusinessSessionId,
    };
  });

  afterAll(async () => { await pool.end(); });

  test('offboarding ends open sub-sessions with reason offboarded', async () => {
    const result = await withTransaction(pool, (client) =>
      applyStaffOffboarding(client, { businessId: F.businessId, userId: F.departed, reason: 'test' })
    );
    expect(result.sessionsEnded).toBe(1);
    expect(result.pinsDeactivated).toBe(1);

    const { rows: [session] } = await pool.query(
      'SELECT ended_at, end_reason FROM restaurant_staff_sessions WHERE id = $1',
      [F.openSessionId]
    );
    expect(session.ended_at).toBeTruthy();
    expect(session.end_reason).toBe('offboarded');
  });

  test('already-ended sessions keep their original end state', async () => {
    const { rows: [session] } = await pool.query(
      'SELECT ended_at, end_reason FROM restaurant_staff_sessions WHERE id = $1',
      [F.alreadyEndedId]
    );
    expect(session.ended_at).toBeTruthy();
    expect(session.end_reason).toBe('manual_lock');
  });

  test("sessions at other businesses' restaurants are untouched", async () => {
    const { rows: [session] } = await pool.query(
      'SELECT ended_at FROM restaurant_staff_sessions WHERE id = $1',
      [F.otherBusinessSessionId]
    );
    expect(session.ended_at).toBeNull();
  });

  test('a failure rolls the session revocation back with the transaction', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await applyStaffOffboarding(client, { businessId: F.businessId, userId: F.departed2, reason: 'test' });
        throw new Error('simulated downstream failure');
      })
    ).rejects.toThrow('simulated downstream failure');

    const { rows: [session] } = await pool.query(
      'SELECT ended_at FROM restaurant_staff_sessions WHERE id = $1',
      [F.rollbackSessionId]
    );
    expect(session.ended_at).toBeNull();

    const { rows: [pinRow] } = await pool.query(
      'SELECT is_active FROM restaurant_staff_pins WHERE staff_user_id = $1',
      [F.departed2]
    );
    expect(pinRow.is_active).toBe(true);
  });
});
