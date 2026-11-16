'use strict';

const {
  getEffectiveTier,
  hasProAccess,
  subscriptionIsCurrent,
} = require('../utils/trial');

describe('paid product entitlements stay separate from progressive capabilities', () => {
  test('an active paid product tier grants Pro access even for a customer-class account', () => {
    const user = {
      role: 'customer',
      tier: 'pro',
      membership_tier: 'tier1',
      subscription_status: 'active',
    };

    expect(subscriptionIsCurrent(user)).toBe(true);
    expect(hasProAccess(user)).toBe(true);
    expect(getEffectiveTier(user)).toBe('pro');
  });

  test('an expired paid product tier does not unlock trial-only features', () => {
    const user = {
      role: 'customer',
      tier: 'pro',
      membership_tier: 'tier1',
      subscription_status: 'cancelled',
    };

    expect(subscriptionIsCurrent(user)).toBe(false);
    expect(hasProAccess(user)).toBe(false);
    expect(getEffectiveTier(user)).toBe('free');
  });

  test('a live first-year trial remains an entitlement without a subscription row', () => {
    const user = {
      role: 'customer',
      tier: 'free',
      membership_tier: 'tier1',
      subscription_status: 'none',
      trial_ends_at: new Date(Date.now() + 60 * 60 * 1000),
    };

    expect(hasProAccess(user)).toBe(true);
    expect(getEffectiveTier(user)).toBe('pro');
  });

  test('legacy membership entitlements remain independent of a product subscription', () => {
    const user = {
      role: 'customer',
      tier: 'free',
      membership_tier: 'tier2',
      subscription_status: 'cancelled',
    };

    expect(hasProAccess(user)).toBe(true);
    expect(getEffectiveTier(user)).toBe('pro');
  });
});

