'use strict';

// Phase 7 (gap 19): scheduled report delivery.
//
// Reuses the existing report functions — never a custom report
// builder: the sales close (computeDailyClose), labor (computeLabor)
// and exceptions (computeExceptions). Delivery is in-app notification
// and/or email to the schedule's recipients.
//
// The daily close is RE-COMPUTABLE, not locked (verified 2026-11-06:
// computeDailyClose aggregates live order data on every call and no
// close row is ever written). Every delivered report is therefore
// stamped with its as-of time and states plainly that it is a
// snapshot, not a locked close — in the payload, in the notification
// body, and in the deliveries ledger (snapshot=true,
// locked_close=false).
//
// No duplicate sends: the deliveries table has a UNIQUE
// (scheduled_report_id, business_date) key and the job inserts with
// ON CONFLICT DO NOTHING. A second run for the same business day
// replays instead of re-sending. Each schedule is isolated: one
// failing schedule never blocks the others.

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
const { sendEmail } = require('../utils/email');
const { computeLabor, computeExceptions } = require('./restaurantPayrollService');
const reportsController = require('../controllers/restaurantReportsController');

const REPORT_TYPES = ['daily_close', 'labor', 'exceptions'];
const FREQUENCIES = ['daily', 'weekly'];
const CHANNELS = ['in_app', 'email', 'both'];

