'use strict';

const { affiliatePayableCents } = require('../utils/affiliatePayableCents');

test('uses net_payout_cents when it is set, including zero', () => {
  expect(affiliatePayableCents({
    net_payout_cents: 1400,
    total_commission_cents: 1500,
    processor_fee_cents: 100,
  })).toBe(1400);
  expect(affiliatePayableCents({
    net_payout_cents: 0,
    total_commission_cents: 1500,
    processor_fee_cents: 0,
  })).toBe(0);
});

test('falls back to gross minus the processor fee when net is absent', () => {
  expect(affiliatePayableCents({
    total_commission_cents: 1500,
    processor_fee_cents: 100,
  })).toBe(1400);
  expect(affiliatePayableCents({ total_commission_cents: 1500 })).toBe(1500);
  expect(affiliatePayableCents({})).toBe(0);
});

test('uses a stored net when gross commission is missing', () => {
  expect(affiliatePayableCents({ net_payout_cents: 900 })).toBe(900);
});
