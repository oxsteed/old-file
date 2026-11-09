'use strict';

// Gap fill 9-10 (PR #679 audit) on PostgreSQL: the manual official FX rate
// goes through two different admins; SAR drafts are edited with validation
// through PATCH /sar/:id; one day's audit anchor opens through
// GET /audit-anchors/:date as an audited read.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_LICENCE_GAP_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');

jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  verifyStepupChallenge: jest.fn(async () => ({ verified: true })),
}));

jest.setTimeout(120000);

test('SAR draft edits are validated before the database', () => {
  const { validateDraftEdit } = require('../services/creditCompliance/sarService');
  expect(() => validateDraftEdit({ narrative: 'x', activityFrom: '2026-01-01', activityTo: '2026-01-31', amountMinor: 1500, currencyCode: 'HTG' })).not.toThrow();
  expect(() => validateDraftEdit({})).not.toThrow();
  expect(() => validateDraftEdit({ amountMinor: -1 })).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  expect(() => validateDraftEdit({ amountMinor: 1.5 })).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  expect(() => validateDraftEdit({ currencyCode: 'htg' })).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  expect(() => validateDraftEdit({ activityFrom: '2026-13-45' })).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  expect(() => validateDraftEdit({ activityFrom: '2026-02-01', activityTo: '2026-01-01' })).toThrow(expect.objectContaining({ code: 'validation_failed' }));
  expect(() => validateDraftEdit({ narrative: { $ne: 1 } })).toThrow(expect.objectContaining({ code: 'validation_failed' }));
});

test('licence gap-fill 9-10 DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('credit licence gap fill 9-10', () => {
  let pool;
  let app;
  let admin1;
  let admin2;
  let pending;
  let request;

  async function createUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', 'Gap', 'Fill', $3)`,
      [id, `gapfill910-${role}-${id}@example.invalid`, role]
    );
    return id;
  }
  async function auditCount(actionType, resourceId) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM oxsteed_credit_audit_events WHERE action_type = $1 AND resource_id = $2 AND actor_user_id = $3',
      [actionType, String(resourceId), admin1]
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    pool = require('../db');
    pending = require('../services/oxsteedCreditPendingActionService');
    admin1 = await createUser('super_admin');
    admin2 = await createUser('super_admin');
    const express = require('express');
    const { errorHandler } = require('../middleware/errorHandler');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: admin1, role: 'super_admin' }; next(); });
    app.use('/', require('../routes/creditLicenceAdmin'));
    app.use(errorHandler);
    request = require('supertest');
  });
  afterAll(async () => { await pool.end?.(); });

  test('gap fill 9: a manual official rate needs a second, different admin', async () => {
    const rateDate = '2001-02-03';
    const payload = { quoteCurrency: 'HTG', unitsPerUsd: '131.25', rateDate, note: 'BRH taux de référence (page printed)' };
    const r = await pending.requestPendingAction({ actionType: 'credit_fx_reference_rate_entry', payload, requestedBy: admin1, idempotencyKey: `gf9-${crypto.randomUUID()}` });
    await expect(pending.decideOversightAction({ actionId: r.pendingAction.id, decision: 'approve', decidedBy: admin1, reason: 'self' }))
      .rejects.toMatchObject({ code: 'credit_self_approval_forbidden' });
    await pending.decideOversightAction({ actionId: r.pendingAction.id, decision: 'approve', decidedBy: admin2, reason: 'checked against BRH' });
    const { rows: [rate] } = await pool.query(
      `SELECT units_per_base::text AS units, entered_by::text, approved_by::text FROM credit_fx_reference_rates
        WHERE source = 'manual' AND base_currency = 'USD' AND quote_currency = 'HTG' AND rate_date = $1`, [rateDate]);
    expect(Number(rate.units)).toBeCloseTo(131.25, 6);
    expect(rate.entered_by).toBe(admin1);
    expect(rate.approved_by).toBe(admin2);
    // The template the UI pre-fills is exactly what the executor validates.
    const { validate } = require('../services/fx/manualReferenceRate');
    expect(() => validate({ quoteCurrency: 'HTG', unitsPerUsd: '', rateDate: 'YYYY-MM-DD', note: '' })).toThrow();
    expect(validate(payload)).toMatchObject({ quoteCurrency: 'HTG', units: '131.25', rateDate });
  });

  test('gap fill 10: SAR drafts are editable through PATCH only while they are drafts', async () => {
    const customer = await createUser('customer');
    const { rows: [kase] } = await pool.query(
      `INSERT INTO oxsteed_credit_compliance_cases (case_type, subject_type, subject_id, severity, status, sla_due_at, dedupe_key)
       VALUES ('manual', 'customer', $1, 'high', 'open', NOW() + INTERVAL '2 days', $2) RETURNING id`, [customer, `gapfill910:${customer}`]
    );
    const sar = await require('../services/creditCompliance/sarService').createDraft({ actorUserId: admin1, caseIds: [kase.id], narrative: 'Initial draft' });
    const narrative = 'Several cash-outs to new destinations within hours of a large inbound transfer from an unrelated account.';
    const ok = await request(app).patch(`/sar/${sar.id}`).send({ narrative, activityFrom: '2026-10-01', activityTo: '2026-10-15', amountMinor: 1250000, currencyCode: 'HTG' }).expect(200);
    expect(ok.body.report).toMatchObject({ narrative, currency_code: 'HTG' });
    expect(Number(ok.body.report.amount_minor)).toBe(1250000);
    expect(await auditCount('credit.sar.updated', sar.id)).toBe(1);
    await request(app).patch(`/sar/${sar.id}`).send({ amountMinor: -5 }).expect(400);
    await request(app).patch(`/sar/${sar.id}`).send({ activityFrom: '2026-10-20', activityTo: '2026-10-01' }).expect(400);
    await request(app).patch(`/sar/${sar.id}`).send({ currencyCode: 'dollars' }).expect(400);
    await request(app).post(`/sar/${sar.id}/submit`).send({}).expect(200);
    const locked = await request(app).patch(`/sar/${sar.id}`).send({ narrative: 'changed after submit' });
    expect(locked.status).toBe(404);
    expect(locked.body.code || locked.body.error?.code).toBe('sar_not_found');
  });

  test('gap fill 10: one day of audit anchors opens as an audited read', async () => {
    const date = '2001-02-03';
    const body = { date, chains: { credit: 'a'.repeat(64) } };
    const sha = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await pool.query(
      `INSERT INTO credit_audit_anchors (anchor_date, payload, payload_sha256) VALUES ($1, $2::jsonb, $3) ON CONFLICT (anchor_date) DO NOTHING`,
      [date, JSON.stringify(body), sha]);
    const res = await request(app).get(`/audit-anchors/${date}`).expect(200);
    expect(res.body.anchor_date).toBe(date);
    expect(res.body.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await auditCount('credit.audit_anchor.viewed', date)).toBeGreaterThanOrEqual(1);
    await request(app).get('/audit-anchors/1999-01-01').expect(404);
    await request(app).get('/audit-anchors/yesterday').expect(400);
    // A read that cannot be recorded is not served.
    const audit = require('../services/creditCompliance/audit');
    jest.spyOn(audit, 'insertComplianceAudit').mockRejectedValueOnce(new Error('audit down'));
    const failed = await request(app).get(`/audit-anchors/${date}`);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(failed.body)).not.toContain(res.body.payload_sha256);
    jest.restoreAllMocks();
  });
});
