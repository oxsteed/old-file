import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcsEvent, buildBookingIcs, icsEscape } from '../src/utils/calendarExport.js';

test('buildIcsEvent emits a valid floating-time VEVENT', () => {
  const ics = buildIcsEvent({
    uid: 'oxsteed-booking-1@oxsteed.com',
    title: 'Fix the sink',
    start: new Date(2026, 11, 5, 14, 0, 0),
    end: new Date(2026, 11, 5, 15, 30, 0),
    location: '12 Main St',
    description: 'Bring tools',
    status: 'CONFIRMED',
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261205T140000\r\n/);
  assert.match(ics, /DTEND:20261205T153000\r\n/);
  assert.match(ics, /SUMMARY:Fix the sink\r\n/);
  assert.match(ics, /LOCATION:12 Main St\r\n/);
  assert.match(ics, /STATUS:CONFIRMED\r\n/);
  assert.match(ics, /END:VCALENDAR$/);
});

test('buildIcsEvent escapes commas, semicolons, and newlines', () => {
  assert.equal(icsEscape('a,b;c\nd\\e'), 'a\\,b\\;c\\nd\\\\e');
  const ics = buildIcsEvent({
    uid: 'x',
    title: 'A, B; C',
    start: new Date(2026, 0, 1, 9, 0, 0),
    end: new Date(2026, 0, 1, 10, 0, 0),
  });
  assert.match(ics, /SUMMARY:A\\, B\\; C\r\n/);
});

test('buildBookingIcs builds from a confirmation draft and defaults the end to one hour', () => {
  const ics = buildBookingIcs({
    availabilityMode: 'scheduled',
    requestedDate: '2026-12-05',
    requestedStartTime: '14:00',
    serviceName: 'Fix the sink',
    serviceLocation: '12 Main St',
    description: 'Leaky tap',
  });
  assert.match(ics, /DTSTART:20261205T140000\r\n/);
  assert.match(ics, /DTEND:20261205T150000\r\n/);
  assert.match(ics, /SUMMARY:Fix the sink\r\n/);
  assert.match(ics, /STATUS:TENTATIVE\r\n/);
});

test('buildBookingIcs returns null with no concrete time', () => {
  assert.equal(buildBookingIcs({
    availabilityMode: 'request_only',
    requestedDate: '2026-12-05',
    requestedStartTime: '14:00',
  }), null);
  assert.equal(buildBookingIcs({
    availabilityMode: 'scheduled',
    requestedDate: '2026-12-05',
  }), null);
  assert.equal(buildBookingIcs(null), null);
});
