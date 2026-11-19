'use strict';

/**
 * Group 1, item 27: vehicle service reminders, derived from the fields the
 * customer already records (mileage, last oil-change mileage, last service
 * date). Advisory only: a reminder never books, charges, or changes
 * anything; it only tells the customer what is due.
 *
 * Intervals (conservative, standard shop guidance):
 * - Oil change: every 5,000 miles or 6 months, whichever comes first.
 * - General service: every 12 months from the last service date.
 *
 * Returns an array of:
 *   { kind: 'oil_change' | 'service',
 *     status: 'due' | 'due_soon',
 *     miles_remaining?: number, days_remaining?: number,
 *     miles_overdue?: number, days_overdue?: number }
 * Empty when the vehicle has no mileage/service data at all.
 */

const OIL_CHANGE_MILES = 5000;
const OIL_CHANGE_DAYS = 180;
const SERVICE_DAYS = 365;
const DUE_SOON_MILES = 500;
const DUE_SOON_DAYS = 30;

function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function vehicleServiceReminders(vehicle, now = new Date()) {
  if (!vehicle || typeof vehicle !== 'object') return [];
  const reminders = [];
  const mileage = Number(vehicle.mileage);
  const lastOilMile = Number(vehicle.last_oil_change_mile);
  const lastServiceDate = vehicle.last_service_date ? new Date(vehicle.last_service_date) : null;
  const hasMileage = Number.isFinite(mileage) && mileage > 0;
  const hasOilMile = Number.isFinite(lastOilMile) && lastOilMile >= 0;
  const hasServiceDate = lastServiceDate instanceof Date && !Number.isNaN(lastServiceDate.getTime());

  // Oil change: mileage signal and/or time signal.
  let oilMilesRemaining;
  let oilDaysRemaining;
  if (hasMileage && hasOilMile && mileage >= lastOilMile) {
    oilMilesRemaining = OIL_CHANGE_MILES - (mileage - lastOilMile);
  }
  if (hasServiceDate) {
    oilDaysRemaining = OIL_CHANGE_DAYS - daysBetween(lastServiceDate, now);
  }
  if (oilMilesRemaining !== undefined || oilDaysRemaining !== undefined) {
    // A mile and a day are different units; compare each against its own
    // due-soon threshold instead of mixing them.
    const due = (oilMilesRemaining !== undefined && oilMilesRemaining <= 0)
      || (oilDaysRemaining !== undefined && oilDaysRemaining <= 0);
    const dueSoon = !due && (
      (oilMilesRemaining !== undefined && oilMilesRemaining <= DUE_SOON_MILES)
      || (oilDaysRemaining !== undefined && oilDaysRemaining <= DUE_SOON_DAYS)
    );
    if (due || dueSoon) {
      const reminder = { kind: 'oil_change', status: due ? 'due' : 'due_soon' };
      if (oilMilesRemaining !== undefined) {
        if (due && oilMilesRemaining <= 0) reminder.miles_overdue = -oilMilesRemaining;
        else reminder.miles_remaining = oilMilesRemaining;
      }
      if (oilDaysRemaining !== undefined) {
        if (due && oilDaysRemaining <= 0) reminder.days_overdue = -oilDaysRemaining;
        else reminder.days_remaining = oilDaysRemaining;
      }
      reminders.push(reminder);
    }
  }

  // General service: time-based only.
  if (hasServiceDate) {
    const daysRemaining = SERVICE_DAYS - daysBetween(lastServiceDate, now);
    if (daysRemaining <= 0) {
      reminders.push({ kind: 'service', status: 'due', days_overdue: -daysRemaining });
    } else if (daysRemaining <= DUE_SOON_DAYS) {
      reminders.push({ kind: 'service', status: 'due_soon', days_remaining: daysRemaining });
    }
  }

  return reminders;
}

module.exports = { vehicleServiceReminders, OIL_CHANGE_MILES, OIL_CHANGE_DAYS, SERVICE_DAYS };
