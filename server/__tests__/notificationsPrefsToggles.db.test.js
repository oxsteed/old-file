'use strict';

/**
 * DB tests: notifications audit Track C — preference + toggle system.
 *
 * Items covered (Nov 6 notifications audit):
 *   4  quiet_hours_enabled column missing: PUT must persist start/end +
 *      enabled, and the quiet-hours gate must defer push while enabled.
 *   12 in-app master toggle + per-type opt-outs (notification_type_opt_outs):
 *      master off suppresses the in-app row; an opt-out row suppresses
 *      that type+channel only; absence defaults ON.
 *   33 phantom in_app_media_creator_update column: whitelisted + queue gate.
 *   52 sms_support_replies in neither whitelist nor UI: whitelisted, and
 *      sendSMSIfOptedIn must honour it.
 *   14 calendar quiet-hours leg defers whenever times are set, ignoring the
 *      enabled flag: must unify on quiet_hours_enabled.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/notificationsPrefsToggles.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'notif-prefs-toggles-test-secret';
}

// Expo push is observed, never sent: the SDK is mocked before
// notificationService loads it.
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

const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const notifCtrl = require('../controllers/notificationController');
const availCtrl = require('../controllers/availabilityController');
const calCtrl = require('../controllers/calendarNotificationController');
const { queueCreatorNotification } = require('../services/mediaCreatorNotificationService');
const { sendSMSIfOptedIn } = require('../services/smsNotificationService');

jest.setTimeout(60000);

function mockReq({ params = {}, query = {}, body = {}, user = {} } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

const userIds = [];
const appointmentIds = [];
const notificationIds = [];

async function makeUser({ phone = null } = {}) {
  const id = crypto.randomUUID();
  const email = `notif-c-${id.slice(0, 8)}@example.com`;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, phone_number, phone_verified)
     VALUES ($1, $2, 'x', 'Notif', 'C', 'customer', TRUE, TRUE, $3, $4)`,
    [id, email, phone, !!phone]
  );
  userIds.push(id);
  return { id, email };
}

async function setPrefs(userId, patch) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(
    `UPDATE notification_preferences SET ${set} WHERE user_id = $1`,
    [userId, ...keys.map((k) => patch[k])]
  );
}

// A quiet-hours window covering "now" in UTC, as HH:MM strings.
function quietWindowNow() {
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const fmt = (m) => {
    const v = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  return { start: fmt(mins - 60), end: fmt(mins + 60) };
}

async function countNotifications(userId, type) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2`,
    [userId, type]
  );
  return rows[0].n;
}

ddescribe('Track C preference toggles (DB)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendExpo.mockResolvedValue([{ status: 'ok' }]);
  });

  afterAll(async () => {
    // NOTE: DELETE FROM users fails in this disposable DB: the no-delete
    // RULE on oxsteed_credit_partner_funding_records (migration 514)
    // rewrites the RI trigger query, so Postgres aborts every users
    // delete ("referential integrity query ... gave unexpected result").
    // Other .db.test.js suites swallow the same failure with .catch();
    // the leftover notif-c-* users are inert rows in the disposable DB.
    const clean = async (sql, params) => {
      try { await pool.query(sql, params); } catch { /* see NOTE above */ }
    };
    if (notificationIds.length) {
      await clean('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [notificationIds]);
    }
    if (appointmentIds.length) {
      await clean('DELETE FROM calendar_notifications WHERE appointment_id = ANY($1::bigint[])', [appointmentIds]);
      await clean('DELETE FROM appointments WHERE id = ANY($1::bigint[])', [appointmentIds]);
    }
    if (userIds.length) {
      await clean('DELETE FROM notification_type_opt_outs WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM notification_preferences WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM sms_logs WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM order_sms_budgets WHERE user_id = ANY($1::uuid[])', [userIds]);
      await clean('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await pool.end();
  });

  describe('item 4 — quiet hours end to end', () => {
    test('PUT persists quiet_hours_enabled + start/end, and GET returns them', async () => {
      const user = await makeUser();
      const { start, end } = quietWindowNow();
      const { res, err } = await call(
        availCtrl.updateNotificationPreferences,
        mockReq({ user: { id: user.id }, body: { quiet_hours_enabled: true, quiet_hours_start: start, quiet_hours_end: end, timezone: 'UTC' } })
      );
      expect(err).toBeNull();
      expect(res.payload.quiet_hours_enabled).toBe(true);
      expect(String(res.payload.quiet_hours_start).slice(0, 5)).toBe(start);
      expect(String(res.payload.quiet_hours_end).slice(0, 5)).toBe(end);

      const got = await call(availCtrl.getNotificationPreferences, mockReq({ user: { id: user.id } }));
      expect(got.res.payload.quiet_hours_enabled).toBe(true);
    });

    test('quiet-hours gate defers push while enabled, fires while disabled', async () => {
      const user = await makeUser();
      const { start, end } = quietWindowNow();
      await setPrefs(user.id, {
        quiet_hours_enabled: true, quiet_hours_start: start, quiet_hours_end: end, timezone: 'UTC',
      });
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `qh-on-${user.id}`,
      });
      expect(mockSendExpo).not.toHaveBeenCalled();
      // In-app still proceeds during quiet hours (gate blocks push only).
      expect(await countNotifications(user.id, 'bid_received')).toBe(1);

      await setPrefs(user.id, { quiet_hours_enabled: false });
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `qh-off-${user.id}`,
      });
      expect(mockSendExpo).toHaveBeenCalled();
    });
  });

  describe('item 12 — in-app master toggle + per-type opt-outs', () => {
    test('in_app_notifications=false suppresses the in-app row; true restores it', async () => {
      const user = await makeUser();
      await setPrefs(user.id, { in_app_notifications: false });
      const off = await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        idempotencyKey: `master-off-${user.id}`,
      });
      expect(off.success).toBe(true);
      expect(await countNotifications(user.id, 'bid_received')).toBe(0);

      await setPrefs(user.id, { in_app_notifications: true });
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        idempotencyKey: `master-on-${user.id}`,
      });
      expect(await countNotifications(user.id, 'bid_received')).toBe(1);
    });

    test('per-type opt-out suppresses only that type+channel; other types still deliver', async () => {
      const user = await makeUser();
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'bid_received', 'in_app')`,
        [user.id]
      );
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        idempotencyKey: `optout-inapp-${user.id}`,
      });
      expect(await countNotifications(user.id, 'bid_received')).toBe(0);

      await sendNotification({
        userId: user.id, type: 'job_started', title: 't', body: 'b',
        idempotencyKey: `optout-other-${user.id}`,
      });
      expect(await countNotifications(user.id, 'job_started')).toBe(1);

      // Opt-out is per channel: the push leg for the same type still fires.
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `optout-push-${user.id}`,
      });
      expect(mockSendExpo).toHaveBeenCalled();
    });

    test('per-type push opt-out suppresses Expo push for that type only', async () => {
      const user = await makeUser();
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'bid_received', 'push')`,
        [user.id]
      );
      await sendNotification({
        userId: user.id, type: 'bid_received', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `optout-push2-${user.id}`,
      });
      expect(mockSendExpo).not.toHaveBeenCalled();
      await sendNotification({
        userId: user.id, type: 'job_started', title: 't', body: 'b',
        pushToken: 'ExponentPushToken[test]', idempotencyKey: `optout-push3-${user.id}`,
      });
      expect(mockSendExpo).toHaveBeenCalled();
    });

    test('per-type email opt-out suppresses realtime email for that type only', async () => {
      const user = await makeUser();
      const { sendEmail } = require('../utils/email');
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'new_message', 'email')`,
        [user.id]
      );
      await sendNotification({
        userId: user.id, type: 'new_message', title: 't', body: 'b',
        idempotencyKey: `optout-email-${user.id}`,
      });
      expect(sendEmail).not.toHaveBeenCalled();
      await sendNotification({
        userId: user.id, type: 'bid_accepted', title: 't', body: 'b',
        idempotencyKey: `optout-email2-${user.id}`,
      });
      expect(sendEmail).toHaveBeenCalled();
    });

    test('updatePreferences whitelists the master toggle and the type-opt-out endpoints round-trip', async () => {
      const user = await makeUser();
      const { res, err } = await call(
        notifCtrl.updatePreferences,
        mockReq({ user: { id: user.id }, body: { in_app_notifications: false } })
      );
      expect(err).toBeNull();
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query(
        'SELECT in_app_notifications FROM notification_preferences WHERE user_id = $1', [user.id]
      );
      expect(rows[0].in_app_notifications).toBe(false);

      const put = await call(
        notifCtrl.setTypeOptOut,
        mockReq({ user: { id: user.id }, body: { type: 'bid_received', channel: 'in_app', optedOut: true } })
      );
      expect(put.err).toBeNull();
      const listed = await call(notifCtrl.getTypeOptOuts, mockReq({ user: { id: user.id } }));
      expect(listed.res.payload.opt_outs).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'bid_received', channel: 'in_app' })])
      );
      const cleared = await call(
        notifCtrl.setTypeOptOut,
        mockReq({ user: { id: user.id }, body: { type: 'bid_received', channel: 'in_app', optedOut: false } })
      );
      expect(cleared.err).toBeNull();
      const relisted = await call(notifCtrl.getTypeOptOuts, mockReq({ user: { id: user.id } }));
      expect(relisted.res.payload.opt_outs).toEqual([]);
    });

    test('getPreferences returns the type_opt_outs list for the settings UI', async () => {
      const user = await makeUser();
      await pool.query(
        `INSERT INTO notification_type_opt_outs (user_id, notification_type, channel)
         VALUES ($1, 'job_started', 'push')`,
        [user.id]
      );
      const { res, err } = await call(notifCtrl.getPreferences, mockReq({ user: { id: user.id } }));
      expect(err).toBeNull();
      expect(res.payload.type_opt_outs).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'job_started', channel: 'push' })])
      );
    });

    test('catalog stays in sync with the live sendNotification call sites (N3)', async () => {
      // N3: the catalog is a static snapshot that drifted from the call
      // sites (the batch's own new types had no toggle, and neither did
      // dozens of ternary/variable/template types). This test extracts
      // the live send types from server/ on every run and diffs them
      // against the catalog, so a new send type without a toggle fails
      // the suite instead of silently shipping toggle-less.
      //
      // How a call site is classified (first `type` in the call's own
      // object, value taken up to its top-level comma so a ternary in a
      // LATER property such as title/body is never mistaken for the
      // type's own ternary):
      //   literal `type: 'x'`                -> x must be cataloged.
      //   ternary `type: c ? 'a' : 'b'`      -> both branches cataloged.
      //   template `` `prefix_${v}` ``       -> the prefix family must be
      //     listed in TEMPLATE_FAMILIES with its expansions cataloged.
      //   concat `'prefix' + v`              -> same, as a prefix family.
      //   variable `type: someVar` / `type,` -> the (file, name) must be
      //     listed in VARIABLE_SITES with its expansions cataloged.
      //   no `type` in the call at all       -> the file must be listed
      //     in SPREAD_SITES with its expansions cataloged (the payload
      //     object is built elsewhere in the same flow).
      // A NEW site in any unlisted shape fails here on purpose: classify
      // it (add the type to the catalog, or the site to the lists below
      // with its resolution) instead of widening the extractor.
      const fs = require('fs');
      const path = require('path');
      const { NOTIFICATION_TYPES, NOTIFICATION_TYPE_GROUPS } = require('../utils/notificationTypeCatalog');
      const catalog = new Set(NOTIFICATION_TYPES.map((entry) => entry.type));

      // Template/concat prefix families and their concrete expansions.
      // delivery: is derived at runtime from the same source the worker
      // uses, so adding an event there without a catalog entry fails.
      const { DELIVERY_NOTIFICATION_EVENTS } = require('../utils/localDeliveryNotifications');
      const TEMPLATE_FAMILIES = {
        credit_cashout_: ['credit_cashout_paid', 'credit_cashout_failed'],
        // G10-1: consultant payout leg (notifyConsultant in
        // services/consultantPayoutService.js).
        consultant_payout_: ['consultant_payout_paid', 'consultant_payout_parked', 'consultant_payout_failed'],
        logistics_payment_: ['logistics_payment_succeeded', 'logistics_payment_failed'],
        'delivery:': DELIVERY_NOTIFICATION_EVENTS.map((event) => `delivery:${event}`),
      };

      // Variable-driven send sites: the type comes from a parameter, a
      // lookup table, or a DB column. The expansions are the types that
      // can actually reach sendNotification through the site.
      const VARIABLE_SITES = [
        // Groups 5-6: notify() in services/businessOwner/common.js.
        { file: 'services/businessOwner/common.js', name: 'type', expansions: ['business_listing_claim_approved', 'business_listing_claim_rejected', 'business_service_issue_reported', 'business_service_issue_resolved', 'business_ownership_transfer_requested', 'business_ownership_transfer_completed', 'business_ownership_transfer_declined', 'business_deputy_designated', 'business_work_transferred', 'business_permission_requested', 'business_permission_decided', 'business_work_released', 'business_dispatch_declined', 'business_work_exception_raised', 'business_work_exception_updated', 'business_crew_allocated', 'business_crew_declined', 'business_team_mention', 'business_coverage_claimed', 'business_coverage_decided', 'business_job_follow_up', 'business_feedback_follow_up', 'business_shift_handover', 'business_task_assigned_to_you', 'business_delegation_proposed', 'business_delegation_answered', 'business_delegation_visits', 'business_member_left', 'property_assigned', 'property_manager_changed', 'property_contact_updated', 'property_access_revoked', 'property_approval_requested', 'property_approval_decided', 'property_entry_scheduled', 'property_entry_window_selected', 'property_emergency', 'property_incident_summary', 'property_maintenance_due', 'property_budget_over', 'restaurant_pickup_unclaimed', 'restaurant_order_transfer_requested', 'restaurant_order_transfer_decided', 'restaurant_order_moved', 'restaurant_equipment_down', 'restaurant_location_emergency_closed', 'restaurant_stock_notice', 'restaurant_ticket_transferred', 'restaurant_substitution_request', 'restaurant_order_issue_escalated', 'restaurant_order_late', 'restaurant_incident_assigned', 'restaurant_access_change_handoff'] },
        // Group 4 rest items 179-180: tellCustomer in the helper work service.
        { file: 'services/helperWorkService.js', name: 'type', expansions: ['helper_progress_update', 'helper_handover_updated'] },
        // Group 4 rest item 183: notify() in the job change request service.
        { file: 'services/jobChangeRequestService.js', name: 'type', expansions: ['job_change_request_proposed', 'job_change_request_countered', 'job_change_request_accepted', 'job_change_request_declined'] },
        // Group 4 rest item 181: notify() in the job reschedule service.
        { file: 'services/jobRescheduleService.js', name: 'type', expansions: ['job_reschedule_proposed', 'job_reschedule_accepted', 'job_reschedule_declined'] },
        { file: 'analytics/regionGeoSourceSwitch.js', name: 'type', expansions: ['admin_operational_notice_region_geo_switched', 'admin_operational_notice_region_geo_rolled_back'] },
        { file: 'controllers/bookingController.js', name: 'type', expansions: ['booking_accepted', 'booking_declined', 'booking_cancelled'] },
        { file: 'controllers/businessAppointmentsController.js', name: 'notificationType', expansions: ['appointment_created', 'appointment_cancelled', 'appointment_rescheduled', 'appointment_staff_reassigned', 'appointment_payment_recorded', 'appointment_pending', 'appointment_confirmed', 'appointment_in_progress', 'appointment_completed', 'appointment_no_show'] },
        { file: 'controllers/businessInvoiceController.js', name: 'type', expansions: ['business_invoice_paid', 'business_invoice_voided'] },
        // Group 10 Slice C: notifySessionParty fan-out in the scheduling
        // controller; the five types are the only ones its callers pass.
        { file: 'controllers/consultantSchedulingController.js', name: 'type', expansions: ['consulting_session_reschedule_proposed', 'consulting_session_reschedule_accepted', 'consulting_session_reschedule_declined', 'consulting_session_cancelled', 'consulting_session_attendance_confirmed'] },
        // Group 10 Slice D: notifyProposalParty fan-out in the proposal
        // controller; the four types are the only ones its callers pass.
        { file: 'controllers/consultantProposalController.js', name: 'type', expansions: ['consulting_proposal_sent', 'consulting_proposal_approved', 'consulting_proposal_rejected', 'consulting_proposal_withdrawn'] },
        // Group 10 Slice E: notifyUser fan-out in the deliverable
        // controller; the four types are the only ones its callers pass.
        { file: 'controllers/consultantDeliverableController.js', name: 'type', expansions: ['consulting_engagement_started', 'consulting_draft_delivered', 'consulting_milestone_accepted', 'consulting_deliverable_feedback'] },
        // Group 10 Slice F: notifyUser fan-out in the change controller;
        // the five types are the only ones its callers pass.
        { file: 'controllers/consultantChangeController.js', name: 'type', expansions: ['consulting_change_requested', 'consulting_change_approved', 'consulting_change_rejected', 'consulting_engagement_paused', 'consulting_engagement_resumed'] },
        // Group 10 Slice G: notifyUser fan-out in the confidentiality
        // controller; the two types are the only ones its callers pass.
        { file: 'controllers/consultantConfidentialityController.js', name: 'type', expansions: ['consulting_participant_added', 'consulting_confidentiality_acknowledged'] },
        { file: 'controllers/calendarNotificationController.js', name: 'notification_type', expansions: ['appointment_requested', 'appointment_confirmed', 'appointment_cancelled', 'appointment_rescheduled', 'reminder_24h', 'reminder_2h', 'reminder_same_day'] },
        { file: 'controllers/mediaController.js', name: 'type', expansions: ['media_reply', 'media_like', 'media_follow'] },
        { file: 'controllers/superAdminController.js', name: 'type', expansions: ['account_deletion_scheduled', 'account_restored', 'account_suspended', 'account_restricted', 'admin_warning'] },
        { file: 'jobs/acceptedJobExpiryJob.js', name: 'type', expansions: ['job_auto_cancel_warning', 'job_auto_cancelled'] },
        // Outbox replay: the stored rows were enqueued by the literal
        // call sites, so their types are already covered above.
        { file: 'jobs/jobEventOutbox.js', name: 'send.type', expansions: [] },
        { file: 'routes/savedSearches.js', name: 'notifType', expansions: ['job_alert', 'helper_alert', 'tool_alert'] },
        { file: 'services/disputeNotifications.js', name: 'type', expansions: ['dispute_resolved', 'dispute_under_review', 'dispute_reopened'] },
        // Group 4 Slice C: notifyQuoteEvent fan-out in the quote
        // negotiation service; the seven types are the only ones its
        // callers pass.
        { file: 'services/helperQuoteNegotiation.js', name: 'type', expansions: ['helper_quote_received', 'helper_quote_revised', 'helper_quote_counter_proposed', 'helper_quote_counter_accepted', 'helper_quote_counter_declined', 'helper_quote_accepted', 'helper_quote_declined'] },
        // Group 2: household notifyHousehold fan-out; the four types are
        // the only ones its callers pass.
        { file: 'services/householdDelegationService.js', name: 'type', expansions: ['household_delegate_invite', 'household_delegation_update', 'household_spending_request', 'household_visit_update'] },
        // Group 3: recipient/sponsor notifyAccountParty fan-out; the
        // eleven types are the only ones its callers pass.
        { file: 'services/bookingRecipientService.js', name: 'type', expansions: ['booking_visit_reminder', 'booking_provider_arrived', 'booking_visit_completed', 'booking_site_action', 'booking_care_instructions', 'booking_contact_removed', 'booking_link_renewal_requested', 'booking_recipient_invite', 'booking_site_contact_link', 'booking_sponsor_invite', 'booking_sponsor_update'] },
        { file: 'services/logisticsQuoteService.js', name: 'type', expansions: ['logistics:quote_published', 'logistics:quote_accepted'] },
        { file: 'services/logisticsRefundPorts.js', name: 'type', expansions: ['logistics:refund_proposed', 'logistics:refund_approved', 'logistics:refund_rejected', 'logistics:refund_processed', 'logistics:refund_pending', 'logistics:refund_failed', 'logistics:refund_expired'] },
        // sendBulkNotification fan-out: the type is the bulk caller's
        // type (analytics/regionGeoSourceSwitch.js notifyAdmins).
        { file: 'services/notificationService.js', name: 'type', expansions: [] },
        { file: 'services/oxsteedCreditDisputeService.js', name: 'type', expansions: ['credit_dispute_resolved', 'credit_dispute_updated', 'credit_dispute_provisional_credit'] },
        { file: 'services/paymentRefundService.js', name: 'type', expansions: ['refund', 'refund_failed'] },
        { file: 'services/pooledOrderService.js', name: 'type', expansions: ['logistics_campaign_approved', 'logistics_campaign_revisions_requested', 'logistics_campaign_rejected'] },
        // G7-13: the notifyPayoutOwner fan-out also sends
        // payout_draft_created (manager draft, line 265); the expansions
        // omitted it, so the N3 diff never enforced its catalog entry.
        { file: 'services/restaurantPayoutService.js', name: 'type', expansions: ['payout_requested', 'payout_failed', 'payout_approved', 'payout_deposited', 'payout_reversed', 'payout_rejected', 'payout_draft_created'] },
        { file: 'services/supportNotificationService.js', name: 'type', expansions: ['support_sla_breach'] },
        // Redis job-data replay: the queued payload is a full
        // notification object produced by a sendNotification caller
        // upstream, so the type already passed through the central
        // path once; the worker adds no type of its own.
        { file: 'workers/paymentWorker.js', name: 'type', expansions: [] },
      ];

      // Spread sites: sendNotification(payload) with the payload built
      // elsewhere in the same flow. Expansions are the payload types.
      const SPREAD_SITES = [
        { file: 'controllers/businessAccessCodesController.js', expansions: ['vortex_approval_requested', 'vortex_member_joined'] },
        { file: 'controllers/businessInvoiceController.js', expansions: ['invoice'] },
        { file: 'controllers/customer360Controller.js', expansions: ['watchlist_ticket', 'watchlist_booking'] },
        { file: 'controllers/helpersController.js', expansions: ['credential_removed'] },
        { file: 'controllers/leadController.js', expansions: ['lead_received', 'quote_received', 'lead_accepted', 'lead_rejected'] },
        { file: 'controllers/restaurantAppFlowController.js', expansions: ['crew_shift_published', 'crew_shift_cancelled'] },
        { file: 'controllers/restaurantTeamCommsController.js', expansions: ['restaurant_announcement'] },
        { file: 'controllers/vortexController.js', expansions: ['vortex_redeemed'] },
        { file: 'services/statementAmendmentService.js', expansions: ['statement_amended'] },
        { file: 'services/statementExportJobService.js', expansions: ['statement_ready'] },
        { file: 'services/statementIssuanceService.js', expansions: ['statement_ready'] },
      ];

      const serverDir = path.join(__dirname, '..');
      const concrete = new Map();
      const prefixes = new Map();
      const variables = [];
      const spreads = [];
      const unknown = [];

      function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.js')) extractTypes(full);
        }
      }

      function extractTypeValue(afterColon) {
        let depth = 0;
        let quote = null;
        let tpl = false;
        let tplDepth = 0;
        let end = afterColon.length;
        for (let i = 0; i < afterColon.length; i++) {
          const ch = afterColon[i];
          if (quote) {
            if (ch === '\\') { i++; continue; }
            if (ch === quote) quote = null;
            continue;
          }
          if (tpl) {
            if (ch === '`' && tplDepth === 0) { tpl = false; continue; }
            if (ch === '$' && afterColon[i + 1] === '{') { tplDepth++; i++; continue; }
            if (ch === '}' && tplDepth > 0) { tplDepth--; continue; }
            continue;
          }
          if (ch === "'" || ch === '"') { quote = ch; continue; }
          if (ch === '`') { tpl = true; continue; }
          if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
          if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) { end = i; break; }
            depth--;
            continue;
          }
          if (ch === ',' && depth === 0) { end = i; break; }
        }
        return afterColon.slice(0, end).trim();
      }

      function extractTypes(file) {
        const rel = path.relative(serverDir, file);
        const src = fs.readFileSync(file, 'utf8');
        const callRe = /send(?:Bulk)?Notification\(/g;
        let m;
        while ((m = callRe.exec(src)) !== null) {
          // webpush.sendNotification is the web-push library, not the
          // notification service; it carries no notification type.
          if (src.slice(Math.max(0, m.index - 8), m.index) === 'webpush.') continue;
          const windowText = src.slice(m.index, m.index + 1200);
          const typeMatch = /\btype\b\s*([:,])/.exec(windowText);
          if (!typeMatch) { spreads.push(rel); continue; }
          if (typeMatch[1] === ',') { variables.push({ file: rel, name: 'type' }); continue; }
          const expr = extractTypeValue(windowText.slice(typeMatch.index + typeMatch[0].length));
          if (expr.startsWith('`')) {
            const t = expr.match(/^`([^`$]*)\$\{/);
            if (t) {
              if (!prefixes.has(t[1])) prefixes.set(t[1], []);
              prefixes.get(t[1]).push(rel);
              continue;
            }
          }
          const ternary = expr.match(/\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/);
          if (ternary) {
            for (const t of [ternary[1], ternary[2]]) {
              if (!concrete.has(t)) concrete.set(t, []);
              concrete.get(t).push(rel);
            }
            continue;
          }
          const lit = expr.match(/^['"]([^'"]+)['"]/);
          if (lit) {
            const after = expr.slice(lit[0].length).trim();
            if (after.startsWith('+')) {
              if (!prefixes.has(lit[1])) prefixes.set(lit[1], []);
              prefixes.get(lit[1]).push(rel);
            } else {
              if (!concrete.has(lit[1])) concrete.set(lit[1], []);
              concrete.get(lit[1]).push(rel);
            }
            continue;
          }
          const v = expr.match(/^([A-Za-z_$][A-Za-z0-9_$.]*)/);
          if (v) { variables.push({ file: rel, name: v[1] }); continue; }
          unknown.push(`${rel}: ${expr.slice(0, 80)}`);
        }
      }

      walk(serverDir);

      // 1. Every concrete type from a call site is cataloged.
      const missing = [...concrete.keys()].filter((t) => !catalog.has(t));
      expect(missing).toEqual([]);

      // 2. Every prefix family is classified and its expansions are
      // cataloged. An unlisted prefix means a new dynamic family.
      const unclassifiedPrefixes = [...prefixes.keys()].filter((p) => !(p in TEMPLATE_FAMILIES));
      expect(unclassifiedPrefixes).toEqual([]);
      for (const [prefix, expansions] of Object.entries(TEMPLATE_FAMILIES)) {
        if (!prefixes.has(prefix)) continue;
        const missingExpansions = expansions.filter((t) => !catalog.has(t));
        expect(missingExpansions).toEqual([]);
      }

      // 3. Every variable-driven site is classified and its expansions
      // are cataloged.
      const unclassifiedVariables = variables.filter(
        ({ file, name }) => !VARIABLE_SITES.some((s) => s.file === file && s.name === name)
      );
      expect(unclassifiedVariables).toEqual([]);
      for (const site of VARIABLE_SITES) {
        const missingExpansions = site.expansions.filter((t) => !catalog.has(t));
        expect(missingExpansions).toEqual([]);
      }

      // 4. Every spread site is classified and its expansions are
      // cataloged.
      const spreadFiles = [...new Set(spreads)];
      const unclassifiedSpreads = spreadFiles.filter(
        (file) => !SPREAD_SITES.some((s) => s.file === file)
      );
      expect(unclassifiedSpreads).toEqual([]);
      for (const site of SPREAD_SITES) {
        const missingExpansions = site.expansions.filter((t) => !catalog.has(t));
        expect(missingExpansions).toEqual([]);
      }

      // 5. No site escaped classification entirely.
      expect(unknown).toEqual([]);

      // 6. Catalog hygiene (kept from the old length assertion, which
      // this diff test replaces): no duplicates, known groups.
      const seen = new Set();
      for (const entry of NOTIFICATION_TYPES) {
        expect(NOTIFICATION_TYPE_GROUPS).toContain(entry.group);
        expect(seen.has(entry.type)).toBe(false);
        seen.add(entry.type);
      }
      for (const t of ['bid_received', 'new_message', 'media_creator_update', 'weekly_summary', 'safety_sos']) {
        expect(seen.has(t)).toBe(true);
      }
    });
  });

  describe('item 33 — in_app_media_creator_update is real', () => {
    test('whitelist accepts the toggle and the queue gate honours it', async () => {
      const user = await makeUser();
      const { res, err } = await call(
        notifCtrl.updatePreferences,
        mockReq({ user: { id: user.id }, body: { in_app_media_creator_update: false } })
      );
      expect(err).toBeNull();
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query(
        'SELECT in_app_media_creator_update FROM notification_preferences WHERE user_id = $1', [user.id]
      );
      expect(rows[0].in_app_media_creator_update).toBe(false);

      const blocked = await queueCreatorNotification(pool, {
        userId: user.id, event: 'published', referenceId: 'ref-1',
      });
      expect(blocked).toBeNull();

      await setPrefs(user.id, { in_app_media_creator_update: true });
      const queued = await queueCreatorNotification(pool, {
        userId: user.id, event: 'published', referenceId: 'ref-2',
      });
      expect(queued).not.toBeNull();
      expect(queued.type).toBe('media_creator_update');
      notificationIds.push(queued.id);
    });
  });

  describe('item 52 — sms_support_replies is settable and honoured', () => {
    test('whitelist accepts the toggle and sendSMSIfOptedIn honours it', async () => {
      const user = await makeUser({ phone: '+15551234567' });
      const { res, err } = await call(
        notifCtrl.updatePreferences,
        mockReq({ user: { id: user.id }, body: { sms_support_replies: false } })
      );
      expect(err).toBeNull();
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query(
        'SELECT sms_support_replies FROM notification_preferences WHERE user_id = $1', [user.id]
      );
      expect(rows[0].sms_support_replies).toBe(false);

      const blocked = await sendSMSIfOptedIn(user.id, 'Your request was updated.', 'support_replies');
      expect(blocked).toBe(false);

      await setPrefs(user.id, { sms_support_replies: true });
      const allowed = await sendSMSIfOptedIn(user.id, 'Your request was updated.', 'support_replies');
      expect(allowed).toBe(true);
    });
  });

  describe('item 14 — calendar quiet hours unify on the enabled flag', () => {
    async function makeDueReminder(userId, helperId, startHours = 2) {
      const { rows: appts } = await pool.query(
        `INSERT INTO appointments (customer_id, helper_id, service_description, scheduled_start_time, scheduled_end_time, status)
         VALUES ($1, $2, 'Test service', NOW() + ($3 || ' hours')::interval, NOW() + (($3::int + 1) || ' hours')::interval, 'confirmed')
         RETURNING id`,
        [userId, helperId, startHours]
      );
      const appointmentId = appts[0].id;
      appointmentIds.push(appointmentId);
      const { rows: notifs } = await pool.query(
        `INSERT INTO calendar_notifications (user_id, appointment_id, notification_type, channel, scheduled_send_at, status)
         VALUES ($1, $2, 'reminder_2h', 'in_app', NOW() - INTERVAL '1 minute', 'pending')
         RETURNING id`,
        [userId, appointmentId]
      );
      return notifs[0].id;
    }

    test('times set but enabled=false sends; enabled=true defers until the window ends', async () => {
      const customer = await makeUser();
      const helper = await makeUser();
      const { start, end } = quietWindowNow();
      await setPrefs(customer.id, {
        quiet_hours_enabled: false, quiet_hours_start: start, quiet_hours_end: end, timezone: 'UTC',
      });
      const idOff = await makeDueReminder(customer.id, helper.id);
      await calCtrl.processReminderNotifications();
      const { rows: offRows } = await pool.query(
        'SELECT status FROM calendar_notifications WHERE id = $1', [idOff]
      );
      expect(offRows[0].status).toBe('sent');

      await setPrefs(customer.id, { quiet_hours_enabled: true });
      const idOn = await makeDueReminder(customer.id, helper.id, 5);
      await calCtrl.processReminderNotifications();
      const { rows: onRows } = await pool.query(
        'SELECT status FROM calendar_notifications WHERE id = $1', [idOn]
      );
      expect(onRows[0].status).toBe('pending');
    });
  });
});
