'use strict';

/**
 * Parse a calendar date without allowing JavaScript's Date constructor to
 * normalize impossible values such as 2026-02-30 into a different day.
 */
function parseDateOnlyUTC(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  const normalized = date.toISOString().slice(0, 10);
  return normalized === value ? date : null;
}

module.exports = { parseDateOnlyUTC };
