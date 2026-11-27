// Client-side .ics builder for the booking flow (G1-A7). Mirrors
// server/utils/ics.js: times are emitted as floating local times (no Z
// suffix) because booking times are wall-clock values with no stored
// offset, so the importing calendar interprets them in the viewer's zone.

export function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function icsFloatingDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function icsDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildIcsEvent({ uid, title, start, end, location, description, status }) {
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

// Build the .ics for a pre-confirm BookingConfirmation draft, or null
// when the draft has no concrete time (request-only bookings have no
// time to export, so the export button stays hidden instead of
// downloading a guessed event).
export function buildBookingIcs(bookingData) {
  if (!bookingData || bookingData.availabilityMode === 'request_only') return null;
  if (!bookingData.requestedDate || !bookingData.requestedStartTime) return null;
  const start = new Date(`${bookingData.requestedDate}T${bookingData.requestedStartTime}`);
  if (Number.isNaN(start.getTime())) return null;
  const end = bookingData.requestedEndTime
    ? new Date(`${bookingData.requestedDate}T${bookingData.requestedEndTime}`)
    : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime())) return null;
  return buildIcsEvent({
    uid: `oxsteed-booking-draft-${start.getTime()}@oxsteed.com`,
    title: bookingData.serviceName || 'OxSteed Booking',
    start,
    end,
    location: bookingData.serviceLocation || '',
    description: bookingData.description || '',
    status: 'TENTATIVE',
  });
}

export function downloadIcs(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
