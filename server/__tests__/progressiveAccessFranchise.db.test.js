'use strict';

jest.unmock('pg');

const crypto = require('crypto');

const RAW_URL = process.env.ACCESS_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname);
  } catch { return false; }
}
if (RAW_URL && !isDisposableDb(RAW_URL)) throw new Error('Progressive access DB tests require a loopback disposable database');
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.LOG_LEVEL = 'error';
}

jest.setTimeout(120000);

function captureResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

ddescribe('franchise activation grants progressive territory access', () => {
  let db;
  let franchise;
  let access;

  beforeAll(() => {
    db = require('../db');
    franchise = require('../controllers/franchiseController');
    access = require('../services/access/accessService');
  });

  afterAll(async () => {
    delete process.env.ACCESS_FRANCHISE_ENFORCEMENT;
    if (db) await db.end();
  });

  async function newUser(label) {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', $3, 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [id, `pa-franchise-${label}-${id}@example.invalid`, label],
    );
    return id;
  }

  async function preparedApplication(ownerUserId) {
    const program = (await db.query('SELECT id FROM franchise_programs ORDER BY id LIMIT 1')).rows[0];
    if (!program) throw new Error('franchise program fixture is missing');
    const application = (await db.query(
      `INSERT INTO franchise_applications (
         program_id, applicant_user_id, owner_user_id, first_name, last_name, email,
         desired_country, desired_region, desired_city, desired_brand_name, status,
         agreement_status, training_status, launch_readiness_status
       ) VALUES ($1, $2, $2, 'Franchise', 'Fixture', $3, 'US', 'OH', 'Columbus', 'Fixture Territory',
                 'approved', 'signed', 'completed', 'ready')
       RETURNING id`,
      [program.id, ownerUserId, `franchise-app-${ownerUserId}@example.invalid`],
    )).rows[0];
    await db.query(
      `INSERT INTO franchise_agreements (application_id, agreement_version, initial_fee_cents, currency, signed_at)
       VALUES ($1, 'fixture', 0, 'USD', NOW())`,
      [application.id],
    );
    await db.query(
      `INSERT INTO franchise_application_checklist_items (application_id, code, label, status)
       VALUES ($1, 'fixture_ready', 'Fixture ready', 'completed')`,
      [application.id],
    );
    return application.id;
  }

  test('activation grants only the owner and status revocation removes it', async () => {
    const owner = await newUser('owner');
    const foreign = await newUser('foreign');
    const applicationId = await preparedApplication(owner);

    const activated = captureResponse();
    await franchise.activateFranchiseStore({
      params: { id: applicationId },
      body: { business_name: 'Fixture Territory' },
      user: { id: owner },
    }, activated);
    expect(activated.statusCode).toBe(201);

    const grant = (await db.query(
      `SELECT user_id, capability, status, provenance_reason
         FROM access_grants
        WHERE user_id = $1 AND capability = 'franchise.operate' AND subject_key = 'self'`,
      [owner],
    )).rows[0];
    expect(grant).toMatchObject({ user_id: owner, capability: 'franchise.operate', status: 'active', provenance_reason: 'territory_assignment' });
    expect((await db.query(
      `SELECT 1 FROM access_grants WHERE user_id = $1 AND capability = 'franchise.operate'`,
      [foreign],
    )).rows).toHaveLength(0);

    process.env.ACCESS_FRANCHISE_ENFORCEMENT = 'enforce';
    expect((await access.can(owner, 'franchise.operate')).allowed).toBe(true);
    expect((await access.can(foreign, 'franchise.operate')).allowed).toBe(false);

    const revoked = captureResponse();
    await franchise.updateFranchiseApplication({
      params: { id: applicationId },
      body: { status: 'rejected' },
      user: { id: foreign },
    }, revoked);
    expect(revoked.statusCode).toBe(200);
    expect((await db.query(
      `SELECT status FROM access_grants WHERE user_id = $1 AND capability = 'franchise.operate' AND subject_key = 'self'`,
      [owner],
    )).rows[0].status).toBe('revoked');
    expect((await access.can(owner, 'franchise.operate')).allowed).toBe(false);
  });
});
