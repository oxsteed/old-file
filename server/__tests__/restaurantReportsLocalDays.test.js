'use strict';
// N-06: inventory / operations / loyalty reports use store-local days.
require('./setup');
const { _localRangeTest: { parseLocalRange, localMidnightUtcMs } } = require('../controllers/restaurantReportsController');

test('New York day maps to its local midnights (EDT)', () => {
  const r = parseLocalRange({ from: '2026-10-20', to: '2026-10-20' }, 'America/New_York');
  expect(r.from).toBe('2026-10-20T04:00:00.000Z');
  expect(r.to).toBe('2026-10-21T03:59:59.999Z');
  expect(r).toMatchObject({ from_date: '2026-10-20', to_date: '2026-10-20', timezone: 'America/New_York' });
});

test('DST fall-back day is 25 hours long', () => {
  const start = localMidnightUtcMs('2026-11-01', 'America/New_York');
  const end = localMidnightUtcMs('2026-11-02', 'America/New_York');
  expect((end - start) / 3600000).toBe(25);
});

test('east-of-UTC zones and UTC', () => {
  expect(parseLocalRange({ from: '2026-03-01', to: '2026-03-01' }, 'Asia/Tokyo').from).toBe('2026-02-28T15:00:00.000Z');
  expect(parseLocalRange({ from: '2026-03-01', to: '2026-03-01' }, 'UTC').to).toBe('2026-03-01T23:59:59.999Z');
});

test('defaults and validation', () => {
  const r = parseLocalRange({}, 'America/New_York', 90);
  const days = Math.round((Date.parse(`${r.to_date}T12:00:00Z`) - Date.parse(`${r.from_date}T12:00:00Z`)) / 86400000) + 1;
  expect(days).toBe(90);
  expect(() => parseLocalRange({ from: '2026-02-30' }, 'UTC')).toThrow(/Invalid date range/);
  expect(() => parseLocalRange({ from: '2026-03-02', to: '2026-03-01' }, 'UTC')).toThrow(/Invalid date range/);
  expect(() => parseLocalRange({ from: '2020-01-01', to: '2026-03-01' }, 'UTC')).toThrow(/capped/);
});
