'use strict';

/**
 * Group 2 (Household delegate, items 51-100) — acceptance tests against
 * the real migrated schema, through the real controllers:
 *
 *   item 51  delegate booking: with 'book' scope the delegate books on
 *            the owner's behalf (customer stays the owner, booked_by is
 *            the delegate, ownership label shows both); without scope
 *            403; a stranger cannot read the booking, the delegate can,
 *            with no status token and no payment fields;
 *   items 52/53/55  invite by id and by email, duplicate live invite
 *            409s, accept records consent, second accept 409s, decline,
 *            activity log carries invited/accepted/revoked;
 *   items 71/72/73/75  coordinator assignment clears the previous one,
 *            substitute needs a future date, handoff + acknowledgment;
 *   items 81/83/84/85/99/100  scope preview, renewal extends expiry,
 *            renewal of a revoked row 409s, reminder, revocation is
 *            immediate (booking + calendar close at once), closure
 *            receipt readable, re-invite mints a fresh delegation;
 *   items 56-60  saved location with preset + private notes + shared
 *            flag; the delegate sees the shared address without the
 *            private notes; archiving hides it from the shared book;
 *   items 59/89/98  contact roster, emergency fallback returns the
 *            emergency contact, archiving removes it from the roster;
 *   items 61-65  shared calendar for owner and view_calendar delegate
 *            (a tasks-only delegate 403s), availability submit/get,
 *            template CRUD + prefill, calendar handoff reassigns;
 *   items 66-70  prep checklist/supplies/accessibility/arrival,
 *            readiness confirmation, supply reminder;
 *   items 76-80  maintenance plans per kind, triage buckets, recurring
 *            completion opens the next occurrence, history;
 *   item 82  spending request by a book-scope delegate, owner approves,
 *            second decide 409s, delegate cannot decide, owner denies;
 *   items 86-90  replacement request, missed follow-up, unavailability,
 *            cancellation preview lists linked work, no amounts;
 *   items 91-95  visit summary shared as a document, vault scoping
 *            (unshared docs hidden from the delegate), receipt forward,
 *            permission-aware export (calendar-only delegate sees visits
 *            but no documents/activity);
 *   items 96/97  upcoming visit reassignment, prep handoff + ack.
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

test('suite targets only the disposable Group 2 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'group2-household-test-secret';
}

const pool = require('../db');
const householdCtrl = require('../controllers/householdController');
const bookingCtrl = require('../controllers/bookingController');
const lifeCtrl = require('../controllers/lifeDashboardController');

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

ddescribe('Group 2 household delegate', () => {
  let owner;
  let delegate;
  let delegate2;
  let tasksOnly;
  let calendarOnly;
  let helper;
  let stranger;
  let ownerEmail;
  let delegateEmail;

  beforeAll(async () => {
    async function makeUser(role) {
      const id = crypto.randomUUID();
      const email = `g2-${id.slice(0, 8)}@example.invalid`;
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
         VALUES ($1, $2, 'x', 'Test', $3, $4, TRUE, TRUE, FALSE)`,
        [id, email, role, role],
      );
      return { id, email };
    }
    owner = (await makeUser('customer')).id;
    ownerEmail = `g2-owner-${crypto.randomUUID().slice(0, 8)}@example.invalid`;
    const d1 = await makeUser('customer');
    delegate = d1.id;
    delegateEmail = d1.email;
    delegate2 = (await makeUser('customer')).id;
    tasksOnly = (await makeUser('customer')).id;
    calendarOnly = (await makeUser('customer')).id;
    helper = (await makeUser('helper')).id;
    stranger = (await makeUser('customer')).id;
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function invite({ asUser, body }) {
    return call(householdCtrl.inviteDelegation, { user: { id: asUser || owner }, body });
  }

  async function acceptAs(userId, delegationId) {
    return call(householdCtrl.acceptDelegation, { user: { id: userId }, params: { id: delegationId } });
  }

  async function makeAcceptedDelegation(delegateId, scopes) {
    const { res } = await invite({ body: { delegateUserId: delegateId, scopes } });
    expect(res.statusCode).toBe(201);
    const id = res.payload.delegation.id;
    const accepted = await acceptAs(delegateId, id);
    expect(accepted.res.statusCode).toBe(200);
    expect(accepted.res.payload.delegation.status).toBe('accepted');
    return id;
  }

  async function createBooking({ asUser, overrides = {} } = {}) {
    return call(bookingCtrl.createBookingRequest, {
      user: { id: asUser || owner },
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
    });
  }

  test('52/53/55: invite, consent review, activity log', async () => {
    const noScope = await invite({ body: { delegateUserId: delegate, scopes: [] } });
    expect(noScope.res.statusCode).toBe(400);
    const self = await invite({ body: { delegateUserId: owner, scopes: ['book'] } });
    expect(self.res.statusCode).toBe(400);
    const { res } = await invite({
      body: { delegateUserId: delegate, delegateName: 'Dana Delegate', scopes: ['book', 'schedule', 'prepare', 'view_records'] },
    });
    expect(res.statusCode).toBe(201);
    const delegationId = res.payload.delegation.id;
    expect(res.payload.delegation.status).toBe('invited');
    expect(res.payload.delegation.inviteToken).toBeTruthy();
    expect(res.payload.delegation.daysToExpiry).toBeGreaterThan(80);

    const dup = await invite({ body: { delegateUserId: delegate, scopes: ['book'] } });
    expect(dup.res.statusCode).toBe(409);

    // Item 81: the scope preview shows what the invite grants, and what
    // it never grants, before the delegate accepts.
    const preview = await call(householdCtrl.getScopePreview, {
      user: { id: delegate }, params: { id: delegationId },
    });
    expect(preview.res.statusCode).toBe(200);
    expect(preview.res.payload.scopes.map((s) => s.scope)).toEqual(
      expect.arrayContaining(['book', 'schedule', 'prepare']),
    );
    expect(preview.res.payload.neverGranted.join(' ')).toMatch(/owner always pays/);

    // Invitations list surfaces the pending invite to the delegate.
    const invites = await call(householdCtrl.listInvitations, { user: { id: delegate } });
    expect(invites.res.payload.invitations.map((i) => i.id)).toContain(delegationId);

    const accepted = await acceptAs(delegate, delegationId);
    expect(accepted.res.statusCode).toBe(200);
    expect(accepted.res.payload.delegation.status).toBe('accepted');
    expect(accepted.res.payload.delegation.acceptedAt).toBeTruthy();

    const again = await acceptAs(delegate, delegationId);
    expect(again.res.statusCode).toBe(409);

    const strangerAccept = await acceptAs(stranger, delegationId);
    expect(strangerAccept.res.statusCode).toBe(403);

    const activity = await call(householdCtrl.getDelegationActivity, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(activity.res.payload.activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(['invited', 'accepted']),
    );
    // The delegate reads their own activity log too; a stranger 404s.
    const strangerActivity = await call(householdCtrl.getDelegationActivity, {
      user: { id: stranger }, params: { id: delegationId },
    });
    expect(strangerActivity.res.statusCode).toBe(404);
    expect(global.__g2DelegationId || (global.__g2DelegationId = delegationId)).toBe(delegationId);
  });

  test('52: invite by email resolves an existing account', async () => {
    const { res } = await invite({ body: { delegateEmail: delegateEmail, scopes: ['view_calendar'] } });
    // delegate already holds a live delegation, so this is a 409: the
    // email resolved to the same account, proving resolution happened.
    expect(res.statusCode).toBe(409);
    const { res: res2 } = await invite({ body: { delegateEmail: 'nobody-new@example.invalid', scopes: ['book'] } });
    expect(res2.statusCode).toBe(201);
    expect(res2.payload.delegation.delegateUserId).toBeNull();
    expect(res2.payload.delegation.delegateEmail).toBe('nobody-new@example.invalid');
  });

  test('51/54: delegate books on the owner behalf; label shows both', async () => {
    const delegationId = global.__g2DelegationId;
    expect(delegationId).toBeTruthy();
    // A tasks-only delegate cannot book.
    const tasksDelegation = await makeAcceptedDelegation(tasksOnly, ['manage_tasks']);
    const denied = await createBooking({
      asUser: tasksOnly,
      overrides: { onBehalfOfOwnerId: owner, serviceName: 'Nope' },
    });
    expect(denied.res.statusCode).toBe(403);

    const { res } = await createBooking({
      asUser: delegate,
      overrides: { onBehalfOfOwnerId: owner, recipientName: 'Rita Relative', recipientPhone: '555-0100' },
    });
    expect(res.statusCode).toBe(201);
    const booking = res.payload.data;
    expect(booking.customerId).toBe(owner);
    expect(booking.ownershipLabel).toMatch(/Visit for Rita Relative/);
    expect(booking.ownershipLabel).toMatch(/booked by a household delegate/);
    expect(booking.bookedByDelegate).toBe(true);
    global.__g2BookingId = booking.id;

    // The delegate reads the booking; a stranger 403s; the read carries
    // no status token and no payment fields.
    const read = await call(bookingCtrl.getBookingRequest, {
      user: { id: delegate }, params: { bookingId: booking.id },
    });
    expect(read.res.statusCode).toBe(200);
    expect(read.res.payload.data.id).toBe(booking.id);
    expect(read.res.payload.data).not.toHaveProperty('statusToken');
    expect(read.res.payload.data).not.toHaveProperty('recipientToken');
    const strangerRead = await call(bookingCtrl.getBookingRequest, {
      user: { id: stranger }, params: { bookingId: booking.id },
    });
    expect(strangerRead.res.statusCode).toBe(403);
    expect(tasksDelegation).toBeTruthy();
  });

  test('71/72/73/75: coordinator, substitute, handoff, acknowledgment', async () => {
    const delegationId = global.__g2DelegationId;
    const secondId = await makeAcceptedDelegation(delegate2, ['coordinate', 'schedule']);
    const past = await call(householdCtrl.setSubstituteCoordinator, {
      user: { id: owner }, params: { id: secondId },
      body: { until: new Date(Date.now() - 1000).toISOString() },
    });
    expect(past.res.statusCode).toBe(400);

    const coord = await call(householdCtrl.setCoordinator, {
      user: { id: owner }, params: { id: delegationId }, body: { isCoordinator: true },
    });
    expect(coord.res.statusCode).toBe(200);
    expect(coord.res.payload.delegation.isCoordinator).toBe(true);

    // Assigning the second delegate as coordinator clears the first.
    const coord2 = await call(householdCtrl.setCoordinator, {
      user: { id: owner }, params: { id: secondId }, body: { isCoordinator: true },
    });
    expect(coord2.res.statusCode).toBe(200);
    const first = await call(householdCtrl.getDelegation, { user: { id: owner }, params: { id: delegationId } });
    expect(first.res.payload.delegation.isCoordinator).toBe(false);

    // Temporary substitute coordinator until a future date.
    const sub = await call(householdCtrl.setSubstituteCoordinator, {
      user: { id: owner }, params: { id: delegationId },
      body: { until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), note: 'Covering a trip' },
    });
    expect(sub.res.statusCode).toBe(200);
    expect(sub.res.payload.delegation.isCoordinator).toBe(true);
    expect(sub.res.payload.delegation.coordinatorUntil).toBeTruthy();

    // Handoff with a note; the receiver acknowledges.
    const handoff = await call(householdCtrl.handoffDelegation, {
      user: { id: owner }, params: { id: delegationId },
      body: { toDelegationId: secondId, note: 'Taking over the calendar this week' },
    });
    expect(handoff.res.statusCode).toBe(200);
    expect(handoff.res.payload.delegation.handoffNote).toMatch(/Taking over/);
    const ack = await call(householdCtrl.acknowledgeHandoff, {
      user: { id: delegate2 }, params: { id: secondId },
    });
    expect(ack.res.statusCode).toBe(200);
    expect(ack.res.payload.delegation.handoffAcknowledgedAt).toBeTruthy();
    global.__g2SecondDelegationId = secondId;
  });

  test('56-60: household address book, presets, private notes, archive', async () => {
    const created = await call(lifeCtrl.createSavedLocation, {
      user: { id: owner },
      body: {
        label: 'Mum house', address: '4 Oak Lane', entry_instructions: 'Ring twice',
        entry_preset: 'gate_code', private_notes: 'Alarm code 1234 - owner only',
        shared_with_household: true,
      },
    });
    expect(created.res.statusCode).toBe(201);
    const locationId = created.res.payload.saved_location.id;
    const badPreset = await call(lifeCtrl.createSavedLocation, {
      user: { id: owner }, body: { label: 'Bad', address: '1 Way', entry_preset: 'teleport' },
    });
    expect(badPreset.res.statusCode).toBe(400);

    // The delegate sees the shared address, its preset and entry
    // instructions, but never the private notes.
    const shared = await call(householdCtrl.listSharedAddresses, {
      user: { id: delegate }, query: { ownerId: owner },
    });
    expect(shared.res.statusCode).toBe(200);
    const seen = shared.res.payload.addresses.find((a) => a.id === locationId);
    expect(seen).toBeTruthy();
    expect(seen.entry_preset).toBe('gate_code');
    expect(seen).not.toHaveProperty('private_notes');
    const strangerShared = await call(householdCtrl.listSharedAddresses, {
      user: { id: stranger }, query: { ownerId: owner },
    });
    expect(strangerShared.res.statusCode).toBe(403);

    // Archiving hides it from the shared book; the owner still sees it
    // with includeArchived.
    const archived = await call(lifeCtrl.updateSavedLocation, {
      user: { id: owner }, params: { id: locationId }, body: { is_archived: true },
    });
    expect(archived.res.statusCode).toBe(200);
    expect(archived.res.payload.saved_location.is_archived).toBe(true);
    const sharedAfter = await call(householdCtrl.listSharedAddresses, {
      user: { id: delegate }, query: { ownerId: owner },
    });
    expect(sharedAfter.res.payload.addresses.map((a) => a.id)).not.toContain(locationId);
    const ownerArchived = await call(lifeCtrl.getSavedLocations, {
      user: { id: owner }, query: { includeArchived: 'true' },
    });
    expect(ownerArchived.res.payload.saved_locations.map((a) => a.id)).toContain(locationId);
    const ownerDefault = await call(lifeCtrl.getSavedLocations, { user: { id: owner }, query: {} });
    expect(ownerDefault.res.payload.saved_locations.map((a) => a.id)).not.toContain(locationId);
  });

  test('59/89/98: contact roster, emergency fallback, cleanup', async () => {
    const alt = await call(householdCtrl.createContact, {
      user: { id: owner },
      body: { name: 'Ana Alternate', phone: '555-0200', relationship: 'Sister', role: 'alternate' },
    });
    expect(alt.res.statusCode).toBe(201);
    const emergency = await call(householdCtrl.createContact, {
      user: { id: owner },
      body: { name: 'Eddie Emergency', phone: '555-0300', relationship: 'Brother', role: 'emergency', isEmergency: true },
    });
    expect(emergency.res.statusCode).toBe(201);
    const roster = await call(householdCtrl.listContacts, { user: { id: owner }, query: {} });
    expect(roster.res.payload.contacts.length).toBe(2);

    // Emergency fallback returns the emergency contact for a visit.
    const bookingId = global.__g2BookingId;
    const fallback = await call(householdCtrl.emergencyFallback, {
      user: { id: delegate }, params: { bookingId },
    });
    expect(fallback.res.statusCode).toBe(200);
    expect(fallback.res.payload.contact.name).toBe('Eddie Emergency');

    // Archiving is the cleanup: the roster shrinks, archived rows stay
    // visible only when explicitly asked for.
    const archived = await call(householdCtrl.archiveContact, {
      user: { id: owner }, params: { id: alt.res.payload.contact.id },
    });
    expect(archived.res.statusCode).toBe(200);
    expect(archived.res.payload.contact.is_archived).toBe(true);
    const rosterAfter = await call(householdCtrl.listContacts, { user: { id: owner }, query: {} });
    expect(rosterAfter.res.payload.contacts.length).toBe(1);
  });

  test('61-70: shared calendar, availability, prep, readiness', async () => {
    const bookingId = global.__g2BookingId;
    const calendarOnlyId = await makeAcceptedDelegation(calendarOnly, ['view_calendar']);
    expect(calendarOnlyId).toBeTruthy();

    const ownerCal = await call(householdCtrl.getCalendar, { user: { id: owner }, query: {} });
    expect(ownerCal.res.statusCode).toBe(200);
    const visit = ownerCal.res.payload.visits.find((v) => v.bookingId === bookingId);
    expect(visit).toBeTruthy();
    expect(visit.ownershipLabel).toMatch(/Rita Relative/);

    const delegateCal = await call(householdCtrl.getCalendar, {
      user: { id: calendarOnly }, query: { ownerId: owner },
    });
    expect(delegateCal.res.statusCode).toBe(200);
    expect(delegateCal.res.payload.visits.map((v) => v.bookingId)).toContain(bookingId);
    // A tasks-only delegate cannot read the calendar.
    const tasksCal = await call(householdCtrl.getCalendar, {
      user: { id: tasksOnly }, query: { ownerId: owner },
    });
    expect(tasksCal.res.statusCode).toBe(403);

    // Availability collection (63).
    const avail = await call(householdCtrl.submitAvailability, {
      user: { id: delegate }, params: { bookingId },
      body: { windows: [{ date: tomorrowPlus(2), start: '09:00', end: '12:00', note: 'Mornings work' }] },
    });
    expect(avail.res.statusCode).toBe(200);
    expect(avail.res.payload.prep.availability).toHaveLength(1);
    const availGet = await call(householdCtrl.getAvailability, {
      user: { id: owner }, params: { bookingId },
    });
    expect(availGet.res.payload.availability).toHaveLength(1);

    // Prep: checklist, supplies, accessibility, arrival (66-69).
    const prep = await call(householdCtrl.updatePrep, {
      user: { id: delegate }, params: { bookingId },
      body: {
        checklist: [{ id: 'c1', label: 'Clear the driveway', done: true }, { id: 'c2', label: 'Put the dog away', done: false }],
        supplies: [{ item: 'New tap washer', quantity: '2', note: 'From the hardware store' }],
        accessibilityNeeds: 'Step-free entry needed; use the side gate.',
        arrivalInstructions: 'Park on the street; ring twice.',
      },
    });
    expect(prep.res.statusCode).toBe(200);
    expect(prep.res.payload.prep.checklist).toHaveLength(2);
    expect(prep.res.payload.prep.accessibilityNeeds).toMatch(/Step-free/);

    // Supply reminder with supplies listed (67) and readiness (70).
    const suppliesRemind = await call(householdCtrl.remindSupplies, {
      user: { id: delegate }, params: { bookingId },
    });
    expect(suppliesRemind.res.statusCode).toBe(200);
    const ready = await call(householdCtrl.confirmReadiness, {
      user: { id: delegate }, params: { bookingId },
    });
    expect(ready.res.statusCode).toBe(200);
    expect(ready.res.payload.prep.readinessConfirmedAt).toBeTruthy();

    // Visit confirmation reminder (62).
    const remind = await call(householdCtrl.remindVisit, {
      user: { id: delegate }, params: { bookingId },
    });
    expect(remind.res.statusCode).toBe(200);
    expect(remind.res.payload.reminded).toBeGreaterThan(0);
  });

  test('64/65: recurring templates and calendar handoff', async () => {
    const created = await call(householdCtrl.createTemplate, {
      user: { id: owner },
      body: {
        name: 'Weekly sink check', serviceName: 'Fix the sink', frequency: 'weekly',
        preferredDay: 'monday', preferredTime: '10:00', serviceLocation: '12 Main St',
        recipientName: 'Rita Relative',
      },
    });
    expect(created.res.statusCode).toBe(201);
    const templateId = created.res.payload.template.id;
    const badFreq = await call(householdCtrl.createTemplate, {
      user: { id: owner }, body: { name: 'Bad', serviceName: 'X', frequency: 'yearly' },
    });
    expect(badFreq.res.statusCode).toBe(400);
    const prefill = await call(householdCtrl.prefillTemplate, {
      user: { id: delegate }, params: { id: templateId },
    });
    expect(prefill.res.statusCode).toBe(200);
    expect(prefill.res.payload.prefill.serviceName).toBe('Fix the sink');
    expect(prefill.res.payload.prefill.ownerId).toBe(owner);
    const list = await call(householdCtrl.listTemplates, { user: { id: owner }, query: {} });
    expect(list.res.payload.templates.map((t) => t.id)).toContain(templateId);
    const deleted = await call(householdCtrl.deleteTemplate, {
      user: { id: owner }, params: { id: templateId },
    });
    expect(deleted.res.statusCode).toBe(200);
    const listAfter = await call(householdCtrl.listTemplates, { user: { id: owner }, query: {} });
    expect(listAfter.res.payload.templates.map((t) => t.id)).not.toContain(templateId);

    // Calendar handoff moves the coordinator role.
    const handoff = await call(householdCtrl.handoffCalendar, {
      user: { id: owner },
      body: {
        fromDelegationId: global.__g2SecondDelegationId,
        toDelegationId: global.__g2DelegationId,
        note: 'Handing the calendar back',
      },
    });
    expect(handoff.res.statusCode).toBe(200);
    expect(handoff.res.payload.delegation.isCoordinator).toBe(true);
    expect(handoff.res.payload.delegation.handoffNote).toMatch(/Handing the calendar back/);
  });

  test('82: spending approval is a request the owner decides', async () => {
    const bookingId = global.__g2BookingId;
    // A calendar-only delegate cannot request spending approval.
    const denied = await call(householdCtrl.createSpendingApproval, {
      user: { id: calendarOnly },
      body: { ownerId: owner, amountCents: 5000, reason: 'New part' },
    });
    expect(denied.res.statusCode).toBe(403);
    const created = await call(householdCtrl.createSpendingApproval, {
      user: { id: delegate },
      body: { ownerId: owner, bookingId, amountCents: 7500, currency: 'USD', reason: 'Replacement tap needed' },
    });
    expect(created.res.statusCode).toBe(201);
    expect(created.res.payload.approval.status).toBe('pending');
    const approvalId = created.res.payload.approval.id;

    // The requester can never approve their own request.
    const selfDecide = await call(householdCtrl.decideSpendingApproval, {
      user: { id: delegate }, params: { id: approvalId }, body: { decision: 'approved' },
    });
    expect(selfDecide.res.statusCode).toBe(403);
    const decided = await call(householdCtrl.decideSpendingApproval, {
      user: { id: owner }, params: { id: approvalId }, body: { decision: 'approved' },
    });
    expect(decided.res.statusCode).toBe(200);
    expect(decided.res.payload.approval.status).toBe('approved');
    const again = await call(householdCtrl.decideSpendingApproval, {
      user: { id: owner }, params: { id: approvalId }, body: { decision: 'denied' },
    });
    expect(again.res.statusCode).toBe(409);

    const second = await call(householdCtrl.createSpendingApproval, {
      user: { id: delegate },
      body: { ownerId: owner, amountCents: 100, reason: 'Small part' },
    });
    const deniedByOwner = await call(householdCtrl.decideSpendingApproval, {
      user: { id: owner }, params: { id: second.res.payload.approval.id }, body: { decision: 'denied' },
    });
    expect(deniedByOwner.res.payload.approval.status).toBe('denied');
  });

  test('76-80: maintenance plans, triage, history', async () => {
    const overdue = await call(householdCtrl.createTask, {
      user: { id: owner },
      body: { kind: 'vehicle', title: 'Oil change', dueDate: tomorrowPlus(-2), recurrenceDays: 180 },
    });
    expect(overdue.res.statusCode).toBe(201);
    expect(overdue.res.payload.task.overdue).toBe(true);
    const soon = await call(householdCtrl.createTask, {
      user: { id: owner },
      body: { kind: 'household', title: 'Gutter clean', dueDate: tomorrowPlus(3) },
    });
    expect(soon.res.payload.task.dueSoon).toBe(true);
    const care = await call(householdCtrl.createTask, {
      user: { id: owner },
      body: { kind: 'personal_care', title: 'Weekly check-in call', dueDate: tomorrowPlus(30) },
    });
    expect(care.res.statusCode).toBe(201);
    const badKind = await call(householdCtrl.createTask, {
      user: { id: owner }, body: { kind: 'rocket', title: 'Nope' },
    });
    expect(badKind.res.statusCode).toBe(400);

    const triage = await call(householdCtrl.triageTasks, { user: { id: owner }, query: {} });
    expect(triage.res.payload.counts.overdue).toBe(1);
    expect(triage.res.payload.counts.dueSoon).toBe(1);
    expect(triage.res.payload.overdue[0].title).toBe('Oil change');

    // Completing a recurring plan opens the next occurrence and keeps
    // the completed one in history.
    const done = await call(householdCtrl.completeTask, {
      user: { id: tasksOnly }, params: { id: overdue.res.payload.task.id },
    });
    expect(done.res.statusCode).toBe(200);
    expect(done.res.payload.task.status).toBe('done');
    expect(done.res.payload.nextTask).toBeTruthy();
    expect(done.res.payload.nextTask.status).toBe('open');
    const history = await call(householdCtrl.taskHistory, { user: { id: owner }, query: {} });
    expect(history.res.payload.history.map((t) => t.title)).toContain('Oil change');
    const doneAgain = await call(householdCtrl.completeTask, {
      user: { id: owner }, params: { id: overdue.res.payload.task.id },
    });
    expect(doneAgain.res.statusCode).toBe(409);
  });

  test('86-90: disruptions — replacement, missed follow-up, unavailability, preview', async () => {
    const bookingId = global.__g2BookingId;
    const replacement = await call(householdCtrl.requestReplacement, {
      user: { id: delegate }, params: { bookingId }, body: { reason: 'Helper cancelled' },
    });
    expect(replacement.res.statusCode).toBe(200);
    expect(replacement.res.payload.prep.disruption.type).toBe('replacement_request');
    const followup = await call(householdCtrl.missedFollowup, {
      user: { id: delegate }, params: { bookingId },
      body: { action: 'reschedule', note: 'Try Thursday morning instead' },
    });
    expect(followup.res.statusCode).toBe(200);
    expect(followup.res.payload.prep.followUp.action).toBe('reschedule');
    const unavailable = await call(householdCtrl.markUnavailable, {
      user: { id: delegate }, params: { bookingId }, body: { reason: 'Rita is at the hospital' },
    });
    expect(unavailable.res.statusCode).toBe(200);
    expect(unavailable.res.payload.prep.disruption.type).toBe('recipient_unavailable');
    const preview = await call(householdCtrl.cancellationPreview, {
      user: { id: delegate }, params: { bookingId },
    });
    expect(preview.res.statusCode).toBe(200);
    expect(preview.res.payload.impacts.checklistItems).toBe(2);
    expect(preview.res.payload.impacts.readinessConfirmed).toBe(true);
    expect(JSON.stringify(preview.res.payload)).not.toMatch(/amount|deposit|price/i);
  });

  test('91-95: visit summary, vault, forwarding, permission-aware export', async () => {
    const bookingId = global.__g2BookingId;
    const summary = await call(householdCtrl.shareVisitSummary, {
      user: { id: delegate }, params: { bookingId }, body: { summary: 'Tap fixed, no leak. Rita is happy.' },
    });
    expect(summary.res.statusCode).toBe(201);
    expect(summary.res.payload.document.kind).toBe('visit_summary');

    // The vault: a document shared with the delegate is visible; an
    // unshared one is not.
    const sharedDoc = await call(householdCtrl.createDocument, {
      user: { id: owner },
      body: {
        kind: 'document', title: 'Care instructions', body: 'Check the tap weekly.',
        sharedWithDelegationIds: [global.__g2DelegationId],
      },
    });
    expect(sharedDoc.res.statusCode).toBe(201);
    const privateDoc = await call(householdCtrl.createDocument, {
      user: { id: owner },
      body: { kind: 'document', title: 'Owner only note', body: 'Private.' },
    });
    expect(privateDoc.res.statusCode).toBe(201);
    const delegateDocs = await call(householdCtrl.listDocuments, {
      user: { id: delegate }, query: { ownerId: owner },
    });
    const titles = delegateDocs.res.payload.documents.map((d) => d.title);
    expect(titles).toContain('Care instructions');
    expect(titles).not.toContain('Owner only note');

    // Forwarding the receipt shares it onward.
    const receipt = await call(householdCtrl.createDocument, {
      user: { id: owner },
      body: { kind: 'receipt', title: 'Tap receipt', body: 'Paid by owner.', bookingId },
    });
    const forwarded = await call(householdCtrl.forwardDocument, {
      user: { id: owner }, params: { id: receipt.res.payload.document.id },
      body: { toDelegationIds: [global.__g2DelegationId] },
    });
    expect(forwarded.res.statusCode).toBe(200);
    expect(forwarded.res.payload.document.sharedWithDelegationIds).toContain(global.__g2DelegationId);

    // Permission-aware export: a calendar-only delegate sees visits but
    // no documents and no activity.
    const exportCal = await call(householdCtrl.historyExport, {
      user: { id: calendarOnly }, query: { ownerId: owner },
    });
    expect(exportCal.res.statusCode).toBe(200);
    expect(exportCal.res.payload.visits).toBeTruthy();
    expect(exportCal.res.payload).not.toHaveProperty('documents');
    expect(exportCal.res.payload).not.toHaveProperty('activity');
    const exportOwner = await call(householdCtrl.historyExport, {
      user: { id: owner }, query: {},
    });
    expect(exportOwner.res.payload.documents).toBeTruthy();
    expect(exportOwner.res.payload.activity).toBeTruthy();
  });

  test('96/97: reassignment and draft handoff', async () => {
    const bookingId = global.__g2BookingId;
    const reassigned = await call(householdCtrl.reassignVisits, {
      user: { id: owner },
      body: { bookingIds: [bookingId], toDelegateUserId: delegate2 },
    });
    expect(reassigned.res.statusCode).toBe(200);
    expect(reassigned.res.payload.reassigned).toContain(bookingId);
    const prep = await call(householdCtrl.getPrep, {
      user: { id: owner }, params: { bookingId },
    });
    expect(prep.res.payload.prep.assignedDelegateUserId).toBe(delegate2);

    const handoff = await call(householdCtrl.handoffPrep, {
      user: { id: owner }, params: { bookingId },
      body: { toDelegateUserId: delegate, note: 'Back to Dana, please finish the checklist' },
    });
    expect(handoff.res.statusCode).toBe(200);
    expect(handoff.res.payload.prep.handoffNote).toMatch(/Back to Dana/);
    const ack = await call(householdCtrl.acknowledgePrepHandoff, {
      user: { id: delegate }, params: { bookingId },
    });
    expect(ack.res.statusCode).toBe(200);
    expect(ack.res.payload.prep.handoffAcknowledgedAt).toBeTruthy();
  });

  // Wave 4 checkpoint A: fresh users for the new-behavior tests below.
  async function freshUser() {
    const id = crypto.randomUUID();
    const email = `g2-w4-${id.slice(0, 8)}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
       VALUES ($1, $2, 'x', 'Test', 'customer', 'customer', TRUE, TRUE, FALSE)`,
      [id, email],
    );
    return { id, email };
  }

  test('Wave 4 (52): emailed invite carries an accept token; token accept works', async () => {
    const email = require('../utils/email');
    const freshEmail = `g2-token-${crypto.randomUUID().slice(0, 8)}@example.invalid`;
    const { res } = await invite({ body: { delegateEmail: freshEmail, scopes: ['book'] } });
    expect(res.statusCode).toBe(201);
    const token = res.payload.delegation.inviteToken;
    expect(token).toBeTruthy();
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: freshEmail,
      text: expect.stringContaining(token),
    }));
    const strangerTry = await call(householdCtrl.acceptDelegationByToken, {
      user: { id: stranger }, body: { token },
    });
    expect(strangerTry.res.statusCode).toBe(403);
    const invitee = await freshUser();
    await pool.query('UPDATE users SET email = $2 WHERE id = $1', [invitee.id, freshEmail]);
    const accepted = await call(householdCtrl.acceptDelegationByToken, {
      user: { id: invitee.id }, body: { token },
    });
    expect(accepted.res.statusCode).toBe(200);
    expect(accepted.res.payload.delegation.status).toBe('accepted');
    const again = await call(householdCtrl.acceptDelegationByToken, {
      user: { id: invitee.id }, body: { token },
    });
    expect(again.res.statusCode).toBe(409);
  });

  test('Wave 4 (79/80/81): book-only delegates cannot do visit actions; calendar-only reads no tasks', async () => {
    const bookOnly = await freshUser();
    await makeAcceptedDelegation(bookOnly.id, ['book']);
    const booking = await createBooking({});
    expect(booking.res.statusCode).toBe(201);
    const bookingId = booking.res.payload.data.id;
    const ready = await call(householdCtrl.confirmReadiness, {
      user: { id: bookOnly.id }, params: { bookingId },
    });
    expect(ready.res.statusCode).toBe(403);
    const summary = await call(householdCtrl.shareVisitSummary, {
      user: { id: bookOnly.id }, params: { bookingId }, body: { summary: 'x' },
    });
    expect(summary.res.statusCode).toBe(403);
    const replacement = await call(householdCtrl.requestReplacement, {
      user: { id: bookOnly.id }, params: { bookingId }, body: { reason: 'x' },
    });
    expect(replacement.res.statusCode).toBe(403);
    const triage = await call(householdCtrl.triageTasks, {
      user: { id: calendarOnly }, query: { ownerId: owner },
    });
    expect(triage.res.statusCode).toBe(403);
    const history = await call(householdCtrl.taskHistory, {
      user: { id: calendarOnly }, query: { ownerId: owner },
    });
    expect(history.res.statusCode).toBe(403);
  });

  test('Wave 4 (62/84): reminders refuse inside 24h and report tooSoon', async () => {
    const fresh = await freshUser();
    const delegationId = await makeAcceptedDelegation(fresh.id, ['schedule']);
    const first = await call(householdCtrl.remindDelegation, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(first.res.statusCode).toBe(200);
    expect(first.res.payload.reminded).toBe(true);
    const second = await call(householdCtrl.remindDelegation, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(second.res.payload.reminded).toBe(false);
    expect(second.res.payload.tooSoon).toBe(true);
    // The visit reminder was already sent once for the shared booking
    // in the 61-70 test, so a repeat is tooSoon with nothing notified.
    const visit = await call(householdCtrl.remindVisit, {
      user: { id: delegate }, params: { bookingId: global.__g2BookingId },
    });
    expect(visit.res.payload.tooSoon).toBe(true);
    expect(visit.res.payload.reminded).toBe(0);
  });

  test('Wave 4 (93): forwarding creates a copy; the original sharing is untouched', async () => {
    const a = await freshUser();
    const b = await freshUser();
    const delA = await makeAcceptedDelegation(a.id, ['view_records']);
    const delB = await makeAcceptedDelegation(b.id, ['view_records']);
    const doc = await call(householdCtrl.createDocument, {
      user: { id: owner },
      body: { kind: 'receipt', title: 'Wave4 receipt', body: 'Paid.', sharedWithDelegationIds: [delA] },
    });
    expect(doc.res.statusCode).toBe(201);
    const fwd = await call(householdCtrl.forwardDocument, {
      user: { id: owner }, params: { id: doc.res.payload.document.id },
      body: { toDelegationIds: [delB] },
    });
    expect(fwd.res.statusCode).toBe(200);
    expect(fwd.res.payload.document.id).not.toBe(doc.res.payload.document.id);
    expect(fwd.res.payload.document.forwardedFrom).toBe(doc.res.payload.document.id);
    expect(fwd.res.payload.document.sharedWithDelegationIds).toEqual([delB]);
    const { rows } = await pool.query(
      'SELECT shared_with_delegation_ids FROM household_documents WHERE id = $1',
      [doc.res.payload.document.id],
    );
    expect(rows[0].shared_with_delegation_ids).toEqual([delA]);
  });

  test('Wave 4 (92): a recipient reads only documents linked to their own bookings', async () => {
    const recip = await freshUser();
    const booking = await createBooking({});
    expect(booking.res.statusCode).toBe(201);
    const bookingId = booking.res.payload.data.id;
    await pool.query('UPDATE booking_requests SET recipient_user_id = $2 WHERE id = $1', [bookingId, recip.id]);
    const linked = await call(householdCtrl.createDocument, {
      user: { id: owner },
      body: { kind: 'receipt', title: 'Linked receipt', body: 'For the visit.', bookingId },
    });
    expect(linked.res.statusCode).toBe(201);
    const unlinked = await call(householdCtrl.createDocument, {
      user: { id: owner },
      body: { kind: 'document', title: 'Owner private', body: 'Not for the visit.' },
    });
    expect(unlinked.res.statusCode).toBe(201);
    const seen = await call(householdCtrl.listDocuments, {
      user: { id: recip.id }, query: { ownerId: owner },
    });
    expect(seen.res.statusCode).toBe(200);
    const titles = seen.res.payload.documents.map((d) => d.title);
    expect(titles).toContain('Linked receipt');
    expect(titles).not.toContain('Owner private');
    const wrongHousehold = await call(householdCtrl.listDocuments, {
      user: { id: recip.id }, query: { ownerId: stranger },
    });
    expect(wrongHousehold.res.statusCode).toBe(403);
  });

  test('Wave 4 (99): revocation reassigns upcoming preps to the owner and records it', async () => {
    const fresh = await freshUser();
    const delegationId = await makeAcceptedDelegation(fresh.id, ['schedule', 'prepare']);
    const booking = await createBooking({});
    expect(booking.res.statusCode).toBe(201);
    const bookingId = booking.res.payload.data.id;
    const prep = await call(householdCtrl.updatePrep, {
      user: { id: owner }, params: { bookingId },
      body: { assignedDelegateUserId: fresh.id },
    });
    expect(prep.res.statusCode).toBe(200);
    expect(prep.res.payload.prep.assignedDelegateUserId).toBe(fresh.id);
    const revoked = await call(householdCtrl.revokeDelegation, {
      user: { id: owner }, params: { id: delegationId }, body: { reason: 'Wave 4 check' },
    });
    expect(revoked.res.statusCode).toBe(200);
    const receipt = await call(householdCtrl.getClosureReceipt, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(receipt.res.payload.receipt.upcomingVisitsReassigned.count).toBe(1);
    expect(receipt.res.payload.receipt.upcomingVisitsReassigned.reassignedTo).toBe('owner');
    const after = await call(householdCtrl.getPrep, {
      user: { id: owner }, params: { bookingId },
    });
    expect(after.res.payload.prep.assignedDelegateUserId).toBeNull();
  });

  test('Wave 4 (63): reading a prep or availability creates no prep row', async () => {
    const booking = await createBooking({});
    expect(booking.res.statusCode).toBe(201);
    const bookingId = booking.res.payload.data.id;
    const prep = await call(householdCtrl.getPrep, {
      user: { id: owner }, params: { bookingId },
    });
    expect(prep.res.statusCode).toBe(200);
    expect(prep.res.payload.prep).toBeNull();
    const avail = await call(householdCtrl.getAvailability, {
      user: { id: owner }, params: { bookingId },
    });
    expect(avail.res.payload.availability).toEqual([]);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM household_visit_preps WHERE booking_id = $1', [bookingId],
    );
    expect(rows[0].n).toBe(0);
  });

  test('Wave 4 (72): a lapsed substitute coordinator clears on read', async () => {
    const fresh = await freshUser();
    const delegationId = await makeAcceptedDelegation(fresh.id, ['coordinate']);
    await pool.query(
      `UPDATE household_delegations
          SET is_coordinator = TRUE, coordinator_until = NOW() - interval '1 day'
        WHERE id = $1`,
      [delegationId],
    );
    const read = await call(householdCtrl.getDelegation, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(read.res.statusCode).toBe(200);
    expect(read.res.payload.delegation.isCoordinator).toBe(false);
    const { rows } = await pool.query(
      'SELECT is_coordinator FROM household_delegations WHERE id = $1', [delegationId],
    );
    expect(rows[0].is_coordinator).toBe(false);
  });

  test('Wave 4 (84): the sweep reminds delegations entering their final 7 days, once', async () => {
    const svc = require('../services/householdDelegationService');
    const fresh = await freshUser();
    const delegationId = await makeAcceptedDelegation(fresh.id, ['view_calendar']);
    await pool.query(
      `UPDATE household_delegations SET expires_at = NOW() + interval '3 days' WHERE id = $1`,
      [delegationId],
    );
    const first = await svc.sendDelegationExpiryReminders(pool);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query(
      'SELECT last_reminder_sent_at FROM household_delegations WHERE id = $1', [delegationId],
    );
    expect(rows[0].last_reminder_sent_at).toBeTruthy();
    const second = await svc.sendDelegationExpiryReminders(pool);
    expect(second.sent).toBe(0);
  });

  test('Wave 4 (75/97): prep handoff acknowledgment records once', async () => {
    const fresh = await freshUser();
    await makeAcceptedDelegation(fresh.id, ['schedule', 'prepare']);
    const booking = await createBooking({});
    expect(booking.res.statusCode).toBe(201);
    const bookingId = booking.res.payload.data.id;
    const handoff = await call(householdCtrl.handoffPrep, {
      user: { id: owner }, params: { bookingId },
      body: { toDelegateUserId: fresh.id, note: 'Please take this visit' },
    });
    expect(handoff.res.statusCode).toBe(200);
    const first = await call(householdCtrl.acknowledgePrepHandoff, {
      user: { id: fresh.id }, params: { bookingId },
    });
    expect(first.res.statusCode).toBe(200);
    const at = first.res.payload.prep.handoffAcknowledgedAt;
    expect(at).toBeTruthy();
    const second = await call(householdCtrl.acknowledgePrepHandoff, {
      user: { id: fresh.id }, params: { bookingId },
    });
    expect(second.res.statusCode).toBe(200);
    expect(new Date(second.res.payload.prep.handoffAcknowledgedAt).getTime())
      .toBe(new Date(at).getTime());
  });

  test('83/84/85/99/100: renewal, reminder, revocation, receipt, re-invite', async () => {
    const delegationId = global.__g2DelegationId;
    const before = await call(householdCtrl.getDelegation, { user: { id: owner }, params: { id: delegationId } });
    const reminded = await call(householdCtrl.remindDelegation, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(reminded.res.statusCode).toBe(200);
    expect(reminded.res.payload.reminded).toBe(true);

    const renewed = await call(householdCtrl.renewDelegation, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(renewed.res.statusCode).toBe(200);
    expect(new Date(renewed.res.payload.delegation.expiresAt).getTime())
      .toBeGreaterThan(new Date(before.res.payload.delegation.expiresAt).getTime());

    // Revocation is immediate and total: booking on behalf and the
    // shared calendar close at once.
    const revoked = await call(householdCtrl.revokeDelegation, {
      user: { id: owner }, params: { id: delegationId }, body: { reason: 'No longer needed' },
    });
    expect(revoked.res.statusCode).toBe(200);
    expect(revoked.res.payload.delegation.status).toBe('revoked');
    const afterBook = await createBooking({
      asUser: delegate,
      overrides: { onBehalfOfOwnerId: owner, serviceName: 'Should fail' },
    });
    expect(afterBook.res.statusCode).toBe(403);
    const afterCal = await call(householdCtrl.getCalendar, {
      user: { id: delegate }, query: { ownerId: owner },
    });
    expect(afterCal.res.statusCode).toBe(403);

    // Closure receipt (99) survives revocation.
    const receipt = await call(householdCtrl.getClosureReceipt, {
      user: { id: delegate }, params: { id: delegationId },
    });
    expect(receipt.res.statusCode).toBe(200);
    expect(receipt.res.payload.receipt.reason).toMatch(/No longer needed/);
    expect(receipt.res.payload.activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(['invited', 'accepted', 'revoked']),
    );

    // Renewing a revoked row is refused; re-inviting mints a fresh one.
    const renewDead = await call(householdCtrl.renewDelegation, {
      user: { id: owner }, params: { id: delegationId },
    });
    expect(renewDead.res.statusCode).toBe(409);
    const reinvited = await call(householdCtrl.reinviteDelegation, {
      user: { id: owner }, params: { id: delegationId }, body: {},
    });
    expect(reinvited.res.statusCode).toBe(201);
    expect(reinvited.res.payload.delegation.id).not.toBe(delegationId);
    expect(reinvited.res.payload.delegation.status).toBe('invited');
    const old = await call(householdCtrl.getDelegation, { user: { id: owner }, params: { id: delegationId } });
    expect(old.res.payload.delegation.status).toBe('revoked');
  });
});
