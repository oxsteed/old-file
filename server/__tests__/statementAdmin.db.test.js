'use strict';

/**
 * Disposable-DB behavior tests for the statement operations admin router.
 *
 * These run against the disposable `credit_statement_test` database only
 * (same convention as statementJobService.test.js): real migrations,
 * real immutability triggers, real grant rows. They prove:
 *   (c) the safe retry path cannot delete or modify an issued document;
 *   (d) the audit trail is append-only (update/delete of an audit row fails);
 *   (e) list/detail/audit responses never leak document bodies, signed links,
 *       or another run's jobs;
 *   (f) amendment self-approval is rejected against real data, and the
 *       maker-checker transition rules hold.
 *
 * Run with e.g.
 *   STATEMENT_JOB_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/statementAdmin.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */

jest.unmock('pg');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_JOB_TEST_DATABASE_URL || '';
const DISPOSABLE_URL = RAW_URL;

function isDisposableDatabase(urlText) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return false;
  }
  const localhost = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  return ['postgres:', 'postgresql:'].includes(url.protocol) && localhost
    && url.pathname === '/credit_statement_test';
}

const CAN_RUN_DB = isDisposableDatabase(DISPOSABLE_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  if (!CAN_RUN_DB) {
    // eslint-disable-next-line no-console
    console.log('statementAdmin DB tests skipped: set STATEMENT_JOB_TEST_DATABASE_URL to the disposable credit_statement_test database to run them');
  }
  expect(isDisposableDatabase('postgresql://postgres@127.0.0.1:54329/credit_statement_test?sslmode=disable')).toBe(true);
  expect(isDisposableDatabase('postgresql://testuser:testpass@localhost:5432/testdb')).toBe(false);
  expect(isDisposableDatabase(DISPOSABLE_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
process.env.DATABASE_URL = DISPOSABLE_URL;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');
const statementAdmin = require('../routes/statementAdmin');
const { logAdminAction } = require('../services/auditService');

const ADMIN_VIEWER = 'a0a0a0a0-0000-4000-8000-000000000001';
const ADMIN_OPERATOR = 'a0a0a0a0-0000-4000-8000-000000000002';
const ADMIN_APPROVER = 'a0a0a0a0-0000-4000-8000-000000000003';
const ADMIN_APPROVER_2 = 'a0a0a0a0-0000-4000-8000-000000000004';
const CUSTOMER_A = 'c0c0c0c0-0000-4000-8000-00000000000a';
const CUSTOMER_B = 'c0c0c0c0-0000-4000-8000-00000000000b';
const GRANTOR = 'a0a0a0a0-0000-4000-8000-000000000099';

const MARKER = 'SECRET_MARKER_DB_XYZ_9f8e7d6c';

function bearer(userId) {
  return `Bearer ${jwt.sign({ id: userId, role: 'admin' }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/statements', statementAdmin);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.statusCode || 500).json({ code: err.code || 'internal_error' });
  });
  return app;
}

async function applySqlFile(filename) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', filename), 'utf8');
  await pool.query(sql);
}

async function triggerExists(name) {
  const { rows } = await pool.query(
    'SELECT 1 FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal', [name]);
  return rows.length > 0;
}

ddescribe('statement admin on the disposable database', () => {
  let runA; let jobA; let runB;

  beforeAll(async () => {
    tokenRevocationService.isRevoked.mockResolvedValue(false);

    // Real migration files, verbatim.
    await applySqlFile('682_credit_statement_documents.sql');
    await applySqlFile('684_statement_artifacts.sql');
    await applySqlFile('686_statement_amendment_proposals.sql');

    // admin_audit_log: base table verbatim from 005_admin.sql, target_key
    // from 591, hash chain + immutability from 406, no-delete from 624.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
        action        VARCHAR(80) NOT NULL,
        target_type   VARCHAR(40),
        target_id     UUID,
        description   TEXT,
        ip_address    INET,
        user_agent    TEXT,
        before_state  JSONB,
        after_state   JSONB,
        created_at    TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_log(admin_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);
      ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS target_key VARCHAR(160);
    `);
    await applySqlFile('406_admin_audit_hash_chain.sql').catch(async (error) => {
      // Idempotent reruns: once the triggers exist, 406's backfill UPDATE
      // hits the immutability trigger on leftover rows. Skip in that case.
      if (await triggerExists('trg_admin_audit_immutable')) return;
      throw error;
    });
    if (!(await triggerExists('admin_audit_log_no_delete'))) {
      await pool.query(`
      -- Verbatim from 624_ws5_audit_evidence_guards.sql (admin_audit_log portion).
      CREATE OR REPLACE FUNCTION reject_audit_log_delete()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit log table % is append-only; DELETE is not permitted', TG_TABLE_NAME
          USING ERRCODE = '55000';
        RETURN NULL;
      END;
      $$;
      DROP TRIGGER IF EXISTS admin_audit_log_no_delete ON admin_audit_log;
      CREATE TRIGGER admin_audit_log_no_delete
        BEFORE DELETE ON admin_audit_log
        FOR EACH ROW EXECUTE FUNCTION reject_audit_log_delete();
      `);
    }

    // admin_permission_grants: table + index verbatim from 049.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_permission_grants (
        id          BIGSERIAL   PRIMARY KEY,
        grantor_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grantee_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permissions JSONB       NOT NULL DEFAULT '[]',
        expires_at  TIMESTAMPTZ NOT NULL,
        revoked_at  TIMESTAMPTZ,
        revoked_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_perm_grants_grantee ON admin_permission_grants(grantee_id);
      -- 115/119 add region_id on the real chain; the grant lookup reads it.
      ALTER TABLE admin_permission_grants ADD COLUMN IF NOT EXISTS region_id INTEGER;
    `);

    // Minimal delegation_grants so the permission middleware's delegated-grant
    // UNION ALL can run on the disposable schema (empty: no delegations).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS delegation_grants (
        id BIGSERIAL PRIMARY KEY,
        grantor_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grantee_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Users (disposable schema predates totp_enabled; add it to mirror prod).
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE');
    for (const [id, email, role] of [
      [ADMIN_VIEWER, 'viewer@invalid', 'admin'],
      [ADMIN_OPERATOR, 'operator@invalid', 'admin'],
      [ADMIN_APPROVER, 'approver@invalid', 'admin'],
      [ADMIN_APPROVER_2, 'approver2@invalid', 'super_admin'],
      [GRANTOR, 'grantor@invalid', 'super_admin'],
      [CUSTOMER_A, 'customer-a@invalid', 'customer'],
      [CUSTOMER_B, 'customer-b@invalid', 'customer'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
         VALUES ($1, $2, 'synthetic-unusable-hash', 'Stmt', 'Fixture', $3, TRUE, TRUE, TRUE)
         ON CONFLICT (id) DO UPDATE SET totp_enabled = TRUE, role = EXCLUDED.role`, [id, `${id}@example.invalid`, role]);
    }

    // Grants (real rows, real lookup semantics).
    await pool.query('DELETE FROM admin_permission_grants WHERE grantee_id = ANY($1)',
      [[ADMIN_VIEWER, ADMIN_OPERATOR, ADMIN_APPROVER, ADMIN_APPROVER_2]]);
    const grant = async (grantee, permissions) => {
      await pool.query(
        `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at)
         VALUES ($1, $2, $3::jsonb, NOW() + interval '1 day')`, [GRANTOR, grantee, JSON.stringify(permissions)]);
    };
    await grant(ADMIN_VIEWER, ['view_financials']);
    await grant(ADMIN_OPERATOR, ['view_financials', 'manage_operations']);
    await grant(ADMIN_APPROVER, ['view_financials', 'manage_financials']);
    await grant(ADMIN_APPROVER_2, ['view_financials', 'manage_financials']);

    // Run-scoped fixtures are rebuilt per run (idempotent reruns).
    // Versions are immutable (DELETE is blocked by trigger, like issued
    // documents), and proposals are RESTRICT-referenced by versions, so
    // reset the amendment tables with TRUNCATE on the disposable test DB.
    await pool.query(`TRUNCATE statement_amendment_publication_attempts,
      statement_amendment_versions, statement_amendment_proposals`);
    await pool.query('DELETE FROM statement_account_jobs');
    await pool.query('DELETE FROM statement_issuance_runs');

    // Run A with a failed job and an issued document carrying a marker body.
    ({ rows: [runA] } = await pool.query(
      `INSERT INTO statement_issuance_runs (id, product, period_from, period_to, state, discovered_count)
       VALUES ($1, 'oxsteed', '2026-09-01', '2026-09-30', 'running', 1) RETURNING *`,
      [crypto.randomUUID()]));
    ({ rows: [jobA] } = await pool.query(
      `INSERT INTO statement_account_jobs
         (id, run_id, customer_id, product, account_id, currency_code, state,
          attempt_count, max_attempts, issuance_key, last_error)
       VALUES ($1, $2, $3, 'oxsteed', 4242, 'USD', 'failed', 2, 8,
               'stmt:v1:oxsteed:4242:USD:2026-09-01:2026-09-30:ca', 'worker crashed')
       RETURNING *`, [crypto.randomUUID(), runA.id, CUSTOMER_A]));
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES ($1, $2, 'oxsteed', 4242, 'USD', '2026-09-01', '2026-09-30',
               NOW(), $3::jsonb, $4)
       ON CONFLICT (customer_id, product, account_id, currency_code, period_from, period_to)
       DO NOTHING`,
      [crypto.randomUUID(), CUSTOMER_A,
        JSON.stringify({ marker: MARKER, lines: [{ label: 'secret line item', amount: 1 }] }),
        crypto.createHash('sha256').update('marker-body').digest('hex')]);

    // Run B (another scope): its jobs must never appear in run A's detail.
    ({ rows: [runB] } = await pool.query(
      `INSERT INTO statement_issuance_runs (id, product, period_from, period_to, state, discovered_count)
       VALUES ($1, 'restaurant', '2026-09-01', '2026-09-30', 'running', 1) RETURNING *`,
      [crypto.randomUUID()]));
    await pool.query(
      `INSERT INTO statement_account_jobs
         (id, run_id, customer_id, product, account_id, currency_code, state,
          attempt_count, max_attempts, issuance_key, last_error)
       VALUES ($1, $2, $3, 'restaurant', 777, 'USD', 'dead_letter', 8, 8,
               'stmt:v1:restaurant:777:USD:2026-09-01:2026-09-30:cb', 'unrecoverable')
       RETURNING *`, [crypto.randomUUID(), runB.id, CUSTOMER_B]);
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  test('(a) grant matrix: super_admin positive control + known grant-lookup limitation', async () => {
    // Positive control: a super_admin passes requireAdmin + requirePermission
    // (isSuper bypass) and can drive the operator endpoints against real data.
    const runs = await request(buildApp())
      .get('/api/admin/statements/ops/runs')
      .set('Authorization', bearer(GRANTOR))
      .expect(200);
    expect(Array.isArray(runs.body.items)).toBe(true);

    const paused = await request(buildApp())
      .post(`/api/admin/statements/ops/runs/${runA.id}/pause`)
      .set('Authorization', bearer(GRANTOR))
      .send({ reason: 'db positive control' })
      .expect(200);
    expect(paused.body.state).toBe('paused');
    const resumed = await request(buildApp())
      .post(`/api/admin/statements/ops/runs/${runA.id}/resume`)
      .set('Authorization', bearer(GRANTOR))
      .send({ reason: 'db positive control' })
      .expect(200);
    expect(resumed.body.state).toBe('running');

    // GRANT LOOKUP (fixed in 13807fca, 2026-10-05): GRANT_LOOKUP_SQL in
    // server/middleware/adminAuth.js previously ended its UNION ALL with
    // `ORDER BY (region_id IS NULL) DESC`, which PostgreSQL rejects, so the
    // lookup threw and requirePermission returned 500 for non-super-admin
    // admins. The ORDER BY is now `region_id NULLS FIRST` (valid in a UNION),
    // so the real middleware answers from the live grants. The full grant
    // matrix (viewer/operator/approver/denied, revoked grant, revoked
    // session) is covered with the REAL middleware in statementAdmin.test.js
    // (mocked DB layer, so the SQL never executes).
    const { hasGlobalGrant } = require('../middleware/adminAuth');
    await expect(hasGlobalGrant(ADMIN_OPERATOR, 'manage_operations')).resolves.toBe(true);
    await expect(hasGlobalGrant(ADMIN_VIEWER, 'manage_operations')).resolves.toBe(false);
    await expect(hasGlobalGrant(ADMIN_VIEWER, 'view_financials')).resolves.toBe(true);
  });

  test('(c) retry re-queues the job and cannot touch the issued document', async () => {
    // Scope to this run's customer: other suites share the disposable DB and
    // may hold their own account 4242 documents (unique per customer).
    const before = await pool.query(
      'SELECT document, content_hash FROM credit_statement_documents WHERE account_id = 4242 AND customer_id = $1',
      [CUSTOMER_A]);
    expect(before.rows).toHaveLength(1);

    const res = await request(buildApp())
      .post(`/api/admin/statements/ops/jobs/${jobA.id}/retry`)
      .set('Authorization', bearer(GRANTOR))
      .send({ reason: 'worker recovered' })
      .expect(200);
    expect(res.body.state).toBe('pending');

    const after = await pool.query(
      'SELECT document, content_hash FROM credit_statement_documents WHERE account_id = 4242 AND customer_id = $1',
      [CUSTOMER_A]);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].content_hash).toBe(before.rows[0].content_hash);
    expect(after.rows[0].document).toEqual(before.rows[0].document);

    // The immutability trigger guards the retry path: no code path can
    // rewrite issued evidence through the database.
    await expect(pool.query(
      `UPDATE credit_statement_documents SET document = '{}'::jsonb WHERE account_id = 4242`
    )).rejects.toThrow(/immutable/i);
    await expect(pool.query(
      'DELETE FROM credit_statement_documents WHERE account_id = 4242'
    )).rejects.toThrow(/immutable/i);

    // The retry itself was audited through the fail-closed chain.
    const { rows: [audit] } = await pool.query(
      `SELECT action FROM admin_audit_log
       WHERE action = 'statement.job.retry' AND target_key = $1`, [jobA.issuance_key]);
    expect(audit).toBeDefined();
  });

  test('(d) the audit trail is append-only', async () => {
    // logAdminAction resolves (no throw) on a successful fail-closed write.
    await logAdminAction({
      adminId: ADMIN_OPERATOR,
      action: 'statement.run.pause',
      targetType: 'statement_run',
      targetId: runA.id,
      description: 'append-only probe',
      throwOnError: true,
    });

    const { rows: [inserted] } = await pool.query(
      `SELECT id FROM admin_audit_log WHERE action = 'statement.run.pause'
       AND description = 'append-only probe' ORDER BY created_at DESC LIMIT 1`);
    expect(inserted).toBeDefined();

    await expect(pool.query(
      `UPDATE admin_audit_log SET description = 'tampered' WHERE id = $1`, [inserted.id]
    )).rejects.toThrow(/immutable/i);
    await expect(pool.query(
      'DELETE FROM admin_audit_log WHERE id = $1', [inserted.id]
    )).rejects.toThrow(/append-only/i);
  });

  test('(e) lists never leak document bodies, signed links, or other runs', async () => {
    // Re-arm the failed fixture: test (c) retried it first, which legitimately
    // moved it out of 'failed'.
    await pool.query(
      `UPDATE statement_account_jobs SET state = 'failed' WHERE id = $1`, [jobA.id]);
    // Plant the marker inside an ISSUED document's body + a fake signed link.
    // Issued evidence must never surface in any admin list or detail payload.
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES (gen_random_uuid(), $1, 'oxsteed', 4242, 'USD', '2026-09-01', '2026-09-30',
               NOW(), jsonb_build_object('body', 'BODY ' || $2, 'signed_link', 'https://r2.invalid/x?' || $2),
               '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
       ON CONFLICT DO NOTHING`, [CUSTOMER_A, MARKER]);
    const paths = [
      '/api/admin/statements/ops/runs',
      `/api/admin/statements/ops/runs/${runA.id}`,
      '/api/admin/statements/ops/failures',
      '/api/admin/statements/ops/alerts',
      '/api/admin/statements/audit',
    ];
    for (const path of paths) {
      const res = await request(buildApp())
        .get(path)
        .set('Authorization', bearer(GRANTOR))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(MARKER);
    }

    // Run A's detail contains only run A's jobs (scope isolation).
    const detail = await request(buildApp())
      .get(`/api/admin/statements/ops/runs/${runA.id}`)
      .set('Authorization', bearer(GRANTOR))
      .expect(200);
    const jobIds = detail.body.failures.map((f) => f.jobId);
    expect(jobIds).toContain(jobA.id);
    const { rows: runBJobs } = await pool.query(
      'SELECT id FROM statement_account_jobs WHERE run_id = $1', [runB.id]);
    for (const { id } of runBJobs) {
      expect(jobIds).not.toContain(id);
    }
  });

  test('(f) self-approval rejected; cross-approval works once and only once', async () => {
    const ownProposal = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_id, currency_code, period_from, period_to,
          reason, proposed_by)
       VALUES ($1, 'stmt:v1:y', 'oxsteed', 4242, 'USD', '2026-09-01', '2026-09-30',
               'fix a total', $2)`, [ownProposal, GRANTOR]);

    const self = await request(buildApp())
      .post(`/api/admin/statements/ops/amendments/${ownProposal}/approve`)
      .set('Authorization', bearer(GRANTOR))
      .send({ reason: 'approving my own proposal' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('statement_amendment_self_approval');

    const otherProposal = crypto.randomUUID();
    await pool.query(
      `INSERT INTO statement_amendment_proposals
         (id, issuance_key, product, account_id, currency_code, period_from, period_to,
          reason, proposed_by)
       VALUES ($1, 'stmt:v1:z', 'oxsteed', 4242, 'USD', '2026-09-01', '2026-09-30',
               'fix another total', $2)`, [otherProposal, ADMIN_APPROVER]);

    const other = await request(buildApp())
      .post(`/api/admin/statements/ops/amendments/${otherProposal}/approve`)
      .set('Authorization', bearer(ADMIN_APPROVER_2))
      .send({ reason: 'verified against ledger' })
      .expect(200);
    expect(other.body.proposal.status).toBe('approved');
    expect(other.body.proposal.decidedBy).toBe(ADMIN_APPROVER_2);

    const again = await request(buildApp())
      .post(`/api/admin/statements/ops/amendments/${otherProposal}/approve`)
      .set('Authorization', bearer(ADMIN_APPROVER_2))
      .send({ reason: 'duplicate' });
    expect(again.status).toBe(409);
  });
});
