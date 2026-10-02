'use strict';

/**
 * Rail-disabled worker behavior: credit jobs skip quietly instead of
 * raising critical incidents when the OxSteed Credit rail is off.
 * A disabled rail is an operator state, not a failure.
 */

jest.mock('../db', () => ({
  query: jest.fn(async () => ({ rows: [{ is_enabled: false }] })),
}));

const db = require('../db');
const { skipCreditJobWhenRailDisabled } = require('../services/oxsteedCreditService');
const { runOxsteedCreditTopupExpiry } = require('../jobs/oxsteedCreditTopupExpiry');

describe('credit worker rail-disabled skip', () => {
  test('skipCreditJobWhenRailDisabled returns true when the rail is off', async () => {
    await expect(skipCreditJobWhenRailDisabled('test-job')).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")
    );
  });

  test('skipCreditJobWhenRailDisabled returns false when the rail is on', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ is_enabled: true }] });
    await expect(skipCreditJobWhenRailDisabled('test-job')).resolves.toBe(false);
  });

  test('topup-expiry worker returns early without failing when the rail is disabled', async () => {
    const result = await runOxsteedCreditTopupExpiry();
    expect(result).toEqual({ skipped: 'rail_disabled' });
  });
});
