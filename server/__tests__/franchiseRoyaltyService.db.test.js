'use strict';

/**
 * __tests__/franchiseRoyaltyService.db.test.js
 *
 * DB-backed tests for the franchise territory royalty service
 * (reviews P2-9-F08, P2-9-F13):
 *  - deterministic territory matching (city beats region; recency tiebreak)
 *  - idempotent accrual (no double royalty for the same revenue event)
 *  - marketing-fee accrual on the agreement
 */

const crypto = require('crypto');
const schema = `fr_royalty_${crypto.randomBytes(6).toString('hex')}`;
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
const { findTerritoryAgreement, accrueTerritoryRoyalty, retryFailedRoyalties } = require('../services/franchiseRoyaltyService');

const describeDb = url ? describe : describe.skip;

describeDb('franchise territory royalty service', () => {
  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();

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
    // Background-jobs audit #45: fee idempotency record + failure
    // outbox, mirroring migration 20261108173000.
    await db.query(`CREATE TABLE ${schema}.franchise_marketing_fee_accruals (
      id SERIAL PRIMARY KEY,
      agreement_id UUID REFERENCES franchise_agreements(id),
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      marketing_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (agreement_id, source_type, source_id)
    )`);
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE UNIQUE INDEX fr_royalty_failures_open ON ${schema}.franchise_royalty_failures (source_type, source_id) WHERE resolved_at IS NULL`);
    for (const id of [ownerA, ownerB]) await db.query('INSERT INTO users(id) VALUES($1)', [id]);
  });

  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });

  async function application({ owner, city, region, status = 'launched', royaltyBps = 500, marketingBps = 200 }) {
    const { rows: [app] } = await db.query(
      `INSERT INTO franchise_applications (owner_user_id, desired_city, desired_region, status)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [owner, city, region, status]
    );
    const { rows: [agr] } = await db.query(
      `INSERT INTO franchise_agreements (application_id, royalty_bps, marketing_fee_bps)
       VALUES ($1,$2,$3) RETURNING id`,
      [app.id, royaltyBps, marketingBps]
    );
    return { appId: app.id, agreementId: agr.id };
  }

  test('exact city match outranks a region-only match (deterministic winner)', async () => {
    await application({ owner: ownerA, city: null, region: 'Texas' });
    const cityApp = await application({ owner: ownerB, city: 'Austin', region: 'Texas' });
    const found = await findTerritoryAgreement(db, 'Austin', 'Texas');
    expect(found.application_id).toBe(cityApp.appId);
    expect(found.owner_user_id).toBe(ownerB);
  });

  test('most recently updated agreement wins ties on the same region', async () => {
    const first = await application({ owner: ownerA, city: null, region: 'Nevada' });
    const second = await application({ owner: ownerB, city: null, region: 'Nevada' });
    await db.query('UPDATE franchise_agreements SET updated_at = NOW() + interval \'1 minute\' WHERE id = $1', [second.agreementId]);
    const found = await findTerritoryAgreement(db, null, 'Nevada');
    expect(found.application_id).toBe(second.appId);
    expect(first.appId).not.toBe(second.appId);
  });

  test('accrual credits the owner ledger, accrues marketing fee, and is idempotent', async () => {
    const { agreementId } = await application({ owner: ownerA, city: 'Denver', region: 'Colorado', royaltyBps: 500, marketingBps: 200 });
    const args = {
      client: db, amountCents: 10000, city: 'Denver', region: 'Colorado',
      sourceType: 'job', sourceId: 'job-1', description: 'test royalty',
    };
    const first = await accrueTerritoryRoyalty(args);
    expect(first.royaltyCents).toBe(500);   // 5% of $100
    expect(first.marketingCents).toBe(200); // 2% of $100
    expect(first.ownerUserId).toBe(ownerA);

    const ledger = await db.query(`SELECT * FROM platform_ledger WHERE idempotency_key = 'franchise-royalty:job:job-1'`);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].amount_cents).toBe(500);

    const agreement = await db.query('SELECT marketing_fee_accrued_cents FROM franchise_agreements WHERE id = $1', [agreementId]);
    expect(agreement.rows[0].marketing_fee_accrued_cents).toBe(200);

    // Replaying the same revenue event must not double-count either side.
    const second = await accrueTerritoryRoyalty(args);
    expect(second.duplicate).toBe(true);
    expect(second.royaltyCents).toBe(0);
    const ledgerAgain = await db.query(`SELECT count(*) FROM platform_ledger WHERE idempotency_key = 'franchise-royalty:job:job-1'`);
    expect(Number(ledgerAgain.rows[0].count)).toBe(1);
    const agreementAgain = await db.query('SELECT marketing_fee_accrued_cents FROM franchise_agreements WHERE id = $1', [agreementId]);
    expect(agreementAgain.rows[0].marketing_fee_accrued_cents).toBe(200);
  });

  test('returns null when no territory matches or the amount is invalid', async () => {
    expect(await accrueTerritoryRoyalty({ client: db, amountCents: 10000, city: 'Nowhere', region: 'ZZ', sourceType: 'job', sourceId: 'x' })).toBeNull();
    expect(await accrueTerritoryRoyalty({ client: db, amountCents: 0, city: 'Denver', region: 'Colorado', sourceType: 'job', sourceId: 'y' })).toBeNull();
    expect(await accrueTerritoryRoyalty({ client: db, amountCents: 10000, city: null, region: null, sourceType: 'job', sourceId: 'z' })).toBeNull();
  });

  // Background-jobs audit #45: the marketing fee has its own
  // idempotency, and failed accruals are recorded for re-drive.
  test('a repeated accrue never double-counts the marketing fee, even when the royalty rounds to 0', async () => {
    const { agreementId } = await application({ owner: ownerA, city: 'Tulsa', region: 'Oklahoma', royaltyBps: 10, marketingBps: 500 });
    const args = {
      client: db, amountCents: 100, city: 'Tulsa', region: 'Oklahoma',
      sourceType: 'job', sourceId: 'job-zero-royalty', description: 'test zero royalty',
    };
    const first = await accrueTerritoryRoyalty(args);
    expect(first.royaltyCents).toBe(0); // 0.1 rounds to 0: no ledger insert
    expect(first.marketingCents).toBe(5);
    // The second call has no ledger row to gate on, so the old bare
    // UPDATE double-counted the fee here. The fee record gates it.
    await accrueTerritoryRoyalty(args);
    const agreement = await db.query('SELECT marketing_fee_accrued_cents FROM franchise_agreements WHERE id = $1', [agreementId]);
    expect(agreement.rows[0].marketing_fee_accrued_cents).toBe(5);
    const ledger = await db.query(`SELECT count(*) FROM platform_ledger WHERE idempotency_key = 'franchise-royalty:job:job-zero-royalty'`);
    expect(Number(ledger.rows[0].count)).toBe(0);
  });

  test('a duplicate royalty still accrues the fee when the first attempt never reached it', async () => {
    const { agreementId } = await application({ owner: ownerA, city: 'Boise', region: 'Idaho', royaltyBps: 500, marketingBps: 200 });
    // Simulate the old crash window: the royalty insert landed but
    // the fee UPDATE never ran.
    await db.query(
      `INSERT INTO platform_ledger (user_id, type, amount_cents, description, metadata, source_type, idempotency_key)
       VALUES ($1, 'franchise_royalty', 500, 'test royalty', '{}'::jsonb, 'franchise_royalty', 'franchise-royalty:job:job-crash')`,
      [ownerA]
    );
    const first = await accrueTerritoryRoyalty({
      client: db, amountCents: 10000, city: 'Boise', region: 'Idaho',
      sourceType: 'job', sourceId: 'job-crash', description: 'test crash window',
    });
    expect(first.duplicate).toBe(true);
    expect(first.marketingCents).toBe(200); // the fee IS applied on the duplicate path
    const agreement = await db.query('SELECT marketing_fee_accrued_cents FROM franchise_agreements WHERE id = $1', [agreementId]);
    expect(agreement.rows[0].marketing_fee_accrued_cents).toBe(200);
    // And exactly once: a further replay accrues nothing more.
    const second = await accrueTerritoryRoyalty({
      client: db, amountCents: 10000, city: 'Boise', region: 'Idaho',
      sourceType: 'job', sourceId: 'job-crash', description: 'test crash window',
    });
    expect(second.duplicate).toBe(true);
    expect(second.marketingCents).toBe(0);
    const agreementAgain = await db.query('SELECT marketing_fee_accrued_cents FROM franchise_agreements WHERE id = $1', [agreementId]);
    expect(agreementAgain.rows[0].marketing_fee_accrued_cents).toBe(200);
  });

  test('a failed accrual is recorded for re-drive and the redrive resolves it', async () => {
    const { agreementId } = await application({ owner: ownerA, city: 'Reno', region: 'Nevada', royaltyBps: 500, marketingBps: 200 });
    const args = {
      client: db, amountCents: 10000, city: 'Reno', region: 'Nevada',
      sourceType: 'job', sourceId: 'job-redrive', description: 'test redrive',
    };
    // Break the accrual after the royalty lands: a wrapper client
    // that fails the fee store only. (Dropping a schema-local table
    // cannot force the failure: the search_path falls through to the
    // same table in public on the migrated test database.)
    const failingClient = {
      query: async (sql, params) => {
        if (String(sql).includes('franchise_marketing_fee_accruals')) {
          throw new Error('simulated fee store outage');
        }
        return db.query(sql, params);
      },
    };
    await expect(accrueTerritoryRoyalty({ ...args, client: failingClient })).rejects.toThrow('simulated fee store outage');
    const failures = await db.query(
      `SELECT * FROM franchise_royalty_failures WHERE source_type = 'job' AND source_id = 'job-redrive' AND resolved_at IS NULL`
    );
    expect(failures.rows).toHaveLength(1);
    expect(failures.rows[0].amount_cents).toBe(10000);
    expect(failures.rows[0].agreement_id).toBe(agreementId);
    expect(failures.rows[0].error).toContain('simulated fee store outage');
    // The royalty itself landed before the fee failed.
    const ledgerBefore = await db.query(`SELECT * FROM platform_ledger WHERE idempotency_key = 'franchise-royalty:job:job-redrive'`);
    expect(ledgerBefore.rows).toHaveLength(1);
    expect(ledgerBefore.rows[0].amount_cents).toBe(500);
    // Re-drive with a healthy client: the duplicate royalty is
    // recognized and the fee lands exactly once.
    const redrive = await retryFailedRoyalties(db);
    expect(redrive).toMatchObject({ attempted: 1, resolved: 1, failed: 0 });
    const ledger = await db.query(`SELECT count(*) FROM platform_ledger WHERE idempotency_key = 'franchise-royalty:job:job-redrive'`);
    expect(Number(ledger.rows[0].count)).toBe(1);
    const agreement = await db.query('SELECT marketing_fee_accrued_cents FROM franchise_agreements WHERE id = $1', [agreementId]);
    expect(agreement.rows[0].marketing_fee_accrued_cents).toBe(200);
    const resolved = await db.query(
      `SELECT resolved_at FROM franchise_royalty_failures WHERE source_type = 'job' AND source_id = 'job-redrive'`
    );
    expect(resolved.rows[0].resolved_at).toBeTruthy();
    // Nothing left due: a second redrive attempts nothing.
    expect(await retryFailedRoyalties(db)).toMatchObject({ attempted: 0, resolved: 0 });
  });
});
