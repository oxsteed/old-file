// server/jobs/vehicleServiceReminderNotices.js
// Group 1, item 27 (G1-B2): vehicle service reminders were display-only.
// server/services/vehicleServiceReminders.js derives due / due-soon from
// the mileage and service dates the customer already records, and the
// Car Care page renders that derivation when the customer opens it.
// This weekly sweeper reuses the derivation unchanged (D-31 intervals:
// oil 5,000 mi / 180 days, service 365 days, due-soon 500 mi / 30 days)
// and notifies each vehicle OWNER when a reminder is due or due-soon.
//
// Once-only per vehicle+occasion rides the notification delivery key
// (migration 555 partial unique index uq_notifications_delivery_key),
// following the checkpoint-7 pattern
// (`planned-need-reminder:<id>:<date>` in plannedNeedsScheduler.js
// Pass 1b). The occasion is (vehicle, kind, status, service anchors):
//   vehicle-service-reminder:<vehicleId>:<kind>:<status>
//     :<last_oil_change_mile>:<last_service_date|none>
// The anchors matter because the derivation is state-based, not
// event-based: a due vehicle stays due until it is serviced. Without
// them, a vehicle serviced and later due again would share the key
// with its first occasion and never re-notify. The anchors change
// exactly when the owner records service, so the next cycle is a fresh
// occasion; the status distinguishes the due-soon notice from the
// later due notice of the same cycle, and re-runs inside one occasion
// replay instead of duplicating.
//
// The sweep is advisory only: it never books, charges, or changes
// anything. It notifies in-app + push, like its planned_need_reminder
// sibling (not in the email allow-list in notificationService.js).
'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { sendNotification } = require('../services/notificationService');
const { vehicleServiceReminders } = require('../services/vehicleServiceReminders');

const JOB_NAME = 'vehicle-service-reminder-notices';
const CRON_EXPRESSION = '0 7 * * 1'; // Mondays 07:00 UTC (weekly; between the Monday 06:05 delivery report and the Monday 08:00 weekly summary)
const BATCH_SIZE = 500; // same cap as bidDeadlineNotices; one tick never scans unbounded rows

function vehicleLabel(vehicle) {
  if (vehicle.nickname) return String(vehicle.nickname);
  const parts = [vehicle.year, vehicle.make_name, vehicle.model_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'your vehicle';
}

function anchorDate(value) {
  if (!value) return 'none';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function deliveryKey(vehicle, reminder) {
  return [
    'vehicle-service-reminder',
    String(vehicle.id),
    reminder.kind,
    reminder.status,
    String(Number(vehicle.last_oil_change_mile) || 0),
    anchorDate(vehicle.last_service_date),
  ].join(':');
}

function inlineBody(label, reminder) {
  const service = reminder.kind === 'oil_change' ? 'an oil change' : 'a service';
  return reminder.status === 'due'
    ? `Your ${label} is due for ${service}. Open Car Care to review what is due.`
    : `Your ${label} is coming due for ${service} soon. Open Car Care to review what is due.`;
}

async function runVehicleServiceReminderJob(dbClient, now = new Date()) {
  const db = dbClient || pool;
  logger.info('Vehicle service reminder sweep started', { batchSize: BATCH_SIZE });

  // The WHERE clause is the derivation's own non-empty precondition
  // ("empty when the vehicle has no mileage/service data at all"), not
  // a second copy of the intervals: a vehicle with mileage > 0 can trip
  // the oil mileage signal, and one with a service date can trip the
  // oil time signal and the service signal. Only provably-empty rows
  // are skipped, so the cap is spent on vehicles that can remind.
  // Columns verified firsthand against the migrated schema
  // (user_vehicles: migration 057 + 299).
  const { rows: vehicles } = await db.query(
    `SELECT id, user_id, make_name, model_name, year, nickname,
            mileage, last_oil_change_mile, last_service_date
       FROM user_vehicles
      WHERE mileage > 0 OR last_service_date IS NOT NULL
      ORDER BY id ASC
      LIMIT $1`,
    [BATCH_SIZE],
  );

  let notified = 0;
  let failed = 0;
  for (const vehicle of vehicles) {
    const reminders = vehicleServiceReminders(vehicle, now);
    for (const reminder of reminders) {
      const label = vehicleLabel(vehicle);
      try {
        const result = await sendNotification({
          userId: vehicle.user_id,
          type: 'vehicle_service_reminder',
          title: 'Vehicle service reminder',
          body: inlineBody(label, reminder),
          data: {
            vehicle_id: vehicle.id,
            kind: reminder.kind,
            status: reminder.status,
            params: { vehicle: label },
          },
          action_url: '/car-care',
          idempotencyKey: deliveryKey(vehicle, reminder),
        });
        if (result && result.success) notified += 1;
        else {
          failed += 1;
          logger.warn('Vehicle service reminder not delivered', {
            vehicleId: vehicle.id, kind: reminder.kind, status: reminder.status,
            reason: result && result.reason ? result.reason : 'unknown',
          });
        }
      } catch (err) {
        failed += 1;
        logger.warn('Vehicle service reminder failed', {
          vehicleId: vehicle.id, kind: reminder.kind, status: reminder.status,
          error: err.message,
        });
      }
    }
  }

  const result = { checked: vehicles.length, notified, failed };
  if (notified > 0 || failed > 0) {
    logger.info('Vehicle service reminder sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startVehicleServiceReminderJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runVehicleServiceReminderJob();
    } catch (err) {
      logger.error('Vehicle service reminder notices cron error', { error: err.message });
    }
  });
  logger.info('Vehicle service reminder notices job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startVehicleServiceReminderJob,
  runVehicleServiceReminderJob,
  cronExpression: CRON_EXPRESSION,
  batchSize: BATCH_SIZE,
};
