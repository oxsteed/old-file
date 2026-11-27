import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveToolOwnerStats, upcomingToolOwnerHandoffs } from './toolOwnerDashboard.js';

const now = Date.parse('2026-11-11T12:00:00Z');

test('dashboard metrics use live tool-rental statuses and fields', () => {
  const listings = [
    { is_available: true, moderation_hold: false },
    { is_available: false, moderation_hold: false },
    { is_available: true, moderation_hold: true },
  ];
  const bookings = [
    { status: 'pending' },
    { status: 'payment_confirmed', start_date: '2026-11-12', end_date: '2026-11-14' },
    { status: 'confirmed', start_date: '2026-11-12', end_date: '2026-11-14' },
  ];

  assert.deepEqual(deriveToolOwnerStats(listings, bookings, now), {
    activeListings: 1,
    pending: 1,
    upcomingPickups: 1,
    upcomingReturns: 1,
    earnings30: 0,
    invoiced: 0,
    avgRating: null,
  });
});

test('G11-A10/B1 (D-622): a publication-blocked listing is not active', () => {
  const listings = [
    { is_available: true, moderation_hold: false, publication_blocked: true },
    { is_available: true, moderation_hold: false },
  ];
  assert.equal(deriveToolOwnerStats(listings, [], now).activeListings, 1);
});

test('G11-B14 (D-633): invoice_sent bookings count as invoiced, never as earnings', () => {
  const bookings = [
    { status: 'invoice_sent', total_price: 40, created_at: '2026-11-10', end_date: '2026-11-12' },
    { status: 'completed', total_price: 36, completed_at: '2026-11-10', end_date: '2026-11-11' },
  ];
  const stats = deriveToolOwnerStats([], bookings, now);
  assert.equal(stats.invoiced, 4000);
  assert.equal(stats.earnings30, 3600);
});

test('G11-A10/B1 (D-622): a started rental shows as a return, a future one as a pickup, sorted by handoff date', () => {
  const result = upcomingToolOwnerHandoffs([
    { id: 1, status: 'payment_confirmed', start_date: '2026-11-13', end_date: '2026-11-15' },
    { id: 2, status: 'payment_confirmed', start_date: '2026-11-09', end_date: '2026-11-12' },
    { id: 3, status: 'payment_confirmed', start_date: '2026-11-05', end_date: '2026-11-06' },
  ], now);
  assert.deepEqual(result.map((booking) => booking.id), [2, 1]);
  assert.equal(result[0]._handoffKind, 'return');
  assert.equal(result[0]._handoffWhen, '2026-11-12');
  assert.equal(result[1]._handoffKind, 'pickup');
  assert.equal(result[1]._handoffWhen, '2026-11-13');
});

test('upcoming handoffs include paid bookings only', () => {
  const result = upcomingToolOwnerHandoffs([
    { id: 1, status: 'invoice_sent', start_date: '2026-11-12', end_date: '2026-11-13' },
    { id: 2, status: 'payment_confirmed', start_date: '2026-11-12', end_date: '2026-11-13' },
  ], now);
  assert.deepEqual(result.map((booking) => booking.id), [2]);
});
