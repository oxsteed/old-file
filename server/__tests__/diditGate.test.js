'use strict';

const { isDiditIdentitySatisfied, isDiditVerificationFresh, diditAllowUserSkip } = require('../utils/diditGate');

describe('diditGate', () => {
  const orig = process.env.DIDIT_ALLOW_USER_SKIP;

  afterEach(() => {
    if (orig === undefined) delete process.env.DIDIT_ALLOW_USER_SKIP;
    else process.env.DIDIT_ALLOW_USER_SKIP = orig;
  });

  test('diditAllowUserSkip defaults false and requires explicit opt-in', () => {
    delete process.env.DIDIT_ALLOW_USER_SKIP;
    expect(diditAllowUserSkip()).toBe(false);
    process.env.DIDIT_ALLOW_USER_SKIP = 'false';
    expect(diditAllowUserSkip()).toBe(false);
    process.env.DIDIT_ALLOW_USER_SKIP = 'true';
    expect(diditAllowUserSkip()).toBe(true);
  });

  test('enforcement requires verified only', () => {
    expect(isDiditIdentitySatisfied({ didit_status: 'skipped', didit_enforcement_required: true })).toBe(false);
    expect(isDiditIdentitySatisfied({
      didit_status: 'verified',
      didit_verified_at: new Date().toISOString(),
      didit_enforcement_required: true,
    })).toBe(true);
    expect(isDiditIdentitySatisfied({
      didit_status: 'verified',
      didit_verified_at: '2020-01-01T00:00:00.000Z',
      didit_enforcement_required: true,
    })).toBe(false);
  });

  test('no enforcement allows skipped', () => {
    expect(isDiditIdentitySatisfied({ didit_status: 'skipped', didit_enforcement_required: false })).toBe(true);
    expect(isDiditIdentitySatisfied({
      didit_status: 'verified',
      didit_verified_at: new Date().toISOString(),
      didit_enforcement_required: false,
    })).toBe(true);
  });

  test('missing and malformed approval timestamps fail closed', () => {
    expect(isDiditVerificationFresh(null)).toBe(false);
    expect(isDiditVerificationFresh('not-a-date')).toBe(false);
    expect(isDiditVerificationFresh('2020-01-01T00:00:00.000Z')).toBe(false);
  });
});
