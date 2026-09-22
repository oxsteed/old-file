import test from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../src/lib/creditDateTime.js', import.meta.url);
const { formatCreditDateTime } = await import(moduleUrl);
const timestamp = '2026-01-02T15:04:05.000Z';

test('formats the same instant using the requested locale', () => {
  const date = new Date(timestamp);
  const english = formatCreditDateTime(timestamp, 'Unavailable', 'en-US');
  const spanish = formatCreditDateTime(timestamp, 'Unavailable', 'es-ES');
  const arabic = formatCreditDateTime(timestamp, 'Unavailable', 'ar-SA');

  assert.equal(english, new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date));
  assert.equal(spanish, new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date));
  assert.equal(arabic, new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date));
  assert.notEqual(english, spanish);
  assert.notEqual(english, arabic);
});

test('returns the caller fallback for missing or invalid dates', () => {
  assert.equal(formatCreditDateTime('', 'No date recorded', 'fr'), 'No date recorded');
  assert.equal(formatCreditDateTime('not-a-date', 'Unknown date', 'fr'), 'Unknown date');
});

test('keeps restaurant-wallet timestamps tied to the selected language', () => {
  const english = formatCreditDateTime(timestamp, 'Unavailable', 'en-US');
  const french = formatCreditDateTime(timestamp, 'Unavailable', 'fr-FR');
  assert.notEqual(english, french);
  assert.equal(formatCreditDateTime('', 'Indisponible', 'fr-FR'), 'Indisponible');
});

test('preserves skipped and repeated hours in the runtime timezone', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(
      formatCreditDateTime('2026-03-08T06:30:00.000Z', 'Unavailable', 'en-US'),
      'Mar 8, 2026, 1:30 AM',
    );
    assert.equal(
      formatCreditDateTime('2026-03-08T07:30:00.000Z', 'Unavailable', 'en-US'),
      'Mar 8, 2026, 3:30 AM',
    );
    assert.equal(
      formatCreditDateTime('2026-11-01T05:30:00.000Z', 'Unavailable', 'en-US'),
      'Nov 1, 2026, 1:30 AM',
    );
    assert.equal(
      formatCreditDateTime('2026-11-01T06:30:00.000Z', 'Unavailable', 'en-US'),
      'Nov 1, 2026, 1:30 AM',
    );
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
