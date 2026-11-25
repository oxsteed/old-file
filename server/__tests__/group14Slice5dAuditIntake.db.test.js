'use strict';

// Group 14 Slice 5d acceptance: support audits (716-720, D-430/D-431).
//   716 Audit request intake: POST creates a request (201), the admin
//       queue lists it, the owner sees it, a stranger sees nothing; the
//       creation notifies support staff through the REAL send path
//       (audit_request_received, stored notification, non-empty title).
//   717 Approved evidence selection: propose + approve marks evidence
//       approved-for-audit; the auditor's audit-scoped selection shows
//       approved evidence only; a stranger's document cannot be proposed.
//   718 Time-limited evidence share: a grant mints a time-limited signed
//       link for approved evidence; revocation kills the grant (link,
//       evidence list, and messages all 404 for the auditor afterwards).
//   719 Reviewer follow-up: a message thread on the request itself,
//       idempotent replay, owner + auditor participate, stranger gets 404.
//   720 Evidence package receipt: only the reviewing auditor records
//       receipt (owner gets 403); the receipt names the reviewer, the
//       timestamp, and the approved-evidence package snapshot.
// Group 14 is READ-ONLY (D-408): nothing here moves money.
// Runs against a dedicated fresh database (credit_statement_test_g14d).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
jest.mock('../middleware/rateLimiter', () => ({
  creditMutationLimiter: (_req, _res, next) => next(),
  creditExportLimiter: (_req, _res, next) => next(),
  authenticatedLimiter: (_req, _res, next) => next(),
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
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, id: 'email-test' }),
  sendOTPEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

const crypto = require('crypto');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP14_SLICE5D_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g14d') {
    throw new Error('Group 14 Slice 5d DB tests require the loopback credit_statement_test_g14d database');
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
const PDF_BYTES = Buffer.from('%PDF-1.4 fake statement bytes for slice 5d');
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

describeDb('Group 14 Slice 5d: support audits (716-720)', () => {
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

  async function makeUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE)`,
      [id, `t5d-${role}-${id}@example.invalid`, role],
    );
    return { id, role };
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
      [snapshotId, `g14d-${runId}-${docId.slice(0, 8)}`, accountId, 'a'.repeat(64)],
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

  async function countNotifications(userId, type) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2',
      [userId, type],
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    pool = require('../db');
    owner = await makeUser('customer');
    auditor = await makeUser('customer');
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

  // 716: audit request intake.
  test('716: intake creates a request, validates input, and queues it for the admin', async () => {
    const before = await countNotifications(admin.id, 'audit_request_received');
    const created = await postAs(owner, '/api/audit-requests', createInput()).expect(201);
    expect(created.body.request.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body.request.status).toBe('open');
    expect(created.body.request.auditType).toBe('financial');
    expect(created.body.request.requestedBy).toBe(owner.id);
    await postAs(owner, '/api/audit-requests', createInput({ auditType: 'nope' })).expect(400);
    await postAs(owner, '/api/audit-requests', createInput({ title: '' })).expect(400);
    await postAs(owner, '/api/audit-requests', createInput({ scope: '' })).expect(400);
    await postAs(owner, '/api/audit-requests', createInput({ auditorEmail: 'not-an-email' })).expect(400);
    await request(app).post('/api/audit-requests').send(createInput()).expect(401);
    // The queue: admin sees it, the owner sees their own, a stranger sees
    // an empty list and a 404 on detail (no existence leak).
    const queue = await getAs(admin, '/api/audit-requests?page=1&pageSize=20').expect(200);
    expect(queue.body.requests.map((item) => item.id)).toContain(created.body.request.id);
    const mine = await getAs(owner, '/api/audit-requests').expect(200);
    expect(mine.body.requests.map((item) => item.id)).toContain(created.body.request.id);
    const foreign = await getAs(stranger, '/api/audit-requests').expect(200);
    expect(foreign.body.requests.map((item) => item.id)).not.toContain(created.body.request.id);
    await getAs(stranger, `/api/audit-requests/${created.body.request.id}`).expect(404);
    const detail = await getAs(owner, `/api/audit-requests/${created.body.request.id}`).expect(200);
    expect(detail.body.request.title).toBe('FY2026 year-end audit');
    // The new request notified support staff through the real send path:
    // a stored notification of the new type with a non-empty title.
    expect(await countNotifications(admin.id, 'audit_request_received')).toBeGreaterThan(before);
    const { rows: [note] } = await pool.query(
      `SELECT title, body, data FROM notifications
        WHERE user_id = $1 AND type = 'audit_request_received' ORDER BY created_at DESC LIMIT 1`,
      [admin.id],
    );
    expect(note.title).toBeTruthy();
    expect(note.title.length).toBeGreaterThan(0);
    expect(note.data.auditRequestId).toBe(created.body.request.id);
  });

  test('716: the new type sends through the real send path with a non-empty title', async () => {
    const { sendNotification } = require('../services/notificationService');
    const result = await sendNotification({
      userId: admin.id,
      type: 'audit_request_received',
      data: { auditRequestId: crypto.randomUUID(), title: 'Direct send proof' },
      sequence: `g14d-direct-${runId}-${crypto.randomUUID()}`,
    });
    expect(result.success).toBe(true);
    const { rows: [note] } = await pool.query(
      `SELECT title FROM notifications
        WHERE user_id = $1 AND type = 'audit_request_received' ORDER BY created_at DESC LIMIT 1`,
      [admin.id],
    );
    expect(note.title).toBeTruthy();
    expect(note.title.length).toBeGreaterThan(0);
  });

  test('716: status walks open -> in_review -> closed, closed is terminal', async () => {
    const created = await createRequest();
    const moved = await patchAs(owner, `/api/audit-requests/${created.id}/status`, { status: 'in_review' }).expect(200);
    expect(moved.body.request.status).toBe('in_review');
    await patchAs(stranger, `/api/audit-requests/${created.id}/status`, { status: 'closed' }).expect(404);
    await patchAs(owner, `/api/audit-requests/${created.id}/status`, { status: 'open' }).expect(409);
    const closed = await patchAs(admin, `/api/audit-requests/${created.id}/status`, { status: 'closed' }).expect(200);
    expect(closed.body.request.status).toBe('closed');
    await patchAs(admin, `/api/audit-requests/${created.id}/status`, { status: 'in_review' }).expect(409);
  });

  // 717: approved evidence selection.
  test('717: propose + approve marks evidence approved-for-audit; the auditor sees approved only', async () => {
    const created = await createRequest();
    const proposed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(201);
    expect(proposed.body.evidence.status).toBe('proposed');
    expect(proposed.body.evidence.documentId).toBe(documentId);
    // A stranger's document cannot be proposed: 404, same as the archive.
    await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId: strangerDocumentId }).expect(404);
    await postAs(stranger, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(404);
    // Re-proposing the same document replays instead of duplicating.
    const replayed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.evidence.id).toBe(proposed.body.evidence.id);
    // No grant yet: the auditor cannot even see the request.
    await getAs(auditor, `/api/audit-requests/${created.id}/evidence`).expect(404);
    const approved = await postAs(admin, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(200);
    expect(approved.body.evidence.status).toBe('approved');
    expect(approved.body.evidence.decidedBy).toBe(admin.id);
    // Approving twice is a conflict; the auditor cannot approve.
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(409);
    // A second document, rejected, stays out of the auditor's selection.
    const secondDoc = await seedDocument(owner.id);
    const second = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId: secondDoc }).expect(201);
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${second.body.evidence.id}/reject`).expect(200);
    const granted = await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id }).expect(201);
    expect(granted.body.share.active).toBe(true);
    const auditorView = await getAs(auditor, `/api/audit-requests/${created.id}/evidence`).expect(200);
    expect(auditorView.body.evidence.map((item) => item.documentId)).toEqual([documentId]);
    const ownerView = await getAs(owner, `/api/audit-requests/${created.id}/evidence`).expect(200);
    expect(ownerView.body.evidence).toHaveLength(2);
  });

  // 718: time-limited evidence share.
  test('718: a grant mints a time-limited link; revocation kills it', async () => {
    const created = await createRequest();
    const proposed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(201);
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(200);
    // Grant validation: bad TTL, self-audit, unknown auditor.
    await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id, expiresInSeconds: 60 }).expect(400);
    await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: owner.id }).expect(400);
    await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: crypto.randomUUID() }).expect(404);
    const share = await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id, expiresInSeconds: 3600 }).expect(201);
    expect(new Date(share.body.share.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // A second active grant for the same auditor conflicts.
    await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id }).expect(409);
    // The auditor mints a time-limited signed link for approved evidence.
    const link = await getAs(auditor, `/api/audit-requests/${created.id}/evidence/${documentId}/link?ttlSeconds=300`).expect(200);
    expect(link.body.url).toMatch(/^https:\/\/signed\.test\//);
    expect(link.body.ttlSeconds).toBe(300);
    expect(new Date(link.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The owner can mint too; a stranger cannot mint, list, or read shares.
    await getAs(owner, `/api/audit-requests/${created.id}/evidence/${documentId}/link`).expect(200);
    await getAs(stranger, `/api/audit-requests/${created.id}/evidence/${documentId}/link`).expect(404);
    await getAs(auditor, `/api/audit-requests/${created.id}/shares`).expect(403);
    // Revocation closes the grant immediately: link, evidence list, and
    // messages all 404 for the auditor afterwards.
    const revoked = await postAs(owner, `/api/audit-requests/${created.id}/shares/${share.body.share.id}/revoke`).expect(200);
    expect(revoked.body.share.active).toBe(false);
    expect(revoked.body.share.revokedAt).toBeTruthy();
    await postAs(owner, `/api/audit-requests/${created.id}/shares/${share.body.share.id}/revoke`).expect(409);
    await getAs(auditor, `/api/audit-requests/${created.id}/evidence/${documentId}/link`).expect(404);
    await getAs(auditor, `/api/audit-requests/${created.id}/evidence`).expect(404);
    await getAs(auditor, `/api/audit-requests/${created.id}`).expect(404);
    // Re-granting after revocation works (the active-grant uniqueness is
    // scoped to unrevoked rows).
    const regranted = await postAs(admin, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id }).expect(201);
    expect(regranted.body.share.active).toBe(true);
    expect(regranted.body.share.id).not.toBe(share.body.share.id);
    await getAs(auditor, `/api/audit-requests/${created.id}/evidence/${documentId}/link`).expect(200);
  });

  test('718: an expired grant closes auditor access without any revocation', async () => {
    const created = await createRequest();
    const proposed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(201);
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(200);
    const share = await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id }).expect(201);
    await pool.query(`UPDATE audit_request_shares SET expires_at = NOW() - interval '1 hour' WHERE id = $1`, [share.body.share.id]);
    await getAs(auditor, `/api/audit-requests/${created.id}`).expect(404);
    await getAs(auditor, `/api/audit-requests/${created.id}/evidence/${documentId}/link`).expect(404);
  });

  // 719: reviewer follow-up.
  test('719: follow-up thread on the request, idempotent, stranger sees nothing', async () => {
    const created = await createRequest();
    const proposed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(201);
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(200);
    await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id }).expect(201);
    // No grant for the stranger: every thread call is 404.
    await getAs(stranger, `/api/audit-requests/${created.id}/messages`).expect(404);
    await postAs(stranger, `/api/audit-requests/${created.id}/messages`, { message: 'hello', idempotencyKey: crypto.randomUUID() }).expect(404);
    await postAs(auditor, `/api/audit-requests/${created.id}/messages`, { message: '', idempotencyKey: crypto.randomUUID() }).expect(400);
    await postAs(auditor, `/api/audit-requests/${created.id}/messages`, { message: 'x'.repeat(5001), idempotencyKey: crypto.randomUUID() }).expect(400);
    await postAs(auditor, `/api/audit-requests/${created.id}/messages`, { message: 'hello' }).expect(400);
    const key = crypto.randomUUID();
    const first = await postAs(auditor, `/api/audit-requests/${created.id}/messages`, {
      message: 'Please confirm the September close is final.',
      idempotencyKey: key,
    }).expect(201);
    expect(first.body.message.authorRole).toBe('customer');
    const replayed = await postAs(auditor, `/api/audit-requests/${created.id}/messages`, {
      message: 'Please confirm the September close is final.',
      idempotencyKey: key,
    }).expect(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.message.id).toBe(first.body.message.id);
    await postAs(auditor, `/api/audit-requests/${created.id}/messages`, {
      message: 'A different message.',
      idempotencyKey: key,
    }).expect(409);
    await postAs(owner, `/api/audit-requests/${created.id}/messages`, {
      message: 'Confirmed — the September close is final.',
      idempotencyKey: crypto.randomUUID(),
    }).expect(201);
    const thread = await getAs(admin, `/api/audit-requests/${created.id}/messages`).expect(200);
    expect(thread.body.messages).toHaveLength(2);
    expect(thread.body.messages[0].message).toMatch(/September close is final/);
    expect(thread.body.messages[1].message).toMatch(/Confirmed/);
  });

  // 720: evidence package receipt.
  test('720: only the reviewing auditor records receipt, with reviewer + timestamp + package', async () => {
    const created = await createRequest();
    const proposed = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId }).expect(201);
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${proposed.body.evidence.id}/approve`).expect(200);
    const secondDoc = await seedDocument(owner.id);
    const second = await postAs(owner, `/api/audit-requests/${created.id}/evidence`, { documentId: secondDoc }).expect(201);
    await postAs(owner, `/api/audit-requests/${created.id}/evidence/${second.body.evidence.id}/approve`).expect(200);
    await postAs(owner, `/api/audit-requests/${created.id}/shares`, { auditorUserId: auditor.id }).expect(201);
    // The owner and the admin cannot receipt on the reviewer's behalf.
    await postAs(owner, `/api/audit-requests/${created.id}/receipts`, {}).expect(403);
    await postAs(admin, `/api/audit-requests/${created.id}/receipts`, {}).expect(403);
    await postAs(stranger, `/api/audit-requests/${created.id}/receipts`, {}).expect(404);
    const receipt = await postAs(auditor, `/api/audit-requests/${created.id}/receipts`, { note: 'Package received.' }).expect(201);
    expect(receipt.body.receipt.receivedBy).toBe(auditor.id);
    expect(receipt.body.receipt.createdAt).toBeTruthy();
    expect(receipt.body.receipt.note).toBe('Package received.');
    expect(receipt.body.receipt.package).toEqual(expect.arrayContaining([documentId, secondDoc]));
    expect(receipt.body.receipt.package).toHaveLength(2);
    const listed = await getAs(owner, `/api/audit-requests/${created.id}/receipts`).expect(200);
    expect(listed.body.receipts).toHaveLength(1);
    expect(listed.body.receipts[0].receivedBy).toBe(auditor.id);
    await getAs(stranger, `/api/audit-requests/${created.id}/receipts`).expect(404);
  });
});
