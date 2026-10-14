'use strict';

// Review P2-3-F08: the customer slots listing (getBusinessAvailableSlots),
// the booking gate (enforceBookingRules), and the appointment writer
// (assertAppointmentWindowFree) each computed staff availability differently,
// so a slot the listing offered could 409 at create time with "Staff member
// is unavailable". This module is the single source of truth for the staff
// member's personal availability_blocks overlap predicate; every path uses
// it.

const pool = require('../db');

/**
 * Returns the staff member's personal availability blocks overlapping
 * [startIso, endIso). Blocks of type 'unavailable' or 'busy' are the
 * authoritative "do not book" signal. Returns an array of rows.
 */
async function staffBlockedWindows(staffId, startIso, endIso, client = pool) {
  if (!staffId || !startIso || !endIso) return [];
  const { rows } = await client.query(
    `SELECT id FROM availability_blocks
      WHERE helper_id = $1 AND type IN ('unavailable', 'busy')
        AND start_time < $3 AND end_time > $2 LIMIT 1`,
    [String(staffId), startIso, endIso]
  );
  return rows;
}

/**
 * True when the staff member has a personal availability block overlapping
 * [startIso, endIso).
 */
async function isStaffBlocked(staffId, startIso, endIso, client = pool) {
  const rows = await staffBlockedWindows(staffId, startIso, endIso, client);
  return rows.length > 0;
}

module.exports = { staffBlockedWindows, isStaffBlocked };
