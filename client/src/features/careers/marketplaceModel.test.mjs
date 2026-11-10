import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchParamsFrom, alertCriteriaFrom, pageList, minutesToTime, timeToMinutes, availabilityErrors,
  groupSlotsByDay, stars, bandKey, screenerPayload, missingScreenerAnswers, formatCents,
} from './marketplaceModel.js';

test('search params keep only known filters', () => {
  const p = searchParamsFrom({ q: ' cook ', industry: ['food_service', 'bogus'], experience: 'entry,xx', same_day: true, urgent: false, sort: 'pay_high', page: 2, pay_min: '15', pay_period: 'hourly', near: '', radius_km: 25 });
  assert.deepEqual(p, { q: 'cook', industry: 'food_service', experience: 'entry', same_day: 'true', sort: 'pay_high', page: 2, pay_min: 15, pay_period: 'hourly' });
  assert.equal(searchParamsFrom({ sort: 'newest' }).sort, undefined);
  assert.equal(searchParamsFrom({ near: '33101', radius_km: 10 }).radius_km, 10);
});

test('alert criteria rename single filters to their list forms', () => {
  assert.deepEqual(alertCriteriaFrom({ q: 'cook', workplace: 'remote', path: 'shift', sort: 'pay_high', page: 3 }), { q: 'cook', workplaces: 'remote', types: 'shift' });
});

test('page list with gaps', () => {
  assert.deepEqual(pageList(1, 1), [1]);
  assert.deepEqual(pageList(6, 20), [1, '…', 5, 6, 7, '…', 20]);
  assert.deepEqual(pageList(2, 3), [1, 2, 3]);
});

test('time helpers and availability validation', () => {
  assert.equal(minutesToTime(540), '09:00');
  assert.equal(timeToMinutes('17:30'), 1050);
  assert.equal(timeToMinutes('25:00'), null);
  assert.deepEqual(availabilityErrors([{ weekday: 1, start_minute: 540, end_minute: 545 }, { weekday: 9, start_minute: 0, end_minute: 60 }]), { 0: 'range', 1: 'day' });
});

test('slots group by local day', () => {
  const g = groupSlotsByDay(['2026-11-12T14:00:00Z', '2026-11-12T15:00:00Z', '2026-11-13T15:00:00Z'], 'America/New_York', 'en');
  assert.equal(g.length, 2);
  assert.equal(g[0].slots.length, 2);
  // 04:30Z on the 13th is still the 12th in New York.
  assert.equal(groupSlotsByDay(['2026-11-13T04:30:00Z'], 'America/New_York')[0].key, '2026-11-12');
});

test('ratings, bands, screeners, money', () => {
  assert.equal(stars(3.6), '★★★★☆');
  assert.equal(bandKey('strong'), 'strong');
  assert.equal(bandKey(undefined), 'unavailable');
  const qs = [{ id: 1, answer_type: 'number', required: true }, { id: 2, answer_type: 'yes_no', required: true }, { id: 3, answer_type: 'text', required: false }];
  assert.deepEqual(screenerPayload(qs, { 1: '3', 2: false, 3: '' }), { 1: 3, 2: false });
  assert.deepEqual(missingScreenerAnswers(qs, { 1: '3' }), [2]);
  assert.match(formatCents(735, 'usd', 'en'), /7\.35/);
});
