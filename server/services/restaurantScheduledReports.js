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
// (scheduled_report_id, business_date) key. The send loop claims the
// row first (status 'pending'), then marks it 'sent' only after
// delivery succeeds or 'failed' on error — a delivery that throws
// mid-send is never recorded 'sent', and a failed date stays due
// (last_business_date advances only on success) so the next run
// retries it. A second run for the same business day replays instead
// of re-sending. Each schedule is isolated: one failing schedule
// never blocks the others.

const PENDING_STALE_MINUTES = 60;

const pool = require('../db');
const logger = require('../utils/logger');
const { formatMinorUnits } = require('../utils/currencyPrecision');
const { sendNotification } = require('./notificationService');
const { sendEmail } = require('../utils/email');
const { computeLabor, computeExceptions } = require('./restaurantPayrollService');
const reportsController = require('../controllers/restaurantReportsController');
const brandService = require('./restaurantBrandService');
const franchiseReportService = require('./restaurantFranchiseReportService');
const fx = require('./restaurantFxService');

const REPORT_TYPES = ['daily_close', 'labor', 'exceptions', 'hq_digest', 'franchise_digest'];
const DIGEST_TYPES = ['hq_digest', 'franchise_digest'];
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
  // Phase 8 Track D/E: HQ and franchise digests are brand-scoped;
  // the anchor restaurant must belong to the brand (checked at
  // creation in the controller, re-checked at build time).
  let brandId = null;
  if (DIGEST_TYPES.includes(body.reportType)) {
    brandId = Number(body.brandId ?? body.brand_id);
    if (!Number.isSafeInteger(brandId) || brandId <= 0) {
      throw Object.assign(new Error('A brand is required for HQ and franchise digests'), { status: 400, code: 'validation_failed' });
    }
  }
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
    brandId,
  };
}

function summarizeReport(reportType, report) {
  if (reportType === 'daily_close') {
    // Finding 22: minor units format in their own currency's
    // precision (JPY has no decimals, BHD has three), never / 100.
    const totals = (report.brand_totals || []).map((b) => formatMinorUnits(b.totals?.revenue_cents || 0, b.currency)).join(', ');
    return `Sales close for ${report.business_date}: revenue ${totals || 'none'}.`;
  }
  if (reportType === 'labor') {
    return `Labor ${report.from_date} to ${report.to_date}: ${report.total_hours || 0} hours, labor cost ${formatMinorUnits(report.labor_cost_cents || 0, report.currency)} (${report.labor_percent ?? 'n/a'}% of sales).`;
  }
  if (reportType === 'hq_digest') {
    const converted = report.converted?.convertedTotalCents;
    const native = (report.totals || []).map((t) => formatMinorUnits(t.netCollectedCents || 0, t.currencyCode)).join(', ');
    return `HQ digest ${report.from} to ${report.to}: ${report.storeCount || 0} stores, sales ${native || 'none'}${converted == null ? '' : `, converted ${formatMinorUnits(converted, report.converted.reportingCurrency)}`}.`;
  }
  if (reportType === 'franchise_digest') {
    const converted = report.totals?.salesConvertedCents;
    return `Franchise digest ${report.from} to ${report.to}: ${report.stores?.length || 0} stores${converted == null ? '' : `, sales converted ${formatMinorUnits(converted, report.reportingCurrency)}`}.`;
  }
  const flagged = (report.employees || []).filter((e) => (e.voids || 0) + (e.refunds || 0) + (e.missing_punches || 0) + (e.waived_breaks || 0) > 0).length;
  return `Exceptions ${report.from_date} to ${report.to_date}: ${flagged} staff member(s) with flags.`;
}

// Phase 8 Track D/E: the digest builders. Both reuse the live
// rollup/report services — never a custom report builder — and both
// stamp the same snapshot (never a locked close) as every other
// scheduled report.
async function buildHqDigest(db, { schedule, fromDate, toDate }) {
  const brandId = Number(schedule.brand_id);
  const comparison = await brandService.getStoreComparison(db, {
    brandId,
    from: `${fromDate}T00:00:00.000Z`,
    to: `${toDate}T00:00:00.000Z`,
  });
  const restaurants = await brandService.listBrandRestaurants(db, brandId);
  const policy = await fx.getFxPolicy(db, { brandId });
  const rateDate = fx.resolveRateDate(policy, toDate);
  const converted = await fx.convertBreakdown(db, {
    entries: (comparison.totals || []).map((entry) => ({
      currencyCode: entry.currencyCode,
      amountCents: Number(entry.netCollectedCents || 0),
    })),
    reportingCurrency: policy.reportingCurrency,
    rateDate,
    rateSource: policy.rateSource,
  });
  return {
    ...comparison,
    converted: { ...converted, isDefaultPolicy: policy.isDefault },
    restaurantNames: restaurants.map((row) => ({ id: Number(row.id), displayName: row.display_name })),
  };
}

