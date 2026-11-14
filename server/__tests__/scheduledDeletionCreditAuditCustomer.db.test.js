'use strict';

// Domain 8 #15: oxsteed_credit_audit_events.customer_id is ON DELETE SET
// NULL (migration 421) while the table raises 55000 on any UPDATE/DELETE
// (migration 467 trigger, kept by 624). The retention guard in
// scheduledDeletionJob.js checked audit events by actor_user_id only, so a
// user referenced only as customer_id passed the guard and the job's
// DELETE FROM users raised 55000 (reproduced live against
// credit_statement_test before this fix), matching neither the 23503
// anonymize-plus-incident branch nor the 409 branch: generic log-only
// error, deletion_scheduled_at stays set, daily retry forever, no incident.
// hasCreditRecords must treat a customer_id-only reference as credit
// records so the user takes the anonymize path instead.
//
// partner_id is deliberately NOT added: it is a BIGINT FK to
// oxsteed_credit_partners, not a user id, so it can never match a user and
// comparing it to a UUID would be a type error. Partner ownership is
// already caught by the oxsteed_credit_partners created_by predicate.

jest.unmock('pg');
const crypto = require('crypto');
const { Pool } = require('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const { hasCreditRecords } = require('../jobs/scheduledDeletionJob');

const database = disposableDatabaseOptIn('STATEMENT_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.STATEMENT_TEST_DATABASE_URL = database;
}
const describeDatabase = database ? describe : describe.skip;

jest.setTimeout(180000);

test('Domain 8 #15 test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('Domain 8 #15: hasCreditRecords sees customer_id-only audit references', () => {
  let pool;
  const created = { users: [], resourceIds: [] };

  async function makeUser(emailPrefix) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', 'D8', 'Fifteen', 'customer', 'US', 'en')`,
      [id, `d8-15-${emailPrefix}-${id}@example.invalid`]
    );
    created.users.push(id);
    return id;
  }

  async function makeAuditEvent({ actorUserId, customerId }) {
    const resourceId = `d8-15-${crypto.randomUUID()}`;
    await pool.query(
      `INSERT INTO oxsteed_credit_audit_events (action_type, actor_user_id, customer_id, resource_type, resource_id)
       VALUES ('d8_15_probe', $1, $2, 'd8_repro', $3)`,
      [actorUserId, customerId, resourceId]
    );
    created.resourceIds.push(resourceId);
    return resourceId;
  }

  async function cleanupFixtures() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      if (created.resourceIds.length > 0) {
        await client.query(
          `DELETE FROM oxsteed_credit_audit_events WHERE resource_id = ANY($1::text[])`,
          [created.resourceIds]
        );
        created.resourceIds = [];
      }
      if (created.users.length > 0) {
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]);
        created.users = [];
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: database });
  });

  afterAll(async () => {
    if (pool) {
      try {
        await cleanupFixtures();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Domain 8 #15 test teardown failed:', error.message);
      } finally {
        await pool.end();
      }
    }
  });

  test('a user referenced only as customer_id in audit events has credit records', async () => {
    const customerOnly = await makeUser('customer-only');
    await makeAuditEvent({ actorUserId: null, customerId: customerOnly });
    const client = await pool.connect();
    try {
      await expect(
        hasCreditRecords(client, customerOnly, ['oxsteed_credit_audit_events'])
      ).resolves.toBe(true);
    } finally {
      client.release();
    }
  });

  test('a user with no audit references has no credit records (control)', async () => {
    const unreferenced = await makeUser('unreferenced');
    const client = await pool.connect();
    try {
      await expect(
        hasCreditRecords(client, unreferenced, ['oxsteed_credit_audit_events'])
      ).resolves.toBe(false);
    } finally {
      client.release();
    }
  });

  test('a user referenced only as actor_user_id still has credit records (no regression)', async () => {
    const actorOnly = await makeUser('actor-only');
    await makeAuditEvent({ actorUserId: actorOnly, customerId: null });
    const client = await pool.connect();
    try {
      await expect(
        hasCreditRecords(client, actorOnly, ['oxsteed_credit_audit_events'])
      ).resolves.toBe(true);
    } finally {
      client.release();
    }
  });
});
