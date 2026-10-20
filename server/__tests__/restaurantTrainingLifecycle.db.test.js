'use strict';

// DB-backed tests for S-12 (training retakes, overdue, recertification,
// auto-assignment) and S-14 (staff document vault, SOP acknowledgements).
// Runs against a real migrated database; no SQL mocks. Opt in with
// STAFF_TRAINING_TEST_DATABASE_URL pointing at a local disposable DB
// (e.g. st_t5). Skipped when absent.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.LOCAL_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-docs-'));

const url = process.env.STAFF_TRAINING_TEST_DATABASE_URL || process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.hostname)) {
    throw new Error('Staff training fixtures require a local disposable database');
  }
  process.env['DATABASE' + '_URL'] = url;
}
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../db');
const training = require('../controllers/restaurantTrainingController');
const documents = require('../controllers/restaurantStaffDocumentsController');
const lifecycle = require('../services/restaurantTrainingLifecycle');
const { sendNotification } = require('../services/notificationService');

const describeDb = url ? describe : describe.skip;

function res() {
  const r = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return r;
}

async function invoke(handler, { userId, params = {}, body = {}, query = {}, file = undefined }) {
  const r = res();
  const req = { user: { id: userId, role: 'user' }, params, body, query, file };
  let thrown = null;
  await handler(req, r, (err) => { thrown = err; });
  if (thrown) {
    r.statusCode = thrown.statusCode || 500;
    r.body = { error: thrown.message, code: thrown.code, details: thrown.details };
  }
  return r;
}

let ownerId; let managerId; let employeeId; let employee2Id; let outsiderId;
let businessId; let restaurantId;

