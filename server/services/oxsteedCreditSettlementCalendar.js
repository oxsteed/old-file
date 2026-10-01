'use strict';

/**
 * Settlement calendar helpers (Phase 3: automated settlement cycle).
 *
 * Pure UTC-date functions used to derive settlement_date (the next business
 * day on or after a cycle's period_end). Weekends shift to Monday.
 *
 * NOTE on holidays: there is deliberately no holiday table yet. Public
 * holidays differ per settlement currency's jurisdiction and would need a
 * per-currency calendar source; add one here (e.g. a holidays table keyed
 * by currency_code + date) before promising true business-day settlement in
 * production. Until then the calendar is weekend-aware only, which is
 * documented on every surface that consumes it.
 */

function toUtcDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date for settlement calendar');
  return date;
}

function startOfUtcDay(value) {
  const date = toUtcDate(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * True when the UTC day is Saturday (6) or Sunday (0).
 */
function isWeekend(value) {
  const day = toUtcDate(value).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The same UTC calendar day when it is a weekday, otherwise the following
 * Monday. Time-of-day is preserved.
 */
function nextBusinessDay(value) {
  const date = toUtcDate(value);
  const day = date.getUTCDay();
  if (day === 6) date.setUTCDate(date.getUTCDate() + 2); // Saturday -> Monday
  else if (day === 0) date.setUTCDate(date.getUTCDate() + 1); // Sunday -> Monday
  return date;
}

/**
 * Add (or subtract, when n is negative) n business days, skipping weekends.
 * n = 0 returns the input unchanged.
 */
function addBusinessDays(value, n) {
  if (!Number.isSafeInteger(n)) throw new Error('Business-day offset must be an integer');
  let date = toUtcDate(value);
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + step);
    if (!isWeekend(date)) remaining -= 1;
  }
  return date;
}

module.exports = {
  isWeekend,
  nextBusinessDay,
  addBusinessDays,
  startOfUtcDay,
};
