'use strict';

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const stripe = require('stripe')();
const { processExternalRefund } = require('../services/externalRefundService');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('reserves and settles a consulting refund with stable provider idempotency', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 41, rail: 'consulting', reference_id: '41', provider_payment_intent_id: 'pi_consulting',
      amount_cents: 10000, currency: 'USD', idempotency_key: 'consulting-payment-refund-41', status: 'pending',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 41, rail: 'consulting', reference_id: '41', provider_payment_intent_id: 'pi_consulting',
      amount_cents: 10000, currency: 'USD', idempotency_key: 'consulting-payment-refund-41', status: 'pending',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 41, status: 'succeeded', provider_refund_id: 're_consulting' }] });
  stripe.refunds.create.mockResolvedValueOnce({
    id: 're_consulting', payment_intent: 'pi_consulting', amount: 10000, currency: 'usd', status: 'succeeded',
  });

  const result = await processExternalRefund({
    rail: 'consulting', referenceId: 41, paymentIntentId: 'pi_consulting', amountCents: 10000,
    actorUserId: 'user-41', requestId: 'consulting-payment-refund-41',
  });

  expect(result.attempt.status).toBe('succeeded');
  expect(stripe.refunds.create).toHaveBeenCalledWith(
    { payment_intent: 'pi_consulting', amount: 10000 },
    expect.objectContaining({ idempotencyKey: 'consulting-payment-refund-41' })
  );
});

test('migration stores external refund attempts without introducing a ledger', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/598_external_refund_reconciliation.sql'), 'utf8');
  expect(migration).toContain('external_refund_attempts');
  expect(migration).toContain('idempotency_key VARCHAR(255) NOT NULL UNIQUE');
  expect(migration).toContain('provider_refund_id VARCHAR(255) UNIQUE');
  expect(migration).toContain("status IN ('pending', 'succeeded', 'failed', 'canceled')");
});
