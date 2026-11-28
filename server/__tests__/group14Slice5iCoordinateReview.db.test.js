'use strict';

// Group 14 Slice 5i acceptance: coordinate review (741-745, D-784..D-788).
//   741 Accountant invitation: the owner/admin invites an external
//       accountant by email; the code is emailed, verification is public
//       (id + email + code), and accepting with the invited account
//       mints the 718 share grant, so the accountant becomes an auditor
//       on the request. Wrong codes lock the invitation after 5 attempts
//       (the bump runs outside any transaction, so a rollback cannot undo
//       it); the invitation itself grants nothing.
//   742 Audit scope review: the reviewing auditor records an explicit
//       acknowledgment of the scope (acknowledged / needs_clarification),
//       append-only; owner/admin cannot review their own scope.
//   743 Record correction request: the auditor asks for a correction to
//       a record (an approved evidence document, or a free-text
//       reference); the owner/admin resolves it addressed / declined.
//   744 Internal annotation thread: owner/admin-only notes on the
//       request; auditors get 403 on the sub-resource and the client
//       never fetches it for them.
//   745 Review completion notice: closing the request notifies the
//       requester and every auditor holding an active grant, through the
//       real send path (audit_review_completed, stored notification,
//       non-empty title); a notice failure never rolls back the close.
// Group 14 is READ-ONLY (D-408): nothing here moves money.
// Runs against a dedicated fresh database (credit_statement_test_g14i).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('../middleware/rateLimiter', () => ({
  creditMutationLimiter: (_req, _res, next) => next(),
  creditExportLimiter: (_req, _res, next) => next(),
  authenticatedLimiter: (_req, _res, next) => next(),
  strictLimiter: (_req, _res, next) => next(),
}));
// The real send path is observed, never sent: Expo + email mocked exactly
// like notificationsPrefsToggles.db.test.js.
const mockSendExpo = jest.fn();
jest.mock('expo-server-sdk', () => {
  const Expo = jest.fn().mockImplementation(() => ({
    chunkPushNotifications: jest.fn((messages) => [messages]),
    sendPushNotificationsAsync: (...args) => mockSendExpo(...args),
  }));
  Expo.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { Expo };
});
const mockSendEmail = jest.fn().mockResolvedValue({ success: true, id: 'email-test' });
jest.mock('../utils/email', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const crypto = require('crypto');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5I_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14i') {
    throw new Error('Group 14 Slice 5i DB tests require the loopback credit_statement_test_g14i database');
  }
  process.env.DATABASE_URL = dbUrl;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret';
process.env.STATEMENT_ARTIFACT_BUCKET = 'test-bucket';

jest.setTimeout(120000);

const describeDb = dbUrl ? describe : describe.skip;
const runId = crypto.randomUUID().slice(0, 8);
const PDF_BYTES = Buffer.from('%PDF-1.4 fake statement bytes for slice 5i');
const PDF_SHA = crypto.createHash('sha256').update(PDF_BYTES).digest('hex');

// In-memory private storage: the signed-link read-back round trip
// without any real bucket.
function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    async getObjectStream(objectKey) {
      const bytes = objects.get(objectKey);
      return bytes ? Readable.from([bytes]) : null;
    },
    async getSignedDownloadUrl(objectKey, ttl) {
      return `https://signed.test/${encodeURIComponent(objectKey)}?ttl=${ttl}`;
    },
  };
}

