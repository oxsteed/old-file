'use strict';

// Group 13 Slice 4e acceptance: Resolve errors (671-675).
// 671/672/675 are EXISTS re-checks (evidence in docs/persona-roadmap/group13.md);
// this suite proves them live against the endpoints, plus the 673 customer
// adjustment view (D-369/D-370/D-375) and the 674 customer evidence
// submission (D-371/D-372/D-373/D-374): the customer attaches a note and/or
// a file to their own open dispute, the file lands under the private
// `credit-dispute-evidence/` prefix and downloads only through signed URLs
// minted at read time, and the agent working the case reads the same
// evidence through the admin endpoint.
// Runs against a dedicated fresh database (credit_statement_test_g13e) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// Seeding follows the ledger's own rules: accounts start empty (migration
// 491) and balances arrive through postJournalTransaction, exactly like the
// 4d checkout suite. Disputes go through the real POST /disputes path;
// agent adjustments go through the real /api/agent propose/approve path
// (two-person rule + TOTP step-up included), so the pending/applied states
// the customer view derives are real rows, not hand-written fixtures.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const fs = require('fs');
const os = require('os');
const path = require('path');
// Private evidence files land in the local storage backend during tests;
// keep them in a disposable temp dir, never the repo runtime dir.
process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'g13e-uploads-'));

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4E_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13e') {
    throw new Error('Group 13 Slice 4e DB tests require the loopback credit_statement_test_g13e database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

// TOTP secret for the approving admin: 32 base32 chars (20 bytes, the
// otplib v12 minimum is 16). The secret is encrypted with the test
// ENCRYPTION_KEY exactly the way the real TOTP setup stores it.
const { encrypt } = require('../utils/encryption');
const APPROVER_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

// The suite-wide setup mocks the otplib adapter (no `generate`), so the
// approver's current code is computed here with plain RFC 6238 math
// (base32 secret, 30-second step, 6 digits) — the same code the server's
// authenticator verifies, window of +-1 step.
function totpNow(base32Secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = String(base32Secret).replace(/=+$/, '').toUpperCase().split('')
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

describeDb('Group 13 Slice 4e: resolve errors (671-675)', () => {
  let pool;
  let creditCtrl;
  let creditService;
  let app;
  let admin;
  let proposer;
  let approver;
  let treasuryId;

  beforeAll(async () => {
    pool = require('../db');
    creditService = require('../services/oxsteedCreditService');
    creditCtrl = require('../controllers/oxsteedCreditController');
    const { authenticate } = require('../middleware/auth');
    const { requireSuperAdmin } = require('../middleware/adminAuth');
    const {
      EVIDENCE_MAX_FILE_BYTES,
      EVIDENCE_ALLOWED_MIME_TYPES,
    } = require('../services/oxsteedCreditDisputeEvidenceService');
    const { AppError } = require('../middleware/errorHandler');
    app = express();
    app.use(express.json());
    app.post('/api/oxsteed-credit/disputes', authenticate, creditCtrl.openMyDispute);
    app.get('/api/oxsteed-credit/disputes', authenticate, creditCtrl.listMyDisputes);
    app.get('/api/oxsteed-credit/disputes/:disputeId/evidence', authenticate, creditCtrl.listMyDisputeEvidence);
    app.get('/api/oxsteed-credit/disputes/:disputeId/evidence/:evidenceId/download', authenticate, creditCtrl.downloadMyDisputeEvidence);
    // Same multer shape as the production route: memory storage, 10 MB,
    // one file, disallowed types rejected before the service runs.
    const disputeEvidenceUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: EVIDENCE_MAX_FILE_BYTES, files: 1, fields: 10, parts: 12 },
      fileFilter: (_req, file, cb) => {
        if (EVIDENCE_ALLOWED_MIME_TYPES.includes(String(file.mimetype || '').split(';', 1)[0].trim().toLowerCase())) {
          return cb(null, true);
        }
        return cb(new AppError('That file type cannot be attached as dispute evidence', 400, 'credit_dispute_evidence_file_type_invalid'));
      },
    });
    app.post(
      '/api/oxsteed-credit/disputes/:disputeId/evidence',
      authenticate,
      disputeEvidenceUpload.single('file'),
      creditCtrl.submitMyDisputeEvidence
    );
    // The real agent adjustment router (requireAdmin + manage_financials
    // gate) and the real admin evidence read (requireSuperAdmin).
    app.use('/api/agent', require('../routes/agentCreditAdjustments'));
    app.get(
      '/api/admin/super/oxsteed-credit/disputes/:disputeId/evidence',
      requireSuperAdmin,
      creditCtrl.listAdminDisputeEvidence
    );
    app.get(
      '/api/admin/super/oxsteed-credit/disputes/:disputeId/evidence/:evidenceId/download',
      requireSuperAdmin,
      creditCtrl.downloadAdminDisputeEvidence
    );
    app.use(require('../middleware/errorHandler').errorHandler);

    admin = await makeUser('super_admin');
    proposer = await makeUser('super_admin');
    approver = await makeUser('super_admin');
    await pool.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [approver.id, encrypt(APPROVER_TOTP_SECRET)]);
    // Holds, resolutions, and adjustments all fail closed when the credit
    // rail is off; this dedicated test DB is only used by this suite.
    await pool.query(
      `INSERT INTO feature_flags (key, is_enabled, description)
       VALUES ('oxsteed_credit_enabled', true, 'Group 13 Slice 4e test')
       ON CONFLICT (key) DO UPDATE SET is_enabled = true`,
    );
    treasuryId = await ensureCreditAccount({ accountType: 'platform_treasury' });
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DELETE FROM feature_flags WHERE key = 'oxsteed_credit_enabled'`);
      await pool.end();
    }
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  async function ensureCreditAccount({ accountType, customerId = null, partnerId: pid = null }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await creditService.ensureAccount(client, {
        accountType, customerId, partnerId: pid, currencyCode: 'USD',
      });
      await client.query('COMMIT');
      return account.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function makeWallet(user) {
    return ensureCreditAccount({ accountType: 'customer_wallet', customerId: user.id });
  }

  // Compliance-gated money paths (agent adjustment propose/approve,
  // provisional credit) require a verified identity tier. The fixture
  // customer is verified the way creditCashoutLifecycle does it: a tier-1
  // verified row, expiring in a year. Sanctions screening is fail-closed
  // by design (manual_review screens every unscreened subject as a hit),
  // so the fixture also carries a fresh 'clear' screening the same way.
  async function verifyCustomer(user) {
    await pool.query(
      `INSERT INTO oxsteed_credit_identity_verifications (customer_id, requested_tier, tier, status, expires_at)
       SELECT $1, 1, 1, 'verified', NOW() + INTERVAL '1 year'
        WHERE NOT EXISTS (
          SELECT 1 FROM oxsteed_credit_identity_verifications
           WHERE customer_id = $1 AND status = 'verified'
        )`,
      [user.id],
    );
    await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, payload_hash)
       VALUES ('customer', $1, 'manual_review', 'clear', $2) ON CONFLICT DO NOTHING`,
      [user.id, `g13e-sanctions-${user.id}`],
    );
  }

  const tokenFor = (user) => require('../middleware/auth').generateTokens(user).accessToken;
  const getAs = (user, path) => request(app).get(path).set('Authorization', `Bearer ${tokenFor(user)}`);
  const postAs = (user, path) => request(app).post(path).set('Authorization', `Bearer ${tokenFor(user)}`);

  async function fundWallet(user, walletId, amountCents) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { transaction } = await creditService.postJournalTransaction(client, {
        currencyCode: 'USD',
        transactionType: 'load',
        debitAccountId: treasuryId,
        creditAccountId: walletId,
        amountCents,
        actorType: 'admin',
        actorUserId: admin.id,
        reason: 'Fixture load',
        referenceType: 'admin_load',
        referenceId: 'fixture-load',
        description: 'Fixture load',
        idempotencyKey: `g13e-load-${user.id}-${amountCents}`,
      });
      await client.query('COMMIT');
      return transaction.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function walletState(walletId) {
    const { rows: [row] } = await pool.query(
      `SELECT balance_cents, reserved_cents FROM oxsteed_credit_accounts WHERE id = $1`,
      [walletId],
    );
    return { balance: Number(row.balance_cents), reserved: Number(row.reserved_cents) };
  }

  async function openDispute(user, transactionId, reasonCode = 'incorrect_amount', keySuffix = '') {
    // Compliance-gated paths used later in the test (adjustment propose /
    // approve, provisional credit) need the customer verified; verify the
    // fixture owner up front so the dispute itself is the only setup.
    await verifyCustomer(user);
    const res = await postAs(user, '/api/oxsteed-credit/disputes')
      .set('Idempotency-Key', `g13e-dispute-${user.id}-${transactionId}${keySuffix}`)
      .send({ transactionId, reasonCode, description: 'The amount looks wrong on this transaction.' });
    expect(res.status).toBe(201);
    return res.body.dispute;
  }

  async function listDisputesAs(user) {
    const res = await getAs(user, '/api/oxsteed-credit/disputes');
    expect(res.status).toBe(200);
    return res.body.disputes;
  }

  async function proposeAdjustment(adminUser, { customerId, disputeId, amountCents, key }) {
    const res = await postAs(adminUser, '/api/agent/credit-adjustments')
      .send({
        customerId,
        disputeId: disputeId || undefined,
        amountCents,
        currencyCode: 'USD',
        reason: 'Goodwill adjustment for the disputed transaction.',
        idempotencyKey: key,
      });
    return res;
  }

  async function approveAdjustment(adjustmentId) {
    const issued = await postAs(approver, '/api/agent/credit-adjustments/stepup-challenges')
      .send({ adjustmentId });
    expect(issued.status).toBe(201);
    const challengeId = issued.body.challenge.id;
    const code = totpNow(APPROVER_TOTP_SECRET);
    const approved = await postAs(approver, `/api/agent/credit-adjustments/${adjustmentId}/approve`)
      .send({ stepupChallengeId: challengeId, stepupCode: code });
    return approved;
  }

  test('671 re-check: a per-transaction problem report opens a dispute, idempotently', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);

    const opened = await postAs(user, '/api/oxsteed-credit/disputes')
      .set('Idempotency-Key', `g13e-671-${user.id}`)
      .send({ transactionId, reasonCode: 'incorrect_amount', description: 'Charged twice the menu price.' });
    expect(opened.status).toBe(201);
    expect(opened.body.dispute).toMatchObject({ transactionId: String(transactionId), status: 'open', reasonCode: 'incorrect_amount' });

    const replayed = await postAs(user, '/api/oxsteed-credit/disputes')
      .set('Idempotency-Key', `g13e-671-${user.id}`)
      .send({ transactionId, reasonCode: 'incorrect_amount', description: 'Charged twice the menu price.' });
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.dispute.id).toBe(opened.body.dispute.id);

    const disputes = await listDisputesAs(user);
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ status: 'open', amountCents: 5000 });
  });

  test('672 re-check: duplicate_charge is a first-class dispute reason', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);

    const { openCreditDispute } = creditService;
    const { dispute } = await openCreditDispute({
      customerId: user.id,
      transactionId,
      reasonCode: 'duplicate_charge',
      description: 'The same charge posted twice.',
      actorUserId: user.id,
      idempotencyKey: `g13e-672-${user.id}`,
      disputeType: 'duplicate_charge',
    });
    expect(dispute).toMatchObject({ reasonCode: 'duplicate_charge', disputeType: 'duplicate_charge', status: 'open' });

    const disputes = await listDisputesAs(user);
    expect(disputes).toHaveLength(1);
    expect(disputes[0].reasonCode).toBe('duplicate_charge');
  });

  test('673: a pending agent adjustment linked to the dispute is visible to its owner', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const proposed = await proposeAdjustment(proposer, {
      customerId: user.id, disputeId: dispute.id, amountCents: 2500, key: `g13e-673-pending-${user.id}`,
    });
    expect(proposed.status).toBe(201);
    expect(proposed.body.adjustment).toMatchObject({ status: 'pending', amountCents: 2500, disputeId: dispute.id });

    const disputes = await listDisputesAs(user);
    expect(disputes).toHaveLength(1);
    expect(disputes[0].adjustments).toHaveLength(1);
    expect(disputes[0].adjustments[0]).toMatchObject({
      amountCents: 2500, direction: 'credit', currencyCode: 'USD', status: 'pending', appliedAt: null,
    });
    // The customer view carries no admin identity: no proposer/approver ids.
    expect(disputes[0].adjustments[0]).not.toHaveProperty('proposedBy');
    expect(disputes[0].adjustments[0]).not.toHaveProperty('approvedBy');
  });

  test('673: another customer cannot see the adjustment state on someone else’s dispute', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const proposed = await proposeAdjustment(proposer, {
      customerId: user.id, disputeId: dispute.id, amountCents: 1200, key: `g13e-673-other-${user.id}`,
    });
    expect(proposed.status).toBe(201);

    const otherDisputes = await listDisputesAs(other);
    expect(otherDisputes).toHaveLength(0);

    // The other customer cannot even open the owner's dispute evidence read.
    const forbidden = await getAs(other, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`);
    expect(forbidden.status).toBe(404);
  });

  test('673: an adjustment appears only on its own dispute, and an unlinked adjustment on none', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const firstTx = await fundWallet(user, walletId, 5000);
    const first = await openDispute(user, firstTx);
    const secondTx = await fundWallet(user, walletId, 3000);
    const second = await openDispute(user, secondTx, 'incorrect_amount', '-second');

    const linked = await proposeAdjustment(proposer, {
      customerId: user.id, disputeId: first.id, amountCents: 700, key: `g13e-673-linked-${user.id}`,
    });
    expect(linked.status).toBe(201);
    const unlinked = await proposeAdjustment(proposer, {
      customerId: user.id, amountCents: 900, key: `g13e-673-unlinked-${user.id}`,
    });
    expect(unlinked.status).toBe(201);
    expect(unlinked.body.adjustment.disputeId).toBeNull();

    const disputes = await listDisputesAs(user);
    expect(disputes).toHaveLength(2);
    const firstRow = disputes.find((row) => row.id === first.id);
    const secondRow = disputes.find((row) => row.id === second.id);
    expect(firstRow.adjustments).toHaveLength(1);
    expect(firstRow.adjustments[0].amountCents).toBe(700);
    expect(secondRow.adjustments).toHaveLength(0);
  });

  test('673: a different admin approves the pending adjustment and the owner sees it applied with a date', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const proposed = await proposeAdjustment(proposer, {
      customerId: user.id, disputeId: dispute.id, amountCents: 1500, key: `g13e-673-apply-${user.id}`,
    });
    expect(proposed.status).toBe(201);
    const adjustmentId = proposed.body.adjustment.id;

    const approved = await approveAdjustment(adjustmentId);
    expect(approved.status).toBe(200);
    expect(approved.body.adjustment).toMatchObject({ status: 'applied', amountCents: 1500 });

    const disputes = await listDisputesAs(user);
    expect(disputes[0].adjustments).toHaveLength(1);
    expect(disputes[0].adjustments[0]).toMatchObject({ status: 'applied', amountCents: 1500 });
    expect(disputes[0].adjustments[0].appliedAt).not.toBeNull();
    // The approval moved the money exactly once: load 5000 + adjustment 1500.
    expect(await walletState(walletId)).toEqual({ balance: 6500, reserved: 0 });
  });

  test('673: a rejected adjustment is visible as not applied, with its decision date', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const proposed = await proposeAdjustment(proposer, {
      customerId: user.id, disputeId: dispute.id, amountCents: 800, key: `g13e-673-reject-${user.id}`,
    });
    expect(proposed.status).toBe(201);
    const rejected = await postAs(approver, `/api/agent/credit-adjustments/${proposed.body.adjustment.id}/reject`)
      .send({ reason: 'The transaction was correct; no adjustment is due.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.adjustment).toMatchObject({ status: 'rejected' });

    const disputes = await listDisputesAs(user);
    expect(disputes[0].adjustments).toHaveLength(1);
    expect(disputes[0].adjustments[0]).toMatchObject({ status: 'rejected', amountCents: 800, appliedAt: null });
    expect(disputes[0].adjustments[0].decidedAt).not.toBeNull();
    expect(await walletState(walletId)).toEqual({ balance: 5000, reserved: 0 });
  });

  test('673: linking an adjustment to another customer’s dispute is a 404', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const walletId = await makeWallet(other);
    const transactionId = await fundWallet(other, walletId, 5000);
    const otherDispute = await openDispute(other, transactionId);

    const res = await proposeAdjustment(proposer, {
      customerId: user.id, disputeId: otherDispute.id, amountCents: 500, key: `g13e-673-wronglink-${user.id}`,
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('credit_dispute_not_found');
  });

  test('674: the owner attaches a note to their open dispute and sees it back', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const submitted = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-note-${user.id}`)
      .field('note', 'The receipt shows a different total than the charge.');
    expect(submitted.status).toBe(201);
    expect(submitted.body.evidence).toMatchObject({
      kind: 'note',
      note: 'The receipt shows a different total than the charge.',
      disputeId: dispute.id,
    });
    expect(submitted.body.evidence).not.toHaveProperty('storageKey');

    const listed = await getAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`);
    expect(listed.status).toBe(200);
    expect(listed.body.evidence).toHaveLength(1);
    expect(listed.body.evidence[0]).toMatchObject({ kind: 'note', downloadUrl: null });
  });

  test('674: the owner attaches a file; the download is a signed URL and the storage key never leaves the server', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);
    const before = await walletState(walletId);

    const submitted = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-file-${user.id}`)
      .field('note', 'Receipt attached.')
      .attach('file', Buffer.from('%PDF-1.4 fake receipt bytes'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.evidence).toMatchObject({
      kind: 'file',
      originalFilename: 'receipt.pdf',
      contentType: 'application/pdf',
      sizeBytes: Buffer.from('%PDF-1.4 fake receipt bytes').length,
    });
    expect(submitted.body.evidence.downloadUrl).toMatch(/\/evidence\/[0-9a-f-]+\/download\?exp=\d+&sig=[0-9a-f]+$/);
    expect(JSON.stringify(submitted.body)).not.toContain('storageKey');
    expect(JSON.stringify(submitted.body)).not.toContain('credit-dispute-evidence/');

    // Submitting evidence moves no money.
    expect(await walletState(walletId)).toEqual(before);

    const listed = await getAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`);
    expect(listed.status).toBe(200);
    expect(listed.body.evidence).toHaveLength(1);
    expect(listed.body.evidence[0].downloadUrl).toMatch(/\/evidence\/[0-9a-f-]+\/download\?exp=\d+&sig=[0-9a-f]+$/);

    // The signed URL actually downloads the file for its owner.
    const downloaded = await getAs(user, listed.body.evidence[0].downloadUrl);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toBe('application/pdf');
    expect(String(downloaded.body || downloaded.text || '')).toContain('fake receipt bytes');

    // The same signed URL grants nothing to another customer, and a
    // tampered signature fails closed.
    const strangerDownload = await getAs(other, listed.body.evidence[0].downloadUrl);
    expect(strangerDownload.status).toBe(404);
    const tampered = listed.body.evidence[0].downloadUrl.replace(/sig=[0-9a-f]+$/, 'sig=0000000000000000000000000000000000000000000000000000000000000000');
    const tamperedDownload = await getAs(user, tampered);
    expect(tamperedDownload.status).toBe(403);

    // The dispute list carries the evidence count for the agent queue.
    const disputes = await listDisputesAs(user);
    expect(disputes[0].evidenceCount).toBe(1);
  });

  test('674: evidence submission is idempotent, and a reused key with different details is a 409', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const first = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-idem-${user.id}`)
      .field('note', 'First note.');
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);

    const replayed = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-idem-${user.id}`)
      .field('note', 'First note.');
    expect(replayed.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.evidence.id).toBe(first.body.evidence.id);

    const conflict = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-idem-${user.id}`)
      .field('note', 'Different note, same key.');
    expect(conflict.status).toBe(409);

    const listed = await getAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`);
    expect(listed.body.evidence).toHaveLength(1);
  });

  test('674: a note or a file is required, and a disallowed file type is rejected', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const empty = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-empty-${user.id}`)
      .field('note', '   ');
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('credit_dispute_evidence_required');

    const badType = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-badtype-${user.id}`)
      .attach('file', Buffer.from('<html>evil</html>'), { filename: 'evil.html', contentType: 'text/html' });
    expect(badType.status).toBe(400);
    expect(badType.body.code).toBe('credit_dispute_evidence_file_type_invalid');
  });

  test('674: a non-owner cannot attach evidence or list it, and the error is indistinguishable from missing', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const listed = await getAs(other, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`);
    expect(listed.status).toBe(404);
    expect(listed.body.code).toBe('credit_dispute_not_found');

    const submitted = await postAs(other, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-stranger-${other.id}`)
      .field('note', 'Not my dispute.');
    expect(submitted.status).toBe(404);
    expect(submitted.body.code).toBe('credit_dispute_not_found');

    const unknown = await getAs(user, `/api/oxsteed-credit/disputes/${crypto.randomUUID()}/evidence`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('credit_dispute_not_found');
  });

  test('674: a closed dispute rejects new evidence with 409', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const { resolveDisputeWithCompensation } = require('../services/oxsteedCreditDisputeService');
    const inReview = await resolveDisputeWithCompensation({
      disputeId: dispute.id, adminId: admin.id, decision: 'in_review', reason: 'Reviewing the charge.',
    });
    expect(inReview.dispute.status).toBe('in_review');

    // Evidence is still accepted while the case is under review.
    const duringReview = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-review-${user.id}`)
      .field('note', 'Extra context while under review.');
    expect(duringReview.status).toBe(201);

    const resolved = await resolveDisputeWithCompensation({
      disputeId: dispute.id, adminId: admin.id, decision: 'resolved_customer', reason: 'Refunded in full.', compensationCents: 0,
    });
    expect(resolved.dispute.status).toBe('resolved_customer');

    const closed = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-closed-${user.id}`)
      .field('note', 'Too late.');
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('credit_dispute_evidence_closed');
  });

  test('674: the agent working the case reads the customer evidence through the admin endpoint', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId);

    const submitted = await postAs(user, `/api/oxsteed-credit/disputes/${dispute.id}/evidence`)
      .set('Idempotency-Key', `g13e-674-agent-${user.id}`)
      .field('note', 'For the agent: the receipt is attached.')
      .attach('file', Buffer.from('fake image bytes'), { filename: 'photo.png', contentType: 'image/png' });
    expect(submitted.status).toBe(201);

    const asAdmin = await getAs(admin, `/api/admin/super/oxsteed-credit/disputes/${dispute.id}/evidence`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.customerId).toBe(user.id);
    expect(asAdmin.body.evidence).toHaveLength(1);
    expect(asAdmin.body.evidence[0]).toMatchObject({ kind: 'file', originalFilename: 'photo.png' });
    expect(asAdmin.body.evidence[0].downloadUrl).toMatch(/\/evidence\/[0-9a-f-]+\/download\?exp=\d+&sig=[0-9a-f]+$/);
    expect(JSON.stringify(asAdmin.body)).not.toContain('storageKey');

    // The agent downloads the file through the admin signed URL.
    const downloaded = await getAs(admin, asAdmin.body.evidence[0].downloadUrl);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toBe('image/png');

    const unknown = await getAs(admin, `/api/admin/super/oxsteed-credit/disputes/${crypto.randomUUID()}/evidence`);
    expect(unknown.status).toBe(404);
  });

  test('675 re-check: the resolved case renders status, reason, amount, opened date, description, and resolution text', async () => {
    const user = await makeUser();
    const walletId = await makeWallet(user);
    const transactionId = await fundWallet(user, walletId, 5000);
    const dispute = await openDispute(user, transactionId, 'duplicate_charge');

    const { resolveDisputeWithCompensation, issueProvisionalCredit } = require('../services/oxsteedCreditDisputeService');
    await resolveDisputeWithCompensation({
      disputeId: dispute.id, adminId: admin.id, decision: 'in_review', reason: 'Reviewing the duplicate.',
    });
    const provisional = await issueProvisionalCredit({
      disputeId: dispute.id, adminId: admin.id, amountCents: 1000, reason: 'Provisional credit while we investigate.',
    });
    expect(provisional.dispute.provisionalCreditCents).toBe(1000);

    const resolved = await resolveDisputeWithCompensation({
      disputeId: dispute.id, adminId: admin.id, decision: 'resolved_customer', reason: 'Duplicate confirmed; refunded.', compensationCents: 0,
    });
    expect(resolved.dispute.status).toBe('resolved_customer');

    const disputes = await listDisputesAs(user);
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({
      status: 'resolved_customer',
      reasonCode: 'duplicate_charge',
      amountCents: 5000,
      description: 'The amount looks wrong on this transaction.',
      resolution: 'Duplicate confirmed; refunded.',
      provisionalCreditCents: 1000,
    });
    expect(disputes[0].openedAt).not.toBeNull();
    expect(disputes[0].resolvedAt).not.toBeNull();
  });
});