async function buildFranchiseDigest(db, { schedule, fromDate, toDate }) {
  const brandId = Number(schedule.brand_id);
  const restaurants = await brandService.listBrandRestaurants(db, brandId);
  return franchiseReportService.getFranchiseReport(db, {
    brandId,
    accessibleRestaurantIds: restaurants.map((row) => Number(row.id)),
    from: fromDate,
    to: toDate,
  });
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
  } else if (schedule.report_type === 'hq_digest') {
    // The anchor restaurant must belong to the digest's brand; a
    // brand move after creation fails the digest instead of
    // reporting on a brand the anchor left.
    const restaurants = await brandService.listBrandRestaurants(db, Number(schedule.brand_id));
    if (!restaurants.some((row) => Number(row.id) === Number(restaurant.id))) {
      throw new Error('The anchor restaurant no longer belongs to this digest brand');
    }
    report = await buildHqDigest(db, { schedule, fromDate, toDate });
  } else if (schedule.report_type === 'franchise_digest') {
    const restaurants = await brandService.listBrandRestaurants(db, Number(schedule.brand_id));
    if (!restaurants.some((row) => Number(row.id) === Number(restaurant.id))) {
      throw new Error('The anchor restaurant no longer belongs to this digest brand');
    }
    report = await buildFranchiseDigest(db, { schedule, fromDate, toDate });
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
  // Background-jobs audit #41: both senders signal failure by return
  // value, not by throwing (sendNotification returns {success:false}
  // on any error; sendEmail returns {success:false} on an unconfigured
  // provider, a Resend rejection, or an exception). Counting a send
  // as delivered merely because it did not throw marked Resend-down
  // days 'sent' with a full recipient_count, and the next run skipped
  // them. Only a send whose result is not {success:false} counts;
  // a result of {success:false} is a failed recipient. Callers must
  // treat any failed recipient as a failed delivery (retryable), not
  // a partial success: the retry re-sends, and the idempotency keys
  // below dedupe the recipients who already received it.
  let delivered = 0;
  let failed = 0;
  const errors = [];
  if (channel === 'in_app' || channel === 'both') {
    for (const userId of users) {
      const result = await sendNotification({
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
      if (result?.success === false) {
        failed += 1;
        errors.push({ recipient: userId, channel: 'in_app', error: result?.error || 'Notification delivery failed' });
      } else {
        delivered += 1;
      }
    }
  }
  if (channel === 'email' || channel === 'both') {
    for (const email of emails) {
      const result = await sendEmail({
        to: email,
        subject: `Scheduled report: ${payload.report_type} (${payload.business_date})`,
        text: `${payload.summary}\nSnapshot as of ${payload.as_of}; not a locked close.`,
        idempotencyKey: `scheduled-report:${schedule.id}:${payload.business_date}:${email}`,
      });
      if (result?.success === false) {
        failed += 1;
        errors.push({ recipient: email, channel: 'email', error: result?.error || 'Email delivery failed' });
      } else {
        delivered += 1;
      }
    }
  }
  return { delivered, failed, errors };
}

// Claim the delivery row for one schedule and business date, so the
// send loop can record the outcome on the claimed row instead of
// inserting a second row (the old code inserted 'sent' before
// delivery, and the failure insert hit the same ON CONFLICT DO
// NOTHING dedupe key, so a partial failure was recorded as sent and
// never retried).
//
// Returns { delivery, outcome }:
//   - 'claimed' / 'reclaimed' / 'reclaimed_stale': the caller owns
//     the row (status 'pending') and must mark it 'sent' or 'failed'.
//   - 'already_sent': the date was delivered; the caller must skip it.
//   - 'in_progress' / 'skipped': another run owns the date, or the
//     claim lost a race; the caller must not send.
// A 'failed' row is re-claimed so the date is retried. A 'pending'
// row older than PENDING_STALE_MINUTES is a crashed run and is
// re-claimed too, so a crash between claim and outcome cannot lose
// the date forever; a fresh 'pending' row means a live run owns it.
async function claimScheduledReportDelivery(db, { schedule, businessDate, asOf, now = new Date() } = {}) {
  const { rows: [claimed] } = await db.query(
    `INSERT INTO restaurant_scheduled_report_deliveries
       (scheduled_report_id, business_date, report_type, as_of,
        snapshot, locked_close, channel, status, recipient_count)
     VALUES ($1, $2::date, $3, $4, TRUE, FALSE, $5, 'pending', 0)
     ON CONFLICT (scheduled_report_id, business_date) DO NOTHING
     RETURNING *`,
    [schedule.id, businessDate, schedule.report_type, asOf.toISOString(), schedule.delivery_channel]
  );
  if (claimed) return { delivery: claimed, outcome: 'claimed' };

  const { rows: [existing] } = await db.query(
    `SELECT * FROM restaurant_scheduled_report_deliveries
      WHERE scheduled_report_id = $1 AND business_date = $2::date`,
    [schedule.id, businessDate]
  );
  // No row despite the conflict: the row vanished under us (or the
  // mock has no row). Never send without a claim.
  if (!existing) return { delivery: null, outcome: 'skipped' };
  if (existing.status === 'sent') return { delivery: null, outcome: 'already_sent' };
  if (existing.status === 'failed' || existing.status === 'pending') {
    if (existing.status === 'pending') {
      const claimedAt = existing.created_at ? new Date(existing.created_at).getTime() : NaN;
      const stale = Number.isNaN(claimedAt)
        || new Date(now).getTime() - claimedAt > PENDING_STALE_MINUTES * 60 * 1000;
      if (!stale) return { delivery: null, outcome: 'in_progress' };
    }
    const { rows: [reclaimed] } = await db.query(
      `UPDATE restaurant_scheduled_report_deliveries
          SET status = 'pending', error = NULL
        WHERE id = $1 AND status = $2
        RETURNING *`,
      [existing.id, existing.status]
    );
    if (reclaimed) return { delivery: reclaimed, outcome: existing.status === 'failed' ? 'reclaimed' : 'reclaimed_stale' };
    return { delivery: null, outcome: 'skipped' };
  }
  return { delivery: null, outcome: 'skipped' };
}

async function markDeliverySent(db, { deliveryId, recipientCount }) {
  await db.query(
    `UPDATE restaurant_scheduled_report_deliveries
        SET status = 'sent', recipient_count = $1 WHERE id = $2`,
    [recipientCount, deliveryId]
  );
}

async function markDeliveryFailed(db, { deliveryId, error, recipientCount = null }) {
  await db.query(
    `UPDATE restaurant_scheduled_report_deliveries
        SET status = 'failed', error = $1,
            recipient_count = COALESCE($3, recipient_count) WHERE id = $2`,
    [String(error == null ? '' : error).slice(0, 1000), deliveryId, recipientCount]
  );
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
    let delivery = null;
    try {
      const restaurant = {
        id: Number(schedule.restaurant_id),
        business_id: Number(schedule.business_id),
        timezone,
        currency_code: schedule.currency_code,
      };
      const asOf = new Date(now);
      // Claim first: the row is 'pending' until delivery succeeds.
      // A 'sent' row skips, a 'failed' row is re-claimed and retried.
      const claim = await claimScheduledReportDelivery(db, { schedule, businessDate, asOf, now });
      if (!claim.delivery) {
        result.skipped += 1;
        continue;
      }
      delivery = claim.delivery;
      const payload = await buildScheduledReport(db, { restaurant, schedule, businessDate, asOf });
      const outcome = await deliverScheduledReport(db, { schedule, payload });
      // Background-jobs audit #41: a {success:false} recipient is a
      // failed delivery, not a partial success. Throw so the catch
      // below marks the claimed row 'failed' (keeping the delivered
      // count) and the date stays due for retry; the retry dedupes
      // recipients who already received it via the idempotency keys.
      if (outcome.failed > 0) {
        const err = new Error(
          `Scheduled report delivery failed for ${outcome.failed} of ${outcome.delivered + outcome.failed} recipient(s): ${outcome.errors.map((e) => e.error).join('; ')}`
        );
        err.deliveryRecipientCount = outcome.delivered;
        throw err;
      }
      await markDeliverySent(db, { deliveryId: delivery.id, recipientCount: outcome.delivered });
      // last_business_date advances only on success: a failed date
      // stays due and is retried on the next run.
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
      // Record the failure on the claimed row (no second INSERT: the
      // dedupe key already belongs to the claim). If the claim itself
      // threw there is no row to mark; last_business_date is untouched
      // either way, so the date stays due and the next run retries.
      if (delivery) {
        try {
          await markDeliveryFailed(db, { deliveryId: delivery.id, error: err.message, recipientCount: err.deliveryRecipientCount ?? null });
        } catch { /* the failure ledger is best-effort; the error above is the record */ }
      }
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
  claimScheduledReportDelivery,
  markDeliverySent,
  markDeliveryFailed,
  PENDING_STALE_MINUTES,
  runDueScheduledReports,
  localDateString,
  shiftDateString,
};
