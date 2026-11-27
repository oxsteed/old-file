'use strict';

/**
 * RFC 5545 .ics builders, shared by the calendar exports (appointments,
 * bookings). Times are emitted as floating local times (no Z suffix):
 * booking/appointment times are stored as wall-clock values with no
 * offset, so a floating time lets the importing calendar interpret them
 * in the viewer's own zone instead of the server stamping a wrong UTC.
 */

function icsDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Floating local time: YYYYMMDDTHHMMSS with no zone designator.
function icsFloatingDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Build one VEVENT .ics document.
 * @param {object} event { uid, title, start: Date, end: Date, location?, description?, status? }
 */
function buildIcsEvent({ uid, title, start, end, location, description, status }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OxSteed//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTART:${icsFloatingDate(start)}`,
    `DTEND:${icsFloatingDate(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    location ? `LOCATION:${icsEscape(location)}` : '',
    description ? `DESCRIPTION:${icsEscape(description)}` : '',
    `STATUS:${status === 'CONFIRMED' ? 'CONFIRMED' : 'TENTATIVE'}`,
    `DTSTAMP:${icsDate(new Date())}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

module.exports = { icsDate, icsFloatingDate, icsEscape, buildIcsEvent };
