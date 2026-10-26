'use strict';
// S-20: minor-labor and Fair Workweek rules (pure engine).
const L = require('../services/laborJurisdictionRules');
const shift = (id, date, start, end, extra = {}) => ({ id, user_id: 'u1', shift_date: date, start_time: start, end_time: end, ...extra });

test('school calendar heuristics (Labor Day is the first Monday of September)', () => {
  expect(L.isSummer('2026-07-15')).toBe(true);
  expect(L.isSummer('2026-09-07')).toBe(true);
  expect(L.isSchoolDay('2026-09-08')).toBe(true);
  expect(L.isSchoolDay('2026-10-24')).toBe(false); // Saturday
});

test('under-16: school-day hours, window and school-week cap', () => {
  const rules = L.resolveRules({ jurisdiction_code: 'US-FED' });
  const w = L.evaluateSchedule([shift(1, '2026-10-26', '15:00', '19:30', { minor_band: 'under_16' })], { rules });
  const kinds = w.map((x) => x.rule);
  expect(kinds).toEqual(expect.arrayContaining(['minor_u16_window', 'minor_u16_daily']));
  const week = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']
    .map((d, i) => shift(10 + i, d, '15:00', d === '2026-10-31' ? '19:00' : '18:00', { minor_band: 'under_16' }));
  expect(L.evaluateSchedule(week, { rules }).some((x) => x.rule === 'minor_u16_weekly')).toBe(true);
  const summer = L.evaluateSchedule([shift(2, '2026-07-14', '13:00', '20:30', { minor_band: 'under_16' })], { rules });
  expect(summer.filter((x) => x.rule.startsWith('minor_u16'))).toEqual([]);
});

test('16-17: state weekly cap and latest end, only on published days', () => {
  const rules = L.resolveRules({ jurisdiction_code: 'US-CHI' });
  const existing = [shift(1, '2026-10-26', '09:00', '19:00')]; // 10h, adult-shaped existing row
  const published = [
    shift(2, '2026-10-27', '12:00', '21:30', { is_minor: true, minor_band: 'age_16_17' }),
    ...['2026-10-28', '2026-10-29', '2026-10-30'].map((d, i) => shift(3 + i, d, '09:00', '17:00', { is_minor: true, minor_band: 'age_16_17' })),
  ];
  const w = L.evaluateSchedule(published, { rules, existingShifts: existing });
  expect(w.some((x) => x.rule === 'minor_latest_end')).toBe(true);
  expect(w.some((x) => x.rule === 'minor_weekly_hours')).toBe(true);
  // The 10h existing day is not re-flagged by a publish that does not touch it.
  expect(w.filter((x) => x.rule === 'minor_daily_hours' && x.message.includes('2026-10-26'))).toEqual([]);
  expect(w.some((x) => x.rule.startsWith('minor_u16'))).toBe(false);
});

test('adults get no minor warnings', () => {
  const w = L.evaluateSchedule([shift(1, '2026-10-26', '06:00', '23:00')], { rules: L.resolveRules(null) });
  expect(w.some((x) => x.rule.startsWith('minor'))).toBe(false);
});

test('Fair Workweek change: premium inside the notice window unless employee-requested', () => {
  const now = new Date('2026-10-26T12:00:00');
  const nyc = L.resolveRules({ jurisdiction_code: 'US-NYC' });
  const before = { shift_date: '2026-10-30', start_time: '09:00', end_time: '17:00' };
  const after = { shift_date: '2026-10-30', start_time: '12:00', end_time: '17:00' };
  expect(L.evaluateChange({ before, after, rules: nyc, now })).toMatchObject({ premium_due: true, notice_hours: 336, jurisdiction_code: 'US-NYC' });
  expect(L.evaluateChange({ before, after, rules: nyc, now, employeeRequested: true }).premium_due).toBe(false);
  expect(L.evaluateChange({ before: { ...before, shift_date: '2026-12-01' }, rules: nyc, now }).premium_due).toBe(false);
  expect(L.evaluateChange({ before, rules: L.resolveRules({ jurisdiction_code: 'US-FED' }), now })).toMatchObject({ premium_due: false, notice_hours: null });
});
