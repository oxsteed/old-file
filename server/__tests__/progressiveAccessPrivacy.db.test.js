'use strict';

// WP-021 real-database acceptance. The test is opt-in to a loopback disposable
// database and never runs against a deployment database.
jest.unmock('pg');
const crypto = require('crypto');
const RAW_URL = process.env.ACCESS_TEST_DATABASE_URL || '';
function disposable(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname);
  } catch { return false; }
}
if (RAW_URL && !disposable(RAW_URL)) throw new Error('Progressive privacy DB tests require a loopback disposable database');
if (RAW_URL) process.env.DATABASE_URL = RAW_URL;
const describeDatabase = disposable(RAW_URL) ? describe : describe.skip;
const privacy = require('../services/access/privacy');

jest.setTimeout(120000);

describeDatabase('progressive access privacy retention', () => {
  let pool;
  let userId;
  let requestId;
  let decisionId;

  beforeAll(async () => {
    pool = require('../db');
    userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Privacy', 'Fixture', 'customer', 'customer', TRUE, TRUE)`,
      [userId, `pa-privacy-${userId}@example.invalid`],
    );
    ({ rows: [requestId] } = await pool.query(
      `INSERT INTO access_requests (applicant_id, capability, subject_key, status, policy_version, answers, source, submitted_at, decided_at)
       VALUES ($1, 'helper.offer_services', 'self', 'approved', 'v1', '{}'::jsonb, 'settings', NOW(), NOW()) RETURNING id`,
      [userId],
    ));
    ({ rows: [decisionId] } = await pool.query(
      `INSERT INTO access_request_decisions (request_id, action, from_status, to_status, request_version, actor_type, policy_version)
       VALUES ($1, 'approve', 'in_review', 'approved', 1, 'system', 'v1') RETURNING id`,
      [requestId.id],
    ));
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_key, status, provenance, source_request_id, source_decision_id, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'active', 'request', $2, $3, 'v1')`,
      [userId, requestId.id, decisionId.id],
    );
    await pool.query(
      `INSERT INTO access_projection_versions (user_id, version) VALUES ($1, 4)
       ON CONFLICT (user_id) DO UPDATE SET version = 4`, [userId],
    );
    await pool.query(
      `INSERT INTO access_outbox (event_type, user_id, payload, dedupe_key)
       VALUES ('access.granted', $1, '{}'::jsonb, $2)`, [userId, `pa-privacy-${userId}`],
    );
  });

  afterAll(async () => {
    // The disposable schema intentionally retains users for some financial
    // foreign keys; deactivate and anonymize the fixture instead of issuing a
    // broad DELETE that trips the database's SET NULL referential-integrity
    // rewrite.
    if (pool && userId) {
      await pool.query(
        `UPDATE users SET email = CONCAT('deleted_', id::text, '@oxsteed.removed'),
                          is_active = FALSE, deleted_at = NOW() WHERE id = $1`,
        [userId],
      );
    }
    if (pool) await pool.end();
  });

  test('exports request history, revokes active grants, and retains audit decisions', async () => {
    const exported = await privacy.exportData(pool, userId);
    expect(exported.progressive_access_requests).toHaveLength(1);
    expect(exported.progressive_access_grants[0]).toMatchObject({ capability: 'helper.offer_services', status: 'active' });
    expect(exported.progressive_access_decisions[0]).toMatchObject({ action: 'approve', actor_type: 'system' });
    expect(JSON.stringify(exported)).not.toContain('internal_note');

    await expect(privacy.revokeForDeletion(pool, userId)).resolves.toEqual({ revokedGrants: 1 });
    const state = await pool.query(
      `SELECT (SELECT status FROM access_grants WHERE user_id = $1) AS grant_status,
              (SELECT COUNT(*)::int FROM access_request_decisions WHERE request_id = $2) AS decision_count,
              (SELECT status FROM access_outbox WHERE user_id = $1) AS outbox_status`,
      [userId, requestId.id],
    );
    expect(state.rows[0]).toEqual({ grant_status: 'revoked', decision_count: 1, outbox_status: 'failed' });
  });
});
