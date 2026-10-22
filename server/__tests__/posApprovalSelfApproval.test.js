'use strict';

/**
 * POS approval dual-control records (auth-audit findings 26 and 39).
 *
 * Finding 26: consumeManagerApproval returned null for manager actors with
 * no approval row — the highest-privilege money actions left no
 * dual-control record. Manager actors now get a 'self_approved' row
 * (approver_user_id = the actor) on the caller's transaction.
 *
 * Finding 39: linkApproval now also transitions void and discount approvals
 * to 'consumed' (and can record the order link), so a completed approval is
 * distinguishable from a mid-flight one.
 */

const { resetMocks } = require('./setup');

jest.mock('../services/permissionsService', () => {
  const actual = jest.requireActual('../services/permissionsService');
  return { ...actual, hasRestaurantPermission: jest.fn() };
});
const permissionsService = require('../services/permissionsService');

const {
  consumeManagerApproval,
  linkApproval,
} = require('../services/restaurantStaffIdentityService');

const RESTAURANT = { id: 42, business_id: 7, settings: {} };

function fakeClient(insertRow) {
  return { query: jest.fn().mockResolvedValue({ rows: insertRow ? [insertRow] : [] }) };
}

function managerReq() {
  return { user: { id: 'manager-1' }, body: { reasonCode: 'spoilage', reason: 'spoiled milk' } };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 26: manager self-approvals write a row', () => {
  test('a manager actor gets a self_approved row, not null', async () => {
    permissionsService.hasRestaurantPermission.mockResolvedValue(true);
    const inserted = { id: 99, status: 'self_approved', approver_user_id: 'manager-1' };
    const client = fakeClient(inserted);

    const approval = await consumeManagerApproval({
      client,
      restaurant: RESTAURANT,
      req: managerReq(),
      action: 'void',
      amountCents: 500,
    });

    expect(approval).toBeTruthy();
    expect(approval.status).toBe('self_approved');
    expect(approval.approver_user_id).toBe('manager-1');
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("'self_approved'");
    expect(sql).toContain('INSERT INTO restaurant_pos_approvals');
    // approver_user_id ($7) is the acting manager; no PIN column is set.
    expect(params[6]).toBe('manager-1');
  });

  test('below the threshold still returns null with no row (no noise)', async () => {
    permissionsService.hasRestaurantPermission.mockResolvedValue(true);
    const client = fakeClient();
    const approval = await consumeManagerApproval({
      client,
      restaurant: RESTAURANT,
      req: managerReq(),
      action: 'payout',
      amountCents: 100, // under the 10000 default threshold
    });
    expect(approval).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  test('non-manager without a PIN is still rejected (unchanged)', async () => {
    permissionsService.hasRestaurantPermission.mockResolvedValue(false);
    const client = fakeClient();
    await expect(
      consumeManagerApproval({
        client,
        restaurant: RESTAURANT,
        req: { user: { id: 'cashier-1' }, body: {} },
        action: 'void',
        amountCents: 500,
      })
    ).rejects.toMatchObject({ code: 'manager_approval_required' });
    expect(client.query).not.toHaveBeenCalled();
  });

  test('self-approval still enforces the reason-code contract', async () => {
    permissionsService.hasRestaurantPermission.mockResolvedValue(true);
    const client = fakeClient();
    const { POS_VOID_REASON_CODES } = require('../services/restaurantStaffIdentityService');
    await expect(
      consumeManagerApproval({
        client,
        restaurant: RESTAURANT,
        req: { user: { id: 'manager-1' }, body: { reasonCode: 'bogus' } },
        action: 'void',
        amountCents: 500,
        reasonCodes: POS_VOID_REASON_CODES,
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('finding 39: linkApproval consumes void/discount approvals', () => {
  test('marks the row consumed and records the order link', async () => {
    const client = fakeClient();
    await linkApproval(client, 123, { foodOrderId: 456 });
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("status = 'consumed'");
    expect(sql).toContain('food_order_id = COALESCE($4, food_order_id)');
    expect(params).toEqual([123, null, null, 456]);
  });

  test('existing payment/drawer links are preserved (COALESCE)', async () => {
    const client = fakeClient();
    await linkApproval(client, 123, { paymentId: 789 });
    const [, params] = client.query.mock.calls[0];
    expect(params).toEqual([123, 789, null, null]);
  });

  test('null approval id is a no-op', async () => {
    const client = fakeClient();
    await linkApproval(client, null, { foodOrderId: 1 });
    expect(client.query).not.toHaveBeenCalled();
  });
});