function localDateString(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function shiftDateString(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseRecipients(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const users = [];
  const emails = [];
  for (const entry of list) {
    if (entry && typeof entry.user_id === 'string' && entry.user_id) users.push(entry.user_id);
    if (entry && typeof entry.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) {
      emails.push(entry.email);
    }
  }
  return { users, emails };
}

function validateScheduleInput(body = {}) {
  if (!REPORT_TYPES.includes(body.reportType)) throw Object.assign(new Error('Unknown report type'), { status: 400, code: 'validation_failed' });
  if (body.frequency != null && !FREQUENCIES.includes(body.frequency)) throw Object.assign(new Error('Unknown frequency'), { status: 400, code: 'validation_failed' });
  if (body.deliveryChannel != null && !CHANNELS.includes(body.deliveryChannel)) throw Object.assign(new Error('Unknown delivery channel'), { status: 400, code: 'validation_failed' });
  const { users, emails } = parseRecipients(body.recipients);
  const channel = body.deliveryChannel || 'in_app';
  if ((channel === 'in_app' || channel === 'both') && users.length === 0) {
    throw Object.assign(new Error('In-app delivery needs at least one recipient user'), { status: 400, code: 'validation_failed' });
  }
  if ((channel === 'email' || channel === 'both') && emails.length === 0) {
    throw Object.assign(new Error('Email delivery needs at least one recipient email'), { status: 400, code: 'validation_failed' });
  }
  return {
    reportType: body.reportType,
    frequency: body.frequency || 'daily',
    deliveryChannel: channel,
    recipients: body.recipients,
    locationId: body.locationId == null ? null : Number(body.locationId),
  };
}

function summarizeReport(reportType, report) {
  if (reportType === 'daily_close') {
    const totals = (report.brand_totals || []).map((b) => `${b.currency} ${((b.totals?.revenue_cents || 0) / 100).toFixed(2)}`).join(', ');
    return `Sales close for ${report.business_date}: revenue ${totals || 'none'}.`;
  }
  if (reportType === 'labor') {
    return `Labor ${report.from_date} to ${report.to_date}: ${report.total_hours || 0} hours, labor cost ${report.currency || ''} ${((report.labor_cost_cents || 0) / 100).toFixed(2)} (${report.labor_percent ?? 'n/a'}% of sales).`;
  }
  const flagged = (report.employees || []).filter((e) => (e.voids || 0) + (e.refunds || 0) + (e.missing_punches || 0) + (e.waived_breaks || 0) > 0).length;
  return `Exceptions ${report.from_date} to ${report.to_date}: ${flagged} staff member(s) with flags.`;
}

async function buildScheduledReport(db, { restaurant, schedule, businessDate, asOf = new Date() } = {}) {
  const locationIds = schedule.location_id == null ? null : [Number(schedule.location_id)];
  const fromDate = schedule.frequency === 'weekly' ? shiftDateString(businessDate, -6) : businessDate;
  const toDate = businessDate;
  let report;
  if (schedule.report_type === 'daily_close') {
    report = await reportsController._computeDailyClose(restaurant.id, restaurant, { date: businessDate });
  } else if (schedule.report_type === 'labor') {
    report = await computeLabor({ restaurant, fromDate, toDate, locationIds });
  } else {
    report = await computeExceptions({ restaurant, fromDate, toDate, locationIds });
  }
  return {
    scheduled_report_id: Number(schedule.id),
    restaurant_id: Number(schedule.restaurant_id),
    report_type: schedule.report_type,
    frequency: schedule.frequency,
    business_date: businessDate,
    from_date: fromDate,
    to_date: toDate,
    // Snapshot stamp: re-computable data as of this instant, never a
    // locked close (see the header note).
    as_of: asOf.toISOString(),
    snapshot: true,
    locked_close: false,
    timezone: report.timezone || restaurant.timezone || 'UTC',
    summary: summarizeReport(schedule.report_type, report),
    report,
  };
}

async function deliverScheduledReport(db, { schedule, payload } = {}) {
  const { users, emails } = parseRecipients(schedule.recipients);
  const channel = schedule.delivery_channel;
  let recipientCount = 0;
  if (channel === 'in_app' || channel === 'both') {
    for (const userId of users) {
      await sendNotification({
        userId,
        type: 'restaurant_scheduled_report',
        title: `Scheduled report: ${payload.report_type} (${payload.business_date})`,
        body: `${payload.summary} Snapshot as of ${payload.as_of}; not a locked close.`,
        data: {
          scheduled_report_id: payload.scheduled_report_id,
          report_type: payload.report_type,
          business_date: payload.business_date,
          as_of: payload.as_of,
          snapshot: true,
          locked_close: false,
        },
        action_url: '/restaurants/merchant?tab=reports',
        idempotencyKey: `scheduled-report:${schedule.id}:${payload.business_date}:${userId}`,
      });
      recipientCount += 1;
    }
  }
  if (channel === 'email' || channel === 'both') {
    for (const email of emails) {
      await sendEmail({
        to: email,
        subject: `Scheduled report: ${payload.report_type} (${payload.business_date})`,
        text: `${payload.summary}\nSnapshot as of ${payload.as_of}; not a locked close.`,
        idempotencyKey: `scheduled-report:${schedule.id}:${payload.business_date}:${email}`,
      });
      recipientCount += 1;
    }
  }
  return recipientCount;
}

// Run every due schedule once. `now` is injectable for tests. The
// business date is yesterday in the restaurant's own timezone: the
// report covers a finished day, never a day still in service.
async function runDueScheduledReports(db = pool, { now = new Date() } = {}) {
  const { rows: schedules } = await db.query(
    `SELECT sr.*, r.business_id, r.timezone, r.currency_code
       FROM restaurant_scheduled_reports sr
       JOIN food_restaurants r ON r.id = sr.restaurant_id
      WHERE sr.enabled = TRUE
      ORDER BY sr.id`
  );
  const result = { due: 0, sent: 0, skipped: 0, failed: 0, errors: [] };
  for (const schedule of schedules) {
    const timezone = schedule.timezone || 'UTC';
    let businessDate;
    try {
      businessDate = shiftDateString(localDateString(now, timezone), -1);
    } catch {
      businessDate = shiftDateString(new Date().toISOString().slice(0, 10), -1);
    }
    const lastRun = schedule.last_business_date ? String(schedule.last_business_date).slice(0, 10) : null;
    const isDue = schedule.frequency === 'weekly'
      ? (lastRun == null || lastRun <= shiftDateString(businessDate, -7))
      : (lastRun == null || lastRun < businessDate);
    if (!isDue) continue;
    result.due += 1;
    try {
      const restaurant = {
        id: Number(schedule.restaurant_id),
        business_id: Number(schedule.business_id),
        timezone,
        currency_code: schedule.currency_code,
      };
      const asOf = new Date(now);
      const payload = await buildScheduledReport(db, { restaurant, schedule, businessDate, asOf });
      // The ledger insert is the dedupe: a second run for the same
      // business day inserts nothing and sends nothing.
      const { rows: [delivery] } = await db.query(
        `INSERT INTO restaurant_scheduled_report_deliveries
           (scheduled_report_id, business_date, report_type, as_of,
            snapshot, locked_close, channel, status, recipient_count)
         VALUES ($1, $2::date, $3, $4, TRUE, FALSE, $5, 'sent', 0)
         ON CONFLICT (scheduled_report_id, business_date) DO NOTHING
         RETURNING *`,
        [schedule.id, businessDate, schedule.report_type, asOf.toISOString(), schedule.delivery_channel]
      );
      if (!delivery) {
        result.skipped += 1;
        continue;
      }
      const recipientCount = await deliverScheduledReport(db, { schedule, payload });
      await db.query(
        `UPDATE restaurant_scheduled_report_deliveries
            SET recipient_count = $1 WHERE id = $2`,
        [recipientCount, delivery.id]
      );
      await db.query(
        `UPDATE restaurant_scheduled_reports
            SET last_run_at = NOW(), last_business_date = $2::date, updated_at = NOW()
          WHERE id = $1`,
        [schedule.id, businessDate]
      );
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push({ schedule_id: Number(schedule.id), error: err.message });
      logger.error('Scheduled restaurant report failed', { scheduleId: schedule.id, error: err.message });
      try {
        await db.query(
          `INSERT INTO restaurant_scheduled_report_deliveries
             (scheduled_report_id, business_date, report_type, as_of,
              snapshot, locked_close, channel, status, recipient_count, error)
           VALUES ($1, $2::date, $3, $4, TRUE, FALSE, $5, 'failed', 0, $6)
           ON CONFLICT (scheduled_report_id, business_date) DO NOTHING`,
          [schedule.id, businessDate, schedule.report_type, new Date(now).toISOString(), schedule.delivery_channel, String(err.message).slice(0, 1000)]
        );
      } catch { /* the failure ledger is best-effort; the error above is the record */ }
    }
  }
  return result;
}

module.exports = {
  REPORT_TYPES,
  FREQUENCIES,
  CHANNELS,
  validateScheduleInput,
  parseRecipients,
  summarizeReport,
  buildScheduledReport,
  deliverScheduledReport,
  runDueScheduledReports,
  localDateString,
  shiftDateString,
};
