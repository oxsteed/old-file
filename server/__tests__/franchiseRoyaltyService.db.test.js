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
const { findTerritoryAgreement, accrueTerritoryRoyalty } = require('../services/franchiseRoyaltyService');

const describeDb = url ? describe : describe.skip;

describeDb('franchise territory royalty service', () => {
  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.franchise_applications (
      id SERIAL PRIMARY KEY,
      owner_user_id UUID REFERENCES users(id),
      desired_city TEXT,
      desired_region TEXT,
      status TEXT NOT NULL DEFAULT 'draft'
    )`);
    await db.query(`CREATE TABLE ${schema}.franchise_agreements (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES franchise_applications(id),
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
});
