'use strict';

// PR #804 Track C — G-18 migration check (real schema): the 'draft' payout
// status is accepted by the status CHECK, the confirmation columns exist,
// and confirmDraftPayout moves a draft to requested for the owner only.
//
// DB-backed; runs against the track-C database only
// (STATEMENT_TEST_DATABASE_URL must point at credit_statement_test_pr804_c).

const crypto = require('crypto');

const TEST_DB_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
if (!TEST_DB_URL.includes('/credit_statement_test_pr804_c')) {
  throw new Error('pr804TrackCRestaurantPayoutDraftDb requires STATEMENT_TEST_DATABASE_URL for credit_statement_test_pr804_c');
}
process.env.DATABASE_URL = TEST_DB_URL;

jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const payoutService = require('../services/restaurantPayoutService');

const ownerId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const bizSuffix = crypto.randomBytes(4).toString('hex');
let bizId;
let restaurantId;
let draftId;

async function seedUser(id, email) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name)
     VALUES ($1, $2, 'x', 'Test', 'User') ON CONFLICT (id) DO NOTHING`,
    [id, email],
  );
}

describe('G-18 payout draft migration (PR #804 track C)', () => {
  beforeAll(async () => {
    await seedUser(ownerId, `pr804c-pod-owner-${bizSuffix}@example.test`);
    await seedUser(managerId, `pr804c-pod-manager-${bizSuffix}@example.test`);
    const { rows: bizRows } = await db.query(
      `INSERT INTO businesses (business_name, user_id, is_active)
       VALUES ($1, $2, TRUE) RETURNING id`,
      [`PR804C Payout Draft Biz ${bizSuffix}`, ownerId],
    );
    bizId = bizRows[0].id;
    await db.query(
      `INSERT INTO business_members (business_id, member_id, owner_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active')`,
      [bizId, managerId, ownerId, `manager-${bizSuffix}@example.test`],
    );
    const { rows: restRows } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status, currency_code)
       VALUES ($1, $2, $3, 'active', 'USD') RETURNING id`,
      [bizId, ownerId, `PR804C Draft Diner ${bizSuffix}`],
    );
    restaurantId = restRows[0].id;
    await db.query(
      `INSERT INTO restaurant_connect_accounts (restaurant_id, stripe_account_id, payouts_enabled)
       VALUES ($1, 'acct_test_pr804c', TRUE)`,
      [restaurantId],
    );
  });

  afterAll(async () => {
    const clean = async (sql, params) => { try { await db.query(sql, params); } catch (_) {} };
    await clean('DELETE FROM restaurant_payouts WHERE restaurant_id = $1', [restaurantId]);
    await clean('DELETE FROM restaurant_connect_accounts WHERE restaurant_id = $1', [restaurantId]);
    await clean('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]);
    await clean('DELETE FROM business_members WHERE business_id = $1', [bizId]);
    await clean('DELETE FROM businesses WHERE id = $1', [bizId]);
    await clean('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, managerId]]);
    await db.end();
  });

  test('a draft row can be stored and confirmed by the owner', async () => {
    const { rows } = await db.query(
      `INSERT INTO restaurant_payouts
         (restaurant_id, currency_code, amount_cents, stripe_account_id,
          idempotency_key, requested_by, status)
       VALUES ($1, 'USD', 5000, 'acct_test_pr804c', $2, $3, 'draft')
       RETURNING *`,
      [restaurantId, `pr804c-draft-${bizSuffix}`, managerId],
    );
    draftId = rows[0].id;
    expect(rows[0].status).toBe('draft');
    expect(rows[0].confirmed_by_user_id).toBeNull();

    // A manager cannot confirm their own draft.
    await expect(payoutService.confirmDraftPayout({
      restaurantId, userId: managerId, payoutId: draftId,
    })).rejects.toThrow();

    const confirmed = await payoutService.confirmDraftPayout({
      restaurantId, userId: ownerId, payoutId: draftId,
    });
    expect(confirmed.status).toBe('requested');
    expect(String(confirmed.confirmed_by_user_id)).toBe(ownerId);
    expect(confirmed.confirmed_at).not.toBeNull();
  });
});
