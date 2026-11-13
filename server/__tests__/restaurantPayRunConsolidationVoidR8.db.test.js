'use strict';

/**
 * DB test: money-flows audit R8 (2026-11-07) — voiding a
 * consolidation is single-step with no dual control, unlike voiding
 * a pay run.
 *
 * Repro: an HQ-approved consolidation must not dissolve under one
 * manager. Voiding is a maker-checker flow mirroring the pay-run
 * void (migration 20261107015646): the requester records the void
 * request, a different approver who also differs from the finalizer
 * completes it, and the DB CHECK is the second line of defense. A
 * draft consolidation still voids in one step.
 *
 * Run with:
 *   DATABASE_URL=STATEMENT_TEST_DATABASE_URL=STATEMENT_JOB_TEST_DATABASE_URL=STATEMENT_INVESTIGATION_TEST_DATABASE_URL=ADMIN_GRANT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantPayRunConsolidationVoidR8.db.test.js --runInBand --forceExit
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchCloseoutBatchLimit.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = process.env.STATEMENT_TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const consolidations = require('../services/restaurantPayRunConsolidationService');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Consol', $3, 'customer', TRUE, TRUE)`,
    [id, `r8-${label}-${id}@example.invalid`, label]
  );
  return id;
}

ddescribe('Money flows R8: consolidation void is dual-controlled', () => {
  let anchorRestaurantId;
  let finalizerId;
  let approverId;
  let requesterId;

  beforeAll(async () => {
    const owner = await newUser(`owner-${RUN}`);
    finalizerId = await newUser(`finalizer-${RUN}`);
    approverId = await newUser(`approver-${RUN}`);
    requesterId = await newUser(`requester-${RUN}`);
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `R8 Bistro ${RUN}`, 'UTC']
    );
    const { rows: [r] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [Number(b.id), owner, `R8 Bistro ${RUN}`]
    );
    anchorRestaurantId = Number(r.id);
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function mkConsolidation(status, { finalizedBy = null, approvedBy = null } = {}) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_pay_run_consolidations
         (brand_id, anchor_restaurant_id, period_from, period_to, status, totals,
          created_by, finalized_by, finalized_at, approved_by, approved_at)
       VALUES (NULL, $1, '2026-11-02'::date, '2026-11-07'::date, $2, '{}'::jsonb,
          $3, $4, NOW(), $5, NOW())
       RETURNING id`,
      [anchorRestaurantId, status, finalizerId, finalizedBy, approvedBy]
    );
    return Number(row.id);
  }

  test('a single manager cannot void an HQ-approved consolidation; a different approver can complete it', async () => {
    const id = await mkConsolidation('approved', { finalizedBy: finalizerId, approvedBy: approverId });
    // Maker step: the request records the requester; the group stays approved.
    const requested = await consolidations.voidConsolidation(pool, {
      consolidationId: id, actorUserId: requesterId,
    });
    expect(requested.status).toBe('approved');
    expect(requested.requested).toBe(true);
    expect(requested.void_requested_by).toBe(requesterId);
    // The requester cannot approve their own void.
    await expect(consolidations.approveVoidConsolidation(pool, {
      consolidationId: id, actorUserId: requesterId,
    })).rejects.toMatchObject({ code: 'consolidation_void_self_approval' });
    // The finalizer cannot approve the void either.
    await expect(consolidations.approveVoidConsolidation(pool, {
      consolidationId: id, actorUserId: finalizerId,
    })).rejects.toMatchObject({ code: 'consolidation_void_finalizer_approval' });
    // A different approver completes it.
    const voided = await consolidations.approveVoidConsolidation(pool, {
      consolidationId: id, actorUserId: approverId,
    });
    expect(voided.status).toBe('voided');
    expect(voided.void_requested_by).toBe(requesterId);
    expect(voided.void_approved_by).toBe(approverId);
    const { rows: [row] } = await pool.query(
      'SELECT status, void_requested_by, void_approved_by FROM restaurant_pay_run_consolidations WHERE id = $1',
      [id]
    );
    expect(row.status).toBe('voided');
    expect(row.void_requested_by).toBe(requesterId);
    expect(row.void_approved_by).toBe(approverId);
  });

  test('a draft consolidation still voids in one step', async () => {
    const id = await mkConsolidation('draft');
    const voided = await consolidations.voidConsolidation(pool, {
      consolidationId: id, actorUserId: requesterId,
    });
    expect(voided.status).toBe('voided');
    expect(voided.requested).toBe(false);
    expect(voided.void_requested_by).toBeNull();
  });

  test('a second void request is rejected and approve without a request is rejected', async () => {
    const id = await mkConsolidation('finalized', { finalizedBy: finalizerId });
    await expect(consolidations.approveVoidConsolidation(pool, {
      consolidationId: id, actorUserId: approverId,
    })).rejects.toMatchObject({ code: 'consolidation_void_not_requested' });
    await consolidations.voidConsolidation(pool, {
      consolidationId: id, actorUserId: requesterId,
    });
    await expect(consolidations.voidConsolidation(pool, {
      consolidationId: id, actorUserId: approverId,
    })).rejects.toMatchObject({ code: 'consolidation_void_already_requested' });
  });

  test('the DB CHECK rejects a void approver equal to the requester or the finalizer', async () => {
    const id = await mkConsolidation('finalized', { finalizedBy: finalizerId });
    await consolidations.voidConsolidation(pool, {
      consolidationId: id, actorUserId: requesterId,
    });
    await expect(pool.query(
      `UPDATE restaurant_pay_run_consolidations
          SET void_approved_by = void_requested_by, void_approved_at = NOW()
        WHERE id = $1`,
      [id]
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      `UPDATE restaurant_pay_run_consolidations
          SET void_approved_by = finalized_by, void_approved_at = NOW()
        WHERE id = $1`,
      [id]
    )).rejects.toMatchObject({ code: '23514' });
  });
});
