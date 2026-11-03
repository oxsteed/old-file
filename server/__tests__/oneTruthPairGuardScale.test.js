'use strict';

/**
 * oneTruthPairGuardScale.test.js — fast in-path companion to the
 * scripts/oneTruthBenchmark.js harness (which needs a real database and
 * stays out of the default unit-test path).
 *
 * The harness proves the retired 5,000 cap holds at 100k/500k/1M against
 * Postgres. This file pins the guard arithmetic at the default 100,000
 * limit without a database: a single linear group of 100,002 users yields
 * 100,001 pairs, so pairing must abort with 413 instead of materializing
 * them, while a group of exactly 100,001 users (100,000 pairs) succeeds.
 * Pairing throws as soon as the count exceeds the limit, so neither case
 * materializes an unbounded array.
 */

const { linkSignalGroups } = require('../services/oneTruthPairing');

function groupOf(n) {
  return [{
    signalType: 'same_ip',
    label: 'Same last login IP',
    weight: 3,
    userIds: Array.from({ length: n }, (_, i) => `u${i}`),
  }];
}

describe('One Truth pair guard at the default 100,000 limit', () => {
  test('100,001 pairs from a 100,002-user group abort with 413', () => {
    let err = null;
    try {
      linkSignalGroups(groupOf(100002), 'linear', { maxPairs: 100000 });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(413);
    expect(err.code).toBe('one_truth_pair_limit_exceeded');
  });

  test('exactly 100,000 pairs from a 100,001-user group succeed', () => {
    const { pairs } = linkSignalGroups(groupOf(100001), 'linear', { maxPairs: 100000 });
    expect(pairs).toHaveLength(100000);
  });
});
