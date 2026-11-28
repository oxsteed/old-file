'use strict';

// statementFreshness.test.js — pure unit tests for assessDatasetFreshness
// (Slice 5e, item 721, D-746). No DB: the helper shares the issuance gate's
// clock (latestClosedMonthPeriod + issuanceGraceElapsed), so the boundary
// cases are pinned here against fixed reference dates.

const { assessDatasetFreshness } = require('../services/statementFreshness');

describe('assessDatasetFreshness', () => {
  test('no document yet is none, never a warning', () => {
    const result = assessDatasetFreshness(null, new Date('2026-11-28T12:00:00.000Z'));
    expect(result).toEqual({ state: 'none', latestPeriod: null, expectedPeriod: '2026-10' });
  });

  test('latest document covering the latest closed month is current', () => {
    const result = assessDatasetFreshness('2026-10', new Date('2026-11-28T12:00:00.000Z'));
    expect(result).toEqual({ state: 'current', latestPeriod: '2026-10', expectedPeriod: '2026-10' });
  });

  test('latest document ahead of the latest closed month is current (defensive)', () => {
    const result = assessDatasetFreshness('2026-11', new Date('2026-11-28T12:00:00.000Z'));
    expect(result.state).toBe('current');
    expect(result.expectedPeriod).toBe('2026-10');
  });

  test('one month behind inside the grace window is pending, not stale', () => {
    // Latest closed month is October 2026; the grace elapses a full 72h
    // after the true month end (2026-11-01T00:00Z), i.e. 2026-11-04T00:00Z.
    const result = assessDatasetFreshness('2026-09', new Date('2026-11-02T12:00:00.000Z'));
    expect(result).toEqual({ state: 'pending', latestPeriod: '2026-09', expectedPeriod: '2026-10' });
  });

  test('one month behind after the grace elapsed is stale', () => {
    const result = assessDatasetFreshness('2026-09', new Date('2026-11-28T12:00:00.000Z'));
    expect(result).toEqual({ state: 'stale', latestPeriod: '2026-09', expectedPeriod: '2026-10' });
  });

  test('year boundary: December document is current in January', () => {
    const result = assessDatasetFreshness('2025-12', new Date('2026-01-15T12:00:00.000Z'));
    expect(result).toEqual({ state: 'current', latestPeriod: '2025-12', expectedPeriod: '2025-12' });
  });

  test('year boundary: November document is stale in January after grace', () => {
    const result = assessDatasetFreshness('2025-11', new Date('2026-01-15T12:00:00.000Z'));
    expect(result).toEqual({ state: 'stale', latestPeriod: '2025-11', expectedPeriod: '2025-12' });
  });

  test('grace boundary is exact: one second before elapse is pending, at elapse is stale', () => {
    const before = assessDatasetFreshness('2026-09', new Date('2026-11-03T23:59:59.000Z'));
    expect(before.state).toBe('pending');
    const at = assessDatasetFreshness('2026-09', new Date('2026-11-04T00:00:00.000Z'));
    expect(at.state).toBe('stale');
  });
});
