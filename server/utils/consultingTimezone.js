'use strict';

// Time-zone conversion for consulting scheduling (Group 10 item 517).
//
// Availability is stored as wall-clock times in the consultant's
// canonical zone (their contractor-profile timezone). Slots are generated
// in that zone; this module converts a canonical wall-clock slot to the
// client's zone for display only. Booking always posts the canonical
// date/time, so the stored appointment never depends on the viewer's zone.

const DEFAULT_TIMEZONE = 'America/New_York';

function isValidIanaZone(timezone) {
  if (typeof timezone !== 'string' || !timezone) return false;
  try {
    // Intl throws a RangeError for an unknown zone name.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function wallClockParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// The UTC instant of a wall-clock date/time in a zone. Uses the standard
// offset-guess: format the UTC-guess in the zone, measure how far the
// zone's wall clock sits from the guess, and shift by that offset.
function zonedWallToUtc(dateStr, timeStr, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const wall = wallClockParts(guess, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return new Date(guess.getTime() - (wallAsUtc - guess.getTime()));
}

// Convert a canonical wall-clock slot to another zone. Returns the date
// and time in the target zone; the date can roll over across the line.
function convertWallClock(dateStr, timeStr, fromZone, toZone) {
  const utc = zonedWallToUtc(dateStr, timeStr, fromZone);
  const wall = wallClockParts(utc, toZone);
  return {
    date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`,
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
  };
}

// The UTC instant a scheduled session starts, from its stored date/time
// and zone (the row's timezone column, or the consultant's canonical zone).
function sessionStartInstant(dateStr, timeStr, timeZone) {
  return zonedWallToUtc(dateStr, timeStr, timeZone || DEFAULT_TIMEZONE);
}

// The consultant's canonical zone: their contractor-profile timezone,
// falling back to the platform default when unset or invalid.
async function getConsultantTimezone(db, consultantId) {
  const { rows } = await db.query(
    'SELECT timezone FROM consultant_contractor_profiles WHERE user_id = $1',
    [consultantId],
  );
  const zone = rows[0]?.timezone;
  return zone && isValidIanaZone(zone) ? zone : DEFAULT_TIMEZONE;
}

module.exports = {
  DEFAULT_TIMEZONE,
  isValidIanaZone,
  wallClockParts,
  zonedWallToUtc,
  convertWallClock,
  sessionStartInstant,
  getConsultantTimezone,
};
