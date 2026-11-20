'use strict';

/**
 * Group 3 (Recipient and sponsor, items 101-150) — acceptance tests
 * against the real migrated schema, through the real controllers:
 *
 *   items 101/119  limited status + booking-only history are already
 *            real (existing G-6/G-7 reads); the recipient's list carries
 *            only their linked bookings, and the token page shows status
 *            only, no billing or identities;
 *   items 102/103/105  visit reminder once per party (sweep), booking
 *            arrival stamps the appointment and notifies all three
 *            parties, auto-complete notifies recipient + site contact;
 *   item 104  provider identity: full name on the account read, first
 *            name + last initial on the token page once accepted;
 *   items 106-110/141/144  site actions record + notify the booker,
 *            handoff confirmation returns a receipt, completion
 *            acknowledgment is recorded;
 *   items 112-115/120/147  contact replacement mints fresh tokens and
 *            resets consent, renewal request + booker renew, alternate
 *            delivery to an account and to a named address, guest-access
 *            removal notifies the removed party;
 *   items 116-118  sharing preview, masked phones in non-booker views,
 *            relay message without exposing numbers, update-email
 *            registration for token parties;
 *   items 121-130  sponsor invite by email, token preview, accept,
 *            pay with the sponsor's own Stripe intent (webhook settles
 *            the sponsorship row), additional-charge request/accept/pay
 *            and decline, payment breakdown per role, sponsor receipt,
 *            terminal refunds return each payer's money to their own
 *            intent, booker intent reduced by paid sponsorships and a
 *            fully sponsored booking needs no booker intent;
 *   items 131-135  participant summary: labels, authority, scope, and
 *            the payment breakdown (booker sees amounts, recipient sees
 *            who pays, never an amount);
 *   items 136-140  recipient/sponsor support intake is a real ticket
 *            with booking metadata, scoped timeline shows public
 *            messages only, missed-provider report notifies the booker;
 *   items 142/143/145  site photo contribution, care instructions
 *            delivered to recipient + site contact, optional feedback;
 *   items 146/148-150  opt-out ends notifications, archive hides the
 *            visit from the party's list, contact correction auto-applies
 *            and is recorded, authorized receipt is gated on sharing.
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('booking-site-photos/test-key.jpg'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://example.invalid/photo.jpg'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  normalizeStorageKey: jest.fn((k) => k),
}));
const mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
  },
  refunds: { create: jest.fn() },
};
jest.mock('stripe', () => () => mockStripe);

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 3 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group3-recipient-test-secret';
  process.env['STRIPE' + '_SECRET_KEY'] = 'sk_test_group3';
  process.env['STRIPE' + '_PUBLISHABLE_KEY'] = 'pk_test_group3';
}

const pool = require('../db');
const bookingController = require('../controllers/bookingController');
const recipientController = require('../controllers/bookingRecipientController');
const recipientService = require('../services/bookingRecipientService');
const bookingDeposits = require('../services/bookingDepositService');
const mobileController = require('../controllers/mobileController');
const notificationService = require('../services/notificationService');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function call(fn, req) {
  const res = mockRes();
  let nextErr = null;
  const next = (err) => { nextErr = err; };
  await fn(req, res, next);
  return { res, nextErr };
}

function tomorrowPlus(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function notifiedTypes(userId) {
  return (notificationService.sendNotification.mock.calls || [])
    .filter((c) => String(c[0]?.userId) === String(userId))
    .map((c) => c[0]?.type);
}

ddescribe('Group 3 recipient and sponsor', () => {
  let booker;
  let helper;
  let recipient;
  let siteContact;
  let sponsor;
  let stranger;

  beforeAll(async () => {
    async function makeUser(role, firstName = 'Test', lastName = 'User') {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES ($1, $2, 'x', $3, $4, $5, TRUE, TRUE)`,
        [id, `group3-${id.slice(0, 8)}@example.invalid`, firstName, lastName, role],
      );
      return id;
    }
    booker = await makeUser('customer', 'Bea', 'Booker');
    helper = await makeUser('helper', 'Henry', 'Helper');
    recipient = await makeUser('customer', 'Rita', 'Recipient');
    siteContact = await makeUser('customer', 'Sam', 'Site');
    sponsor = await makeUser('customer', 'Sue', 'Sponsor');
    stranger = await makeUser('customer', 'Stan', 'Stranger');
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
        requestedDate: tomorrowPlus(2),
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

  async function createLinkedBooking() {
    const created = await createBooking({
      overrides: {
        recipientUserId: recipient, recipientName: 'Mom', recipientPhone: '555-0100',
        siteContactUserId: siteContact, siteContactName: 'Concierge', siteContactPhone: '555-0200',
      },
    });
    expect(created.statusCode).toBe(201);
    return created.payload.data;
  }

  test('items 101/119: limited status and booking-only history are real', async () => {
    const booking = await createLinkedBooking();
    const pub = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: booking.statusToken } }, pub);
    expect(pub.statusCode).toBe(200);
    expect(pub.payload.data.serviceName).toBe('Fix the sink');
    expect(pub.payload.data).not.toHaveProperty('customerId');
    expect(JSON.stringify(pub.payload.data)).not.toMatch(/cents|amount|price|payment|deposit/i);

    // The recipient's list carries only their linked bookings.
    const other = await createBooking({});
    expect(other.statusCode).toBe(201);
    const list = mockRes();
    await bookingController.getMyBookingRequests({ user: { id: recipient }, query: {} }, list);
    expect(list.statusCode).toBe(200);
    const ids = list.payload.data.map((b) => b.id);
    expect(ids).toContain(booking.id);
    expect(ids).not.toContain(other.payload.data.id);
  });

  test('items 104/117: provider name for linked parties; phones masked for non-bookers', async () => {
    const booking = await createLinkedBooking();
    const read = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: recipient } }, read);
    expect(read.statusCode).toBe(200);
    expect(read.payload.data.helperName).toBe('Henry Helper');
    expect(JSON.stringify(read.payload.data)).not.toContain('555-0100');
    expect(JSON.stringify(read.payload.data)).not.toContain('555-0200');

    const bookerRead = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: booker } }, bookerRead);
    expect(bookerRead.statusCode).toBe(200);
    expect(JSON.stringify(bookerRead.payload.data)).toContain('555-0100');
  });

  test('items 106-110/141/144: site actions record, notify the booker, handoff returns a receipt', async () => {
    const booking = await createLinkedBooking();
    notificationService.sendNotification.mockClear();

    const ack = mockRes();
    await recipientController.recordSiteAction(
      { params: { bookingId: booking.id }, user: { id: siteContact }, body: { actionType: 'acknowledge_instructions' } },
      ack,
    );
    expect(ack.statusCode).toBe(201);
    expect(ack.payload.data.actionType).toBe('acknowledge_instructions');
    expect(ack.payload.data.receiptId).toBeTruthy();

    const windowAction = mockRes();
    await recipientController.recordSiteAction(
      { params: { bookingId: booking.id }, user: { id: siteContact }, body: { actionType: 'suggest_window', details: { window: 'After 2pm, use the side gate' } } },
      windowAction,
    );
    expect(windowAction.statusCode).toBe(201);

    const handoff = mockRes();
    await recipientController.recordSiteAction(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: { actionType: 'confirm_handoff', details: { handedTo: 'Concierge' } } },
      handoff,
    );
    expect(handoff.statusCode).toBe(201);
    expect(handoff.payload.data.receiptId).toBeTruthy();

    const done = mockRes();
    await recipientController.recordSiteAction(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: { actionType: 'acknowledge_completion' } },
      done,
    );
    expect(done.statusCode).toBe(201);

    // The booker was notified of the actions.
    expect(notifiedTypes(booker)).toContain('booking_site_action');

    // The checklist reflects the recorded actions.
    const checklist = mockRes();
    await recipientController.getChecklist({ params: { bookingId: booking.id }, user: { id: recipient } }, checklist);
    expect(checklist.statusCode).toBe(200);
    const byKey = Object.fromEntries(checklist.payload.data.items.map((i) => [i.key, i.done]));
    expect(byKey.instructions_acknowledged).toBe(true);
    expect(byKey.access_window_suggested).toBe(true);
    expect(byKey.handoff_confirmed).toBe(true);
    expect(byKey.completion_acknowledged).toBe(true);

    // A stranger cannot act; an unknown action is refused.
    const denied = mockRes();
    await recipientController.recordSiteAction(
      { params: { bookingId: booking.id }, user: { id: stranger }, body: { actionType: 'confirm_handoff' } },
      denied,
    );
    expect(denied.statusCode).toBe(403);
    const bad = mockRes();
    await recipientController.recordSiteAction(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: { actionType: 'delete_booking' } },
      bad,
    );
    expect(bad.statusCode).toBe(400);

    // The token path records too.
    const tokenAction = mockRes();
    await recipientController.recordTokenSiteAction(
      { params: { token: booking.statusToken }, body: { actionType: 'report_entry_problem', details: { problem: 'Gate code did not work' } } },
      tokenAction,
    );
    expect(tokenAction.statusCode).toBe(201);
    const list = mockRes();
    await recipientController.listSiteActions({ params: { bookingId: booking.id }, user: { id: booker } }, list);
    expect(list.payload.data.map((a) => a.actionType)).toContain('report_entry_problem');
  });

  test('items 112/114/115/120/147: replace, renew, alternate delivery, guest removal', async () => {
    const booking = await createLinkedBooking();
    notificationService.sendNotification.mockClear();

    // Replace the recipient by email with a fresh account.
    const replacementEmail = `group3-replacement-${Date.now()}@example.invalid`;
    const replacementId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Rita', 'Two', 'customer', TRUE, TRUE)`,
      [replacementId, replacementEmail],
    );
    const replaced = mockRes();
    await recipientController.replaceContact(
      { params: { bookingId: booking.id }, user: { id: booker }, body: { kind: 'recipient', name: 'Mom Two', phone: '555-0111', email: replacementEmail } },
      replaced,
    );
    expect(replaced.statusCode).toBe(200);
    expect(replaced.payload.data.recipientUserId).toBe(replacementId);
    expect(replaced.payload.data.recipientToken).toHaveLength(64);
    expect(replaced.payload.data.recipientToken).not.toBe(booking.recipientToken);
    // The old recipient was told their access ended; the old token is dead.
    expect(notifiedTypes(recipient)).toContain('booking_contact_removed');
    const dead = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: booking.recipientToken } }, dead);
    expect(dead.statusCode).toBe(404);
    const { rows: consentRows } = await pool.query(
      'SELECT recipient_consent_status FROM booking_requests WHERE id = $1', [booking.id]
    );
    expect(consentRows[0].recipient_consent_status).toBe('pending');

    // The new recipient asks for a renewal; the booker renews.
    const renewalReq = mockRes();
    await recipientController.requestLinkRenewal(
      { params: { bookingId: booking.id }, user: { id: replacementId } }, renewalReq,
    );
    expect(renewalReq.statusCode).toBe(201);
    expect(notifiedTypes(booker)).toContain('booking_link_renewal_requested');
    const renewed = mockRes();
    await recipientController.renewStatusLink({ params: { bookingId: booking.id }, user: { id: booker } }, renewed);
    expect(renewed.statusCode).toBe(200);
    expect(renewed.payload.data.statusToken).toHaveLength(64);
    const { rows: renewalRows } = await pool.query(
      "SELECT status FROM booking_link_renewals WHERE booking_id = $1", [booking.id]
    );
    expect(renewalRows[0].status).toBe('renewed');

    // Alternate delivery: to an account (delivered) and to a named address (link returned).
    const altDelivered = mockRes();
    await recipientController.deliverLinkToAlternate(
      { params: { bookingId: booking.id }, user: { id: booker }, body: { kind: 'site_contact', email: (await pool.query('SELECT email FROM users WHERE id = $1', [siteContact])).rows[0].email } },
      altDelivered,
    );
    expect(altDelivered.statusCode).toBe(201);
    expect(altDelivered.payload.data.delivered).toBe(true);
    const altNamed = mockRes();
    await recipientController.deliverLinkToAlternate(
      { params: { bookingId: booking.id }, user: { id: booker }, body: { kind: 'site_contact', email: 'no-account-here@example.invalid' } },
      altNamed,
    );
    expect(altNamed.statusCode).toBe(201);
    expect(altNamed.payload.data.delivered).toBe(false);
    expect(altNamed.payload.data.link).toContain('/bookings/status/');

    // Guest-access removal clears the site contact and notifies them.
    const removed = mockRes();
    await recipientController.removeGuestAccess(
      { params: { bookingId: booking.id }, user: { id: booker }, body: { kind: 'site_contact' } },
      removed,
    );
    expect(removed.statusCode).toBe(200);
    expect(removed.payload.data.notified).toBe(true);
    expect(notifiedTypes(siteContact)).toContain('booking_contact_removed');
    const gone = mockRes();
    await bookingController.getBookingRequest({ params: { bookingId: booking.id }, user: { id: siteContact } }, gone);
    expect(gone.statusCode).toBe(403);
  });

  test('items 116/118/146: sharing preview, update email, opt-out ends notifications', async () => {
    const booking = await createLinkedBooking();
    const preview = mockRes();
    await recipientController.getSharingPreview({ params: { bookingId: booking.id }, user: { id: booker } }, preview);
    expect(preview.statusCode).toBe(200);
    expect(preview.payload.data.recipient.sees).toContain('Service');
    expect(preview.payload.data.recipient.neverSees).toContain('Payment amounts');
    expect(preview.payload.data.siteContact.canDo).toContain('Confirm handoff');

    const emailReg = mockRes();
    await recipientController.registerUpdateEmail(
      { params: { token: booking.statusToken }, body: { email: 'updates@example.invalid' } },
      emailReg,
    );
    expect(emailReg.statusCode).toBe(200);
    const { rows: emailRows } = await pool.query(
      'SELECT email FROM booking_link_update_emails WHERE booking_id = $1', [booking.id]
    );
    expect(emailRows.map((r) => r.email)).toContain('updates@example.invalid');

    const optOut = mockRes();
    await recipientController.optOutNotifications(
      { params: { bookingId: booking.id }, user: { id: recipient } }, optOut,
    );
    expect(optOut.statusCode).toBe(200);
    expect(await recipientService.isMuted(booking.id, { userId: recipient })).toBe(true);
    const optIn = mockRes();
    await recipientController.optInNotifications(
      { params: { bookingId: booking.id }, user: { id: recipient } }, optIn,
    );
    expect(optIn.statusCode).toBe(200);
    expect(await recipientService.isMuted(booking.id, { userId: recipient })).toBe(false);
  });

  async function sponsorEmail() {
    return (await pool.query('SELECT email FROM users WHERE id = $1', [sponsor])).rows[0].email;
  }

  async function createSponsorshipFor(bookingId, amountCents) {
    const res = mockRes();
    await recipientController.createSponsorship(
      { params: { bookingId }, user: { id: booker }, body: { sponsorEmail: await sponsorEmail(), amountCents } },
      res,
    );
    expect(res.statusCode).toBe(201);
    return res.payload.data;
  }

  async function acceptSponsorship(bookingId, sponsorshipId, token) {
    const res = mockRes();
    await recipientController.respondToSponsorshipByToken(
      { params: { token }, body: { decision: 'accepted' } },
      res,
    );
    expect(res.statusCode).toBe(200);
    return res.payload.data;
  }

  test('items 121-125/128: sponsor invite, preview, accept, pay with own card', async () => {
    const booking = await createLinkedBooking();
    notificationService.sendNotification.mockClear();
    const invite = await createSponsorshipFor(booking.id, 5000);
    expect(invite.status).toBe('invited');
    expect(invite.inviteToken).toHaveLength(64);
    expect(invite.amountCents).toBe(5000);
    expect(new Date(invite.paymentDeadlineAt).getTime()).toBeGreaterThan(Date.now());
    expect(notifiedTypes(sponsor)).toContain('booking_sponsor_invite');

    // Token preview shows the amount; the public page flags it as a sponsor preview.
    const preview = mockRes();
    await recipientController.getSponsorPreviewByToken({ params: { token: invite.inviteToken } }, preview);
    expect(preview.statusCode).toBe(200);
    expect(preview.payload.data.amountCents).toBe(5000);
    const pub = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: invite.inviteToken } }, pub);
    expect(pub.statusCode).toBe(200);
    expect(pub.payload.data.isSponsorPreview).toBe(true);
    expect(pub.payload.data.amountCents).toBe(5000);

    await acceptSponsorship(booking.id, invite.id, invite.inviteToken);
    const again = mockRes();
    await recipientController.respondToSponsorshipByToken(
      { params: { token: invite.inviteToken }, body: { decision: 'accepted' } },
      again,
    );
    expect(again.statusCode).toBe(409);

    // The sponsor pays with their own Stripe intent.
    mockStripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_s1', client_secret: 'sec_s1', amount: 5000, status: 'requires_payment', currency: 'usd',
    });
    const intentRes = mockRes();
    await recipientController.createSponsorPaymentIntent(
      { params: { bookingId: booking.id, sponsorshipId: invite.id }, user: { id: sponsor } },
      intentRes,
    );
    expect(intentRes.statusCode).toBe(200);
    expect(intentRes.payload.data.paymentIntentId).toBe('pi_s1');
    expect(intentRes.payload.data.amountCents).toBe(5000);

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_s1', status: 'succeeded', amount_received: 5000, amount: 5000, currency: 'usd',
      metadata: { booking_request_id: booking.id, sponsorship_id: invite.id },
    });
    const confirmed = mockRes();
    await recipientController.confirmSponsorPayment(
      { params: { bookingId: booking.id, sponsorshipId: invite.id }, user: { id: sponsor }, body: { paymentIntentId: 'pi_s1' } },
      confirmed,
    );
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.payload.data.status).toBe('paid');

    const receipt = mockRes();
    await recipientController.getSponsorReceipt(
      { params: { bookingId: booking.id, sponsorshipId: invite.id }, user: { id: sponsor } },
      receipt,
    );
    expect(receipt.statusCode).toBe(200);
    expect(receipt.payload.data.amountCents).toBe(5000);
    expect(receipt.payload.data.status).toBe('paid');
  });

  test('items 121/124/125: token sponsor accepts and pays with no account', async () => {
    const booking = await createLinkedBooking();
    const invite = await createSponsorshipFor(booking.id, 4000);
    // Accept by token (no user object at all: the invite token is the credential).
    const accepted = mockRes();
    await recipientController.respondToSponsorshipByToken(
      { params: { token: invite.inviteToken }, body: { decision: 'accepted' } },
      accepted,
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.payload.data.status).toBe('accepted');

    mockStripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_tok_1', client_secret: 'sec_tok_1', amount: 4000, status: 'requires_payment', currency: 'usd',
    });
    const intentRes = mockRes();
    await recipientController.createSponsorPaymentIntentByToken(
      { params: { token: invite.inviteToken }, body: {} },
      intentRes,
    );
    expect(intentRes.statusCode).toBe(200);
    expect(intentRes.payload.data.paymentIntentId).toBe('pi_tok_1');

    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_tok_1', status: 'succeeded', amount_received: 4000, amount: 4000, currency: 'usd',
      metadata: { booking_request_id: booking.id, sponsorship_id: invite.id },
    });
    const confirmed = mockRes();
    await recipientController.confirmSponsorPaymentByToken(
      { params: { token: invite.inviteToken }, body: { paymentIntentId: 'pi_tok_1' } },
      confirmed,
    );
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.payload.data.status).toBe('paid');

    const receipt = mockRes();
    await recipientController.getSponsorReceiptByToken(
      { params: { token: invite.inviteToken } },
      receipt,
    );
    expect(receipt.statusCode).toBe(200);
    expect(receipt.payload.data.amountCents).toBe(4000);
    expect(receipt.payload.data.status).toBe('paid');

    // A different token cannot pay this sponsorship.
    const other = await createSponsorshipFor(booking.id, 1000);
    const denied = mockRes();
    await recipientController.createSponsorPaymentIntentByToken(
      { params: { token: other.inviteToken }, body: {} },
      denied,
    );
    expect(denied.statusCode).toBe(409);
  });

  test('items 121-130: webhook settles a sponsorship; charges, breakdown, cap', async () => {
    const booking = await createLinkedBooking();
    const first = await createSponsorshipFor(booking.id, 5000);
    await acceptSponsorship(booking.id, first.id, first.inviteToken);

    // Webhook settlement: a second sponsorship paid through the webhook.
    const second = await createSponsorshipFor(booking.id, 7000);
    await acceptSponsorship(booking.id, second.id, second.inviteToken);
    await pool.query(
      'UPDATE booking_sponsorships SET stripe_payment_intent_id = $2 WHERE id = $1',
      [second.id, 'pi_s2'],
    );
    const settled = await bookingDeposits.applyBookingIntentWebhook('payment_intent.succeeded', {
      id: 'pi_s2', amount_received: 7000, amount: 7000, currency: 'usd',
      metadata: { booking_request_id: booking.id, sponsorship_id: second.id, source: 'mobile_booking' },
    });
    expect(settled).toBe(true);
    const { rows: paidRows } = await pool.query(
      'SELECT status FROM booking_sponsorships WHERE id = $1', [second.id]
    );
    expect(paidRows[0].status).toBe('paid');

    // Additional charge: helper asks, sponsor accepts and pays, second one declined.
    const chargeRes = mockRes();
    await recipientController.requestAdditionalCharge(
      { params: { bookingId: booking.id, sponsorshipId: first.id }, user: { id: helper }, body: { amountCents: 1500, reason: 'Extra part needed' } },
      chargeRes,
    );
    expect(chargeRes.statusCode).toBe(201);
    const charge = chargeRes.payload.data;
    expect(charge.status).toBe('requested');
    const chargeAccept = mockRes();
    await recipientController.respondToCharge(
      { params: { bookingId: booking.id, sponsorshipId: first.id, chargeId: charge.id }, user: { id: sponsor }, body: { decision: 'accepted' } },
      chargeAccept,
    );
    expect(chargeAccept.statusCode).toBe(200);
    mockStripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_c1', client_secret: 'sec_c1', amount: 1500, status: 'requires_payment', currency: 'usd',
    });
    const chargeIntent = mockRes();
    await recipientController.createChargePaymentIntent(
      { params: { bookingId: booking.id, sponsorshipId: first.id, chargeId: charge.id }, user: { id: sponsor } },
      chargeIntent,
    );
    expect(chargeIntent.statusCode).toBe(200);
    mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_c1', status: 'succeeded', amount_received: 1500, amount: 1500, currency: 'usd',
      metadata: { booking_request_id: booking.id, sponsorship_id: first.id, sponsorship_charge_id: charge.id },
    });
    const chargePaid = mockRes();
    await recipientController.confirmChargePayment(
      { params: { bookingId: booking.id, sponsorshipId: first.id, chargeId: charge.id }, user: { id: sponsor }, body: { paymentIntentId: 'pi_c1' } },
      chargePaid,
    );
    expect(chargePaid.statusCode).toBe(200);
    expect(chargePaid.payload.data.status).toBe('paid');

    const charge2Res = mockRes();
    await recipientController.requestAdditionalCharge(
      { params: { bookingId: booking.id, sponsorshipId: first.id }, user: { id: booker }, body: { amountCents: 2000, reason: 'Weekend callout' } },
      charge2Res,
    );
    expect(charge2Res.statusCode).toBe(201);
    const charge2Decline = mockRes();
    await recipientController.respondToCharge(
      { params: { bookingId: booking.id, sponsorshipId: first.id, chargeId: charge2Res.payload.data.id }, user: { id: sponsor }, body: { decision: 'declined' } },
      charge2Decline,
    );
    expect(charge2Decline.statusCode).toBe(200);
    expect(charge2Decline.payload.data.status).toBe('declined');

    // The cap: with a declared amount, live sponsorships cannot exceed it.
    await pool.query('UPDATE booking_requests SET payment_amount_cents = 10000 WHERE id = $1', [booking.id]);
    const overCap = mockRes();
    await recipientController.createSponsorship(
      { params: { bookingId: booking.id }, user: { id: booker }, body: { sponsorEmail: await sponsorEmail(), amountCents: 6000 } },
      overCap,
    );
    expect(overCap.statusCode).toBe(400);
  });

  test('items 129/135: payment breakdown per role; sponsor sees only their own amount', async () => {
    const booking = await createLinkedBooking();
    const invite = await createSponsorshipFor(booking.id, 5000);
    await acceptSponsorship(booking.id, invite.id, invite.inviteToken);
    await pool.query(
      "UPDATE booking_sponsorships SET status = 'paid', paid_at = NOW(), stripe_payment_intent_id = 'pi_bd1' WHERE id = $1",
      [invite.id],
    );
    await pool.query('UPDATE booking_requests SET gross_amount_cents = 12000, payment_amount_cents = 7000 WHERE id = $1', [booking.id]);

    const bookerBreakdown = mockRes();
    await recipientController.getPaymentBreakdown({ params: { bookingId: booking.id }, user: { id: booker } }, bookerBreakdown);
    expect(bookerBreakdown.statusCode).toBe(200);
    expect(bookerBreakdown.payload.data.declaredCents).toBe(12000);
    expect(bookerBreakdown.payload.data.sponsoredPaidCents).toBe(5000);
    expect(bookerBreakdown.payload.data.remainingCents).toBe(7000);
    expect(bookerBreakdown.payload.data.payments.find((p) => p.payer === 'sponsor').amountCents).toBe(5000);

    const sponsorBreakdown = mockRes();
    await recipientController.getPaymentBreakdown({ params: { bookingId: booking.id }, user: { id: sponsor } }, sponsorBreakdown);
    expect(sponsorBreakdown.statusCode).toBe(200);
    expect(sponsorBreakdown.payload.data.declaredCents).toBeNull();
    expect(sponsorBreakdown.payload.data.payments).toHaveLength(1);
    expect(sponsorBreakdown.payload.data.payments[0].amountCents).toBe(5000);

    const recipientBreakdown = mockRes();
    await recipientController.getPaymentBreakdown({ params: { bookingId: booking.id }, user: { id: recipient } }, recipientBreakdown);
    expect(recipientBreakdown.statusCode).toBe(403);

    // The recipient summary names the payers and never an amount.
    const summary = mockRes();
    await recipientController.getParticipantSummary({ params: { bookingId: booking.id }, user: { id: recipient } }, summary);
    expect(summary.statusCode).toBe(200);
    expect(summary.payload.data.payment.bookerPays).toBe(true);
    expect(JSON.stringify(summary.payload.data.payment)).not.toContain('5000');
    expect(summary.payload.data.authority.recipient).toContain('Accept or decline the visit');
    expect(summary.payload.data.labels.recipient).toBe('Mom');
    const sponsorSummary = mockRes();
    await recipientController.getParticipantSummary({ params: { bookingId: booking.id }, user: { id: sponsor } }, sponsorSummary);
    expect(sponsorSummary.payload.data.payment.sponsors[0].amountCents).toBe(5000);
  });

  test('item 129: terminal settlement refunds each payer to their own intent', async () => {
    const booking = await createLinkedBooking();
    const invite = await createSponsorshipFor(booking.id, 5000);
    await acceptSponsorship(booking.id, invite.id, invite.inviteToken);
    await pool.query(
      "UPDATE booking_sponsorships SET status = 'paid', paid_at = NOW(), stripe_payment_intent_id = 'pi_r1' WHERE id = $1",
      [invite.id],
    );
    await pool.query(
      "UPDATE booking_requests SET status = 'cancelled', payment_status = 'paid' WHERE id = $1",
      [booking.id],
    );
    mockStripe.refunds.create.mockResolvedValueOnce({
      id: 're_1', amount: 5000, currency: 'usd', payment_intent: 'pi_r1',
    });
    const outcome = await bookingDeposits.settleTerminalBooking(booking.id, 'customer_cancelled');
    expect(outcome).toBe('refunded');
    expect(mockStripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_r1' }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining(invite.id) }),
    );
    const { rows } = await pool.query(
      "SELECT status, stripe_refund_id FROM booking_sponsorships WHERE id = $1", [invite.id]
    );
    expect(rows[0].status).toBe('refunded');
    expect(rows[0].stripe_refund_id).toBe('re_1');

    // A terminal booking with no payment at all settles as a no-op.
    const plain = await createLinkedBooking();
    await pool.query("UPDATE booking_requests SET status = 'cancelled' WHERE id = $1", [plain.id]);
    expect(await bookingDeposits.settleTerminalBooking(plain.id, 'customer_cancelled')).toBe('no_payment');
  });

  test('item 121/128: booker intent is reduced by paid sponsorships; fully sponsored needs no intent', async () => {
    mockStripe.paymentIntents.create.mockImplementation(({ amount }) => Promise.resolve({
      id: `pi_b_${amount}`, client_secret: `sec_b_${amount}`, amount, status: 'requires_payment', currency: 'usd',
    }));
    const booking = await createLinkedBooking();
    const invite = await createSponsorshipFor(booking.id, 5000);
    await acceptSponsorship(booking.id, invite.id, invite.inviteToken);
    await pool.query(
      "UPDATE booking_sponsorships SET status = 'paid', paid_at = NOW(), stripe_payment_intent_id = 'pi_off1' WHERE id = $1",
      [invite.id],
    );
    const { res: intentRes, nextErr } = await call(mobileController.createBookingPaymentIntent, {
      params: { bookingId: booking.id },
      user: { id: booker, email: 'booker@example.invalid' },
      body: { amountCents: 10000, paymentRequirement: 'deposit' },
    });
    expect(nextErr).toBeNull();
    expect(intentRes.statusCode).toBe(200);
    expect(intentRes.payload.data.amountCents).toBe(5000);
    const { rows: bookingRows } = await pool.query(
      'SELECT payment_amount_cents, gross_amount_cents FROM booking_requests WHERE id = $1', [booking.id]
    );
    expect(bookingRows[0].payment_amount_cents).toBe(5000);
    expect(bookingRows[0].gross_amount_cents).toBe(10000);

    const full = await createLinkedBooking();
    const fullInvite = await createSponsorshipFor(full.id, 10000);
    await acceptSponsorship(full.id, fullInvite.id, fullInvite.inviteToken);
    await pool.query(
      "UPDATE booking_sponsorships SET status = 'paid', paid_at = NOW(), stripe_payment_intent_id = 'pi_off2' WHERE id = $1",
      [fullInvite.id],
    );
    const { res: fullRes, nextErr: fullErr } = await call(mobileController.createBookingPaymentIntent, {
      params: { bookingId: full.id },
      user: { id: booker, email: 'booker@example.invalid' },
      body: { amountCents: 10000, paymentRequirement: 'deposit' },
    });
    expect(fullErr).toBeNull();
    expect(fullRes.statusCode).toBe(200);
    expect(fullRes.payload.data.fullySponsored).toBe(true);
    const { rows: fullRows } = await pool.query(
      "SELECT payment_status FROM booking_requests WHERE id = $1", [full.id]
    );
    expect(fullRows[0].payment_status).toBe('paid');
  });

  test('items 136-140: recipient and sponsor support intake is a real ticket with a scoped timeline', async () => {
    const booking = await createLinkedBooking();
    notificationService.sendNotification.mockClear();
    const intake = mockRes();
    await recipientController.submitSupportIntake(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: { kind: 'missed_provider', message: 'Nobody showed up at 10am' } },
      intake,
    );
    expect(intake.statusCode).toBe(201);
    expect(intake.payload.data.ticketNumber).toBeTruthy();
    expect(notifiedTypes(booker)).toContain('booking_site_action');
    const { rows: ticketRows } = await pool.query(
      "SELECT metadata FROM support_tickets WHERE id = $1", [intake.payload.data.ticketId]
    );
    expect(ticketRows[0].metadata.booking_id).toBe(booking.id);
    expect(ticketRows[0].metadata.kind).toBe('missed_provider');

    const timeline = mockRes();
    await recipientController.listSupportIntake({ params: { bookingId: booking.id }, user: { id: recipient } }, timeline);
    expect(timeline.statusCode).toBe(200);
    expect(timeline.payload.data).toHaveLength(1);
    expect(timeline.payload.data[0].messages[0].content).toContain('Nobody showed up');

    const sponsorIntake = mockRes();
    // The sponsor is a party only with a live sponsorship on this booking.
    const sponsorInvite = await createSponsorshipFor(booking.id, 5000);
    await acceptSponsorship(booking.id, sponsorInvite.id, sponsorInvite.inviteToken);
    await recipientController.submitSupportIntake(
      { params: { bookingId: booking.id }, user: { id: sponsor }, body: { kind: 'payment', message: 'My card was charged twice' } },
      sponsorIntake,
    );
    expect(sponsorIntake.statusCode).toBe(201);
    const sponsorGeneral = mockRes();
    await recipientController.submitSupportIntake(
      { params: { bookingId: booking.id }, user: { id: sponsor }, body: { kind: 'general', message: 'Hello' } },
      sponsorGeneral,
    );
    expect(sponsorGeneral.statusCode).toBe(400);

    // Token parties open tickets too, and read their own timeline.
    const tokenIntake = mockRes();
    await recipientController.submitTokenSupportIntake(
      { params: { token: booking.statusToken }, body: { kind: 'callback', message: 'Please call me back', callbackWindow: 'After 3pm' } },
      tokenIntake,
    );
    expect(tokenIntake.statusCode).toBe(201);
    const { rows: callbackRows } = await pool.query(
      "SELECT target FROM booking_callbacks WHERE booking_id = $1 AND target = 'support'", [booking.id]
    );
    expect(callbackRows.length).toBeGreaterThanOrEqual(1);
  });

  test('items 142/143/145: site photo, care instructions, feedback', async () => {
    const booking = await createLinkedBooking();
    notificationService.sendNotification.mockClear();
    const photo = mockRes();
    await recipientController.uploadSitePhoto(
      { params: { bookingId: booking.id }, user: { id: siteContact }, file: { buffer: Buffer.from('fake-image'), originalname: 'site.jpg', mimetype: 'image/jpeg' } },
      photo,
    );
    expect(photo.statusCode).toBe(201);
    const photos = mockRes();
    await recipientController.listSitePhotos({ params: { bookingId: booking.id }, user: { id: booker } }, photos);
    expect(photos.payload.data).toHaveLength(1);
    expect(photos.payload.data[0].url).toContain('example.invalid');

    const care = mockRes();
    await recipientController.setCareInstructions(
      { params: { bookingId: booking.id }, user: { id: helper }, body: { instructions: 'Water the plants twice a week' } },
      care,
    );
    expect(care.statusCode).toBe(200);
    expect(notifiedTypes(recipient)).toContain('booking_care_instructions');
    const summary = mockRes();
    await recipientController.getParticipantSummary({ params: { bookingId: booking.id }, user: { id: recipient } }, summary);
    expect(summary.payload.data.careInstructions).toContain('Water the plants');

    const feedback = mockRes();
    await recipientController.submitFeedback(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: { rating: 5, body: 'Great visit, thank you' } },
      feedback,
    );
    expect(feedback.statusCode).toBe(201);
    const bookerFeedback = mockRes();
    await recipientController.listFeedback({ params: { bookingId: booking.id }, user: { id: booker } }, bookerFeedback);
    expect(bookerFeedback.payload.data).toHaveLength(1);
    expect(bookerFeedback.payload.data[0].rating).toBe(5);
    const contactFeedback = mockRes();
    await recipientController.listFeedback({ params: { bookingId: booking.id }, user: { id: siteContact } }, contactFeedback);
    expect(contactFeedback.payload.data).toHaveLength(0);
  });

  test('items 146/148-150: opt-out, archive, correction, authorized receipt', async () => {
    const booking = await createLinkedBooking();
    const archived = mockRes();
    await recipientController.archiveVisit({ params: { bookingId: booking.id }, user: { id: recipient } }, archived);
    expect(archived.statusCode).toBe(200);
    const list = mockRes();
    await bookingController.getMyBookingRequests({ user: { id: recipient }, query: {} }, list);
    expect(list.payload.data.map((b) => b.id)).not.toContain(booking.id);
    const withArchived = mockRes();
    await bookingController.getMyBookingRequests({ user: { id: recipient }, query: { includeArchived: 'true' } }, withArchived);
    expect(withArchived.payload.data.map((b) => b.id)).toContain(booking.id);
    const unarchived = mockRes();
    await recipientController.unarchiveVisit({ params: { bookingId: booking.id }, user: { id: recipient } }, unarchived);
    expect(unarchived.statusCode).toBe(200);

    const correction = mockRes();
    await recipientController.submitContactCorrection(
      { params: { bookingId: booking.id }, user: { id: recipient }, body: { field: 'phone', value: '555-9999' } },
      correction,
    );
    expect(correction.statusCode).toBe(200);
    const { rows: correctedRows } = await pool.query(
      'SELECT recipient_phone FROM booking_requests WHERE id = $1', [booking.id]
    );
    expect(correctedRows[0].recipient_phone).toBe('555-9999');
    const { rows: correctionRows } = await pool.query(
      'SELECT old_value, new_value FROM booking_contact_corrections WHERE booking_id = $1', [booking.id]
    );
    expect(correctionRows[0].old_value).toBe('555-0100');
    expect(correctionRows[0].new_value).toBe('555-9999');

    const gated = mockRes();
    await recipientController.getReceipt({ params: { bookingId: booking.id }, user: { id: recipient } }, gated);
    expect(gated.statusCode).toBe(403);
    const shared = mockRes();
    await recipientController.shareReceipt({ params: { bookingId: booking.id }, user: { id: booker } }, shared);
    expect(shared.statusCode).toBe(200);
    const receipt = mockRes();
    await recipientController.getReceipt({ params: { bookingId: booking.id }, user: { id: recipient } }, receipt);
    expect(receipt.statusCode).toBe(200);
    expect(receipt.payload.data.serviceName).toBe('Fix the sink');
    expect(JSON.stringify(receipt.payload.data)).not.toMatch(/cents|amount/i);
  });

  test('items 102/103/105: reminder once per party, arrival stamps and notifies, completion notifies', async () => {
    const booking = await createLinkedBooking();
    notificationService.sendNotification.mockClear();
    await pool.query(
      "UPDATE booking_requests SET status = 'accepted', requested_date = (CURRENT_DATE + INTERVAL '1 day')::date WHERE id = $1",
      [booking.id],
    );
    const first = await recipientService.sendVisitReminders();
    expect(first.sent).toBe(2);
    const { rows: reminderRows } = await pool.query(
      'SELECT party_role FROM booking_visit_reminders WHERE booking_id = $1', [booking.id]
    );
    expect(reminderRows.map((r) => r.party_role).sort()).toEqual(['recipient', 'site_contact']);
    expect(notifiedTypes(recipient)).toContain('booking_visit_reminder');
    const second = await recipientService.sendVisitReminders();
    expect(second.sent).toBe(0);

    // Arrival: insert the appointment, stamp it, notify all three parties.
    const appointmentId = (await pool.query(
      `INSERT INTO appointments (customer_id, helper_id, service_description, scheduled_start_time, scheduled_end_time, status, source)
       VALUES ($1, $2, 'Fix the sink', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 'confirmed', 'job')
       RETURNING id`,
      [booker, helper],
    )).rows[0].id;
    await pool.query('UPDATE booking_requests SET appointment_id = $1 WHERE id = $2', [appointmentId, booking.id]);
    notificationService.sendNotification.mockClear();
    const arrived = mockRes();
    await recipientController.markProviderArrived(
      { params: { bookingId: booking.id }, user: { id: helper } },
      arrived,
    );
    expect(arrived.statusCode).toBe(200);
    expect(arrived.payload.data.arrivedAt).toBeTruthy();
    expect(notifiedTypes(recipient)).toContain('booking_provider_arrived');
    expect(notifiedTypes(siteContact)).toContain('booking_provider_arrived');
    const again = mockRes();
    await recipientController.markProviderArrived(
      { params: { bookingId: booking.id }, user: { id: helper } },
      again,
    );
    expect(again.statusCode).toBe(409);

    // The token page shows the arrival and the provider's door name.
    const pub = mockRes();
    await bookingController.getPublicBookingStatus({ params: { token: booking.statusToken } }, pub);
    expect(pub.statusCode).toBe(200);
    expect(pub.payload.data.arrivedAt).toBeTruthy();
    expect(pub.payload.data.helperDoorName).toBe('Henry H.');

    // Completion: delivered appointment + stale schedule auto-completes
    // and notifies the recipient and site contact. A second stale booking
    // with no delivered appointment must release in the SAME sweep: before
    // D-53 the delivered UPDATE threw and aborted the whole sweeper, so
    // stale bookings were never released while any delivered one existed.
    const staleBooking = await createLinkedBooking();
    await pool.query(
      "UPDATE booking_requests SET status = 'accepted', requested_date = (CURRENT_DATE - INTERVAL '1 day')::date, requested_start_time = '08:00', requested_end_time = '09:00' WHERE id = $1",
      [staleBooking.id],
    );
    await pool.query("UPDATE appointments SET status = 'completed' WHERE id = $1", [appointmentId]);
    await pool.query(
      "UPDATE booking_requests SET requested_date = (CURRENT_DATE - INTERVAL '1 day')::date, requested_start_time = '08:00', requested_end_time = '09:00' WHERE id = $1",
      [booking.id],
    );
    notificationService.sendNotification.mockClear();
    await bookingController.releaseStaleAcceptedBookings();
    const { rows: completedRows } = await pool.query(
      'SELECT status FROM booking_requests WHERE id = $1', [booking.id]
    );
    expect(completedRows[0].status).toBe('completed');
    expect(notifiedTypes(recipient)).toContain('booking_visit_completed');
    expect(notifiedTypes(siteContact)).toContain('booking_visit_completed');
    const { rows: staleRows } = await pool.query(
      'SELECT status FROM booking_requests WHERE id = $1', [staleBooking.id]
    );
    expect(staleRows[0].status).toBe('accepted_cancelled');
  });
});
