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

  test('releases open reservations without changing on-hand stock', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ inventory_item_id: 17 }] });

    const result = await releaseInventoryForOrder(client, { restaurantId: 5, orderId: 7 });

    expect(result).toEqual({ released: 1 });
    expect(mockQuery.mock.calls[0][0]).toMatch(/SET status = 'released'/);
    expect(availability.syncMappedMenuAvailability).toHaveBeenCalledTimes(1);
  });
});
