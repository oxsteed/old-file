'use strict';

/**
 * PR #804 Track D, G-6 (book for another person) and G-7 (site contact).
 *
 * Against the real migrated schema, through the real booking controller:
 *   - a booking created with recipientUserId + recipient name/phone stores
 *     booked_by_user_id = booker and the recipient; the deposit payer stays
 *     the booker (booking.customer_id);
 *   - the recipient can read the booking and cancel it; a stranger 403s;
 *   - a booking created with a site contact mints a status_token, and the
 *     public token endpoint returns status + arrival window only (no
 *     customer/helper identity, no amounts, no billing); an unknown token 404s.
 *
 * DB: disposable loopback database credit_statement_test_pr804_d only; the
 * suite skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d)?$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Track D test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pr804-track-d-test-secret';
}

const pool = require('../db');
const bookingController = require('../controllers/bookingController');
const bookingLifecycle = require('../services/bookingRequestLifecycle');
const jobController = require('../controllers/jobController');
const messageController = require('../controllers/messageController');
const { assertConversationParticipant } = require('../services/chatThreadAccess');
const { viewerRole, serializeJob } = require('../services/jobSerializer');
const bookingDeposits = require('../services/bookingDepositService');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

function tomorrow() {
  // Two days out, not one: createBookingRequest caps the confirmation
  // deadline at the hours until the service start, so a tomorrow-10:00
  // booking with confirmationHours 24 fails after 10:00 UTC. +2 days keeps
  // the window above 24h at any time of day.
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('G-6 book for another person / G-7 site contact', () => {
  let booker;
  let helper;
  let recipient;
  let stranger;
  let siteContact;

  beforeAll(async () => {
    async function makeUser(role) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE)`,
        [id, `pr804d-${id.slice(0, 8)}@example.invalid`, role, role],
      );
      return id;
    }
    booker = await makeUser('customer');
    helper = await makeUser('helper');
    recipient = await makeUser('customer');
    stranger = await makeUser('customer');
    siteContact = await makeUser('customer');
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createBooking({ asUser, overrides = {} } = {}) {
    const res = mockRes();
    await bookingController.createBookingRequest({
      user: { id: asUser || booker },
      body: {
        helperId: helper,
        serviceName: 'Fix the sink',
        requestedDate: tomorrow(),
        requestedStartTime: '10:00',
        requestedEndTime: '11:00',
        serviceLocation: '12 Main St',
        description: 'Leaky tap',
        confirmationHours: 24,
        ...overrides,
      },
    }, res);
    return res;
  }

  test('G-6: booking for another person stores booker + recipient; recipient reads and cancels', async () => {
    const created = await createBooking({
      overrides: { recipientUserId: recipient, recipientName: 'Mom', recipientPhone: '555-0100' },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    expect(booking.customerId).toBe(booker);
    expect(booking.bookedByUserId).toBe(booker);
    expect(booking.recipientUserId).toBe(recipient);
    expect(booking.recipientName).toBe('Mom');

    const { rows } = await pool.query('SELECT customer_id, booked_by_user_id, recipient_user_id FROM booking_requests WHERE id = $1', [booking.id]);
    expect(rows[0].customer_id).toBe(booker);
    expect(rows[0].booked_by_user_id).toBe(booker);
    expect(rows[0].recipient_user_id).toBe(recipient);

    // Recipient reads.
    const read = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: recipient } }, read);
    expect(read.statusCode).toBe(200);
    expect(read.payload.data.id).toBe(booking.id);

    // Stranger cannot read.
    const denied = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: stranger } }, denied);
    expect(denied.statusCode).toBe(403);

    // Recipient cancels.
    const cancelled = mockRes();
    await bookingController.cancelBookingRequest({ params: { bookingId: booking.id }, user: { id: recipient }, body: {} }, cancelled);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.payload.data.status).toBe('cancelled');
  });

  test('G-6: booking for yourself as recipient is rejected', async () => {
    const res = await createBooking({ overrides: { recipientUserId: booker } });
    expect(res.statusCode).toBe(400);
  });

  test('G-7: site contact mints a status token; public status shows no billing or identities', async () => {
    const created = await createBooking({
      overrides: { siteContactName: 'Concierge', siteContactPhone: '555-0200' },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    expect(booking.siteContactName).toBe('Concierge');
    expect(typeof booking.statusToken).toBe('string');
    expect(booking.statusToken).toHaveLength(64);

    const pub = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: booking.statusToken } }, pub);
    expect(pub.statusCode).toBe(200);
    expect(pub.payload.data.serviceName).toBe('Fix the sink');
    expect(pub.payload.data.status).toBe('pending');
    expect(pub.payload.data.requestedDate).toBeTruthy();
    // Nothing identifying the parties and nothing money-shaped leaks.
    expect(pub.payload.data).not.toHaveProperty('customerId');
    expect(pub.payload.data).not.toHaveProperty('helperId');
    expect(pub.payload.data).not.toHaveProperty('customer_id');
    expect(JSON.stringify(pub.payload.data)).not.toMatch(/cents|amount|price|payment|deposit/i);

    const missing = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: '0'.repeat(64) } }, missing);
    expect(missing.statusCode).toBe(404);
  });

  // G-6/G-7 delivery + acceptance + expiry + revocation + scoped reads.
  async function notificationsFor(userId, type) {
    const { rows } = await pool.query(
      `SELECT type, action_url FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT 5`,
      [userId, type],
    );
    return rows;
  }

  async function makeUserWithEmail(email, role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE)`,
      [id, email, role, role],
    );
    return id;
  }

  test('G-6/G-7: status link is delivered to recipient and site-contact accounts', async () => {
    const created = await createBooking({
      overrides: { recipientUserId: recipient, recipientName: 'Mom', siteContactUserId: siteContact, siteContactName: 'Concierge' },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    expect(typeof booking.recipientToken).toBe('string');
    expect(booking.recipientToken).toHaveLength(64);
    expect(typeof booking.statusToken).toBe('string');
    // 7-day expiry, within tolerance.
    const expiresIn = new Date(booking.statusTokenExpiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 60 * 1000);

    // Delivery is asserted on the notification outbox, not on a URL string.
    const recipientNotes = await notificationsFor(recipient, 'booking_recipient_invite');
    expect(recipientNotes.length).toBeGreaterThanOrEqual(1);
    expect(recipientNotes[0].action_url).toContain(`/bookings/status/${booking.recipientToken}`);
    const contactNotes = await notificationsFor(siteContact, 'booking_site_contact_link');
    expect(contactNotes.length).toBeGreaterThanOrEqual(1);
    expect(contactNotes[0].action_url).toContain(`/bookings/status/${booking.statusToken}`);
  });

  test('G-6: email attaches an existing account; unknown email stays named-only', async () => {
    const emailUser = await makeUserWithEmail(`pr804d-link-${Date.now()}@example.invalid`, 'customer');
    const linked = await createBooking({
      overrides: { recipientEmail: (await pool.query('SELECT email FROM users WHERE id = $1', [emailUser])).rows[0].email },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.payload.data.recipientUserId).toBe(emailUser);

    const named = await createBooking({
      overrides: { recipientName: 'Nobody Here', recipientEmail: 'no-such-account@example.invalid' },
    });
    expect(named.statusCode).toBe(201);
    expect(named.payload.data.recipientUserId).toBeNull();
    expect(typeof named.payload.data.recipientToken).toBe('string');
  });

  test('G-6: named recipient accepts via invite token; site-contact token cannot respond; second response rejected', async () => {
    const created = await createBooking({
      overrides: { recipientName: 'Mom', recipientPhone: '555-0100', siteContactName: 'Concierge' },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;

    const pub = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: booking.recipientToken } }, pub);
    expect(pub.statusCode).toBe(200);
    expect(pub.payload.data.canRespondAsRecipient).toBe(true);
    expect(pub.payload.data.recipientConsentStatus).toBe('pending');

    // The site-contact token opens the status page but cannot respond.
    const wrongToken = mockRes();
    await bookingController.respondToRecipientInvite(
      { params: { token: booking.statusToken }, body: { decision: 'accepted' } }, wrongToken,
    );
    expect(wrongToken.statusCode).toBe(404);

    const accepted = mockRes();
    await bookingController.respondToRecipientInvite(
      { params: { token: booking.recipientToken }, body: { decision: 'accepted' } }, accepted,
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.payload.data.recipientConsentStatus).toBe('accepted');
    const { rows } = await pool.query(
      'SELECT recipient_consent_status, recipient_consented_at, recipient_consent_method FROM booking_requests WHERE id = $1',
      [booking.id],
    );
    expect(rows[0].recipient_consent_status).toBe('accepted');
    expect(rows[0].recipient_consented_at).toBeTruthy();
    expect(rows[0].recipient_consent_method).toBe('token');

    const again = mockRes();
    await bookingController.respondToRecipientInvite(
      { params: { token: booking.recipientToken }, body: { decision: 'declined' } }, again,
    );
    expect(again.statusCode).toBe(409);
  });

  test('G-6: signed-in recipient links their account on token accept', async () => {
    const created = await createBooking({ overrides: { recipientName: 'Mom' } });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    const res = mockRes();
    await bookingController.respondToRecipientInvite(
      { params: { token: booking.recipientToken }, body: { decision: 'accepted' }, user: { id: recipient } }, res,
    );
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      'SELECT recipient_user_id, recipient_consent_method FROM booking_requests WHERE id = $1',
      [booking.id],
    );
    expect(String(rows[0].recipient_user_id)).toBe(String(recipient));
    expect(rows[0].recipient_consent_method).toBe('account');
  });

  test('G-6: account recipient declines from their account; stranger cannot respond', async () => {
    const created = await createBooking({ overrides: { recipientUserId: recipient } });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;

    const denied = mockRes();
    await bookingController.respondAsRecipient(
      { params: { bookingId: booking.id }, body: { decision: 'accepted' }, user: { id: stranger } }, denied,
    );
    expect(denied.statusCode).toBe(403);

    const declined = mockRes();
    await bookingController.respondAsRecipient(
      { params: { bookingId: booking.id }, body: { decision: 'declined' }, user: { id: recipient } }, declined,
    );
    expect(declined.statusCode).toBe(200);
    expect(declined.payload.data.recipientConsentStatus).toBe('declined');
    const { rows } = await pool.query(
      'SELECT recipient_consent_status, recipient_consent_method FROM booking_requests WHERE id = $1',
      [booking.id],
    );
    expect(rows[0].recipient_consent_status).toBe('declined');
    expect(rows[0].recipient_consent_method).toBe('account');
  });

  test('G-6/G-7: expired link is rejected; revoked link is rejected; only the booker revokes', async () => {
    const expired = await createBooking({ overrides: { recipientName: 'Mom', siteContactName: 'Concierge' } });
    expect(expired.statusCode).toBe(201);
    await pool.query(
      "UPDATE booking_requests SET status_token_expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
      [expired.payload.data.id],
    );
    const pubExpired = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: expired.payload.data.recipientToken } }, pubExpired);
    expect(pubExpired.statusCode).toBe(404);
    const respondExpired = mockRes();
    await bookingController.respondToRecipientInvite(
      { params: { token: expired.payload.data.recipientToken }, body: { decision: 'accepted' } }, respondExpired,
    );
    expect(respondExpired.statusCode).toBe(404);

    const toRevoke = await createBooking({ overrides: { recipientName: 'Mom', siteContactName: 'Concierge' } });
    expect(toRevoke.statusCode).toBe(201);
    const bookingId = toRevoke.payload.data.id;
    const notBooker = mockRes();
    await bookingController.revokeStatusLink({ params: { bookingId }, user: { id: stranger } }, notBooker);
    expect(notBooker.statusCode).toBe(403);
    const revoked = mockRes();
    await bookingController.revokeStatusLink({ params: { bookingId }, user: { id: booker } }, revoked);
    expect(revoked.statusCode).toBe(200);
    const pubRevoked = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: toRevoke.payload.data.statusToken } }, pubRevoked);
    expect(pubRevoked.statusCode).toBe(404);
    const respondRevoked = mockRes();
    await bookingController.respondToRecipientInvite(
      { params: { token: toRevoke.payload.data.recipientToken }, body: { decision: 'accepted' } }, respondRevoked,
    );
    expect(respondRevoked.statusCode).toBe(404);
    const again = mockRes();
    await bookingController.revokeStatusLink({ params: { bookingId }, user: { id: booker } }, again);
    expect(again.statusCode).toBe(409);
  });

  test('G-6/G-7: revoked-after-accept is refused', async () => {
    const created = await createBooking({ overrides: { recipientUserId: recipient } });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    const accepted = mockRes();
    await bookingController.respondAsRecipient(
      { params: { bookingId }, body: { decision: 'accepted' }, user: { id: recipient } }, accepted,
    );
    expect(accepted.statusCode).toBe(200);
    const revoked = mockRes();
    await bookingController.revokeStatusLink({ params: { bookingId }, user: { id: booker } }, revoked);
    expect(revoked.statusCode).toBe(400);
  });

  test('G-7: site contact gets a scoped read, cannot cancel, and sees the booking in their list', async () => {
    const created = await createBooking({
      overrides: {
        recipientUserId: recipient, recipientName: 'Mom', recipientPhone: '555-0100',
        siteContactUserId: siteContact, siteContactName: 'Concierge', siteContactPhone: '555-0200',
      },
    });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;

    const read = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: siteContact } }, read);
    expect(read.statusCode).toBe(200);
    expect(read.payload.data.serviceName).toBe('Fix the sink');
    expect(read.payload.data.status).toBe('pending');
    expect(read.payload.data.serviceLocation).toBe('12 Main St');
    expect(read.payload.data.helperId).toBe(helper);
    // Scoped: no recipient details, no status link, nothing money-shaped.
    expect(read.payload.data).not.toHaveProperty('recipientName');
    expect(read.payload.data).not.toHaveProperty('recipientPhone');
    expect(read.payload.data).not.toHaveProperty('statusToken');
    expect(read.payload.data).not.toHaveProperty('recipientToken');
    expect(JSON.stringify(read.payload.data)).not.toMatch(/cents|amount|price|payment|deposit/i);

    // The recipient's read carries no payment internals either.
    const recipientRead = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: recipient } }, recipientRead);
    expect(recipientRead.statusCode).toBe(200);
    expect(JSON.stringify(recipientRead.payload.data)).not.toMatch(/cents|amount|price|payment|deposit/i);
    expect(recipientRead.payload.data).not.toHaveProperty('recipientToken');

    const cannotCancel = mockRes();
    await bookingController.cancelBookingRequest(
      { params: { bookingId: booking.id }, user: { id: siteContact }, body: {} }, cannotCancel,
    );
    expect(cannotCancel.statusCode).toBe(403);

    const list = mockRes();
    await bookingController.getMyBookingRequests({ user: { id: siteContact }, query: {} }, list);
    expect(list.statusCode).toBe(200);
    expect(list.payload.data.map((b) => b.id)).toContain(booking.id);
    const strangerList = mockRes();
    await bookingController.getMyBookingRequests({ user: { id: stranger }, query: {} }, strangerList);
    expect(strangerList.payload.data.map((b) => b.id)).not.toContain(booking.id);
  });

  test('G-6: the deposit stays with the booker; the recipient is never the payer', async () => {
    const created = await createBooking({ overrides: { recipientUserId: recipient, recipientName: 'Mom' } });
    expect(created.statusCode).toBe(201);
    const booking = created.payload.data;
    const { rows } = await pool.query(
      'SELECT customer_id, recipient_user_id, stripe_payment_intent_id, payment_status FROM booking_requests WHERE id = $1',
      [booking.id],
    );
    expect(rows[0].customer_id).toBe(booker);
    expect(String(rows[0].recipient_user_id)).toBe(String(recipient));
    expect(rows[0].recipient_user_id).not.toBe(rows[0].customer_id);
    expect(rows[0].stripe_payment_intent_id).toBeNull();
    // Cancelling the recipient's booking settles nothing against the
    // recipient: no payment intent exists, so settlement is a no-op.
    const cancelled = mockRes();
    await bookingController.cancelBookingRequest(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: {} }, cancelled,
    );
    expect(cancelled.statusCode).toBe(200);
    expect(await bookingDeposits.settleTerminalBooking(booking.id, 'customer_cancelled')).toBe('no_payment');
  });

  test('G-6/G-7: expired booking carries recipient and site contact onto the posted job', async () => {
    const created = await createBooking({
      overrides: {
        availabilityMode: 'request_only', autoPostOnExpiry: true,
        recipientUserId: recipient, recipientName: 'Mom', recipientPhone: '555-0100',
        siteContactUserId: siteContact, siteContactName: 'Concierge', siteContactPhone: '555-0200',
      },
    });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    await pool.query(
      "UPDATE booking_requests SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
      [bookingId],
    );
    const posted = await bookingLifecycle.autoPostExpiredBooking(bookingId);
    expect(posted).toBeTruthy();
    const { rows } = await pool.query(
      `SELECT client_id, recipient_user_id, recipient_name, recipient_phone,
              site_contact_user_id, site_contact_name, site_contact_phone
         FROM jobs WHERE id = $1`,
      [posted.jobId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe(booker);
    expect(String(rows[0].recipient_user_id)).toBe(String(recipient));
    expect(rows[0].recipient_name).toBe('Mom');
    expect(String(rows[0].site_contact_user_id)).toBe(String(siteContact));
    expect(rows[0].site_contact_name).toBe('Concierge');

    // The job surfaces in the recipient's and site contact's jobs views,
    // and in nobody else's.
    await pool.query("UPDATE jobs SET private_notes = 'booker private' WHERE id = $1", [posted.jobId]);
    const next = jest.fn();
    for (const viewer of [recipient, siteContact]) {
      const res = mockRes();
      await jobController.getMyJobs({ user: { id: viewer }, query: {}, headers: {}, language: 'en' }, res, next);
      expect(next).not.toHaveBeenCalled();
      const mine = (res.payload || []).find((j) => String(j.id) === String(posted.jobId));
      expect(mine).toBeTruthy();
      expect(mine.private_notes).toBeNull();
    }
    const strangerRes = mockRes();
    await jobController.getMyJobs({ user: { id: stranger }, query: {}, headers: {}, language: 'en' }, strangerRes, next);
    expect((strangerRes.payload || []).map((j) => String(j.id))).not.toContain(String(posted.jobId));

    // Single-job read: linked viewers get the address but no escrow or
    // private notes; the serializer role is 'linked'.
    const jobRow = (await pool.query('SELECT * FROM jobs WHERE id = $1', [posted.jobId])).rows[0];
    expect(viewerRole(jobRow, { id: recipient })).toBe('linked');
    expect(viewerRole(jobRow, { id: siteContact })).toBe('linked');
    expect(viewerRole(jobRow, { id: stranger })).toBe('public');
    const linked = serializeJob({ ...jobRow, escrow_status: 'held', private_notes: 'booker private' }, { user: { id: recipient } });
    expect(linked.location_address).toBe('12 Main St');
    expect(linked).not.toHaveProperty('escrow_status');
    expect(linked).not.toHaveProperty('private_notes');

    const readRes = mockRes();
    readRes.set = jest.fn();
    await jobController.getJob({ params: { id: posted.jobId }, user: { id: recipient }, headers: {} }, readRes, next);
    expect(next).not.toHaveBeenCalled();
    expect(readRes.payload.location_address).toBe('12 Main St');
    expect(readRes.payload).not.toHaveProperty('escrow_status');
    expect(readRes.payload).not.toHaveProperty('private_notes');
  });

  test('G-7: site contact is admitted to the booking chat thread only', async () => {
    const created = await createBooking({
      overrides: { siteContactUserId: siteContact, siteContactName: 'Concierge' },
    });
    expect(created.statusCode).toBe(201);
    const bookingId = created.payload.data.id;
    const convId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO conversations (id, customer_id, helper_id, status) VALUES ($1, $2, $3, 'active')`,
      [convId, booker, helper],
    );
    await pool.query('UPDATE booking_requests SET conversation_id = $1 WHERE id = $2', [convId, bookingId]);
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1, $2, 'hello from the booker')`,
      [convId, booker],
    );

    // Thread gate: site contact in, recipient and stranger out.
    expect(await assertConversationParticipant(siteContact, convId)).toBeTruthy();
    expect(await assertConversationParticipant(recipient, convId)).toBeNull();
    expect(await assertConversationParticipant(stranger, convId)).toBeNull();

    // Read path: the site contact sees the thread's messages.
    const readRes = mockRes();
    const next = jest.fn();
    await messageController.getMessages(
      { user: { id: siteContact }, params: { conversationId: convId }, query: {} }, readRes, next,
    );
    expect(next).not.toHaveBeenCalled();
    const messages = readRes.payload?.messages || readRes.payload;
    expect(Array.isArray(messages) ? messages.length : 0).toBeGreaterThanOrEqual(1);

    // Write path: the site contact can send in that thread only.
    const sendRes = mockRes();
    await messageController.sendMessage(
      {
        user: { id: siteContact }, params: { conversationId: convId },
        body: { content: 'On site, gate code 1234' }, get: () => null, headers: {},
      },
      sendRes, next,
    );
    expect(next).not.toHaveBeenCalled();
    const sent = sendRes.payload?.message || sendRes.payload;
    expect(sent).toBeTruthy();

    // ...and nowhere else: a thread with no booking link stays closed.
    // (A different pair: one personal thread per customer/helper pair.)
    const otherConv = crypto.randomUUID();
    await pool.query(
      `INSERT INTO conversations (id, customer_id, helper_id, status) VALUES ($1, $2, $3, 'active')`,
      [otherConv, recipient, helper],
    );
    expect(await assertConversationParticipant(siteContact, otherConv)).toBeNull();
  });
});