async function makeUser() {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, 'x', 'T', 'U')`,
    [id, `${id}@example.test`]
  );
  return id;
}

describeDb('S-12/S-14 staff training lifecycle + document vault (real database)', () => {
  beforeAll(async () => {
    [ownerId, managerId, employeeId, employee2Id, outsiderId] = await Promise.all([
      makeUser(), makeUser(), makeUser(), makeUser(), makeUser(),
    ]);
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Training Test Biz') RETURNING id`,
      [ownerId]
    );
    businessId = biz.id;
    const { rows: [rest] } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Training Testaurant') RETURNING id`,
      [businessId, ownerId]
    );
    restaurantId = rest.id;
    await db.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status) VALUES
         ($1, $5, $2, 'manager@example.test', 'manager', 'active'),
         ($1, $5, $3, 'employee@example.test', 'employee', 'active'),
         ($1, $5, $4, 'employee2@example.test', 'employee', 'active')`,
      [businessId, managerId, employeeId, employee2Id, ownerId]
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM businesses WHERE id = $1`, [businessId]).catch(() => {});
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ownerId, managerId, employeeId, employee2Id, outsiderId]]).catch(() => {});
    await db.end?.();
  });

  beforeEach(() => jest.clearAllMocks());

  async function createModule(userId, overrides = {}) {
    const r = await invoke(training.createModule, {
      userId,
      params: { restaurantId },
      body: {
        title: 'Food safety basics',
        category: 'food_safety',
        passScorePct: 80,
        questions: [
          { question: 'Wash hands for?', options: ['5s', '20s'], correct_index: 1 },
          { question: 'Danger zone?', options: ['41-135F', '0-32F'], correct_index: 0 },
        ],
        ...overrides,
      },
    });
    expect(r.statusCode).toBe(201);
    return r.body.module;
  }

  test('retake flow: failed attempts return to assigned, attempts are capped, passing records version + expiry', async () => {
    const module = await createModule(ownerId, { validForDays: 365, maxAttempts: 3 });
    expect(module.current_version).toBe(1);
    expect(module.valid_for_days).toBe(365);
    expect(module.max_attempts).toBe(3);

    const assign = await invoke(training.assignModule, {
      userId: ownerId,
      params: { restaurantId, moduleId: module.id },
      body: { userId: employeeId },
    });
    expect(assign.statusCode).toBe(201);
    const assignmentId = assign.body.assignment.id;
    // S-12: the assignee is notified.
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: employeeId, type: 'training_assigned',
    }));

    const wrong = [0, 1]; // both incorrect (correct: 1, 0)
    for (let i = 1; i <= 3; i += 1) {
      const submit = await invoke(training.submitQuiz, {
        userId: employeeId,
        params: { restaurantId, assignmentId },
        body: { answers: wrong },
      });
      expect(submit.statusCode).toBe(200);
      expect(submit.body.passed).toBe(false);
      expect(submit.body.attemptsUsed).toBe(i);
      expect(submit.body.completion.module_version).toBe(1);
      const { rows: [a] } = await db.query(
        `SELECT status, attempts_used FROM restaurant_training_assignments WHERE id = $1`, [assignmentId]
      );
      // A failed attempt is never final: the assignment re-opens.
      expect(a.status).toBe('assigned');
      expect(a.attempts_used).toBe(i);
    }

    // Budget exhausted.
    const blocked = await invoke(training.submitQuiz, {
      userId: employeeId,
      params: { restaurantId, assignmentId },
      body: { answers: [1, 0] },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.code).toBe('attempts_exhausted');

    // A manager re-assignment restores the budget (expired/failed cycle).
    await invoke(training.assignModule, {
      userId: ownerId,
      params: { restaurantId, moduleId: module.id },
      body: { userId: employeeId },
    });
    const pass = await invoke(training.submitQuiz, {
      userId: employeeId,
      params: { restaurantId, assignmentId },
      body: { answers: [1, 0] },
    });
    expect(pass.statusCode).toBe(200);
    expect(pass.body.passed).toBe(true);
    expect(pass.body.completion.module_version).toBe(1);
    expect(pass.body.completion.attempt_number).toBe(1);
    // valid_for_days stamps a recertification expiry.
    expect(pass.body.completion.expires_at).toBeTruthy();
    const { rows: [a] } = await db.query(
      `SELECT status FROM restaurant_training_assignments WHERE id = $1`, [assignmentId]
    );
    expect(a.status).toBe('completed');

    // Retake of a still-valid completion is rejected.
    const again = await invoke(training.submitQuiz, {
      userId: employeeId,
      params: { restaurantId, assignmentId },
      body: { answers: [1, 0] },
    });
    expect(again.statusCode).toBe(409);
    expect(again.body.code).toBe('already_completed');

    // Every attempt is preserved in the log.
    const { rows: attempts } = await db.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_training_completions WHERE assignment_id = $1`, [assignmentId]
    );
    expect(attempts[0].n).toBe(4);
  });

  test('module edits create a new version and completions keep the version they took', async () => {
    const module = await createModule(ownerId, {});
    const edit = await invoke(training.updateModule, {
      userId: ownerId,
      params: { restaurantId, moduleId: module.id },
      body: { content: 'Revised lesson content' },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.body.module.current_version).toBe(2);
    const { rows: versions } = await db.query(
      `SELECT version FROM restaurant_training_module_versions WHERE module_id = $1 ORDER BY version`,
      [module.id]
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    // Activation-only change does not create a version.
    const toggle = await invoke(training.updateModule, {
      userId: ownerId,
      params: { restaurantId, moduleId: module.id },
      body: { isActive: false },
    });
    expect(toggle.body.module.current_version).toBe(2);
  });

  test('nightly job: overdue marking + recertification re-open', async () => {
    const module = await createModule(ownerId, { validForDays: 30 });
    const assign = await invoke(training.assignModule, {
      userId: ownerId,
      params: { restaurantId, moduleId: module.id },
      body: { userId: employeeId, dueAt: new Date(Date.now() - 86400000).toISOString() },
    });
    const assignmentId = assign.body.assignment.id;

    const overdue = await lifecycle.markOverdueAssignments(db);
    expect(overdue.some((r) => Number(r.id) === Number(assignmentId))).toBe(true);

    // Complete it, then backdate the pass expiry: the job re-opens it.
    const pass = await invoke(training.submitQuiz, {
      userId: employeeId,
      params: { restaurantId, assignmentId },
      body: { answers: [1, 0] },
    });
    expect(pass.body.passed).toBe(true);
    await db.query(
      `UPDATE restaurant_training_completions SET expires_at = NOW() - INTERVAL '1 day' WHERE assignment_id = $1`,
      [assignmentId]
    );
    const reopened = await lifecycle.expireCompletionsForRecertification(db);
    expect(reopened.some((r) => Number(r.id) === Number(assignmentId))).toBe(true);
    const { rows: [a] } = await db.query(
      `SELECT status, attempts_used FROM restaurant_training_assignments WHERE id = $1`, [assignmentId]
    );
    expect(a.status).toBe('assigned');
    expect(a.attempts_used).toBe(0);
  });

  test('auto-assignment: rule assigns current staff by role, sweep assigns new hires', async () => {
    const module = await createModule(ownerId, {});
    const rule = await invoke(training.createAutoAssignRule, {
      userId: ownerId,
      params: { restaurantId, moduleId: module.id },
      body: { targetRole: 'employee', dueDays: 7 },
    });
    expect(rule.statusCode).toBe(201);
    // Both employees assigned immediately; the manager is not (role rule).
    expect(rule.body.assignedCount).toBe(2);
    const { rows: mine } = await db.query(
      `SELECT user_id, due_at FROM restaurant_training_assignments WHERE module_id = $1 ORDER BY user_id`,
      [module.id]
    );
    expect(mine.map((r) => r.user_id).sort()).toEqual([employeeId, employee2Id].sort());
    expect(mine[0].due_at).toBeTruthy();

    // A new hire (new active member) is picked up by the on-hire sweep.
    const newHire = await makeUser();
    await db.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status) VALUES ($1, $3, $2, 'newhire@example.test', 'employee', 'active')`,
      [businessId, newHire, ownerId]
    );
    const created = await lifecycle.applyAutoAssignRules(db, {
      restaurantId, businessId, onlyOnHire: true,
    });
    expect(created.some((c) => c.userId === newHire && Number(c.moduleId) === Number(module.id))).toBe(true);
    // Note: the user row itself is left in the disposable database —
    // deleting users trips a pre-existing wallet-ledger RI trigger quirk
    // in this schema (same reason Wave F fixtures avoid user deletes).
    await db.query(`DELETE FROM restaurant_training_assignments WHERE user_id = $1`, [newHire]);
    await db.query(`DELETE FROM business_members WHERE member_id = $1`, [newHire]);
  });

  test('vault: upload, signed read, verification, per-user isolation', async () => {
    const upload = await invoke(documents.uploadDocument, {
      userId: managerId,
      params: { restaurantId },
      body: {
        userId: employeeId,
        docType: 'certificate_food_handler',
        title: 'Food handler card',
        expiresOn: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      },
      file: {
        buffer: Buffer.from('fake-certificate-bytes'),
        originalname: 'card.pdf',
        mimetype: 'application/pdf',
        size: 22,
      },
    });
    expect(upload.statusCode).toBe(201);
    const doc = upload.body.document;
    expect(doc.verification_status).toBe('pending');
    // Reads expose a signed URL, never a raw storage key/path.
    expect(doc.download_url).toBeTruthy();
    expect(doc).not.toHaveProperty('storage_key');

    // The employee sees their own document; another employee does not.
    const ownList = await invoke(documents.listDocuments, { userId: employeeId, params: { restaurantId } });
    expect(ownList.body.documents.some((d) => Number(d.id) === Number(doc.id))).toBe(true);
    const otherList = await invoke(documents.listDocuments, { userId: employee2Id, params: { restaurantId } });
    expect(otherList.body.documents.some((d) => Number(d.id) === Number(doc.id))).toBe(false);
    // An outsider has no restaurant access at all.
    const outsiderList = await invoke(documents.listDocuments, { userId: outsiderId, params: { restaurantId } });
    expect(outsiderList.statusCode).toBe(404);

    // Staff cannot verify; managers can.
    const staffVerify = await invoke(documents.verifyDocument, {
      userId: employeeId,
      params: { restaurantId, documentId: doc.id },
      body: { verificationStatus: 'verified' },
    });
    expect(staffVerify.statusCode).toBe(403);
    const verified = await invoke(documents.verifyDocument, {
      userId: managerId,
      params: { restaurantId, documentId: doc.id },
      body: { verificationStatus: 'verified' },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.body.document.verification_status).toBe('verified');
    expect(verified.body.document.verified_by).toBe(managerId);

    // Expiry alert fires once for the manager + owner.
    jest.clearAllMocks();
    const alerted = await lifecycle.sendCertificateExpiryAlerts(db, { withinDays: 30 });
    expect(alerted).toBeGreaterThanOrEqual(1);
    const alertCalls = sendNotification.mock.calls.filter(([arg]) => arg.type === 'staff_document_expiring');
    expect(alertCalls.length).toBeGreaterThanOrEqual(1);
    const again = await lifecycle.sendCertificateExpiryAlerts(db, { withinDays: 30 });
    const { rows: [stored] } = await db.query(
      `SELECT expiry_alert_sent_at FROM restaurant_staff_documents WHERE id = $1`, [doc.id]
    );
    expect(stored.expiry_alert_sent_at).toBeTruthy();
    expect(again).toBe(0);
  });

  test('SOP acknowledgement pins the version read; a re-published SOP needs a new sign-off', async () => {
    const { rows: [sop] } = await db.query(
      `INSERT INTO restaurant_sops (restaurant_id, title, body, version, is_published)
       VALUES ($1, 'Handbook', 'v1 body', 1, TRUE) RETURNING id`,
      [restaurantId]
    );
    const ack = await invoke(documents.acknowledgeSop, {
      userId: employeeId,
      params: { restaurantId, sopId: sop.id },
    });
    expect(ack.statusCode).toBe(201);
    expect(ack.body.acknowledgement.sop_version).toBe(1);

    // Re-publish (version bump, as updateSop does) and sign again.
    await db.query(`UPDATE restaurant_sops SET version = 2 WHERE id = $1`, [sop.id]);
    const ack2 = await invoke(documents.acknowledgeSop, {
      userId: employeeId,
      params: { restaurantId, sopId: sop.id },
    });
    expect(ack2.statusCode).toBe(201);
    expect(ack2.body.acknowledgement.sop_version).toBe(2);

    const list = await invoke(documents.listSopAcknowledgements, {
      userId: managerId,
      params: { restaurantId },
      query: { sopId: sop.id },
    });
    expect(list.statusCode).toBe(200);
    const rows = list.body.acknowledgements.filter((r) => Number(r.sop_id) === Number(sop.id));
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.sop_version === 1).is_current).toBe(false);
    expect(rows.find((r) => r.sop_version === 2).is_current).toBe(true);
  });
});
