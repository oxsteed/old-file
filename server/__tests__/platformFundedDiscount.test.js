'use strict';

// P2-6-F09: the referral discount is funded by the platform out of its own
// fee, never by the helper.
const { applyPlatformFundedDiscount, calculateTier3Fees } = require('../utils/feeCalculator');

function grossFees(rawJobValueCents) {
  const fees = calculateTier3Fees(rawJobValueCents);
  return { platformFeeCents: fees.platform_fee_cents, applicationFeeCents: fees.application_fee_cents };
}

test('helper net is identical with or without the discount', () => {
  const raw = 10000; // $100 job
  const { platformFeeCents, applicationFeeCents } = grossFees(raw);
  const discount = applyPlatformFundedDiscount({
    rawJobValueCents: raw, availableCreditCents: 500,
    platformFeeCents, applicationFeeCents,
  });
  expect(discount.appliedCreditCents).toBe(500);
  expect(discount.chargeCents).toBe(9500);
  // Platform fee was max(500, 7.1% of 10000 = 710) = 710; platform nets 210.
  expect(discount.applicationFeeCents).toBe(210);
  // Helper nets: 9500 - 210 = 9290 = 10000 - 710 (same as no discount).
  expect(discount.chargeCents - discount.applicationFeeCents).toBe(raw - platformFeeCents);
});

test('discount is capped at the platform fee so the platform never goes negative', () => {
  const raw = 2000; // $20 job: fee = max(500, 142) = 500
  const { platformFeeCents, applicationFeeCents } = grossFees(raw);
  const discount = applyPlatformFundedDiscount({
    rawJobValueCents: raw, availableCreditCents: 900,
    platformFeeCents, applicationFeeCents,
  });
  expect(discount.appliedCreditCents).toBe(500);
  expect(discount.applicationFeeCents).toBe(0);
  expect(discount.chargeCents).toBe(1500);
});

test('charge never drops below the $0.50 Stripe minimum', () => {
  const raw = 600; // $6 job
  const { platformFeeCents, applicationFeeCents } = grossFees(raw);
  const discount = applyPlatformFundedDiscount({
    rawJobValueCents: raw, availableCreditCents: 10000,
    platformFeeCents, applicationFeeCents,
  });
  expect(discount.chargeCents).toBeGreaterThanOrEqual(50);
});

test('no credit available means no discount and unchanged fees', () => {
  const raw = 10000;
  const { platformFeeCents, applicationFeeCents } = grossFees(raw);
  const discount = applyPlatformFundedDiscount({
    rawJobValueCents: raw, availableCreditCents: 0,
    platformFeeCents, applicationFeeCents,
  });
  expect(discount).toEqual({ appliedCreditCents: 0, chargeCents: raw, applicationFeeCents });
});

test('rejects non-positive job values', () => {
  expect(() => applyPlatformFundedDiscount({
    rawJobValueCents: 0, availableCreditCents: 500, platformFeeCents: 500, applicationFeeCents: 500,
  })).toThrow();
});
