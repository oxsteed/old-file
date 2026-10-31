'use strict';

/**
 * Audit item 8: driver-payout separation of duties, legacy null-approver hole.
 *
 * approvePayout stamps the approver exactly once on legacy rows that were
 * approved before approver recording began; markPayoutPaid then enforces
 * payer != approver. A null approver fails closed at mark-paid time instead
 * of being allowed through. No approver is ever invented: the stamped
 * approver is the operator who actually re-approved.
 */

jest.mock('../db', () => ({}));

const {
  approvePayout,
  markPayoutPaid,
} = require('../services/deliveryDriverPayoutService');

function makeClient(initialRow) {
  let row = { ...initialRow };
  return {
    getRow: () => row,
    query: async (sql, params) => {
      if (sql.includes('SELECT * FROM delivery_driver_payouts')) {
        return { rows: [row] };
      }
      if (sql.includes('UPDATE delivery_driver_payouts')) {
        // Approve from accrued.
        if (sql.includes("status = 'accrued'") && row.status === 'accrued') {
          row = {
            ...row,
            status: 'approved',
            approved_by_user_id: params[1],
            approved_at: new Date().toISOString(),
            note: params[2] ?? row.note,
            updated_at: new Date().toISOString(),
          };
          return { rows: [row] };
        }
        // One-time approver stamp on a legacy approved row.
        if (sql.includes('approved_by_user_id IS NULL')
          && row.status === 'approved' && row.approved_by_user_id == null) {
          row = {
            ...row,
            approved_by_user_id: params[1],
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          return { rows: [row] };
        }
        // Mark paid from approved.
        if (sql.includes("SET status = 'paid'") && row.status === 'approved') {
          row = {
            ...row,
            status: 'paid',
            paid_at: new Date().toISOString(),
            paid_by_user_id: params[1],
            payment_reference: params[2],
            note: params[3] ?? row.note,
            updated_at: new Date().toISOString(),
          };
          return { rows: [row] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

const baseRow = {
  id: 'payout-1',
  delivery_job_id: 'job-1',
  driver_user_id: 'driver-1',
  payout_cents: 5000,
  status: 'approved',
  approved_by_user_id: null,
  approved_at: new Date().toISOString(),
  note: null,
};

describe('driver payout separation, legacy null-approver rows', () => {
  test('mark-paid on a null-approver row fails closed instead of allowing through', async () => {
    const client = makeClient(baseRow);
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'ref-1', null)
    ).rejects.toMatchObject({ code: 'driver_payout_approver_unknown', statusCode: 403 });
    expect(client.getRow().status).toBe('approved');
  });

  test('re-approval stamps the approver; the same operator still cannot mark paid, a second operator can', async () => {
    const client = makeClient(baseRow);
    const stamped = await approvePayout(client, 'payout-1', 'operator-a', null);
    expect(stamped.approved_by_user_id).toBe('operator-a');
    expect(stamped.status).toBe('approved');

    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-a', 'ref-1', null)
    ).rejects.toMatchObject({ code: 'driver_payout_self_mark_paid', statusCode: 403 });

    const paid = await markPayoutPaid(client, 'payout-1', 'operator-b', 'ref-1', null);
    expect(paid.status).toBe('paid');
    expect(paid.paid_by_user_id).toBe('operator-b');
  });

  test('approve on an already-approved row with a recorded approver stays an idempotent no-op', async () => {
    const client = makeClient({ ...baseRow, approved_by_user_id: 'operator-a' });
    const again = await approvePayout(client, 'payout-1', 'operator-c', null);
    expect(again.approved_by_user_id).toBe('operator-a');
  });

  test('normal rows keep the existing separation behavior', async () => {
    const accrued = { ...baseRow, status: 'accrued', approved_by_user_id: null, approved_at: null };
    const client = makeClient(accrued);
    const approved = await approvePayout(client, 'payout-1', 'operator-a', null);
    expect(approved.approved_by_user_id).toBe('operator-a');
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-a', 'ref-1', null)
    ).rejects.toMatchObject({ code: 'driver_payout_self_mark_paid' });
    const paid = await markPayoutPaid(client, 'payout-1', 'operator-b', 'ref-1', null);
    expect(paid.status).toBe('paid');
  });
});
