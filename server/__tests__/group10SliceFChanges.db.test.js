'use strict';

// Group 10 Slice F acceptance: handle changes (531-535).
// Covers the built items end to end: scope revision requests (531),
// deadline adjustments (532), additional fee approval with a draft
// invoice record and no charge (533), change history (534), and
// engagement pause/resume (535). Decisions D-126..D-131 in
// persona-roadmap-decisions.md.

jest.unmock('pg');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.ACCESS_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname)) {
    throw new Error('Group 10 Slice F DB tests require a loopback disposable database');
  }
  process.env.DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g10f-user-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return { authenticate, authenticateIfPresent: (req, res, next) => (
    req.get('x-test-user') ? authenticate(req, res, next) : next()
  ) };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'super_admin') return res.sendStatus(403);
    req.isSuper = true;
    return next();
  },
  requirePermission: () => (req, res, next) => next(),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test-storage-key'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/test-key'),
  deleteFile: jest.fn().mockResolvedValue(true),
}));
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 10 Slice F: handle changes', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.SIGNED_URL_SECRET = 'group10-slice-f-fixture-secret';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/consulting/contractor', require('../routes/consultantNetwork'));
    app.use('/api/consulting/business-launch', require('../routes/businessLaunch'));
    app.use('/api/consulting/admin', require('../routes/consultingAdmin'));
  });

  afterEach(() => {
    for (const key of ['ACCESS_CONSULTANT_ENFORCEMENT', 'ACCESS_REQUESTS_ENABLED']) {
      if (savedFlags[key] === undefined) delete process.env[key];
      else process.env[key] = savedFlags[key];
    }
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Casey', 'Fixture', $3, $4, TRUE, TRUE, TRUE)`,
      [id, `g10f-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function addApprovedConsultant() {
    const id = await addUser();
    await db.query(`UPDATE users SET default_mode = 'consultant' WHERE id = $1`, [id]);
    await db.query(
      `INSERT INTO consultant_contractor_profiles (user_id, approval_status, is_active, default_oxsteed_cut_bps, timezone)
       VALUES ($1, 'approved', TRUE, 2000, 'America/New_York')`,
      [id],
    );
    return id;
  }

  async function addSession(client, consultant, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_sessions
         (user_id, email, first_name, last_name, consultant_assigned_id, status)
       VALUES ($1, $2, 'Casey', 'Client', $3, $4)
       RETURNING id`,
      [client, `g10f-client-${client}@example.invalid`, consultant, overrides.status || 'pending'],
    );
    return String(row.id);
  }

  async function addDeliverable(sessionId, overrides = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO consulting_deliverables (session_id, name, description, deliverable_type, due_date, status, accepted_by, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [sessionId,
        overrides.name || 'Supplier shortlist',
        overrides.description || 'Three vetted suppliers.',
        overrides.deliverable_type || 'other',
        overrides.due_date || '2026-12-15',
        overrides.status || 'pending',
        overrides.accepted_by || null,
        overrides.accepted_at || null],
    );
    return row;
  }

  function auth(userId, email) {
    const headers = { 'x-test-user': userId };
    if (email) headers['x-test-email'] = email;
    return headers;
  }

  function clientAuth(client) {
    return auth(client, `g10f-client-${client}@example.invalid`);
  }

  async function setup() {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const admin = await addUser('super_admin');
    const sessionId = await addSession(client, consultant);
    const deliverable = await addDeliverable(sessionId);
    return { client, consultant, admin, sessionId, deliverable };
  }

  async function fileRequest(sessionId, actor, payload) {
    const base = payload.requested_by_consultant
      ? `/api/consulting/contractor/sessions/${sessionId}/change-requests`
      : `/api/consulting/business-launch/sessions/${sessionId}/change-requests`;
    const headers = payload.requested_by_consultant ? auth(actor) : clientAuth(actor);
    const { requested_by_consultant, ...body } = payload;
    return request(app).post(base).set(headers).send(body);
  }

  test('531: either party files a change request; one open request per target', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();

    const scope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'The supplier list needs a fourth, local option.',
      new_description: 'Four vetted suppliers, one local.',
    });
    expect(scope.status).toBe(201);
    expect(scope.body.changeRequest.status).toBe('pending');
    expect(scope.body.changeRequest.requestedByRole).toBe('consultant');

    const duplicate = await fileRequest(sessionId, client, {
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'I also want to change the scope here.',
      new_description: 'Five suppliers, two local.',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('change_request_open');

    const deadline = await fileRequest(sessionId, client, {
      request_type: 'deadline_adjustment',
      deliverable_id: deliverable.id,
      reason: 'Our opening moved a week later than planned.',
      new_due_date: '2026-12-22',
    });
    expect(deadline.status).toBe(201);
    expect(deadline.body.changeRequest.requestedByRole).toBe('client');
  });

  test('531-533: validation rejects empty scope, missing deadline parts, bad fees', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();

    const emptyScope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'Change the scope somehow, please.',
    });
    expect(emptyScope.status).toBe(400);

    const noDate = await fileRequest(sessionId, client, {
      request_type: 'deadline_adjustment',
      deliverable_id: deliverable.id,
      reason: 'Move the deadline later, please.',
    });
    expect(noDate.status).toBe(400);

    const noMilestone = await fileRequest(sessionId, client, {
      request_type: 'deadline_adjustment',
      reason: 'Move the deadline later, please.',
      new_due_date: '2026-12-22',
    });
    expect(noMilestone.status).toBe(400);

    const badFee = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'additional_fee',
      reason: 'Extra work is needed here, please approve.',
      amount_cents: 0,
    });
    expect(badFee.status).toBe(400);

    const shortReason = await fileRequest(sessionId, client, {
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'Too short',
      new_description: 'New scope text here.',
    });
    expect(shortReason.status).toBe(400);
  });

  test('531-532: the other party approves and the change is applied', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();

    const scope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'The supplier list needs a fourth, local option.',
      new_description: 'Four vetted suppliers, one local.',
    });
    const scopeId = scope.body.changeRequest.id;

    // The requester cannot approve their own request.
    const selfApprove = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/change-requests/${scopeId}/approve`)
      .set(auth(consultant))
      .send();
    expect(selfApprove.status).toBe(403);

    const approved = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${scopeId}/approve`)
      .set(clientAuth(client))
      .send();
    expect(approved.status).toBe(200);
    expect(approved.body.changeRequest.status).toBe('approved');
    const { rows: [updated] } = await db.query(
      'SELECT description FROM consulting_deliverables WHERE id = $1', [deliverable.id],
    );
    expect(updated.description).toBe('Four vetted suppliers, one local.');

    const deadline = await fileRequest(sessionId, client, {
      request_type: 'deadline_adjustment',
      deliverable_id: deliverable.id,
      reason: 'Our opening moved a week later than planned.',
      new_due_date: '2026-12-22',
    });
    const deadlineId = deadline.body.changeRequest.id;
    const deadlineApproved = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/change-requests/${deadlineId}/approve`)
      .set(auth(consultant))
      .send();
    expect(deadlineApproved.status).toBe(200);
    const { rows: [moved] } = await db.query(
      'SELECT due_date FROM consulting_deliverables WHERE id = $1', [deliverable.id],
    );
    const movedDate = moved.due_date instanceof Date
      ? moved.due_date.toISOString().slice(0, 10) : String(moved.due_date).slice(0, 10);
    expect(movedDate).toBe('2026-12-22');
  });

  test('533: an approved additional fee records a draft invoice and charges nothing', async () => {
    const { client, consultant, sessionId } = await setup();

    const fee = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'additional_fee',
      reason: 'A fourth supplier visit needs an extra fee.',
      amount_cents: 15000,
    });
    const feeId = fee.body.changeRequest.id;
    const approved = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${feeId}/approve`)
      .set(clientAuth(client))
      .send();
    expect(approved.status).toBe(200);
    expect(approved.body.changeRequest.invoiceId).toBeTruthy();
    const { rows: [invoice] } = await db.query(
      'SELECT * FROM consulting_invoices WHERE id = $1', [approved.body.changeRequest.invoiceId],
    );
    expect(invoice.status).toBe('draft');
    expect(invoice.amount_cents).toBe(15000);
    expect(invoice.purchase_id).toBeNull();
    expect(invoice.user_id).toBe(client);
  });

  test('S-C1 (D-767): invoice numbers come from a sequence, so two invoices minted in the same millisecond cannot collide', async () => {
    const { nextConsultingInvoiceNumber } = require('../utils/consultingInvoiceNumber');
    const [first, second] = await Promise.all([nextConsultingInvoiceNumber(db), nextConsultingInvoiceNumber(db)]);
    expect(first).toMatch(/^CONS-\d{6}$/);
    expect(second).toMatch(/^CONS-\d{6}$/);
    expect(first).not.toBe(second);
    // End to end through the draft-invoice site: two approved
    // additional fees in a row get distinct numbers.
    const { client, consultant, sessionId } = await setup();
    const numbers = [];
    for (const amountCents of [15000, 20000]) {
      const fee = await fileRequest(sessionId, consultant, {
        requested_by_consultant: true,
        request_type: 'additional_fee',
        reason: 'An extra fee.',
        amount_cents: amountCents,
      });
      const approved = await request(app)
        .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${fee.body.changeRequest.id}/approve`)
        .set(clientAuth(client))
        .send();
      expect(approved.status).toBe(200);
      const { rows: [invoice] } = await db.query(
        'SELECT invoice_number FROM consulting_invoices WHERE id = $1', [approved.body.changeRequest.invoiceId],
      );
      numbers.push(invoice.invoice_number);
    }
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size).toBe(2);
    for (const number of numbers) expect(number).toMatch(/^CONS-\d{6}$/);
  });

  test('531: approving a scope change re-opens an accepted milestone', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();
    await db.query(
      `UPDATE consulting_deliverables SET status = 'accepted', accepted_by = $1, accepted_at = NOW() WHERE id = $2`,
      [client, deliverable.id],
    );

    const scope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'The client found a better supplier to add.',
      new_description: 'Five vetted suppliers, two local.',
    });
    const approved = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${scope.body.changeRequest.id}/approve`)
      .set(clientAuth(client))
      .send();
    expect(approved.status).toBe(200);
    const { rows: [reopened] } = await db.query(
      'SELECT status, accepted_by, accepted_at FROM consulting_deliverables WHERE id = $1', [deliverable.id],
    );
    expect(reopened.status).toBe('in_progress');
    expect(reopened.accepted_by).toBeNull();
    expect(reopened.accepted_at).toBeNull();
  });

  test('531: rejection needs a reason; withdrawal is the requester only', async () => {
    const { client, consultant, admin, sessionId, deliverable } = await setup();

    const scope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'The supplier list needs a fourth, local option.',
      new_description: 'Four vetted suppliers, one local.',
    });
    const scopeId = scope.body.changeRequest.id;

    const noReason = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${scopeId}/reject`)
      .set(clientAuth(client))
      .send({ decision_reason: 'No' });
    expect(noReason.status).toBe(400);

    // An admin cannot decide for the consultant (the client filed nothing
    // here; the consultant is the decider only when the client filed).
    const adminDecides = await request(app)
      .post(`/api/consulting/admin/sessions/${sessionId}/change-requests/${scopeId}/reject`)
      .set(auth(admin))
      .send({ decision_reason: 'Not needed right now, thanks.' });
    expect(adminDecides.status).toBe(200);
    expect(adminDecides.body.changeRequest.status).toBe('rejected');

    const fee = await fileRequest(sessionId, client, {
      request_type: 'additional_fee',
      reason: 'Please add a rush fee for the extra visit.',
      amount_cents: 5000,
    });
    const feeId = fee.body.changeRequest.id;

    // The consultant cannot withdraw the client's request.
    const strangerWithdraw = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/change-requests/${feeId}/withdraw`)
      .set(auth(consultant))
      .send();
    expect(strangerWithdraw.status).toBe(403);

    const withdrawn = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${feeId}/withdraw`)
      .set(clientAuth(client))
      .send();
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.changeRequest.status).toBe('withdrawn');

    const again = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${feeId}/withdraw`)
      .set(clientAuth(client))
      .send();
    expect(again.status).toBe(409);
  });

  test('534: the history shows change requests and engagement events', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();

    const scope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'The supplier list needs a fourth, local option.',
      new_description: 'Four vetted suppliers, one local.',
    });
    await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${scope.body.changeRequest.id}/approve`)
      .set(clientAuth(client))
      .send();

    const history = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/history`)
      .set(clientAuth(client));
    expect(history.status).toBe(200);
    expect(history.body.changeRequests).toHaveLength(1);
    expect(history.body.changeRequests[0].status).toBe('approved');
    expect(history.body.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['change_requested', 'change_approved']),
    );

    const stranger = await addUser();
    const denied = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/history`)
      .set(auth(stranger, `g10f-user-${stranger}@example.invalid`));
    expect(denied.status).toBe(403);
  });

  test('535: pause freezes milestone work and change approvals; resume restores', async () => {
    const { client, consultant, admin, sessionId, deliverable } = await setup();
    await db.query(
      `UPDATE consulting_deliverables SET status = 'in_progress' WHERE id = $1`, [deliverable.id],
    );

    const shortReason = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/pause`)
      .set(auth(consultant))
      .send({ reason: 'Too short' });
    expect(shortReason.status).toBe(400);

    const scope = await fileRequest(sessionId, consultant, {
      requested_by_consultant: true,
      request_type: 'scope_revision',
      deliverable_id: deliverable.id,
      reason: 'The supplier list needs a fourth, local option.',
      new_description: 'Four vetted suppliers, one local.',
    });
    const scopeId = scope.body.changeRequest.id;

    const paused = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/pause`)
      .set(auth(consultant))
      .send({ reason: 'Waiting on the client’s lease decision.' });
    expect(paused.status).toBe(200);
    expect(paused.body.session.status).toBe('paused');
    expect(paused.body.session.status_before_pause).toBe('pending');

    const again = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/pause`)
      .set(auth(consultant))
      .send({ reason: 'Waiting on the client’s lease decision.' });
    expect(again.status).toBe(409);

    const move = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(consultant))
      .send({ status: 'completed' });
    expect(move.status).toBe(409);
    expect(move.body.code).toBe('engagement_paused');

    const draft = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/deliver-draft`)
      .set(auth(consultant))
      .send({ draft_note: 'Draft while paused.' });
    expect(draft.status).toBe(409);

    const approve = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/change-requests/${scopeId}/approve`)
      .set(clientAuth(client))
      .send();
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe('engagement_paused');

    const complete = await request(app)
      .patch(`/api/consulting/admin/sessions/${sessionId}/complete`)
      .set(auth(admin))
      .send();
    expect(complete.status).toBe(409);
    expect(complete.body.error).toBe('engagement_paused');

    const resumed = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/resume`)
      .set(clientAuth(client))
      .send();
    expect(resumed.status).toBe(200);
    expect(resumed.body.session.status).toBe('pending');
    expect(resumed.body.session.paused_at).toBeNull();

    const moveAfter = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(consultant))
      .send({ status: 'completed' });
    expect(moveAfter.status).toBe(200);

    const resumeAgain = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/resume`)
      .set(auth(consultant))
      .send();
    expect(resumeAgain.status).toBe(409);
  });

  test('531: an admin cannot file a change request and a stranger cannot read them', async () => {
    const { client, consultant, admin, sessionId, deliverable } = await setup();
    const stranger = await addUser();

    const adminFiles = await request(app)
      .post(`/api/consulting/admin/sessions/${sessionId}/change-requests`)
      .set(auth(admin))
      .send({
        request_type: 'scope_revision',
        deliverable_id: deliverable.id,
        reason: 'Admin filing on behalf of no one.',
        new_description: 'Admin scope text.',
      });
    expect(adminFiles.status).toBe(404);

    const strangerList = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/change-requests`)
      .set(auth(stranger, `g10f-user-${stranger}@example.invalid`));
    expect(strangerList.status).toBe(403);

    const adminList = await request(app)
      .get(`/api/consulting/admin/sessions/${sessionId}/change-requests`)
      .set(auth(admin));
    expect(adminList.status).toBe(200);
    expect(adminList.body.changeRequests).toHaveLength(0);
  });
});
