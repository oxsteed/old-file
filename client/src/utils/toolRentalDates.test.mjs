import test from 'node:test';
import assert from 'node:assert/strict';
import { toolRentalDatesOverlap, isToolRentalDateBooked, toolRentalRangeHasBooked } from './toolRentalDates.js';

test('tool rental ranges overlap when a new range touches an existing end date', () => {
  assert.equal(
    toolRentalDatesOverlap('2026-11-03', '2026-11-05', '2026-11-01', '2026-11-03'),
    true,
  );
});

test('tool rental ranges do not overlap when separated by a full calendar day', () => {
  assert.equal(
    toolRentalDatesOverlap('2026-11-04', '2026-11-05', '2026-11-01', '2026-11-03'),
    false,
  );
});

test('invalid date-only values fail closed without throwing', () => {
  assert.equal(toolRentalDatesOverlap('2026-02-30', '2026-03-01', '2026-03-01', '2026-03-02'), false);
  assert.equal(toolRentalDatesOverlap('not-a-date', '2026-03-01', '2026-03-01', '2026-03-02'), false);
});

// Group 11 item 566: the calendar blocks booked days and ranges that
// would cross a booked day, boundary days included.
test('a booked day is blocked, including the range boundary days', () => {
  const ranges = [{ start_date: '2026-12-10', end_date: '2026-12-12' }];
  assert.equal(isToolRentalDateBooked('2026-12-09', ranges), false);
  assert.equal(isToolRentalDateBooked('2026-12-10', ranges), true);
  assert.equal(isToolRentalDateBooked('2026-12-11', ranges), true);
  assert.equal(isToolRentalDateBooked('2026-12-12', ranges), true);
  assert.equal(isToolRentalDateBooked('2026-12-13', ranges), false);
});

test('a range touching a booked range is blocked; a clear range is not', () => {
  const ranges = [{ start_date: '2026-12-10', end_date: '2026-12-12' }];
  assert.equal(toolRentalRangeHasBooked('2026-12-12', '2026-12-14', ranges), true);
  assert.equal(toolRentalRangeHasBooked('2026-12-08', '2026-12-10', ranges), true);
  assert.equal(toolRentalRangeHasBooked('2026-12-05', '2026-12-07', ranges), false);
  assert.equal(toolRentalRangeHasBooked('2026-12-13', '2026-12-15', ranges), false);
});

test('invalid calendar inputs fail closed as blocked', () => {
  assert.equal(isToolRentalDateBooked('not-a-date', []), true);
  assert.equal(toolRentalRangeHasBooked('2026-12-15', '2026-12-13', []), true);
});
