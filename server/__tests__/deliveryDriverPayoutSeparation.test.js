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

function makeClient(initialRow, { railEnabled = true } = {}) {
  let row = { ...initialRow };
  return {
    getRow: () => row,
    query: async (sql, params) => {
      // G9-B8 (D-745): the rail gate reads the credit flag and the freeze
      // table; the fake answers both (flag on by default, never frozen).
      if (sql.includes('FROM feature_flags')) {
        return { rows: [{ is_enabled: railEnabled }] };
      }
      if (sql.includes('FROM delivery_driver_payouts')) {
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

// G9-B8 (D-745): a mock Stripe client whose retrieve returns a transfer
// matching the base row (5000 USD cents, not reversed) unless overridden.
function mockStripe(overrides = {}) {
  const transfer = {
    id: 'tr_1a2b3c4d5e6f7g8h9i0j',
    amount: 5000,
    currency: 'usd',
    reversed: false,
    ...overrides,
  };
  return { transfers: { retrieve: jest.fn().mockResolvedValue(transfer) } };
}

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

    const paid = await markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe: mockStripe() });
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
    const paid = await markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe: mockStripe() });
    expect(paid.status).toBe('paid');
  });
});

describe('driver payout mark-paid rail verification (G9-B8)', () => {
  const approvedRow = { ...baseRow, approved_by_user_id: 'operator-a' };

  test('a free-text reference is refused: only a Stripe transfer id counts as proof', async () => {
    const client = makeClient(approvedRow);
    const stripe = mockStripe();
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'venmo-12345', null, { stripe })
    ).rejects.toMatchObject({ code: 'driver_payout_reference_invalid', statusCode: 400 });
    expect(client.getRow().status).toBe('approved');
    expect(stripe.transfers.retrieve).not.toHaveBeenCalled();
  });

  test('an unknown transfer id is refused', async () => {
    const client = makeClient(approvedRow);
    const stripe = { transfers: { retrieve: jest.fn().mockRejectedValue(Object.assign(new Error('No such transfer'), { statusCode: 404, code: 'resource_missing' })) } };
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_doesnotexist000000000', null, { stripe })
    ).rejects.toMatchObject({ code: 'driver_payout_reference_not_found', statusCode: 409 });
    expect(client.getRow().status).toBe('approved');
  });

  test('a transfer for a different amount is refused', async () => {
    const client = makeClient(approvedRow);
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe: mockStripe({ amount: 4000 }) })
    ).rejects.toMatchObject({ code: 'driver_payout_reference_amount_mismatch', statusCode: 409 });
    expect(client.getRow().status).toBe('approved');
  });

  test('a reversed transfer is refused', async () => {
    const client = makeClient(approvedRow);
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe: mockStripe({ reversed: true }) })
    ).rejects.toMatchObject({ code: 'driver_payout_reference_reversed', statusCode: 409 });
    expect(client.getRow().status).toBe('approved');
  });

  test('a transfer in another currency is refused', async () => {
    const client = makeClient(approvedRow);
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe: mockStripe({ currency: 'eur' }) })
    ).rejects.toMatchObject({ code: 'driver_payout_reference_currency_mismatch', statusCode: 409 });
    expect(client.getRow().status).toBe('approved');
  });

  test('a Stripe error that is not a 404 fails closed without flipping', async () => {
    const client = makeClient(approvedRow);
    const stripe = { transfers: { retrieve: jest.fn().mockRejectedValue(new Error('stripe down')) } };
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe })
    ).rejects.toMatchObject({ code: 'driver_payout_reference_unverifiable', statusCode: 503 });
    expect(client.getRow().status).toBe('approved');
  });

  test('an unconfigured Stripe fails closed without flipping', async () => {
    const client = makeClient(approvedRow);
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe: null })
    ).rejects.toMatchObject({ code: 'driver_payout_rail_unavailable', statusCode: 503 });
    expect(client.getRow().status).toBe('approved');
  });

  test('a disabled rail fails closed before Stripe is ever consulted', async () => {
    const client = makeClient(approvedRow, { railEnabled: false });
    const stripe = mockStripe();
    await expect(
      markPayoutPaid(client, 'payout-1', 'operator-b', 'tr_1a2b3c4d5e6f7g8h9i0j', null, { stripe })
    ).rejects.toMatchObject({ code: 'credit_rail_suspended', statusCode: 503 });
    expect(client.getRow().status).toBe('approved');
    expect(stripe.transfers.retrieve).not.toHaveBeenCalled();
  });
});
