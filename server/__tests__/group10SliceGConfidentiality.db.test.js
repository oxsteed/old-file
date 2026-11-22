'use strict';

// Group 10 Slice G acceptance: maintain confidentiality (536-540).
// Covers the built items end to end: participant list (536), limited
// file sharing with named shares (537), confidentiality acknowledgment
// (538), file access expiry (539), and engagement record export (540).
// Decisions D-132..D-137 in persona-roadmap-decisions.md.

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
    || !/^\/((credit_statement_test(_pr804_d)?)|(pa_[tg]\d+))$/.test(url.pathname)) {
    throw new Error('Group 10 Slice G DB tests require a loopback disposable database');
  }
  process.env.DATABASE_URL = dbUrl;
  process.env.STATEMENT_TEST_DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g10g-user-${id}@example.invalid`,
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

describeDb('Group 10 Slice G: maintain confidentiality', () => {
  let db;
  let app;
  const savedFlags = { ...process.env };

  beforeAll(async () => {
    process.env.ACCESS_CONSULTANT_ENFORCEMENT = 'shadow';
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
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
      [id, `g10g-user-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer'],
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
      [client, `g10g-client-${client}@example.invalid`, consultant, overrides.status || 'pending'],
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
    return auth(client, `g10g-client-${client}@example.invalid`);
  }

  async function setup() {
    const client = await addUser();
    const consultant = await addApprovedConsultant();
    const admin = await addUser('super_admin');
    const sessionId = await addSession(client, consultant);
    const deliverable = await addDeliverable(sessionId);
    return { client, consultant, admin, sessionId, deliverable };
  }

  async function addParticipantByEmail(sessionId, actor, email, role = 'site_contact') {
    return request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/participants`)
      .set(auth(actor))
      .send({ email, role });
  }

  async function uploadDoc(sessionId, deliverable, actor, actorIsClient, name = 'draft.pdf', visibility = 'shared') {
    const base = actorIsClient
      ? `/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents`
      : `/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`;
    const headers = actorIsClient ? clientAuth(actor) : auth(actor);
    return request(app).post(base).set(headers)
      .field('visibility', visibility)
      .attach('file', Buffer.from('%PDF-1.4 fake', 'utf8'), name);
  }

  test('536: participant list shows core parties; consultant adds by email; validation errors', async () => {
    const { client, consultant, sessionId } = await setup();
    const siteContact = await addUser();

    const list = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/participants`)
      .set(auth(consultant));
    expect(list.status).toBe(200);
    expect(list.body.core).toHaveLength(2);
    expect(list.body.core.map((party) => party.role).sort()).toEqual(['client', 'consultant']);
    expect(list.body.participants).toHaveLength(0);

    const added = await addParticipantByEmail(sessionId, consultant, `g10g-user-${siteContact}@example.invalid`, 'site_contact');
    expect(added.status).toBe(201);
    expect(added.body.participant.role).toBe('site_contact');
    expect(added.body.participant.active).toBe(true);

    const duplicate = await addParticipantByEmail(sessionId, consultant, `g10g-user-${siteContact}@example.invalid`, 'observer');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('participant_exists');

    const coreParty = await addParticipantByEmail(sessionId, consultant, `g10g-user-${client}@example.invalid`, 'observer');
    expect(coreParty.status).toBe(409);
    expect(coreParty.body.code).toBe('core_party');

    const unknown = await addParticipantByEmail(sessionId, consultant, 'nobody@example.invalid', 'observer');
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('user_not_found');

    const badRole = await addParticipantByEmail(sessionId, consultant, `g10g-user-${siteContact}@example.invalid`, 'owner');
    expect(badRole.status).toBe(400);

    const clientAdds = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/participants`)
      .set(clientAuth(client))
      .send({ email: `g10g-user-${siteContact}@example.invalid`, role: 'observer' });
    expect(clientAdds.status).toBe(404); // the client router mounts no add route

    const stranger = await addUser();
    const strangerList = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/participants`)
      .set(auth(stranger));
    expect(strangerList.status).toBe(403);
  });

  test('536: a participant reads the board but cannot mutate; removal revokes access', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();
    const siteContact = await addUser();
    const added = await addParticipantByEmail(sessionId, consultant, `g10g-user-${siteContact}@example.invalid`, 'site_contact');
    const participantId = added.body.participant.id;

    const board = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables`)
      .set(auth(siteContact));
    expect(board.status).toBe(200);
    expect(board.body.deliverables).toHaveLength(1);

    const change = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/change-requests`)
      .set(auth(siteContact))
      .send({ request_type: 'scope_revision', deliverable_id: deliverable.id, reason: 'Participants should not file this.', new_description: 'Changed scope.' });
    expect(change.status).toBe(403);

    const upload = await uploadDoc(sessionId, deliverable, siteContact, false);
    expect(upload.status).toBe(404);

    const participating = await request(app)
      .get('/api/consulting/business-launch/sessions/participating')
      .set(auth(siteContact));
    expect(participating.status).toBe(200);
    expect(participating.body.engagements).toHaveLength(1);
    expect(participating.body.engagements[0].participantRole).toBe('site_contact');

    const removed = await request(app)
      .delete(`/api/consulting/contractor/sessions/${sessionId}/participants/${participantId}`)
      .set(auth(consultant));
    expect(removed.status).toBe(200);
    expect(removed.body.participant.active).toBe(false);

    const boardAfter = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables`)
      .set(auth(siteContact));
    expect(boardAfter.status).toBe(403);

    const participatingAfter = await request(app)
      .get('/api/consulting/business-launch/sessions/participating')
      .set(auth(siteContact));
    expect(participatingAfter.body.engagements).toHaveLength(0);

    // The client never had a participating row.
    const clientParticipating = await request(app)
      .get('/api/consulting/business-launch/sessions/participating')
      .set(clientAuth(client));
    expect(clientParticipating.body.engagements).toHaveLength(0);
  });

  test('538: confidentiality acknowledgment is per-party, once, and never gates work', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();
    const observer = await addUser();
    await addParticipantByEmail(sessionId, consultant, `g10g-user-${observer}@example.invalid`, 'observer');

    const status = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/confidentiality`)
      .set(auth(consultant));
    expect(status.status).toBe(200);
    expect(status.body.termsVersion).toBe('2026-11-22-v1');
    expect(status.body.parties).toHaveLength(3);
    expect(status.body.parties.every((party) => party.acknowledgedAt === null)).toBe(true);

    const clientAck = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/confidentiality/acknowledge`)
      .set(clientAuth(client));
    expect(clientAck.status).toBe(201);
    expect(clientAck.body.acknowledgment.termsVersion).toBe('2026-11-22-v1');

    const clientAckAgain = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/confidentiality/acknowledge`)
      .set(clientAuth(client));
    expect(clientAckAgain.status).toBe(409);
    expect(clientAckAgain.body.code).toBe('already_acknowledged');

    const observerAck = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/confidentiality/acknowledge`)
      .set(auth(observer));
    expect(observerAck.status).toBe(201);
    expect(observerAck.body.acknowledgment.role).toBe('observer');

    const admin = await addUser('super_admin');
    const adminAck = await request(app)
      .post(`/api/consulting/contractor/sessions/${sessionId}/confidentiality/acknowledge`)
      .set(auth(admin));
    expect(adminAck.status).toBe(403);

    const stranger = await addUser();
    const strangerAck = await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/confidentiality/acknowledge`)
      .set(auth(stranger));
    expect(strangerAck.status).toBe(403);

    const after = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/confidentiality`)
      .set(auth(consultant));
    const byRole = new Map(after.body.parties.map((party) => [party.role, party]));
    expect(byRole.get('client').acknowledgedAt).not.toBeNull();
    expect(byRole.get('observer').acknowledgedAt).not.toBeNull();
    expect(byRole.get('consultant').acknowledgedAt).toBeNull();

    // Acknowledging never gates work: the consultant still moves a milestone.
    const move = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/status`)
      .set(auth(consultant))
      .send({ status: 'in_progress' });
    expect(move.status).toBe(200);
  });

  test('537: limited sharing shows a document only to its named shares', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();
    const siteContact = await addUser();
    const observer = await addUser();
    await addParticipantByEmail(sessionId, consultant, `g10g-user-${siteContact}@example.invalid`, 'site_contact');
    await addParticipantByEmail(sessionId, consultant, `g10g-user-${observer}@example.invalid`, 'observer');

    const uploaded = await uploadDoc(sessionId, deliverable, consultant, false, 'plan.pdf', 'shared');
    expect(uploaded.status).toBe(201);
    const documentId = uploaded.body.document.id;

    const toLimited = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ visibility: 'limited', shared_with: [siteContact] });
    expect(toLimited.status).toBe(200);
    expect(toLimited.body.document.visibility).toBe('limited');
    expect(toLimited.body.document.sharedWith).toEqual([siteContact]);

    const contactSees = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(auth(siteContact));
    expect(contactSees.body.documents).toHaveLength(1);

    const observerSees = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(auth(observer));
    expect(observerSees.body.documents).toHaveLength(0);

    const clientSees = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(clientAuth(client));
    expect(clientSees.body.documents).toHaveLength(0);

    const contactDownload = await request(app)
      .get(`/api/consulting/contractor/documents/${documentId}/download`)
      .set(auth(siteContact));
    expect(contactDownload.status).toBe(200);
    expect(contactDownload.body.url).toBe('https://signed.example/test-key');

    const observerDownload = await request(app)
      .get(`/api/consulting/contractor/documents/${documentId}/download`)
      .set(auth(observer));
    expect(observerDownload.status).toBe(404);

    // Replacing the share list revokes the first contact.
    const reshared = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ shared_with: [observer] });
    expect(reshared.status).toBe(200);
    expect(reshared.body.document.sharedWith).toEqual([observer]);
    const contactSeesAfter = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(auth(siteContact));
    expect(contactSeesAfter.body.documents).toHaveLength(0);

    // Named shares need limited visibility.
    const sharedDoc = await uploadDoc(sessionId, deliverable, consultant, false, 'open.pdf', 'shared');
    const sharesOnShared = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${sharedDoc.body.document.id}`)
      .set(auth(consultant))
      .send({ shared_with: [siteContact] });
    expect(sharesOnShared.status).toBe(409);
    expect(sharesOnShared.body.code).toBe('shares_require_limited');

    // A stranger cannot be named in a share list.
    const stranger = await addUser();
    const badShare = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ shared_with: [stranger] });
    expect(badShare.status).toBe(400);
    expect(badShare.body.code).toBe('invalid_share_user');
  });

  test('537: only the uploader or an admin changes sharing; party visibility rules apply', async () => {
    const { client, consultant, admin, sessionId, deliverable } = await setup();

    const clientDoc = await uploadDoc(sessionId, deliverable, client, true, 'brief.pdf', 'client_only');
    expect(clientDoc.status).toBe(201);
    const documentId = clientDoc.body.document.id;

    const consultantChanges = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ visibility: 'shared' });
    expect(consultantChanges.status).toBe(403);

    const clientToConsultantOnly = await request(app)
      .patch(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(clientAuth(client))
      .send({ visibility: 'consultant_only' });
    expect(clientToConsultantOnly.status).toBe(403);
    expect(clientToConsultantOnly.body.code).toBe('visibility_forbidden');

    const adminToInternal = await request(app)
      .patch(`/api/consulting/admin/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(admin))
      .send({ visibility: 'internal' });
    expect(adminToInternal.status).toBe(200);
    expect(adminToInternal.body.document.visibility).toBe('internal');

    const badVisibility = await request(app)
      .patch(`/api/consulting/admin/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(admin))
      .send({ visibility: 'everyone' });
    expect(badVisibility.status).toBe(400);

    const nothing = await request(app)
      .patch(`/api/consulting/admin/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(admin))
      .send({});
    expect(nothing.status).toBe(400);
  });

  test('539: file access expiry is enforced at download and list time', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();

    const uploaded = await uploadDoc(sessionId, deliverable, consultant, false, 'timed.pdf', 'shared');
    expect(uploaded.status).toBe(201);
    const documentId = uploaded.body.document.id;

    const pastExpiry = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ expires_at: '2020-01-01T00:00:00.000Z' });
    expect(pastExpiry.status).toBe(400);
    expect(pastExpiry.body.code).toBe('expiry_in_past');

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const setExpiry = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ expires_at: future });
    expect(setExpiry.status).toBe(200);
    expect(setExpiry.body.document.expiresAt).not.toBeNull();

    const beforeExpiry = await request(app)
      .get(`/api/consulting/business-launch/documents/${documentId}/download`)
      .set(clientAuth(client));
    expect(beforeExpiry.status).toBe(200);

    // Move the expiry into the past directly: the API never accepts a
    // past expiry, so the expired state is reached by time passing.
    await db.query(
      `UPDATE consulting_deliverable_documents SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [documentId],
    );

    const afterExpiry = await request(app)
      .get(`/api/consulting/business-launch/documents/${documentId}/download`)
      .set(clientAuth(client));
    expect(afterExpiry.status).toBe(410);
    expect(afterExpiry.body.code).toBe('document_expired');

    // The client stops seeing it; the uploader still sees it flagged,
    // so the expiry can be renewed.
    const clientList = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(clientAuth(client));
    expect(clientList.body.documents).toHaveLength(0);

    const uploaderList = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents`)
      .set(auth(consultant));
    expect(uploaderList.body.documents).toHaveLength(1);
    expect(uploaderList.body.documents[0].expired).toBe(true);

    const renewed = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(renewed.status).toBe(200);
    expect(renewed.body.document.expired).toBe(false);

    const cleared = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ expires_at: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.document.expiresAt).toBeNull();
  });

  test('540: engagement record export carries the full record; strangers get nothing', async () => {
    const { client, consultant, admin, sessionId, deliverable } = await setup();
    const siteContact = await addUser();
    await addParticipantByEmail(sessionId, consultant, `g10g-user-${siteContact}@example.invalid`, 'site_contact');
    await uploadDoc(sessionId, deliverable, consultant, false, 'plan.pdf', 'shared');
    await request(app)
      .post(`/api/consulting/business-launch/sessions/${sessionId}/confidentiality/acknowledge`)
      .set(clientAuth(client));

    const exported = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/export`)
      .set(clientAuth(client));
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain(`engagement-${sessionId}-record.json`);
    expect(String(exported.body.session.id)).toBe(sessionId);
    expect(exported.body.deliverables).toHaveLength(1);
    expect(exported.body.deliverables[0].documents).toHaveLength(1);
    expect(exported.body.participants).toHaveLength(1);
    expect(exported.body.confidentiality.acknowledgments).toHaveLength(1);
    expect(exported.body.changeRequests).toEqual([]);
    expect(exported.body.history.length).toBeGreaterThanOrEqual(1);
    expect(exported.body.invoices).toEqual([]);

    // The export itself is written to the history.
    const history = await request(app)
      .get(`/api/consulting/contractor/sessions/${sessionId}/history`)
      .set(auth(consultant));
    expect(history.body.events.some((event) => event.eventType === 'record_exported')).toBe(true);
    expect(history.body.events.some((event) => event.eventType === 'participant_added')).toBe(true);
    expect(history.body.events.some((event) => event.eventType === 'confidentiality_acknowledged')).toBe(true);

    const stranger = await addUser();
    const strangerExport = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/export`)
      .set(auth(stranger));
    expect(strangerExport.status).toBe(403);

    // A participant's export is filtered: no invoice section, and the
    // document list follows their visibility.
    const participantExport = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/export`)
      .set(auth(siteContact));
    expect(participantExport.status).toBe(200);
    expect(participantExport.body.invoices).toBeNull();
    expect(participantExport.body.deliverables[0].documents).toHaveLength(1);

    const adminExport = await request(app)
      .get(`/api/consulting/admin/sessions/${sessionId}/export`)
      .set(auth(admin));
    expect(adminExport.status).toBe(200);
    expect(adminExport.body.invoices).toEqual([]);
  });

  test('540: a limited document is absent from a participant export that does not name them', async () => {
    const { client, consultant, sessionId, deliverable } = await setup();
    const named = await addUser();
    const unnamed = await addUser();
    await addParticipantByEmail(sessionId, consultant, `g10g-user-${named}@example.invalid`, 'site_contact');
    await addParticipantByEmail(sessionId, consultant, `g10g-user-${unnamed}@example.invalid`, 'observer');

    const uploaded = await uploadDoc(sessionId, deliverable, consultant, false, 'private.pdf', 'shared');
    const documentId = uploaded.body.document.id;
    const limited = await request(app)
      .patch(`/api/consulting/contractor/sessions/${sessionId}/deliverables/${deliverable.id}/documents/${documentId}`)
      .set(auth(consultant))
      .send({ visibility: 'limited', shared_with: [named] });
    expect(limited.status).toBe(200);

    const unnamedExport = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/export`)
      .set(auth(unnamed));
    expect(unnamedExport.status).toBe(200);
    expect(unnamedExport.body.deliverables[0].documents).toHaveLength(0);

    const namedExport = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/export`)
      .set(auth(named));
    expect(namedExport.body.deliverables[0].documents).toHaveLength(1);

    const clientExport = await request(app)
      .get(`/api/consulting/business-launch/sessions/${sessionId}/export`)
      .set(clientAuth(client));
    expect(clientExport.body.deliverables[0].documents).toHaveLength(0);
  });
});
