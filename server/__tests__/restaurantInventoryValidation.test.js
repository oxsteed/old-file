'use strict';
const { inventoryId, foodCostRange } = require('../services/restaurantInventoryValidation');

test.each(['17junk', '1.5', '0', '-1', true, [], {}, '9007199254740992'])('inventory id %j rejects instead of selecting another record', (id) => {
  expect(() => inventoryId(id)).toThrow(expect.objectContaining({ code: 'invalid_inventory_id' }));
});
test('valid inventory ids and omitted optional ids retain their meanings', () => {
  expect(inventoryId('17')).toBe(17);
  expect(inventoryId(undefined)).toBeNull();
});
test.each([{ from: '2026-02-30' }, { to: '2026-02-30' }, { to: '0000-01-01' }, { to: 'not-a-date' },
  { from: '2026-10-02', to: '2026-10-01' }, { to: ['2026-10-01'] }])('invalid food-cost range %j rejects', (range) => {
  expect(() => foodCostRange(range, '2026-10-22')).toThrow(expect.objectContaining({ code: 'invalid_range' }));
});
test('food-cost ranges accept leap day, cap inclusive days at 366, and default relative to the selected end', () => {
  expect(foodCostRange({ from: '2024-02-29', to: '2025-02-28' }, '2026-10-22')).toEqual({ fromDate: '2024-02-29', toDate: '2025-02-28' });
  expect(() => foodCostRange({ from: '2024-02-29', to: '2025-03-01' }, '2026-10-22')).toThrow(expect.objectContaining({ code: 'range_too_wide' }));
  expect(foodCostRange({ to: '2026-10-01' }, '2026-10-22')).toEqual({ fromDate: '2026-09-02', toDate: '2026-10-01' });
});
