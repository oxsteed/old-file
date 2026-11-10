'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const escapeHtml = require('../utils/escapeHtml');
const { renderOxSteedEmail } = require('../utils/emailTemplate');
const { maskEmail } = require('../utils/directQuote');
const { withFencedJobLock } = require('./jobLockingService');

// Oct 30 item 29 / audit #49: the direct starter runs two sweeps on one
// 5-minute interval, the second accruing franchise royalties per
// completed visit. A pass slower than 5 minutes used to overlap itself
// and a second API replica ran it concurrently. The starter below holds
// one fenced lock across both sweeps (plus the in-process running flag),
// and completeFinishedDirectVisits works in bounded batches of 200.
const JOB_NAME = 'direct-calendar-reminders';
const COMPLETED_VISITS_BATCH_LIMIT = 200;

function reminderTypeFor(startAt) {
  const hoursUntil = (new Date(startAt).getTime() - Date.now()) / (60 * 60 * 1000);
  if (hoursUntil >= 23 && hoursUntil < 25) return '24_hour';
  if (hoursUntil >= 1 && hoursUntil < 3) return '2_hour';
  return null;
}

async function claimDelivery(requestId, reminderType, recipientEmail) {
  const { rows } = await db.query(
    `INSERT INTO direct_calendar_reminder_deliveries
       (request_id, reminder_type, recipient_email, status, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, 'processing', 1, NOW(), NOW())
     ON CONFLICT (request_id, reminder_type, recipient_email) DO UPDATE SET
       status = 'processing',
       attempts = direct_calendar_reminder_deliveries.attempts + 1,
       last_error = NULL,
       updated_at = NOW()
     WHERE direct_calendar_reminder_deliveries.status <> 'sent'
       AND direct_calendar_reminder_deliveries.attempts < 3
       AND direct_calendar_reminder_deliveries.updated_at < NOW() - INTERVAL '10 minutes'
     RETURNING id`,
    [requestId, reminderType, recipientEmail]
  );
  return rows[0]?.id || null;
}

