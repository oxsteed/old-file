'use strict';

// Minimal RFC 5545 calendar file for interview invites (spec §7, §11).

function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function utcStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Fold lines longer than 75 octets (RFC 5545 §3.1).
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function buildInterviewIcs({ uid, start, durationMinutes = 30, summary, description, location, organizerName, method = 'REQUEST', sequence = 0 }) {
  const startDate = new Date(start);
  const end = new Date(startDate.getTime() + Math.max(5, Number(durationMinutes) || 30) * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OxSteed//Careers//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method === 'CANCEL' ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${escapeText(uid)}`,
    `SEQUENCE:${Number(sequence) || 0}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(startDate)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    location ? `LOCATION:${escapeText(location)}` : null,
    organizerName ? `ORGANIZER;CN=${escapeText(organizerName)}:mailto:no-reply@oxsteed.com` : null,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function icsAttachment(ics, filename = 'interview.ics') {
  return { filename, content: Buffer.from(ics, 'utf8').toString('base64'), content_type: 'text/calendar; charset=utf-8; method=REQUEST' };
}

module.exports = { buildInterviewIcs, icsAttachment, escapeText, utcStamp };
