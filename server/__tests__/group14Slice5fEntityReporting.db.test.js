'use strict';

// Group 14 Slice 5f acceptance: view entity reporting (726-730).
// Runs against a dedicated fresh database (credit_statement_test_g14f) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
//   726 Entity summary: GET /investor/reporting/entities returns one card
//       per entity in the viewer's audience scope, with live/total raises
//       and the viewer's own live stakes; a holder with no entities sees
//       nothing, and an admin sees the platform-wide list (D-769).
//   727 Authorized KPI dataset: GET /investor/reporting/datasets (D-770).
//   728 Reporting document library: GET /investor/reporting/documents (D-771).
//   729 Audience change notice: invest_reporting_audience_* notices (D-772).
//   730 Entity reporting contact: GET /investor/reporting/entities/:id/contact (D-773).
//
// Group 14 is READ-ONLY (D-408): nothing here moves money.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5F_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14f') {
    throw new Error('Group 14 Slice 5f DB tests require the loopback credit_statement_test_g14f database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'slice-5f-test-secret';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;
const runId = crypto.randomUUID().slice(0, 8);

describeDb('Group 14 Slice 5f: view entity reporting (726-730)', () => {
  let pool;
  let app;
  let holder;
  let holderNoScope;
  let holderExpired;
  let holderAll;
  let noAudienceUser;
  let admin;
  let stranger;
  let superAdmin;
  let investorReviewer;
  let bizA;
  let bizB;
  let bizC;
  let bizD;
  let bizE;

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authAs = (user, req) => req.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getAs = (user, path) => authAs(user, request(app).get(path));
  const postAs = (user, path, body = {}) => authAs(user, request(app).post(path).set('Idempotency-Key', `slice-5f-${runId}-${crypto.randomUUID()}`)).send(body);

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Slice', '5f', $3, 'customer', TRUE, TRUE)`,
      [id, `slice-5f-${runId}-${id}@example.invalid`, role],
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
    // The table requires cancelled_at on cancelled rows and closed_at on
    // closed rows (CHECKs in 20261117123300).
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO investment_opportunities (business_id, created_by, title, purpose, target_cents, deadline_at, status, cancelled_at, closed_at)
       VALUES ($1, $2, $3, 'Slice 5f fixture', 100000, NOW() + INTERVAL '30 days', $4, $5, $6) RETURNING id`,
      [businessId, ownerId, `Opp ${runId} ${status}`, status, status === 'cancelled' ? now : null, status === 'closed' ? now : null],
    );
    return rows[0].id;
  }

  async function makeAgreementVersion(opportunityId, ownerId) {
    const { rows } = await pool.query(
      `INSERT INTO investment_agreement_versions (opportunity_id, version_number, content_hash, body, created_by)
       VALUES ($1, 1, 'slice5f', 'fixture agreement', $2) RETURNING id`,
      [opportunityId, ownerId],
    );
    return rows[0].id;
  }

  async function makeApplication(userId, opportunityId, status = 'approved') {
    // Approved applications require identity_verified AND authority_verified
    // (CHECK in 20261117123300).
    const verified = status === 'approved';
    const { rows } = await pool.query(
      `INSERT INTO investment_participation_applications (user_id, opportunity_id, status, identity_verified, authority_verified, idempotency_key)
       VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`,
      [userId, opportunityId, status, verified, `slice-5f-app-${runId}-${crypto.randomUUID()}`],
    );
    return rows[0].id;
  }

  async function makeCommitment(userId, opportunityId, applicationId, agreementVersionId, status = 'reserved') {
    const { rows } = await pool.query(
      `INSERT INTO investment_commitments (user_id, opportunity_id, application_id, amount_cents, agreement_version_id, agreement_version_number, status, idempotency_key)
       VALUES ($1, $2, $3, 5000, $4, 1, $5, $6) RETURNING id`,
      [userId, opportunityId, applicationId, agreementVersionId, status, `slice-5f-commit-${runId}-${crypto.randomUUID()}`],
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

  async function makeAuditRequest(requestedBy, title) {
    const { rows } = await pool.query(
      `INSERT INTO audit_requests (requested_by, title, audit_type, scope)
       VALUES ($1, $2, 'financial', 'Slice 5f fixture scope') RETURNING id`,
      [requestedBy, title],
    );
    return rows[0].id;
  }

  async function makeShare(auditRequestId, auditorId, createdBy, { expiresAt, revokedAt = null } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO audit_request_shares (audit_request_id, auditor_user_id, created_by, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [auditRequestId, auditorId, createdBy, expiresAt, revokedAt],
    );
    return rows[0].id;
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
        `slice-5f-exp-${runId}-${crypto.randomUUID()}`, 'b'.repeat(64), state,
        complete ? null : 'test_failed',
        complete ? '{}' : null, complete ? now : null, complete ? 10 : null,
        complete ? 10 : 0, complete ? '{}' : null, complete ? 'a'.repeat(64) : null,
        complete ? now : null],
    );
    return id;
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

    // A failed run leaves its fixtures behind (beforeAll has no
    // transaction); clear every prior slice-5f fixture business and its
    // dependent rows so the platform-wide counts are this run's alone.
    // FK order: positions -> commitments -> applications -> agreement
    // versions -> opportunities -> businesses.
    await pool.query(`DELETE FROM investment_positions WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'Biz _ %')`);
    await pool.query(`DELETE FROM investment_commitments WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'Biz _ %')`);
    await pool.query(`DELETE FROM investment_participation_applications WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'Biz _ %')`);
    await pool.query(`DELETE FROM investment_agreement_versions WHERE opportunity_id IN (
      SELECT o.id FROM investment_opportunities o JOIN businesses b ON b.id = o.business_id
      WHERE b.business_name LIKE 'Biz _ %')`);
    await pool.query(`DELETE FROM investment_opportunities WHERE business_id IN (
      SELECT id FROM businesses WHERE business_name LIKE 'Biz _ %')`);
    await pool.query(`DELETE FROM businesses WHERE business_name LIKE 'Biz _ %'`);

    holder = await makeUser('customer');
    holderNoScope = await makeUser('customer');
    holderExpired = await makeUser('customer');
    admin = await makeUser('admin');
    stranger = await makeUser('customer');

    bizA = await makeBusiness(holder.id, `Biz A ${runId}`, 'llc');
    bizB = await makeBusiness(holder.id, `Biz B ${runId}`, 'corp');
    bizC = await makeBusiness(holder.id, `Biz C ${runId}`, 'partnership');
    bizD = await makeBusiness(holder.id, `Biz D ${runId}`, 'llc');
    bizE = await makeBusiness(holder.id, `Biz E ${runId}`, 'llc');

    const oppA1 = await makeOpportunity(bizA, holder.id, 'published');
    const oppA2 = await makeOpportunity(bizA, holder.id, 'draft');
    const oppB1 = await makeOpportunity(bizB, holder.id, 'published');
    const oppC1 = await makeOpportunity(bizC, holder.id, 'published');
    await makeOpportunity(bizD, holder.id, 'cancelled');
    // bizE has no opportunities at all.

    // Holder stakes in bizA: an approved application, a reserved
    // commitment on it, an active position on it, plus a submitted
    // application on the draft raise.
    const versionA1 = await makeAgreementVersion(oppA1, holder.id);
    const appA1 = await makeApplication(holder.id, oppA1, 'approved');
    const commitmentA1 = await makeCommitment(holder.id, oppA1, appA1, versionA1, 'reserved');
    await makePosition(holder.id, oppA1, commitmentA1, versionA1);
    await makeApplication(holder.id, oppA2, 'submitted');
    // Holder also holds a position in bizC, which is NOT in the audience:
    // the audience, not the positions, is the authority.
    const versionC1 = await makeAgreementVersion(oppC1, holder.id);
    const appC1 = await makeApplication(holder.id, oppC1, 'approved');
    const commitmentC1 = await makeCommitment(holder.id, oppC1, appC1, versionC1, 'reserved');
    await makePosition(holder.id, oppC1, commitmentC1, versionC1);

    await grantReporting(holder.id, { entityIds: [bizA, bizB] });
    await grantReporting(holderNoScope.id, { entityIds: [] });
    // 730 fixture: the holder's investor.reporting grant row (created by
    // grantReporting above) was granted by the admin, so the
    // reporting-admin contact resolves.
    await pool.query(
      `UPDATE access_grants SET granted_by = $2 WHERE user_id = $1 AND capability = 'investor.reporting'`,
      [holder.id, admin.id],
    );
    // Distinct display names for the 730 contact tests (no other test
    // asserts user names).
    await pool.query(`UPDATE users SET first_name = 'Olivia', last_name = 'Owner' WHERE id = $1`, [holder.id]);
    await pool.query(`UPDATE users SET first_name = 'Adam', last_name = 'Admin' WHERE id = $1`, [admin.id]);
    await grantReporting(holderExpired.id, {
      entityIds: [bizA],
      expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    });
    holderAll = await makeUser('customer');
    await grantReporting(holderAll.id, { datasets: ['all'], entityIds: [bizA] });
    // A granted holder with no audience row at all (separate user).
    noAudienceUser = await makeUser('customer');
    await grantReportingNoAudience(noAudienceUser.id);

    // 728 fixtures: audit shares and export jobs for the holder.
    const auditReq1 = await makeAuditRequest(admin.id, `Audit ${runId} A`);
    const auditReq2 = await makeAuditRequest(admin.id, `Audit ${runId} B`);
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    await makeShare(auditReq1, holder.id, admin.id, { expiresAt: future });
    await makeShare(auditReq2, holder.id, admin.id, { expiresAt: past });
    await makeShare(auditReq1, holder.id, admin.id, { expiresAt: future, revokedAt: past });
    await makeShare(auditReq1, stranger.id, admin.id, { expiresAt: future });
    await makeExportJob(holder.id, { product: 'oxsteed', format: 'csv', state: 'complete' });
    await makeExportJob(holder.id, { product: 'business', format: 'pdf', state: 'failed' });
    await makeExportJob(stranger.id, { product: 'oxsteed', format: 'csv', state: 'complete' });

    // 729 fixtures: an investor reviewer (admin + review_investor_access).
    // Real adminAuth runs here (unlike the progressive-access suite, which
    // mocks it), so the reviewer must be 2FA-enrolled or requireAdmin
    // refuses with admin_2fa_required.
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

  test('726: the holder sees exactly the audience entities, with raises and stakes', async () => {
    const res = await getAs(holder, '/api/investor/reporting/entities').expect(200);
    expect(res.body.scope).toEqual({ type: 'position', entityIds: [bizA, bizB] });
    expect(res.body.audience.key).toBe('test-audience');
    expect(res.body.audience.datasets).toEqual(['overview', 'franchise']);
    expect(res.body.entities.map((e) => e.entityId).sort((a, b) => a - b)).toEqual([bizA, bizB].sort((a, b) => a - b));
    const a = res.body.entities.find((e) => e.entityId === bizA);
    expect(a.businessName).toBe(`Biz A ${runId}`);
    expect(a.opportunities).toEqual({ total: 2, live: 1 });
    expect(a.stakes).toEqual({ positions: 1, commitments: 1, applications: 2 });
    const b = res.body.entities.find((e) => e.entityId === bizB);
    expect(b.opportunities).toEqual({ total: 1, live: 1 });
    expect(b.stakes).toEqual({ positions: 0, commitments: 0, applications: 0 });
    // bizC is not in the audience even though the holder holds a position there.
    expect(res.body.entities.some((e) => e.entityId === bizC)).toBe(false);
  });

  test('726: a holder with an empty audience sees no entities', async () => {
    const res = await getAs(holderNoScope, '/api/investor/reporting/entities').expect(200);
    expect(res.body.entities).toEqual([]);
    expect(res.body.scope).toEqual({ type: 'position', entityIds: [] });
  });

  test('726: an admin sees the platform-wide list (businesses with a non-dead raise only)', async () => {
    const res = await getAs(admin, '/api/investor/reporting/entities').expect(200);
    expect(res.body.scope).toEqual({ type: 'platform_wide' });
    expect(res.body.audience).toBeNull();
    // Scope to this run's fixtures: other suites share nothing here, but
    // a prior failed run of this suite leaves its own Biz rows behind.
    const mine = res.body.entities.filter((e) => e.businessName.endsWith(runId));
    const ids = mine.map((e) => e.entityId);
    expect(ids).toContain(bizA);
    expect(ids).toContain(bizB);
    expect(ids).toContain(bizC);
    // bizD has only a cancelled raise; bizE has none: neither is listed.
    expect(mine.length).toBe(3);
  });

  test('726: a user without the grant is refused', async () => {
    await getAs(stranger, '/api/investor/reporting/entities').expect(403);
  });

  test('726: a granted holder with no audience row leaks no platform entities', async () => {
    const res = await getAs(noAudienceUser, '/api/investor/reporting/entities');
    // Either the middleware holds the capability (403) or the endpoint
    // fails closed to an empty position scope; a platform-wide list is
    // the only outcome that fails this test.
    if (res.status === 200) {
      expect(res.body.entities).toEqual([]);
      expect(res.body.scope.type).toBe('position');
    } else {
      expect(res.status).toBe(403);
    }
  });

  test('726: an expired audience leaks no entities', async () => {
    const res = await getAs(holderExpired, '/api/investor/reporting/entities');
    if (res.status === 200) {
      expect(res.body.entities).toEqual([]);
    } else {
      expect(res.status).toBe(403);
    }
  });

  test('727: the holder sees the granted flags for exactly the audience datasets', async () => {
    const res = await getAs(holder, '/api/investor/reporting/datasets').expect(200);
    expect(res.body.datasets.map((d) => d.id)).toEqual(
      ['overview', 'revenue', 'franchise', 'supply_demand', 'evidence', 'exports'],
    );
    const byId = Object.fromEntries(res.body.datasets.map((d) => [d.id, d]));
    expect(byId.overview.granted).toBe(true);
    expect(byId.franchise.granted).toBe(true);
    expect(byId.revenue.granted).toBe(false);
    expect(byId.supply_demand.granted).toBe(false);
    expect(byId.evidence.granted).toBe(false);
    expect(byId.exports.granted).toBe(false);
    expect(byId.overview.apiRoute).toBe('/investor/kpis');
    expect(byId.evidence.apiRoute).toBe('/investor/evidence/:metric');
    // exports is grantable but has no serving route yet: reported, not invented.
    expect(byId.exports.apiRoute).toBeNull();
  });

  test('727: an audience with all grants everything, and an admin sees everything', async () => {
    const allRes = await getAs(holderAll, '/api/investor/reporting/datasets').expect(200);
    expect(allRes.body.datasets.every((d) => d.granted)).toBe(true);
    const adminRes = await getAs(admin, '/api/investor/reporting/datasets').expect(200);
    expect(adminRes.body.datasets.every((d) => d.granted)).toBe(true);
    expect(adminRes.body.scope).toEqual({ type: 'platform_wide' });
  });

  test('727: a user without the grant is refused', async () => {
    await getAs(stranger, '/api/investor/reporting/datasets').expect(403);
  });

  // 729 helpers: file an investor.reporting request the way WP-077 seeds
  // it (the public flow refuses investor.reporting as invite-only) and
  // approve it through the real reviewer endpoint.
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

  async function approveInvestorRequest(requestId) {
    const approved = await postAs(investorReviewer, `/api/admin/access-requests/${requestId}/decision`, { decision: 'approve', expectedVersion: 2 });
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

  test('728: the holder sees exactly their own active shares and export jobs', async () => {
    const res = await getAs(holder, '/api/investor/reporting/documents').expect(200);
    const docs = res.body.documents;
    const shares = docs.filter((d) => d.kind === 'evidence_share');
    const exports = docs.filter((d) => d.kind === 'export');
    expect(shares.length).toBe(1);
    expect(shares[0].title).toBe(`Audit ${runId} A`);
    expect(shares[0].url).toBe('/statements/audit-requests');
    expect(new Date(shares[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The expired share, the revoked share, and the stranger's share are absent.
    expect(exports.length).toBe(2);
    const byProduct = Object.fromEntries(exports.map((e) => [e.product, e]));
    expect(byProduct.oxsteed.state).toBe('complete');
    expect(byProduct.oxsteed.format).toBe('CSV');
    expect(byProduct.oxsteed.url).toBe('/oxsteed-credit/statements/archive');
    expect(byProduct.business.state).toBe('failed');
    expect(byProduct.business.url).toBe('/business/statements');
    // Most recent first.
    for (let i = 1; i < docs.length; i++) {
      expect(new Date(docs[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(docs[i].createdAt).getTime());
    }
  });

  test('728: an admin sees only their own documents, never the platform', async () => {
    const res = await getAs(admin, '/api/investor/reporting/documents').expect(200);
    expect(res.body.documents).toEqual([]);
  });

  test('728: a user without the grant is refused', async () => {
    await getAs(stranger, '/api/investor/reporting/documents').expect(403);
  });

  test('729: approving an investor.reporting request sends the audience-granted notice', async () => {
    const applicant = await makeUser('customer');
    const requestId = await seedInvestorRequest(applicant, ['overview', 'revenue']);
    const body = await approveInvestorRequest(requestId);
    expect(body.audienceChange).toMatchObject({ kind: 'granted' });
    const notices = await audienceNotices(applicant.id, 'invest_reporting_audience_granted');
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('Investor reporting access granted');
    expect(notices[0].action_url).toBe('/investor/dashboard');
    expect(notices[0].data.datasets).toEqual(['overview', 'revenue']);
    expect(notices[0].data.entityCount).toBe(0);
    // The notice carries only the audience facts, never reviewer notes.
    expect(notices[0].body).not.toContain('quarterly board');
  });

  test('729: re-approval with different datasets sends the changed notice, and an identical re-approval sends nothing', async () => {
    const applicant = await makeUser('customer');
    const first = await seedInvestorRequest(applicant, ['overview', 'revenue']);
    await approveInvestorRequest(first);
    const second = await seedInvestorRequest(applicant, ['overview']);
    const changedBody = await approveInvestorRequest(second);
    expect(changedBody.audienceChange).toMatchObject({ kind: 'changed' });
    let changed = await audienceNotices(applicant.id, 'invest_reporting_audience_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].title).toBe('Investor reporting access changed');
    expect(changed[0].data.changeAction).toBe('approve');
    expect(changed[0].data.datasets).toEqual(['overview']);
    // Identical re-approval: same datasets, same audience key, same scope.
    const third = await seedInvestorRequest(applicant, ['overview']);
    const sameBody = await approveInvestorRequest(third);
    expect(sameBody.audienceChange).toBeNull();
    changed = await audienceNotices(applicant.id, 'invest_reporting_audience_changed');
    expect(changed).toHaveLength(1);
    expect(await audienceNotices(applicant.id, 'invest_reporting_audience_granted')).toHaveLength(1);
  });

  test('729: revoking an investor.reporting grant sends the changed notice', async () => {
    const applicant = await makeUser('customer');
    const requestId = await seedInvestorRequest(applicant, ['overview']);
    const body = await approveInvestorRequest(requestId);
    const { rows: grantRows } = await pool.query(`SELECT version FROM access_grants WHERE id = $1`, [body.grantId]);
    const revoked = await postAs(investorReviewer, `/api/admin/access-requests/grants/${body.grantId}`, { action: 'revoke', expectedVersion: grantRows[0].version, reasonCode: 'policy_not_met' });
    expect(revoked.status).toBe(200);
    const changed = await audienceNotices(applicant.id, 'invest_reporting_audience_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].data.changeAction).toBe('revoke');
    expect(changed[0].data.reasonCode).toBe('policy_not_met');
  });

  test('730: the holder in scope sees the owner and the granting admin, and no email', async () => {
    const res = await getAs(holder, `/api/investor/reporting/entities/${bizA}/contact`).expect(200);
    expect(res.body.entity).toMatchObject({ id: bizA, businessName: `Biz A ${runId}` });
    expect(res.body.contacts).toEqual([
      { kind: 'business_owner', displayName: 'Olivia Owner' },
      { kind: 'reporting_admin', displayName: 'Adam Admin' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('@');
    expect(JSON.stringify(res.body)).not.toContain('email');
  });

  test('730: the holder 404s for an entity outside the audience, even with a position in it', async () => {
    await getAs(holder, `/api/investor/reporting/entities/${bizC}/contact`).expect(404);
  });

  test('730: an admin sees the owner contact only, and 404s for a dead-only entity', async () => {
    const res = await getAs(admin, `/api/investor/reporting/entities/${bizA}/contact`).expect(200);
    expect(res.body.contacts).toEqual([{ kind: 'business_owner', displayName: 'Olivia Owner' }]);
    await getAs(admin, `/api/investor/reporting/entities/${bizD}/contact`).expect(404);
    await getAs(admin, `/api/investor/reporting/entities/${bizE}/contact`).expect(404);
  });

  test('730: a user without the grant is refused, and a missing entity 404s', async () => {
    await getAs(stranger, `/api/investor/reporting/entities/${bizA}/contact`).expect(403);
    await getAs(holder, '/api/investor/reporting/entities/999999999/contact').expect(404);
  });
});
