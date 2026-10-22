'use strict';

// Money-flows audit (item 7): when a debit-then-adjust capture releases the
// FULL held reservation and the follow-up purchase then fails, the
// compensation must restore the amount actually released (releaseAmount, the
// full hold face value), not the adjusted requestedAmount. Restoring only
// requestedAmount strands the hold with reserved_cents diverged from its
// face amount, and both re-capture and release then fail.
const { captureCreditHoldInTransaction } = require('../services/oxsteedCreditService');

const PURCHASE_FAILURE = new Error('simulated purchase failure');

function fakeClient() {
  const calls = [];
  const hold = {
    id: 'hold-7',
    account_id: 'acct-7',
    customer_id: 'cust-7',
    partner_id: 'partner-7',
    agreement_id: 'agr-7',
    amount_cents: 2000,
    currency_code: 'USD',
    status: 'active',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    capture_idempotency_key: null,
    reference_type: 'credit_hold',
    reference_id: 'hold-7',
    purpose: 'POS debit-then-adjust capture',
    metadata: null,
  };
  const query = jest.fn(async (sql, params) => {
    calls.push([String(sql), params]);
    if (sql.includes('FROM oxsteed_credit_holds h')) return { rows: [hold] };
    if (sql.includes('FROM oxsteed_credit_transactions t')) return { rows: [] }; // no legacy purchase
    if (sql.includes('SELECT * FROM oxsteed_credit_accounts')) {
      return { rows: [{ id: 'acct-7', reserved_cents: 2000 }] };
    }
    if (sql.includes('SET reserved_cents = reserved_cents - $1')) {
      return { rows: [{ id: 'acct-7' }], rowCount: 1 }; // releaseHoldReservation
    }
    // The first query of the follow-up purchase blows up.
    throw PURCHASE_FAILURE;
  });
  return { query, calls };
}

test('a failed adjusted capture restores the full released hold amount', async () => {
  const client = fakeClient();
  await expect(
    captureCreditHoldInTransaction(client, {
      holdId: 'hold-7',
      amountCents: 1500, // adjusted down from the 2000-cent hold
      allowAmountAdjust: true,
      idempotencyKey: 'capture-key-7',
      actorUserId: 'admin-1',
      actorType: 'admin',
      reason: 'test capture',
    })
  ).rejects.toThrow(PURCHASE_FAILURE);

  const compensations = client.calls.filter(
    ([sql]) => sql.includes('UPDATE oxsteed_credit_accounts') && sql.includes('reserved_cents = reserved_cents + $1')
  );
  expect(compensations).toHaveLength(1);
  // 2000 (the full hold released), NOT 1500 (the adjusted capture amount).
  expect(compensations[0][1][0]).toBe(2000);
  expect(compensations[0][1][1]).toBe('acct-7');
});

test('a failed non-adjusted capture restores the requested amount', async () => {
  const client = fakeClient();
  await expect(
    captureCreditHoldInTransaction(client, {
      holdId: 'hold-7',
      amountCents: 2000, // exact match: releaseAmount === requestedAmount
      idempotencyKey: 'capture-key-8',
      actorUserId: 'admin-1',
      actorType: 'admin',
      reason: 'test capture',
    })
  ).rejects.toThrow(PURCHASE_FAILURE);

  const compensations = client.calls.filter(
    ([sql]) => sql.includes('UPDATE oxsteed_credit_accounts') && sql.includes('reserved_cents = reserved_cents + $1')
  );
  expect(compensations).toHaveLength(1);
  expect(compensations[0][1][0]).toBe(2000);
});
