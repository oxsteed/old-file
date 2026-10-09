"use strict";
const { mockQuery, resetMocks } = require('./setup');
const credit = require('../services/oxsteedCreditService');
beforeEach(() => resetMocks());

test('Media helper payer dispute opt-in is limited to the debit wallet and Media references', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  await expect(credit.openCreditDispute({ customerId: 'helper', actorUserId: 'helper', transactionId: 'tx', reasonCode: 'incorrect_amount', description: 'Amount differs.', idempotencyKey: 'key', allowMediaCreatorOwner: true })).rejects.toMatchObject({ code: 'credit_transaction_not_found' });
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain("owner.role IN ('customer','helper','helper_pro','broker')");
  expect(sql).toContain("t.reference_type IN ('media_creator_tip','media_creator_gig','media_creator_sponsorship','media_post_boost')");
  expect(sql).toContain('a.id = t.debit_account_id AND t.actor_user_id = $2');
});

test('standard disputes preserve the customer-only wallet restriction', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  await expect(credit.openCreditDispute({ customerId: 'helper', actorUserId: 'helper', transactionId: 'tx', reasonCode: 'incorrect_amount', description: 'Amount differs.', idempotencyKey: 'key' })).rejects.toMatchObject({ code: 'credit_transaction_not_found' });
  expect(mockQuery.mock.calls[0][0]).toContain("owner.role = 'customer'");
});

test('creator adjustment opt-in rejects a non-dispute reference before wallet access', async () => {
  await expect(credit.adjustCustomerCreditInTransaction({ query: mockQuery }, { customerId: 'helper', amountCents: 100, idempotencyKey: 'key', actorUserId: 'admin', referenceType: 'admin_adjustment', referenceId: 'ref', reason: 'Credit grant.', allowMediaCreatorOwner: true })).rejects.toMatchObject({ code: 'credit_creator_adjustment_scope_invalid' });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('creator compensation requires an existing Media payer dispute matching currency', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  await expect(credit.adjustCustomerCreditInTransaction({ query: mockQuery }, { customerId: 'helper', amountCents: 100, currencyCode: 'USD', idempotencyKey: 'key', actorUserId: 'admin', referenceType: 'oxsteed_credit_dispute', referenceId: 'dispute', reason: 'Approved refund.', allowMediaCreatorOwner: true })).rejects.toMatchObject({ code: 'credit_creator_adjustment_scope_invalid' });
  expect(mockQuery.mock.calls[0][0]).toContain('t.reference_type IN');
  expect(mockQuery.mock.calls[0][1]).toEqual(['dispute','helper','USD']);
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('INSERT INTO oxsteed_credit_accounts'))).toBe(false);
});
