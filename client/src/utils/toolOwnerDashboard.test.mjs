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
    avgRating: null,
  });
});

test('upcoming handoffs include paid bookings only', () => {
  const result = upcomingToolOwnerHandoffs([
    { id: 1, status: 'invoice_sent', start_date: '2026-11-12', end_date: '2026-11-13' },
    { id: 2, status: 'payment_confirmed', start_date: '2026-11-12', end_date: '2026-11-13' },
  ], now);
  assert.deepEqual(result.map((booking) => booking.id), [2]);
});