describeDb('Group 14 Slice 5i: coordinate review (741-745)', () => {
  let pool;
  let app;
  let storage;
  let owner;
  let auditor;
  let admin;
  let stranger;
  let documentId;
  let strangerDocumentId;

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const authAs = (user, req) => req.set('Authorization', `Bearer ${tokenFor(user)}`);
  const getAs = (user, path) => authAs(user, request(app).get(path));
  const postAs = (user, path, body) => authAs(user, request(app).post(path).send(body || {}));
  const patchAs = (user, path, body) => authAs(user, request(app).patch(path).send(body || {}));
  const createInput = (overrides = {}) => ({
    title: 'FY2026 year-end audit',
    auditType: 'financial',
    scope: 'All helper-earnings statements for FY2026, September close.',
    ...overrides,
  });

  async function makeUser(role, emailOverride) {
    const id = crypto.randomUUID();
    const email = emailOverride || `t5i-${role}-${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, role, email };
  }

  // A ready original artifact for one of the owner's statement documents,
  // so the auditor link endpoint has bytes to read back and sign.
  let seedAccountId = 100;
  async function seedDocument(userId) {
    const accountId = seedAccountId++;
    const snapshotId = crypto.randomUUID();
    const docId = crypto.randomUUID();
    const objectKey = `stmt/${crypto.randomUUID()}.pdf`;
    await pool.query(
      `INSERT INTO statement_snapshots
         (id, issuance_key, product, account_id, currency_code, period_from, period_to,
          cutoff_at, schema_version, row_count, total_credits_minor, total_debits_minor,
          opening_minor, closing_minor, source_hash, chunk_count, created_at)
       VALUES ($1, $2, 'oxsteed', $3, 'USD', '2026-09-01', '2026-09-30', NOW(), 1, 0, 0, 0, 0, 0, $4, 1, NOW())`,
      [snapshotId, `g14i-${runId}-${docId.slice(0, 8)}`, accountId, 'a'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO credit_statement_documents
         (id, customer_id, product, account_id, currency_code, period_from, period_to,
          generated_at, document, content_hash)
       VALUES ($1, $2, 'oxsteed', $3, 'USD', '2026-09-01', '2026-09-30', NOW(), '{}'::jsonb, $4)`,
      [docId, userId, accountId, 'a'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO statement_artifacts
         (id, snapshot_id, document_id, kind, language, renderer_version, template_version,
          font_version, byte_length, sha256, media_type, object_key, state, created_at, storage_bucket)
       VALUES ($1, $2, $3, 'original', 'en', 'creditStatementPdf/1', 'statement-template/1',
          'statement-fonts/1', $4, $5, 'application/pdf', $6, 'ready', NOW(), 'test-bucket')`,
      [crypto.randomUUID(), snapshotId, docId, PDF_BYTES.length, PDF_SHA, objectKey],
    );
    storage.objects.set(objectKey, PDF_BYTES);
    return docId;
  }

  async function createRequest(user = owner, overrides = {}) {
    const res = await postAs(user, '/api/audit-requests', createInput(overrides)).expect(201);
    return res.body.request;
  }

  async function grantShare(requestId, auditorUserId, by = owner) {
    const res = await postAs(by, `/api/audit-requests/${requestId}/shares`, { auditorUserId }).expect(201);
    return res.body.share;
  }

  async function countNotifications(userId, type) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2',
      [userId, type],
    );
    return rows[0].n;
  }

  // The one-time code from the most recent accountant-invite email.
  function lastInviteCode() {
    const calls = mockSendEmail.mock.calls.filter(
      ([args]) => String(args?.idempotencyKey || '').startsWith('audit-accountant-invite:'),
    );
    const last = calls[calls.length - 1];
    const match = String(last?.[0]?.text || '').match(/one-time code: (\d{8})/);
    return match ? match[1] : null;
  }

  async function inviteAccountant(requestId, email, by = owner, extra = {}) {
    const res = await postAs(by, `/api/audit-requests/${requestId}/invitations`, { email, ...extra }).expect(201);
    return res.body.invitation;
  }

  beforeAll(async () => {
    pool = require('../db');
    owner = await makeUser('customer');
    auditor = await makeUser('customer', `t5i-accountant-${runId}@example.invalid`);
    admin = await makeUser('super_admin');
    stranger = await makeUser('customer');
    storage = fakeStorage();
    documentId = await seedDocument(owner.id);
    strangerDocumentId = await seedDocument(stranger.id);
    const { createAuditRequestsRouter } = require('../routes/auditRequests');
    app = express();
    app.use(express.json());
    // Real staff notification path (notifySupportStaff -> sendNotification);
    // fake storage only for the signed-link read-back.
    app.use('/api/audit-requests', createAuditRequestsRouter({ storage }));
  });

  afterAll(async () => { if (pool) await pool.end(); });

  // 741: accountant invitation.
  test('741: invite validates, emails the code, and lists for owner/admin only', async () => {
    const created = await createRequest();
    const invited = await inviteAccountant(created.id, auditor.email);
    expect(invited.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(invited.email).toBe(auditor.email);
    expect(invited.status).toBe('pending');
    expect(new Date(invited.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The code went out by email and is not in the API response.
    const code = lastInviteCode();
    expect(code).toMatch(/^\d{8}$/);
    expect(JSON.stringify(invited)).not.toContain(code);
    // Validation: bad email, bad TTL, stranger, auditor (no standing yet).
    await postAs(owner, `/api/audit-requests/${created.id}/invitations`, { email: 'not-an-email' }).expect(400);
    await postAs(owner, `/api/audit-requests/${created.id}/invitations`, { email: auditor.email, expiresInSeconds: 60 }).expect(400);
    await postAs(stranger, `/api/audit-requests/${created.id}/invitations`, { email: auditor.email }).expect(404);
    await getAs(stranger, `/api/audit-requests/${created.id}/invitations`).expect(404);
    // The list is owner/admin only.
    const mine = await getAs(owner, `/api/audit-requests/${created.id}/invitations`).expect(200);
    expect(mine.body.invitations.map((item) => item.id)).toContain(invited.id);
    const adminList = await getAs(admin, `/api/audit-requests/${created.id}/invitations`).expect(200);
    expect(adminList.body.invitations.map((item) => item.id)).toContain(invited.id);
  });

  test('741: verify is public, wrong codes lock the invitation after 5 attempts', async () => {
    const created = await createRequest();
    const invited = await inviteAccountant(created.id, auditor.email);
    const code = lastInviteCode();
    // No auth header at all: verification is public.
    const verified = await request(app).post('/api/audit-requests/invitations/verify')
      .send({ invitationId: invited.id, email: auditor.email, code }).expect(200);
    expect(verified.body.invitationId).toBe(invited.id);
    expect(verified.body.email).toBe(auditor.email);
    // Wrong code and wrong email both answer the same generic 400.
    await request(app).post('/api/audit-requests/invitations/verify')
      .send({ invitationId: invited.id, email: auditor.email, code: '00000000' }).expect(400);
    await request(app).post('/api/audit-requests/invitations/verify')
      .send({ invitationId: invited.id, email: 'someone-else@example.invalid', code }).expect(400);
    // Four more wrong codes: the fifth wrong attempt locks the
    // invitation (429), and the right code is refused while locked.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).post('/api/audit-requests/invitations/verify')
        .send({ invitationId: invited.id, email: auditor.email, code: '00000000' }).expect(400);
    }
    await request(app).post('/api/audit-requests/invitations/verify')
      .send({ invitationId: invited.id, email: auditor.email, code: '00000000' }).expect(429);
    await request(app).post('/api/audit-requests/invitations/verify')
      .send({ invitationId: invited.id, email: auditor.email, code }).expect(429);
  });

  test('741: accept binds the invited account and mints the share grant', async () => {
    const created = await createRequest();
    const invited = await inviteAccountant(created.id, auditor.email);
    const code = lastInviteCode();
    // The wrong account cannot accept: the code proves the invitation,
    // the account must own the invited email.
    await postAs(stranger, '/api/audit-requests/invitations/accept',
      { invitationId: invited.id, email: auditor.email, code }).expect(403);
    // Unauthenticated accept is refused.
    await request(app).post('/api/audit-requests/invitations/accept')
      .send({ invitationId: invited.id, email: auditor.email, code }).expect(401);
    const accepted = await postAs(auditor, '/api/audit-requests/invitations/accept',
      { invitationId: invited.id, email: auditor.email, code }).expect(200);
    expect(accepted.body.invitation.status).toBe('accepted');
    expect(accepted.body.invitation.acceptedBy).toBe(auditor.id);
    expect(accepted.body.share.active).toBe(true);
    expect(accepted.body.share.auditorUserId).toBe(auditor.id);
    // The grant inherits the invitation's remaining lifetime.
    expect(accepted.body.share.expiresAt).toBe(invited.expiresAt);
    expect(accepted.body.shareReplayed).toBe(false);
    // The accountant is now an auditor on the request.
    const detail = await getAs(auditor, `/api/audit-requests/${created.id}`).expect(200);
    expect(detail.body.request.access).toBe('auditor');
    // A second accept with the same code fails: the invitation is spent.
    await postAs(auditor, '/api/audit-requests/invitations/accept',
      { invitationId: invited.id, email: auditor.email, code }).expect(400);
  });

  test('741: accept replays when an active share already exists, and refuses a closed request', async () => {
    const created = await createRequest();
    await grantShare(created.id, auditor.id);
    const invited = await inviteAccountant(created.id, auditor.email);
    const code = lastInviteCode();
    const accepted = await postAs(auditor, '/api/audit-requests/invitations/accept',
      { invitationId: invited.id, email: auditor.email, code }).expect(200);
    expect(accepted.body.shareReplayed).toBe(true);
    expect(accepted.body.share.auditorUserId).toBe(auditor.id);
    // A closed request refuses the accept, and refuses new invitations.
    const closing = await createRequest();
    const closingInvite = await inviteAccountant(closing.id, auditor.email);
    const closingCode = lastInviteCode();
    await patchAs(owner, `/api/audit-requests/${closing.id}/status`, { status: 'closed' }).expect(200);
    await postAs(auditor, '/api/audit-requests/invitations/accept',
      { invitationId: closingInvite.id, email: auditor.email, code: closingCode }).expect(409);
    await postAs(owner, `/api/audit-requests/${closing.id}/invitations`, { email: auditor.email }).expect(409);
  });

  test('741: revoke closes the invitation; a revoked invitation verifies and accepts no more', async () => {
    const created = await createRequest();
    const invited = await inviteAccountant(created.id, auditor.email);
    const code = lastInviteCode();
    // Only the owner/admin can revoke; the auditor cannot.
    await grantShare(created.id, auditor.id);
    await postAs(auditor, `/api/audit-requests/${created.id}/invitations/${invited.id}/revoke`).expect(403);
    const revoked = await postAs(owner, `/api/audit-requests/${created.id}/invitations/${invited.id}/revoke`).expect(200);
    expect(revoked.body.invitation.status).toBe('revoked');
    await postAs(owner, `/api/audit-requests/${created.id}/invitations/${invited.id}/revoke`).expect(409);
    await request(app).post('/api/audit-requests/invitations/verify')
      .send({ invitationId: invited.id, email: auditor.email, code }).expect(400);
    await postAs(auditor, '/api/audit-requests/invitations/accept',
      { invitationId: invited.id, email: auditor.email, code }).expect(400);
  });

  // 742: audit scope review.
  test('742: the auditor acknowledges the scope; owner/admin cannot review it', async () => {
    const created = await createRequest();
    // No grant yet: the auditor cannot even see the request.
    await postAs(auditor, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged' }).expect(404);
    await grantShare(created.id, auditor.id);
    // Validation first.
    await postAs(auditor, `/api/audit-requests/${created.id}/scope-review`, { decision: 'maybe' }).expect(400);
    await postAs(auditor, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged', note: 'x'.repeat(1001) }).expect(400);
    const reviewed = await postAs(auditor, `/api/audit-requests/${created.id}/scope-review`, { decision: 'needs_clarification', note: 'Which months does September close cover?' }).expect(201);
    expect(reviewed.body.scopeReview.decision).toBe('needs_clarification');
    expect(reviewed.body.scopeReview.reviewerId).toBe(auditor.id);
    expect(reviewed.body.scopeReview.note).toBe('Which months does September close cover?');
    // The owner and the admin cannot review the scope: it is the
    // reviewer's acknowledgment, not theirs.
    await postAs(owner, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged' }).expect(403);
    await postAs(admin, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged' }).expect(403);
    await postAs(stranger, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged' }).expect(404);
    // A second review appends; the history reads oldest first.
    await postAs(auditor, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged' }).expect(201);
    const history = await getAs(owner, `/api/audit-requests/${created.id}/scope-review`).expect(200);
    expect(history.body.scopeReviews.map((item) => item.decision)).toEqual(['needs_clarification', 'acknowledged']);
    // A closed request refuses new reviews, but the history stays readable.
    await patchAs(owner, `/api/audit-requests/${created.id}/status`, { status: 'closed' }).expect(200);
    await postAs(auditor, `/api/audit-requests/${created.id}/scope-review`, { decision: 'acknowledged' }).expect(409);
    const afterClose = await getAs(auditor, `/api/audit-requests/${created.id}/scope-review`).expect(200);
    expect(afterClose.body.scopeReviews).toHaveLength(2);
  });

  // 743: record correction request.
  test('743: the auditor asks for a correction; the owner resolves it', async () => {
    const created = await createRequest();
    const proposed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(201);
    // No grant yet: the auditor cannot even see the request.
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { evidenceId: proposed.body.evidence.id, detail: 'Fix this.' }).expect(404);
    await grantShare(created.id, auditor.id);
    // A proposed (not yet approved) document cannot be corrected: the
    // auditor cannot see it, so it answers 404, same as the archive.
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { evidenceId: proposed.body.evidence.id, detail: 'Fix this.' }).expect(404);
    await postAs(admin, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(200);
    // Validation: no target, no detail, detail too long.
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { detail: 'Fix this.' }).expect(400);
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { evidenceId: proposed.body.evidence.id }).expect(400);
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { evidenceId: proposed.body.evidence.id, detail: 'x'.repeat(2001) }).expect(400);
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { evidenceId: crypto.randomUUID(), detail: 'Fix this.' }).expect(404);
    const asked = await postAs(auditor, `/api/audit-requests/${created.id}/corrections`,
      { evidenceId: proposed.body.evidence.id, detail: 'The September total is off by one cent; please re-issue.' }).expect(201);
    expect(asked.body.correction.status).toBe('requested');
    expect(asked.body.correction.evidenceId).toBe(proposed.body.evidence.id);
    expect(asked.body.correction.requestedBy).toBe(auditor.id);
    // A free-text reference works when no evidence row applies.
    const byRef = await postAs(auditor, `/api/audit-requests/${created.id}/corrections`,
      { recordRef: 'September statement, line 12', detail: 'The merchant name is misspelled.' }).expect(201);
    expect(byRef.body.correction.recordRef).toBe('September statement, line 12');
    expect(byRef.body.correction.evidenceId).toBeNull();
    // The owner and the admin cannot ask for a correction; only the
    // reviewer can. The stranger sees nothing.
    await postAs(owner, `/api/audit-requests/${created.id}/corrections`, { recordRef: 'x', detail: 'y' }).expect(403);
    await postAs(admin, `/api/audit-requests/${created.id}/corrections`, { recordRef: 'x', detail: 'y' }).expect(403);
    await postAs(stranger, `/api/audit-requests/${created.id}/corrections`, { recordRef: 'x', detail: 'y' }).expect(404);
    // Resolution: the auditor cannot resolve; bad status is refused;
    // only a requested correction resolves, once.
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections/${asked.body.correction.id}/resolve`, { status: 'addressed' }).expect(403);
    await postAs(owner, `/api/audit-requests/${created.id}/corrections/${asked.body.correction.id}/resolve`, { status: 'maybe' }).expect(400);
    await postAs(owner, `/api/audit-requests/${created.id}/corrections/${crypto.randomUUID()}/resolve`, { status: 'addressed' }).expect(404);
    const resolved = await postAs(admin, `/api/audit-requests/${created.id}/corrections/${asked.body.correction.id}/resolve`,
      { status: 'addressed', resolutionNote: 'Re-issued; the corrected statement is in the archive.' }).expect(200);
    expect(resolved.body.correction.status).toBe('addressed');
    expect(resolved.body.correction.resolvedBy).toBe(admin.id);
    expect(resolved.body.correction.resolutionNote).toBe('Re-issued; the corrected statement is in the archive.');
    await postAs(owner, `/api/audit-requests/${created.id}/corrections/${asked.body.correction.id}/resolve`, { status: 'declined' }).expect(409);
    const queue = await getAs(owner, `/api/audit-requests/${created.id}/corrections`).expect(200);
    expect(queue.body.corrections.map((item) => item.status)).toEqual(['addressed', 'requested']);
    // A closed request refuses new corrections.
    await patchAs(owner, `/api/audit-requests/${created.id}/status`, { status: 'closed' }).expect(200);
    await postAs(auditor, `/api/audit-requests/${created.id}/corrections`, { recordRef: 'x', detail: 'y' }).expect(409);
  });

  // 744: internal annotation thread.
  test('744: internal notes stay owner/admin-only; auditors get 403', async () => {
    const created = await createRequest();
    await grantShare(created.id, auditor.id);
    // The auditor cannot write or read annotations; the stranger sees
    // nothing at all.
    await postAs(auditor, `/api/audit-requests/${created.id}/annotations`, { note: 'Snooping.' }).expect(403);
    await getAs(auditor, `/api/audit-requests/${created.id}/annotations`).expect(403);
    await postAs(stranger, `/api/audit-requests/${created.id}/annotations`, { note: 'Snooping.' }).expect(404);
    await getAs(stranger, `/api/audit-requests/${created.id}/annotations`).expect(404);
    // Validation: empty and over-long notes are refused.
    await postAs(owner, `/api/audit-requests/${created.id}/annotations`, { note: '' }).expect(400);
    await postAs(owner, `/api/audit-requests/${created.id}/annotations`, { note: 'x'.repeat(2001) }).expect(400);
    const first = await postAs(owner, `/api/audit-requests/${created.id}/annotations`,
      { note: 'Hold the September re-issue until the auditor confirms the cent.' }).expect(201);
    expect(first.body.annotation.authorId).toBe(owner.id);
    expect(first.body.annotation.note).toBe('Hold the September re-issue until the auditor confirms the cent.');
    await postAs(admin, `/api/audit-requests/${created.id}/annotations`,
      { note: 'Auditor confirmed; re-issue is in the archive.' }).expect(201);
    const thread = await getAs(admin, `/api/audit-requests/${created.id}/annotations`).expect(200);
    expect(thread.body.annotations.map((item) => item.authorId)).toEqual([owner.id, admin.id]);
    // The shared follow-up thread never carries annotations: the
    // auditor's message list shows no annotation text.
    const messages = await getAs(auditor, `/api/audit-requests/${created.id}/messages`).expect(200);
    expect(JSON.stringify(messages.body.messages)).not.toContain('Hold the September re-issue');
    // A closed request still takes internal notes.
    await patchAs(owner, `/api/audit-requests/${created.id}/status`, { status: 'closed' }).expect(200);
    await postAs(owner, `/api/audit-requests/${created.id}/annotations`, { note: 'Closed; file the receipt with the return.' }).expect(201);
    const afterClose = await getAs(owner, `/api/audit-requests/${created.id}/annotations`).expect(200);
    expect(afterClose.body.annotations).toHaveLength(3);
  });

  // 745: review completion notice.
  test('745: closing notifies the requester and the active-grant auditors', async () => {
    const created = await createRequest();
    const beforeOwner = await countNotifications(owner.id, 'audit_review_completed');
    const beforeAuditor = await countNotifications(auditor.id, 'audit_review_completed');
    const beforeStranger = await countNotifications(stranger.id, 'audit_review_completed');
    await grantShare(created.id, auditor.id);
    // A revoked grant hears nothing: grant the stranger, then revoke.
    const strangerShare = await grantShare(created.id, stranger.id);
    await postAs(owner, `/api/audit-requests/${created.id}/shares/${strangerShare.id}/revoke`).expect(200);
    await patchAs(owner, `/api/audit-requests/${created.id}/status`, { status: 'in_review' }).expect(200);
    // Moving to review is not a completion: nobody is notified.
    expect(await countNotifications(owner.id, 'audit_review_completed')).toBe(beforeOwner);
    await patchAs(admin, `/api/audit-requests/${created.id}/status`, { status: 'closed' }).expect(200);
    expect(await countNotifications(owner.id, 'audit_review_completed')).toBe(beforeOwner + 1);
    expect(await countNotifications(auditor.id, 'audit_review_completed')).toBe(beforeAuditor + 1);
    expect(await countNotifications(stranger.id, 'audit_review_completed')).toBe(beforeStranger);
    const { rows: [note] } = await pool.query(
      `SELECT title, body, data FROM notifications
        WHERE user_id = $1 AND type = 'audit_review_completed' ORDER BY created_at DESC LIMIT 1`,
      [owner.id],
    );
    expect(note.title).toBeTruthy();
    expect(note.title.length).toBeGreaterThan(0);
    expect(note.data.auditRequestId).toBe(created.id);
  });

  test('745: the new type sends through the real send path with a non-empty title', async () => {
    const { sendNotification } = require('../services/notificationService');
    const result = await sendNotification({
      userId: admin.id,
      type: 'audit_review_completed',
      data: { auditRequestId: crypto.randomUUID(), title: 'Direct send proof' },
      sequence: `g14i-direct-${runId}-${crypto.randomUUID()}`,
    });
    expect(result.success).toBe(true);
    const { rows: [note] } = await pool.query(
      `SELECT title FROM notifications
        WHERE user_id = $1 AND type = 'audit_review_completed' ORDER BY created_at DESC LIMIT 1`,
      [admin.id],
    );
    expect(note.title).toBeTruthy();
    expect(note.title.length).toBeGreaterThan(0);
  });
});