async function processDirectCalendarReminders() {
  const { rows: requests } = await db.query(
    `SELECT quote_requests.id, quote_requests.first_name, quote_requests.email,
            quote_requests.service_category, quote_requests.service_location,
            quote_requests.scheduled_start_at,
            assignee.email AS assignee_email
       FROM quote_requests
       LEFT JOIN users assignee ON assignee.id = quote_requests.assigned_to
      WHERE COALESCE(quote_requests.metadata->>'flow', 'direct') = 'direct'
        AND quote_requests.status NOT IN ('cancelled', 'closed', 'completed')
        AND quote_requests.scheduled_start_at >= NOW() + INTERVAL '1 hour'
        AND quote_requests.scheduled_start_at < NOW() + INTERVAL '25 hours'
        AND quote_requests.email IS NOT NULL
      ORDER BY quote_requests.scheduled_start_at ASC
      LIMIT 200`
  );
  let sent = 0;
  let failed = 0;
  for (const request of requests) {
    const reminderType = reminderTypeFor(request.scheduled_start_at);
    if (!reminderType) continue;
    const recipients = Array.from(new Set([request.email, request.assignee_email].filter(Boolean).map((email) => String(email).trim().toLowerCase())));
    for (const recipient of recipients) {
      const deliveryId = await claimDelivery(request.id, reminderType, recipient);
      if (!deliveryId) continue;
      try {
        const when = new Date(request.scheduled_start_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
        const lead = reminderType === '24_hour' ? 'tomorrow' : 'in about 2 hours';
        const safeService = escapeHtml(request.service_category || 'Direct service');
        const safeWhen = escapeHtml(when);
        const safeLocation = escapeHtml(request.service_location || 'On file');
        const safeRequestId = escapeHtml(request.id);
        const bodyText = `Your OxSteed Direct service is scheduled ${lead}.\nService: ${request.service_category || 'Direct service'}\nWhen: ${when}\nLocation: ${request.service_location || 'On file'}\nReference: #${request.id}`;
        const rendered = renderOxSteedEmail({
          language: 'en',
          eyebrow: 'OXSTEED DIRECT',
          title: 'Scheduled service reminder',
          intro: `Hi ${request.first_name || 'there'},`,
          bodyText,
          bodyHtml: `<p>Your OxSteed Direct service is scheduled ${lead}.</p><p><strong>Service:</strong> ${safeService}<br /><strong>When:</strong> ${safeWhen}<br /><strong>Location:</strong> ${safeLocation}</p><p>Reference: #${safeRequestId}</p>`,
          footerText: 'OxSteed - local trades marketplace',
        });
        // Review P3-844: sendEmail reports delivery failure as { success: false }
        // without throwing. Only mark 'sent' on a confirmed delivery; anything
        // else throws into the failure path below so the reminder is retried.
        const delivery = await sendEmail({
          to: recipient,
          subject: `OxSteed Direct reminder: ${request.service_category || 'scheduled service'}`,
          text: rendered.text,
          html: rendered.html,
          idempotencyKey: `direct-calendar-reminder:${request.id}:${reminderType}:${recipient}`,
        });
        if (delivery?.success !== true) {
          throw new Error(delivery?.error || 'email send failed');
        }
        await db.query('UPDATE direct_calendar_reminder_deliveries SET status = \'sent\', sent_at = NOW(), updated_at = NOW() WHERE id = $1', [deliveryId]);
        sent++;
      } catch (err) {
        failed++;
        await db.query('UPDATE direct_calendar_reminder_deliveries SET status = \'failed\', last_error = $2, updated_at = NOW() WHERE id = $1', [deliveryId, String(err.message || 'send failed').slice(0, 500)]);
        // Review P3-852: mask the recipient address in logs (PII).
        logger.error('Direct calendar reminder delivery failed', { requestId: request.id, recipient: maskEmail(recipient), error: err.message });
      }
    }
  }
  return { sent, failed };
}

// Review P1-183: paid, scheduled Direct visits used to sit in `scheduled`
// forever. Complete them once the visit window has ended.
// Review P2-9-F13: franchise royalties accrue on Direct bookings too, not
// just job completion. The sweep accrues per completed visit (idempotent);
// failures are non-fatal and logged.
// Audit #49: the completing UPDATE used to be unbounded (no LIMIT or
// ordering), so after an outage one tick completed thousands of stale
// visits in a single transaction and then accrued royalties serially per
// visit. It now completes in bounded batches of
// COMPLETED_VISITS_BATCH_LIMIT, oldest window first, looping until a
// batch comes back short. Completion itself stays idempotent (a second
// pass finds no `scheduled` rows); the bound limits latency and lease
// pressure, not double-completion. The caller (the starter) holds the
// fenced lock across the whole bounded run, so batches from one pass
// cannot interleave with another tick or replica.
async function completeFinishedDirectVisits() {
  let total = 0;
  for (;;) {
    const { rows } = await db.query(
      `WITH done AS (
         UPDATE quote_requests
            SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
          WHERE id IN (
            SELECT id
              FROM quote_requests
             WHERE COALESCE(metadata->>'flow', 'direct') = 'direct'
               AND status = 'scheduled'
               AND payment_status IN ('paid', 'confirmed')
               AND COALESCE(scheduled_end_at, scheduled_start_at) < NOW() - INTERVAL '1 hour'
             ORDER BY COALESCE(scheduled_end_at, scheduled_start_at) ASC, id ASC
             LIMIT ${COMPLETED_VISITS_BATCH_LIMIT}
          )
          RETURNING id, quote_amount_cents, service_city)
       INSERT INTO direct_request_events (quote_request_id, actor_role, event_type, title, details, payload)
       SELECT id, 'system', 'request_completed', 'Visit completed', 'The visit window ended and payment is settled.', '{}'::jsonb
         FROM done
       RETURNING quote_request_id`
    );
    const completedIds = rows.map((r) => r.quote_request_id);
    if (completedIds.length === 0) break;
    total += completedIds.length;
    try {
      const { rows: done } = await db.query(
        `SELECT id, quote_amount_cents, service_city
           FROM quote_requests
          WHERE id = ANY($1::bigint[])`,
        [completedIds]
      );
      const { accrueTerritoryRoyalty } = require('../services/franchiseRoyaltyService');
      for (const visit of done) {
        try {
          await accrueTerritoryRoyalty({
            client: db,
            amountCents: Number(visit.quote_amount_cents || 0),
            city: visit.service_city || null,
            region: null,
            sourceType: 'direct_booking',
            sourceId: String(visit.id),
            description: `Territory royalty — Direct booking #${visit.id}`,
          });
        } catch (royaltyErr) {
          logger.warn('Failed to accrue franchise royalty for Direct booking (non-fatal)', { error: royaltyErr.message, requestId: visit.id });
        }
      }
    } catch (err) {
      logger.error('Direct royalty accrual sweep failed (non-fatal)', { error: err.message });
    }
    if (completedIds.length < COMPLETED_VISITS_BATCH_LIMIT) break;
  }
  return total;
}

function startDirectCalendarReminderJob() {
  let stopped = false;
  let running = null;
  // Oct 30 item 29: one 5-minute interval used to fire both sweeps
  // concurrently with no guard and no lock, so a slow pass overlapped
  // itself and a second API replica ran it concurrently. Both sweeps now
  // run sequentially inside a single fenced lock (TTL matches the
  // 5-minute cadence; the renewal timer keeps it alive for a long pass),
  // and the running flag skips an overlapping tick in this process. The
  // lock is held across the whole bounded completeFinishedDirectVisits
  // run (#49), not per batch, so no second tick can interleave between
  // batches. Each sweep still logs its own failure without aborting the
  // other, as before.
  const tick = () => {
    if (stopped || running) return;
    running = withFencedJobLock(JOB_NAME, async () => {
      await processDirectCalendarReminders()
        .catch((err) => logger.error('Direct calendar reminder job failed', { error: err.message }));
      await completeFinishedDirectVisits()
        .catch((err) => logger.error('Direct auto-complete sweep failed', { error: err.message }));
    }, 300)
      .catch((err) => logger.error('Direct calendar reminder job failed', { error: err.message }))
      .finally(() => {
        running = null;
      });
  };
  const interval = setInterval(tick, 5 * 60 * 1000);
  interval.unref?.();
  logger.info('Direct calendar reminder job started');
  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      return running;
    },
  };
}

module.exports = { processDirectCalendarReminders, completeFinishedDirectVisits, startDirectCalendarReminderJob, JOB_NAME, COMPLETED_VISITS_BATCH_LIMIT };
