'use strict';

// Group 14 Slice 5h acceptance: handle access changes (736-740).
// Runs against a dedicated fresh database (credit_statement_test_g14h) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
//   736 Missing scope recovery: a withheld dataset 403s with
//       investor_dataset_not_granted naming the dataset, and the
//       dashboard renders recovery copy instead of bare "No data" (D-779).
//   737 Audience removal notice: revoking an investor.reporting grant
//       sends invest_reporting_audience_removed (D-780).
//   738 Export cancellation status: the reporting document library
//       carries the cancellation detail for export jobs (D-781).
//   739 Access history: audience granted/changed/removed/suspended/
//       reinstated events are recorded and merged into the holder's
//       access history (D-782).
//   740 Retained scope selector: a re-approval may retain datasets and
//       entities from the prior audience, by explicit reviewer choice
//       only (D-783).
//
// Group 14 is READ-ONLY (D-408): nothing here moves money.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5H_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14h') {
    throw new Error('Group 14 Slice 5h DB tests require the loopback credit_statement_test_g14h database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'slice-5h-test-secret';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;
const runId = crypto.randomUUID().slice(0, 8);

describeDb('Group 14 Slice 5h: handle access changes (736-740)', () => {
  let pool;
  let app;
  let holder;
  let holderNoOverview;
  let holderNoScope;
  let noAudienceUser;
  let admin;
  let stranger;
  let superAdmin;
  let investorReviewer;
  let bizA;
  let bizB;
  let bizC;

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authAs = (user, req) => req.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getAs = (user, path) => authAs(user, request(app).get(path));
  const postAs = (user, path, body = {}) => authAs(user, request(app).post(path).set('Idempotency-Key', `slice-5h-${runId}-${crypto.randomUUID()}`)).send(body);

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Slice', '5h', $3, 'customer', TRUE, TRUE)`,
      [id, `slice-5h-${runId}-${id}@example.invalid`, role],
    );
    return { id, role };
  }

  async function makeBusiness(ownerId, name, type = 'llc') {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, business_type) VALUES ($1, $2, $3) RETURNING id`,
      [ownerId, name, type],
    );
    return Number(rows[0].id);
  }

  async function makeOpportunity(businessId, ownerId, status = 'published') {
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO investment_opportunities (business_id, created_by, title, purpose, target_cents, deadline_at, status, cancelled_at, closed_at)
       VALUES ($1, $2, $3, 'Slice 5h fixture', 100000, NOW() + INTERVAL '30 days', $4, $5, $6) RETURNING id`,
      [businessId, ownerId, `Opp ${runId} ${status}`, status, status === 'cancelled' ? now : null, status === 'closed' ? now : null],
    );
    return rows[0].id;
  }

  async function makeAgreementVersion(opportunityId, ownerId) {
    const { rows } = await pool.query(
      `INSERT INTO investment_agreement_versions (opportunity_id, version_number, content_hash, body, created_by)
       VALUES ($1, 1, 'slice5h', 'fixture agreement', $2) RETURNING id`,
      [opportunityId, ownerId],
    );
    return rows[0].id;
  }

  async function makeApplication(userId, opportunityId, status = 'approved') {
    const verified = status === 'approved';
    const { rows } = await pool.query(
      `INSERT INTO investment_participation_applications (user_id, opportunity_id, status, identity_verified, authority_verified, idempotency_key)
       VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`,
      [userId, opportunityId, status, verified, `slice-5h-app-${runId}-${crypto.randomUUID()}`],
    );
    return rows[0].id;
  }

  async function makeCommitment(userId, opportunityId, applicationId, agreementVersionId, status = 'reserved') {
    const { rows } = await pool.query(
      `INSERT INTO investment_commitments (user_id, opportunity_id, application_id, amount_cents, agreement_version_id, agreement_version_number, status, idempotency_key)
       VALUES ($1, $2, $3, 5000, $4, 1, $5, $6) RETURNING id`,
      [userId, opportunityId, applicationId, agreementVersionId, status, `slice-5h-commit-${runId}-${crypto.randomUUID()}`],
    );
    return rows[0].id;
  }

  async function makePosition(userId, opportunityId, commitmentId, agreementVersionId) {
    await pool.query(
      `INSERT INTO investment_positions (user_id, opportunity_id, commitment_id, amount_cents, agreement_version_id, agreement_version_number, status)
       VALUES ($1, $2, $3, 5000, $4, 1, 'active')`,
      [userId, opportunityId, commitmentId, agreementVersionId],
    );
  }

  async function grantReporting(userId, { datasets = ['overview', 'franchise'], entityIds = [], expiresAt = null } = {}) {
    const { rows: g } = await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'investor.reporting', 'self', 'self', 'active', 'admin', 'test-policy-1') RETURNING id`,
      [userId],
    );
    const grantId = g[0].id;
    await pool.query(
      `INSERT INTO investor_reporting_audiences (user_id, grant_id, audience_key, datasets, entity_ids, opportunity_ids, expires_at)
       VALUES ($1, $2, 'test-audience', $3, $4, $5, $6)`,
      [userId, grantId, datasets, entityIds, [], expiresAt],
    );
    return grantId;
  }

  async function grantReportingNoAudience(userId) {
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'investor.reporting', 'self', 'self', 'active', 'admin', 'test-policy-1')`,
      [userId],
    );
  }

  async function makeExportJob(userId, { product = 'oxsteed', format = 'csv', state = 'complete' } = {}) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const complete = state === 'complete';
    await pool.query(
      `INSERT INTO statement_export_jobs
         (id, requested_by, product, account_id, scope_id, currency_code, period_from, period_to,
          format, language, idempotency_key, request_hash, state, error_code,
          frozen_header, frozen_at, row_count, rows_rendered, manifest, source_hash, completed_at)
       VALUES ($1, $2, $3, 'acct-test', 'scope-test', 'USD', '2026-01-01', '2026-01-31',
          $4, 'en', $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15)`,
      [id, userId, product, format,
        `slice-5h-exp-${runId}-${crypto.randomUUID()}`, 'b'.repeat(64), state,
        complete ? null : 'test_failed',
        complete ? '{}' : null, complete ? now : null, complete ? 10 : null,
        complete ? 10 : 0, complete ? '{}' : null, complete ? 'a'.repeat(64) : null,
        complete ? now : null],
    );
    return id;
  }

  // 738 helper: a job whose cancellation is recorded in
  // statement_export_cancellations, with a known cancelled-at stamp.
  async function makeCancelledExportJob(userId, { product = 'oxsteed', format = 'csv', state = 'cancelled', cancelledAt = null } = {}) {
    const id = await makeExportJob(userId, { product, format, state });
    const stamp = cancelledAt || new Date(Date.now() - 3600 * 1000).toISOString();
    await pool.query(
      `INSERT INTO statement_export_cancellations (job_id, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, stamp],
    );
    await pool.query(`UPDATE statement_export_jobs SET updated_at = $2 WHERE id = $1`, [id, stamp]);
    return { id, cancelledAt: stamp };
  }

  async function makeRenderingExportJobWithCancelRequest(userId) {
    const id = await makeExportJob(userId, { product: 'business', format: 'pdf', state: 'rendering' });
    await pool.query(
      `INSERT INTO statement_export_cancellations (job_id, created_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING`,
      [id],
    );
    return id;
  }

  // 729/737/739/740 helpers: file an investor.reporting request the way
  // WP-077 seeds it and approve it through the real reviewer endpoint.
  async function seedInvestorRequest(user, requestedReports) {
    const { rows } = await pool.query(
      `INSERT INTO access_requests
         (applicant_id, capability, subject_type, subject_id, subject_key, status, policy_version,
          answers, source, return_to)
       VALUES ($1, 'investor.reporting', 'self', NULL, 'self', 'draft', 'investor-policy-2',
          $2::jsonb, 'in_context', NULL)
       RETURNING id`,
      [user.id, JSON.stringify({ audience: 'quarterly board', requestedReports, about: 'Board reporting' })],
    );
    const id = rows[0].id;
    const submitted = await postAs(user, `/api/me/access-requests/${id}/submit`, { expectedVersion: 1 });
    expect(submitted.status).toBe(200);
    return id;
  }

  async function approveInvestorRequest(requestId, extra = {}) {
    const approved = await postAs(investorReviewer, `/api/admin/access-requests/${requestId}/decision`, { decision: 'approve', expectedVersion: 2, ...extra });
    expect(approved.status).toBe(200);
    return approved.body;
  }

  async function audienceNotices(userId, type) {
    const { rows } = await pool.query(
      `SELECT type, title, body, action_url, data FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at ASC`,
      [userId, type],
    );
    return rows;
  }

  async function accessHistory(user) {
    const res = await getAs(user, '/api/me/access-history').expect(200);
    return res.body.events || [];
  }

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/investor', require('../routes/investor'));
    const progressiveAccess = require('../routes/progressiveAccess');
    app.use('/api/me', progressiveAccess.meRouter);
    app.use('/api/admin/access-requests', progressiveAccess.adminRouter);
    app.use(require('../middleware/errorHandler').errorHandler);

    // A failed run leaves its fixtures behind; clear every prior slice-5h
    // fixture business and its dependent rows so the platform-wide counts
    // are this run's alone. FK order: positions -> commitments ->
    // applications -> agreement versions -> opportunities -> businesses.
    await pool.query(`DELETE FROM investment_positions WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'BizH _ %')`);
    await pool.query(`DELETE FROM investment_commitments WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'BizH _ %')`);
    await pool.query(`DELETE FROM investment_participation_applications WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'BizH _ %')`);
    await pool.query(`DELETE FROM investment_agreement_versions WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'BizH _ %')`);
    await pool.query(`DELETE FROM investment_opportunities WHERE business_id IN (
      SELECT id FROM businesses WHERE business_name LIKE 'BizH _ %')`);
    await pool.query(`DELETE FROM businesses WHERE business_name LIKE 'BizH _ %'`);

    holder = await makeUser('customer');
    holderNoOverview = await makeUser('customer');
    holderNoScope = await makeUser('customer');
    admin = await makeUser('admin');
    stranger = await makeUser('customer');

    bizA = await makeBusiness(holder.id, `BizH A ${runId}`, 'llc');
    bizB = await makeBusiness(holder.id, `BizH B ${runId}`, 'corp');
    bizC = await makeBusiness(holder.id, `BizH C ${runId}`, 'partnership');

    const oppA1 = await makeOpportunity(bizA, holder.id, 'published');
    const oppB1 = await makeOpportunity(bizB, holder.id, 'published');
    const oppC1 = await makeOpportunity(bizC, holder.id, 'published');

    // Holder stakes in bizA and a position in bizC (not in the audience).
    const versionA1 = await makeAgreementVersion(oppA1, holder.id);
    const appA1 = await makeApplication(holder.id, oppA1, 'approved');
    const commitmentA1 = await makeCommitment(holder.id, oppA1, appA1, versionA1, 'reserved');
    await makePosition(holder.id, oppA1, commitmentA1, versionA1);
    const versionC1 = await makeAgreementVersion(oppC1, holder.id);
    const appC1 = await makeApplication(holder.id, oppC1, 'approved');
    const commitmentC1 = await makeCommitment(holder.id, oppC1, appC1, versionC1, 'reserved');
    await makePosition(holder.id, oppC1, commitmentC1, versionC1);

    await grantReporting(holder.id, { datasets: ['overview', 'franchise'], entityIds: [bizA, bizB] });
    await grantReporting(holderNoOverview.id, { datasets: ['revenue', 'franchise'], entityIds: [bizA] });
    await grantReporting(holderNoScope.id, { datasets: ['overview'], entityIds: [] });
    // A granted holder with no audience row at all (separate user).
    noAudienceUser = await makeUser('customer');
    await grantReportingNoAudience(noAudienceUser.id);

    // 738 fixtures: the holder's export jobs (a complete one is covered
    // by the 5f suite; here the cancelled and cancel-requested cases).
    await makeCancelledExportJob(holder.id, { product: 'oxsteed', format: 'csv', state: 'cancelled' });
    await makeRenderingExportJobWithCancelRequest(holder.id);
    await makeExportJob(holder.id, { product: 'business', format: 'pdf', state: 'complete' });

    // Reviewer fixtures (same shape as the 5f suite): real adminAuth runs
    // here, so the reviewer must be 2FA-enrolled.
    superAdmin = await makeUser('super_admin');
    investorReviewer = await makeUser('admin');
    await pool.query(`UPDATE users SET totp_enabled = TRUE WHERE id = $1`, [investorReviewer.id]);
    await pool.query(
      `INSERT INTO admin_permission_grants (grantor_id, grantee_id, permissions, expires_at)
       VALUES ($1, $2, $3::jsonb, NOW() + INTERVAL '1 day')`,
      [superAdmin.id, investorReviewer.id, JSON.stringify(['review_investor_access'])],
    );
  });

  afterAll(async () => { if (pool) await pool.end(); });

  test('736: a dataset the audience does not grant 403s with investor_dataset_not_granted and names the dataset', async () => {
    const res = await getAs(holder, '/api/investor/revenue-chart');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('investor_dataset_not_granted');
    expect(res.body.dataset).toBe('revenue');
    // The KPIs route is dataset-gated too: a holder without overview
    // cannot load the dashboard's first call at all.
    const kpis = await getAs(holderNoOverview, '/api/investor/kpis');
    expect(kpis.status).toBe(403);
    expect(kpis.body.code).toBe('investor_dataset_not_granted');
    expect(kpis.body.dataset).toBe('overview');
  });

  test('736: a granted holder with no audience row is refused, never platform-wide', async () => {
    // The middleware holds the capability (403 investor_audience_required
    // in enforce mode) or the downstream allowInvestor refuses; a
    // platform-wide list is the only outcome that fails this test.
    const res = await getAs(noAudienceUser, '/api/investor/reporting/entities');
    expect(res.status).toBe(403);
    if (res.body.code) expect(res.body.code).toBe('investor_audience_required');
  });

  test('736: a user without the grant is refused on the dataset routes', async () => {
    await getAs(stranger, '/api/investor/revenue-chart').expect(403);
    await getAs(stranger, '/api/investor/kpis').expect(403);
  });

  test('737: revoking an investor.reporting grant sends the removal notice, not a changed notice', async () => {
    const applicant = await makeUser('customer');
    const requestId = await seedInvestorRequest(applicant, ['overview']);
    const body = await approveInvestorRequest(requestId);
    const { rows: grantRows } = await pool.query(`SELECT version FROM access_grants WHERE id = $1`, [body.grantId]);
    const revoked = await postAs(investorReviewer, `/api/admin/access-requests/grants/${body.grantId}`, { action: 'revoke', expectedVersion: grantRows[0].version, reasonCode: 'policy_not_met' });
    expect(revoked.status).toBe(200);
    const removed = await audienceNotices(applicant.id, 'invest_reporting_audience_removed');
    expect(removed).toHaveLength(1);
    // The type sends through the real path with a non-empty title, and
    // the action points at Settings to re-apply — never at the dashboard
    // the removed holder can no longer open.
    expect(removed[0].title).toBe('Investor reporting access removed');
    expect(removed[0].body.length).toBeGreaterThan(0);
    expect(removed[0].action_url).toBe('/settings/applications');
    expect(removed[0].data.changeAction).toBe('revoke');
    expect(removed[0].data.reasonCode).toBe('policy_not_met');
    expect(await audienceNotices(applicant.id, 'invest_reporting_audience_changed')).toHaveLength(0);
  });

  test('737: suspending and reinstating an investor.reporting grant still send the changed notice', async () => {
    const applicant = await makeUser('customer');
    const requestId = await seedInvestorRequest(applicant, ['overview']);
    const body = await approveInvestorRequest(requestId);
    const { rows: grantRows } = await pool.query(`SELECT version FROM access_grants WHERE id = $1`, [body.grantId]);
    const suspended = await postAs(investorReviewer, `/api/admin/access-requests/grants/${body.grantId}`, { action: 'suspend', expectedVersion: grantRows[0].version, reasonCode: 'policy_not_met' });
    expect(suspended.status).toBe(200);
    let changed = await audienceNotices(applicant.id, 'invest_reporting_audience_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].data.changeAction).toBe('suspend');
    expect(changed[0].action_url).toBe('/investor/dashboard');
    const reinstated = await postAs(investorReviewer, `/api/admin/access-requests/grants/${body.grantId}`, { action: 'reinstate', expectedVersion: suspended.body.grant.version, reasonCode: 'review_complete' });
    expect(reinstated.status).toBe(200);
    changed = await audienceNotices(applicant.id, 'invest_reporting_audience_changed');
    expect(changed).toHaveLength(2);
    expect(changed[1].data.changeAction).toBe('reinstate');
    // No removal notice fires for a temporary suspension.
    expect(await audienceNotices(applicant.id, 'invest_reporting_audience_removed')).toHaveLength(0);
  });

  test('737: the removal type is registered on the whole notification surface', async () => {
    // The revoke test above proves the type sends end to end with a
    // non-empty title through the real notifyInvestor path (which
    // resolves copy from T). This test pins the rest of the registration
    // surface the skill names: catalog, i18n copy, email button, and the
    // email allow-list — each fails silently if missed.
    const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
    expect(NOTIFICATION_TYPES.map((entry) => entry.type)).toContain('invest_reporting_audience_removed');
    const fs = require('fs');
    const path = require('path');
    const i18nSrc = fs.readFileSync(path.join(__dirname, '../utils/i18n.js'), 'utf8');
    const tBlock = i18nSrc.slice(i18nSrc.indexOf('invest_reporting_audience_removed: {'));
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      expect(tBlock).toContain(`${lang}: '`);
    }
    expect(i18nSrc).toContain('invest_reporting_audience_removed: {\n      en: \'Request Access\'');
    const serviceSrc = fs.readFileSync(path.join(__dirname, '../services/notificationService.js'), 'utf8');
    expect(serviceSrc).toContain('invest_reporting_audience_removed');
  });
});
