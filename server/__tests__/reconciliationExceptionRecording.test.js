'use strict';

/**
 * Domain 8 #20: recordException swallows all bookkeeping failures.
 *
 * Any insert failure (including a domain the DB CHECK rejects) was
 * caught, logged at warn level, and returned null. The known instance
 * is closed (the CHECK now aligns with the registry's 11 domains), but
 * the next registry domain added without a matching migration would
 * vanish the same way. A failed record must now log at error level
 * and raise an incident (deduped per domain+reference, so repeats
 * surface as a growing occurrence count instead of one incident per
 * failure), while still never throwing to the calling job.
 *
 * The DB pool is the shared mock; incidentStore and logger are mocked
 * so the failure path can be asserted without a real database.
 */
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(async () => ({ persisted: true })),
}));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn(),
}));

const { mockQuery, resetMocks } = require('./setup');
const logger = require('../utils/logger');
const { recordIncident } = require('../services/incidentStore');
const { recordException } = require('../services/reconciliationExceptions');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('recordException failure visibility', () => {
  test('an insert failure logs at error level and raises an incident, still returning null', async () => {
    mockQuery.mockRejectedValueOnce(new Error('relation "reconciliation_exceptions" does not exist'));

    const result = await recordException({
      domain: 'payment_authorization',
      referenceId: 'pi-failing-1',
      severity: 'critical',
      summary: 'Payment authorization webhook verification failed',
    });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'recordException failed',
      expect.objectContaining({
        domain: 'payment_authorization',
        referenceId: 'pi-failing-1',
        error: expect.stringContaining('does not exist'),
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reconciliation_exception_record_failed',
      severity: 'high',
      dedupeKey: 'recon-exception-record-failed:payment_authorization:pi-failing-1',
    }));
    const details = recordIncident.mock.calls[0][0].details;
    expect(details).toMatchObject({
      domain: 'payment_authorization',
      referenceId: 'pi-failing-1',
    });
    expect(details.error).toContain('does not exist');
  });

  test('an invalid domain fails the same way instead of vanishing at warn', async () => {
    const result = await recordException({
      domain: 'not_a_registered_domain',
      referenceId: 'ref-1',
      summary: 'Should never be recorded',
    });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'recordException failed',
      expect.objectContaining({ domain: 'not_a_registered_domain' }),
    );
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident.mock.calls[0][0].dedupeKey)
      .toBe('recon-exception-record-failed:not_a_registered_domain:ref-1');
  });

  test('a successful record raises no incident and logs no error', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-exception-id' }] });

    const result = await recordException({
      domain: 'credit',
      referenceId: 'credit-1',
      summary: 'Credit reconciliation mismatch',
    });

    expect(result).toBe('new-exception-id');
    expect(recordIncident).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('an incident-store failure still never throws to the caller', async () => {
    mockQuery.mockRejectedValueOnce(new Error('insert failed'));
    recordIncident.mockRejectedValueOnce(new Error('incident store down'));

    const result = await recordException({
      domain: 'credit',
      referenceId: 'credit-2',
      summary: 'Credit reconciliation mismatch',
    });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});
