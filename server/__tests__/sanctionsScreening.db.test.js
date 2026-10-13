'use strict';

jest.unmock('pg');
const { disposableDatabaseOptIn, assertMigratedSchema } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('SANCTIONS_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const pool = require('../db');
const crypto = require('crypto');
const { screenSubjectIfStale, SCREENING_PROVIDERS, SANCTIONS_REVIEW_SLA_HOURS } = require('../services/sanctionsScreeningService');
const describeDatabase = database ? describe : describe.skip;

describeDatabase('sanctions screening persistence against migrated PostgreSQL', () => {
  let client;
  beforeAll(() => assertMigratedSchema(pool));
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await client.query('ROLLBACK');
    client.release();
  });
  afterAll(() => pool.end());

  test.each(['hit', 'clear', 'error'])('persists %s with the appropriate review deadline and reuses fresh results', async result => {
    const provider = jest.spyOn(SCREENING_PROVIDERS.manual_review, 'screenSubject')
      .mockResolvedValue({ result, hitContext: result === 'hit' ? 'manual_review_required' : null });
    const subject = { subjectType: 'customer', subjectId: crypto.randomUUID() };
    const screening = await screenSubjectIfStale(client, subject);
    expect(screening.result).toBe(result);
    if (result === 'hit') {
      expect(new Date(screening.sla_due_at).getTime() - new Date(screening.screened_at).getTime())
        .toBe(SANCTIONS_REVIEW_SLA_HOURS * 60 * 60 * 1000);
      expect(screening.cleared_at).toBeNull();
    } else {
      expect(screening.sla_due_at).toBeNull();
    }
    expect((await screenSubjectIfStale(client, subject)).id).toBe(screening.id);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
