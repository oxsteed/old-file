'use strict';

/**
 * __tests__/franchiseRoyaltyPark.db.test.js
 *
 * DB-backed tests for Domain 8 #13: the royalty-failure outbox had
 * no visibility, no cap, no park — a permanently failing source was
 * retried hourly forever, silently.
 *
 * Proves, against an isolated schema in the disposable test
 * database (same fixture pattern as franchiseRoyaltyService.db.test.js):
 *   - a source whose accrual fails on every attempt is parked after
 *     MAX_ROYALTY_FAILURE_ATTEMPTS (10) retries: parked_at is set,
 *     the redrive result counts it as parked, and a later redrive
 *     attempts nothing for it;
 *   - parking raises one high incident naming the source;
 *   - the parked row is listable via listRoyaltyFailures with
 *     status 'parked', and is excluded from status 'open'.
 *
 * The failure is a fee-store outage simulated with a wrapper client
 * that throws on the marketing-fee accruals table only, so the
 * royalty itself lands (then dedupes) while the fee never can.
 */

jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(async () => ({ persisted: true, incident: { id: 7 } })),
}));

const crypto = require('crypto');
const schema = `fr_royalty_park_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Franchise royalty fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const { recordIncident } = require('../services/incidentStore');
const {
  accrueTerritoryRoyalty,
  retryFailedRoyalties,
  listRoyaltyFailures,
  MAX_ROYALTY_FAILURE_ATTEMPTS,
} = require('../services/franchiseRoyaltyService');

const describeDb = url ? describe : describe.skip;

describeDb('Domain 8 #13: a permanently failing royalty source parks after the max-attempts threshold', () => {
  const owner = crypto.randomUUID();

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.franchise_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID REFERENCES users(id),
      desired_city TEXT,
      desired_region TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
    )`);
    await db.query(`CREATE TABLE ${schema}.franchise_agreements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      application_id UUID REFERENCES franchise_applications(id),
      royalty_bps INTEGER NOT NULL DEFAULT 0,
      marketing_fee_bps INTEGER NOT NULL DEFAULT 0,
      marketing_fee_accrued_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE ${schema}.platform_ledger (
      id SERIAL PRIMARY KEY,
      user_id UUID,
      type TEXT,
      amount_cents INTEGER,
      description TEXT,
      metadata JSONB,
      source_type TEXT,
      idempotency_key TEXT,
      UNIQUE (idempotency_key)
    )`);
    await db.query(`CREATE TABLE ${schema}.franchise_marketing_fee_accruals (
      id SERIAL PRIMARY KEY,
      agreement_id UUID REFERENCES franchise_agreements(id),
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      marketing_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (agreement_id, source_type, source_id)
    )`);
    // Mirrors migration 20261108173000 plus the Domain 8 #13
    // parked_at column (migration 20261113190100).
    await db.query(`CREATE TABLE ${schema}.franchise_royalty_failures (
      id SERIAL PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      agreement_id UUID REFERENCES franchise_agreements(id),
      amount_cents INTEGER NOT NULL,
      location_id BIGINT,
      city TEXT,
      region TEXT,
      description TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      parked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE UNIQUE INDEX fr_royalty_park_failures_open ON ${schema}.franchise_royalty_failures (source_type, source_id) WHERE resolved_at IS NULL`);
    await db.query('INSERT INTO users(id) VALUES($1)', [owner]);
    await db.query(
      `INSERT INTO franchise_applications (owner_user_id, desired_city, desired_region, status)
       VALUES ($1, 'Denver', 'Colorado', 'launched')`,
      [owner]
    );
    const { rows: [app] } = await db.query(
      `SELECT id FROM franchise_applications WHERE owner_user_id = $1`, [owner]
    );
    await db.query(
      `INSERT INTO franchise_agreements (application_id, royalty_bps, marketing_fee_bps)
       VALUES ($1, 500, 200)`,
      [app.id]
    );
  });

  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });

  // A wrapper client that fails the fee store only: every other
  // query (ledger, failure outbox, agreement lookup) goes through.
  function failingFeeClient() {
    return {
      query: async (sql, params) => {
        if (String(sql).includes('franchise_marketing_fee_accruals')) {
          throw new Error('simulated fee store outage');
        }
        return db.query(sql, params);
      },
    };
  }

  async function failureRow() {
    const { rows } = await db.query(
      `SELECT * FROM franchise_royalty_failures WHERE source_type = 'job' AND source_id = 'job-parked'`
    );
    return rows[0];
  }

  test('a permanently failing source parks after 10 attempts, raises an incident, and is listable', async () => {
    expect(MAX_ROYALTY_FAILURE_ATTEMPTS).toBe(10);
    const args = {
      client: failingFeeClient(), amountCents: 10000, city: 'Denver', region: 'Colorado',
      sourceType: 'job', sourceId: 'job-parked', description: 'test park',
    };
    await expect(accrueTerritoryRoyalty(args)).rejects.toThrow('simulated fee store outage');
    let row = await failureRow();
    expect(row).toBeTruthy();
    expect(Number(row.attempts)).toBe(0);
    expect(row.parked_at).toBeNull();

    // Ten hourly redrives, each failing again: backoff pushes
    // next_retry_at into the future, so reset it between runs the
    // way time passing would.
    for (let attempt = 1; attempt <= MAX_ROYALTY_FAILURE_ATTEMPTS; attempt += 1) {
      const redrive = await retryFailedRoyalties(failingFeeClient());
      expect(redrive.attempted).toBe(1);
      expect(redrive.failed).toBe(1);
      if (attempt < MAX_ROYALTY_FAILURE_ATTEMPTS) {
        expect(redrive.parked).toBe(0);
        await db.query(
          `UPDATE franchise_royalty_failures SET next_retry_at = NOW()
            WHERE source_type = 'job' AND source_id = 'job-parked'`
        );
      } else {
        expect(redrive.parked).toBe(1);
      }
    }

    row = await failureRow();
    expect(Number(row.attempts)).toBe(MAX_ROYALTY_FAILURE_ATTEMPTS);
    expect(row.parked_at).toBeTruthy();
    expect(row.resolved_at).toBeNull();

    // Parking raises exactly one high incident naming the source.
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'franchise_royalty_failure_parked',
      severity: 'high',
      dedupeKey: 'franchise-royalty-parked:job:job-parked',
    }));

    // A parked row is no longer selected for re-drive.
    const after = await retryFailedRoyalties(failingFeeClient());
    expect(after).toMatchObject({ attempted: 0, resolved: 0, failed: 0, parked: 0 });
    row = await failureRow();
    expect(Number(row.attempts)).toBe(MAX_ROYALTY_FAILURE_ATTEMPTS);

    // And it is listable as parked, but not as open.
    const parked = await listRoyaltyFailures(db, { status: 'parked' });
    expect(parked.total).toBe(1);
    expect(parked.failures[0].source_id).toBe('job-parked');
    expect(parked.failures[0].attempts).toBe(MAX_ROYALTY_FAILURE_ATTEMPTS);
    const open = await listRoyaltyFailures(db, { status: 'open' });
    expect(open.total).toBe(0);
    const all = await listRoyaltyFailures(db, { status: 'all' });
    expect(all.total).toBe(1);
  });
});
