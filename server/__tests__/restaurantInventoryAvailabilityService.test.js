'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');

const db = { query: (...args) => mockQuery(...args) };

describe('restaurant inventory availability service', () => {
  beforeEach(() => resetMocks());

  test('writes inventory state to the selected store menu override', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        menu_item_id: 41,
        menu_item_name: 'Burger',
        current_available: true,
        manual_available: true,
        current_inventory_available: true,
        current_inventory_state: 'available',
        store_manual_available: null,
        blocked_by_stock: true,
        limited_by_stock: false,
        blocking_items: ['Buns'],
        limited_items: [],
        blocking_inventory_item_id: 17,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await syncMappedMenuAvailability(db, 5, { locationId: 22, apply: true });

    expect(result.changes).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/sm\.location_id = \$4/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/rii\.location_id = \$4/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO restaurant_store_menu_overrides/);
    expect(mockQuery.mock.calls[1][1]).toEqual([5, 22, 41, false, 'unavailable', null]);
    expect(mockQuery.mock.calls[2][0]).toMatch(/location_id, inventory_item_id/);
    expect(mockQuery.mock.calls[2][1][1]).toBe(22);
  });
});
