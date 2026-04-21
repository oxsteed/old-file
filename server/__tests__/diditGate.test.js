'use strict';

const { isDiditIdentitySatisfied, diditAllowUserSkip } = require('../utils/diditGate');

describe('diditGate', () => {
  const orig = process.env.DIDIT_ALLOW_USER_SKIP;

  afterEach(() => {
    if (orig === undefined) delete process.env.DIDIT_ALLOW_USER_SKIP;
    else process.env.DIDIT_ALLOW_USER_SKIP = orig;
  });

  test('diditAllowUserSkip defaults true', () => {
    delete process.env.DIDIT_ALLOW_USER_SKIP;
    expect(diditAllowUserSkip()).toBe(true);
    process.env.DIDIT_ALLOW_USER_SKIP = 'false';
    expect(diditAllowUserSkip()).toBe(false);
  });

  test('enforcement requires verified only', () => {
    expect(isDiditIdentitySatisfied({ didit_status: 'skipped', didit_enforcement_required: true })).toBe(false);
    expect(isDiditIdentitySatisfied({ didit_status: 'verified', didit_enforcement_required: true })).toBe(true);
  });

  test('no enforcement allows skipped', () => {
    expect(isDiditIdentitySatisfied({ didit_status: 'skipped', didit_enforcement_required: false })).toBe(true);
    expect(isDiditIdentitySatisfied({ didit_status: 'verified', didit_enforcement_required: false })).toBe(true);
  });
});
