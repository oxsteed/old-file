'use strict';

jest.mock('../services/restaurantInventoryAvailabilityService', () => ({
  syncMappedMenuAvailability: jest.fn().mockResolvedValue({ changes: [], applied: true }),
}));

const { mockQuery, resetMocks } = require('./setup');
const availability = require('../services/restaurantInventoryAvailabilityService');
const {
  reserveInventoryForOrder,
  releaseInventoryForOrder,
  consumeInventoryForOrder,
  restoreInventoryForOrder,
} = require('../services/restaurantInventoryOrderService');

const client = { query: (...args) => mockQuery(...args) };

describe('restaurant inventory order service', () => {
  beforeEach(() => {
    resetMocks();
    availability.syncMappedMenuAvailability.mockClear();
  });

  test('reserves mapped stock for an order item and refreshes availability', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          inventory_item_id: 17,
          menu_item_id: 41,
          required_quantity: '2',
          active_inventory_item_id: 17,
          inventory_item_name: 'Buns',
          on_hand_quantity: '10',
          reserved_quantity: '0',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 99, inventory_item_id: 17 }] });

    const result = await reserveInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 3 }],
    });

    expect(result.reservations).toHaveLength(1);
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO restaurant_inventory_order_reservations/);
    expect(availability.syncMappedMenuAvailability).toHaveBeenCalledWith(client, 5, expect.objectContaining({
      inventoryItemId: 17,
      apply: true,
    }));
  });

  test('rejects an order when mapped stock is already reserved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          inventory_item_id: 17,
          menu_item_id: 41,
          required_quantity: '2',
          active_inventory_item_id: 17,
          inventory_item_name: 'Buns',
          on_hand_quantity: '10',
          reserved_quantity: '8',
        }],
      });

    await expect(reserveInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 2 }],
    })).rejects.toMatchObject({ code: 'inventory_unavailable' });
  });

  test('consumes a reservation exactly once and writes usage history', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          inventory_item_id: 17,
          quantity: '2',
          inventory_item_name: 'Buns',
          on_hand_quantity: '10',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ quantity: '8' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await consumeInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      actorUserId: '00000000-0000-0000-0000-000000000001',
    });

    expect(result).toEqual({ consumed: 1 });
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO restaurant_inventory_adjustments/);
    expect(mockQuery.mock.calls[3][0]).toMatch(/SET status = 'consumed'/);
  });

  test('combined demand for one ingredient fails before any write', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 1, inventory_item_id: 17, quantity: '3', on_hand_quantity: '5' },
      { id: 2, inventory_item_id: 17, quantity: '3', on_hand_quantity: '5' },
    ] });
    await expect(consumeInventoryForOrder(client, { restaurantId: 5, orderId: 7 })).rejects.toMatchObject({ code: 'inventory_consistency_conflict' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('FEFO consumption never draws from an expired lot', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          inventory_item_id: 17,
          quantity: '2',
          inventory_item_name: 'Buns',
          on_hand_quantity: '10',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ quantity: '8' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 5, quantity: '4' },
          { id: 6, quantity: '4' },
        ],
      });

    const result = await consumeInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      actorUserId: '00000000-0000-0000-0000-000000000001',
    });

    expect(result).toEqual({ consumed: 1 });
    const lotSelect = mockQuery.mock.calls[4][0];
    expect(lotSelect).toMatch(/FROM restaurant_inventory_lots/);
    expect(lotSelect).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/);
    expect(lotSelect).toMatch(/ORDER BY expires_at ASC NULLS LAST/);
  });

  test('restores consumed stock, lots and history on cancellation/refund', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          inventory_item_id: 17,
          quantity: '2',
          inventory_item_name: 'Buns',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ quantity: '10' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 11, lot_id: 5, quantity: '2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await restoreInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      actorUserId: '00000000-0000-0000-0000-000000000001',
    });

    expect(result).toEqual({ restored: 1 });
    expect(mockQuery.mock.calls[0][0]).toMatch(/status = 'consumed'/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/SET quantity = quantity \+ \$1/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO restaurant_inventory_adjustments/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/'correction'/);
    expect(mockQuery.mock.calls[2][1]).toEqual([
      5, 17, 'Buns', 2, '10',
      'Restored after cancellation/refund of food order #7',
      '00000000-0000-0000-0000-000000000001',
      7,
    ]);
    expect(mockQuery.mock.calls[3][0]).toMatch(/FROM restaurant_inventory_lot_consumptions/);
    expect(mockQuery.mock.calls[4][0]).toMatch(/UPDATE restaurant_inventory_lots SET quantity = quantity \+ \$1/);
    expect(mockQuery.mock.calls[4][1]).toEqual([2, 5]);
    expect(mockQuery.mock.calls[5][0]).toMatch(/SET status = 'released'/);
    expect(availability.syncMappedMenuAvailability).toHaveBeenCalledWith(client, 5, expect.objectContaining({
      inventoryItemId: 17,
      apply: true,
    }));
  });

  test('a second restore call restores nothing (idempotent)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          inventory_item_id: 17,
          quantity: '2',
          inventory_item_name: 'Buns',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ quantity: '10' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const first = await restoreInventoryForOrder(client, { restaurantId: 5, orderId: 7 });
    expect(first).toEqual({ restored: 1 });
    const callsAfterFirst = mockQuery.mock.calls.length;

    const second = await restoreInventoryForOrder(client, { restaurantId: 5, orderId: 7 });
    expect(second).toEqual({ restored: 0 });
    // The second call only re-runs the consumed-reservations SELECT, which
    // finds nothing left to restore.
    expect(mockQuery.mock.calls.length).toBe(callsAfterFirst + 1);
    expect(mockQuery.mock.calls[callsAfterFirst][0]).toMatch(/status = 'consumed'/);
  });

  test('restores nothing when the order only has un-consumed reservations', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await restoreInventoryForOrder(client, { restaurantId: 5, orderId: 7 });

    expect(result).toEqual({ restored: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/status = 'consumed'/);
    expect(availability.syncMappedMenuAvailability).not.toHaveBeenCalled();
  });

  test('restores shared lots exactly once across two reservations for one item', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 99, inventory_item_id: 17, quantity: '2', inventory_item_name: 'Buns' },
          { id: 100, inventory_item_id: 17, quantity: '3', inventory_item_name: 'Buns' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ quantity: '10' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 11, lot_id: 5, quantity: '2' },
          { id: 12, lot_id: 5, quantity: '3' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ quantity: '13' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 11, lot_id: 5, quantity: '2' },
          { id: 12, lot_id: 5, quantity: '3' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await restoreInventoryForOrder(client, { restaurantId: 5, orderId: 7 });

    expect(result).toEqual({ restored: 2 });
    const lotUpdates = mockQuery.mock.calls.filter(([sql]) => /UPDATE restaurant_inventory_lots/.test(sql));
    expect(lotUpdates).toHaveLength(2);
    expect(lotUpdates[0][1]).toEqual([2, 5]);
    expect(lotUpdates[1][1]).toEqual([3, 5]);
  });

  test('releases open reservations without changing on-hand stock', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ inventory_item_id: 17 }] });

    const result = await releaseInventoryForOrder(client, { restaurantId: 5, orderId: 7 });

    expect(result).toEqual({ released: 1 });
    expect(mockQuery.mock.calls[0][0]).toMatch(/SET status = 'released'/);
    expect(availability.syncMappedMenuAvailability).toHaveBeenCalledTimes(1);
  });

  test('keeps a store-scoped reservation and refresh scoped availability', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          inventory_item_id: 17,
          menu_item_id: 41,
          required_quantity: '1',
          active_inventory_item_id: 17,
          inventory_item_name: 'Buns',
          on_hand_quantity: '10',
          reserved_quantity: '0',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 100, inventory_item_id: 17, location_id: 22 }] });

    await reserveInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      locationId: 22,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 1 }],
    });

    expect(mockQuery.mock.calls[0][0]).toMatch(/rii\.location_id = \$3/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/location_id = \$3/);
    expect(mockQuery.mock.calls[2][0]).toMatch(/location_id/);
    expect(mockQuery.mock.calls[2][1]).toEqual([5, 22, 7, 8, 17, 41, 1, null]);
    expect(availability.syncMappedMenuAvailability).toHaveBeenCalledWith(client, 5, expect.objectContaining({
      inventoryItemId: 17,
      locationId: 22,
      apply: true,
    }));
  });
});
