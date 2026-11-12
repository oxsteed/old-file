import test from 'node:test';
import assert from 'node:assert/strict';
import { toolRentalDatesOverlap } from './toolRentalDates.js';

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
