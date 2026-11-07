'use strict';

// Phase 6 (table service + food-cost depth) behavior tests. All mocked:
// no real database, following the patterns in restaurantHosting.test.js,
// restaurantInventoryOrderService.test.js and
// restaurantInventoryController.test.js.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async () => ({ id: 3, business_id: 42, display_name: 'Ox Burger Lab', effective_role: 'manager' })),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
  getEffectivePermissions: jest.fn().mockResolvedValue({ permissions: new Set(['inventory.view', 'inventory.update', 'inventory.manage']), raw: {} }),
  hasAny: (permissionSet, requested) => requested.some((permission) => permissionSet.has(permission)),
}));
jest.mock('../services/smsNotificationService', () => ({ sendTransactionalSMS: jest.fn() }));
jest.mock('../services/restaurantInventoryAvailabilityService', () => ({
  syncMappedMenuAvailability: jest.fn().mockResolvedValue({ changes: [], applied: true }),
}));

const hosting = require('../controllers/restaurantHostingController');
const inventory = require('../controllers/restaurantInventoryController');
const appFlow = require('../controllers/restaurantAppFlowController');
const { computeMenuItemFoodCost, listMenuFoodCosts } = require('../services/restaurantFoodCostService');
const { draftAutoReorderRequests } = require('../services/restaurantInventoryReorderService');
const { reserveInventoryForOrder, consumeInventoryForOrder } = require('../services/restaurantInventoryOrderService');
const { normalizeTipOutRules, computeTipAllocations } = require('../services/restaurantPayrollService');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const client = { query: (...args) => mockQuery(...args) };

function hostingApp() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: USER_ID }; next(); });
  instance.get('/:restaurantId/tables/:tableId', hosting.getTableDetail);
  instance.post('/:restaurantId/tables/:tableId/seating', hosting.setSeating);
  instance.use(errorHandler);
  return instance;
}

function inventoryApp() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: USER_ID, email: 'owner@example.com' }; next(); });
  instance.post('/:restaurantId/inventory/purchase-requests', inventory.createPurchaseRequest);
  instance.patch('/:restaurantId/inventory/purchase-requests/:requestId', inventory.updatePurchaseRequest);
  instance.use(errorHandler);
  return instance;
}

const tableRow = { id: 11, restaurant_id: 3, location_id: 7, name: 'Table 4', capacity: 4, status: 'active' };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('Phase 6: POS table validation (resolvePosTable)', () => {
  test('accepts a table of the same restaurant and store, within capacity', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 21, order_id: null }] });
    const result = await appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3 });
    expect(result).toEqual({ tableId: 11, table: tableRow, covers: 3 });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2'),
      [11, 3],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM restaurant_table_seatings WHERE table_id = $1 AND restaurant_id = $2 AND closed_at IS NULL FOR UPDATE'),
      [11, 3],
    );
  });

  test('accepts with an open unlinked seating', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 21, order_id: null }] });
    const result = await appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3 });
    expect(result).toEqual({ tableId: 11, table: tableRow, covers: 3 });
  });

  test('accepts with walkIn true and no open seating', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3, walkIn: true });
    expect(result).toEqual({ tableId: 11, table: tableRow, covers: 3 });
  });

  test('no open seating and no walkIn is a 409 table_not_seated', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3 }))
      .rejects.toMatchObject({ status: 409, code: 'table_not_seated' });
  });

  test('open seating linked to another order is a 409 table_occupied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 21, order_id: 99 }] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3, orderId: 55 }))
      .rejects.toMatchObject({ status: 409, code: 'table_occupied' });
  });

  test('open seating linked to another order stays occupied even for a walk-in', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 21, order_id: 99 }] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3, walkIn: true, orderId: 55 }))
      .rejects.toMatchObject({ status: 409, code: 'table_occupied' });
  });

  test('accepts when the open seating is linked to the same order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 21, order_id: 55 }] });
    const result = await appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 3, orderId: 55 });
    expect(result).toEqual({ tableId: 11, table: tableRow, covers: 3 });
  });

  test('no table requested resolves to nulls without querying', async () => {
    const result = await appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: null, covers: 2 });
    expect(result).toEqual({ tableId: null, table: null, covers: 2 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('unknown table is a 404 table_not_found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 99, covers: null }))
      .rejects.toMatchObject({ status: 404, code: 'table_not_found' });
  });

  test('table of another store is a 409 table_location_mismatch', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...tableRow, location_id: 8 }] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: null }))
      .rejects.toMatchObject({ status: 409, code: 'table_location_mismatch' });
  });

  test('disabled table is a 409 table_unavailable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...tableRow, status: 'disabled' }] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: null }))
      .rejects.toMatchObject({ status: 409, code: 'table_unavailable' });
  });

  test('covers above capacity is a 409 table_capacity_exceeded', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [tableRow] });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 5 }))
      .rejects.toMatchObject({ status: 409, code: 'table_capacity_exceeded' });
  });

  test('covers outside 1..1000 is a 400 validation error', async () => {
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 0 }))
      .rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    await expect(appFlow._resolvePosTable(client, { restaurantId: 3, locationId: 7, tableId: 11, covers: 1001 }))
      .rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Phase 6: table detail + seating-release guard', () => {
  function mockSeatingQueries(openTickets) {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT * FROM restaurant_tables WHERE restaurant_id=$1 AND id=$2 FOR UPDATE')) return { rows: [tableRow] };
      if (sql.includes('FROM food_orders') && sql.includes('table_id=$2')) return { rows: openTickets };
      if (sql.startsWith('UPDATE restaurant_table_seatings SET closed_at=NOW()')) return { rows: [{ id: 21, table_id: 11, closed_at: new Date().toISOString() }] };
      return { rows: [] };
    });
  }

  test('table detail lists open tickets with covers and totals', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT * FROM restaurant_tables WHERE restaurant_id=$1 AND id=$2')) return { rows: [tableRow] };
      if (sql.includes('FROM restaurant_table_seatings')) return { rows: [{ id: 21, table_id: 11, party_size: 3, reservation_guest_name: 'Ada', waitlist_guest_name: null }] };
      if (sql.includes('FROM food_orders fo')) {
        return { rows: [
          { id: 101, queue_number: 5, table_label: 'Table 4', covers: 2, status: 'accepted', pos_ticket_state: 'open', total_cents: 2500, currency_code: 'USD', item_count: 3 },
          { id: 102, queue_number: 6, table_label: 'Table 4', covers: 1, status: 'ready', pos_ticket_state: 'open', total_cents: 1200, currency_code: 'USD', item_count: 1 },
        ] };
      }
      return { rows: [] };
    });
    const response = await request(hostingApp()).get('/3/tables/11');
    expect(response.status).toBe(200);
    expect(response.body.table.id).toBe(11);
    expect(response.body.seating.party_size).toBe(3);
    expect(response.body.tickets).toHaveLength(2);
    expect(response.body.totals).toEqual({ open_ticket_count: 2, total_cents: 3700, covers: 3 });
  });

  test('release with open tickets warns with a structured 409 and blocks', async () => {
    mockSeatingQueries([
      { id: 101, queue_number: 5, total_cents: 2500, currency_code: 'USD' },
      { id: 102, queue_number: 6, total_cents: 1200, currency_code: 'USD' },
    ]);
    const response = await request(hostingApp()).post('/3/tables/11/seating').send({ action: 'release' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('table_has_open_tickets');
    expect(response.body.fields).toEqual({
      tableId: 11,
      openTicketIds: [101, 102],
      openTicketCount: 2,
      openTotalCents: 3700,
      currencyCode: 'USD',
    });
    // Nothing was released: no seating UPDATE ran.
    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE restaurant_table_seatings'))).toBe(false);
  });

  test('release with confirm proceeds, closes only the seating, leaves tickets open', async () => {
    mockSeatingQueries([
      { id: 101, queue_number: 5, total_cents: 2500, currency_code: 'USD' },
    ]);
    const response = await request(hostingApp()).post('/3/tables/11/seating').send({ action: 'release', confirm: true });
    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE restaurant_table_seatings SET closed_at=NOW()'))).toBe(true);
    // Tickets are never touched by a release.
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('food_orders') && /UPDATE|DELETE/.test(sql))).toBe(false);
  });

  test('release with no open tickets proceeds without confirm', async () => {
    mockSeatingQueries([]);
    const response = await request(hostingApp()).post('/3/tables/11/seating').send({ action: 'release' });
    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE restaurant_table_seatings SET closed_at=NOW()'))).toBe(true);
  });
});

describe('Phase 6: plate cost and margin', () => {
  // Hand-checked fixture: Jerk Chicken Plate, $15.00.
  //   Chicken 0.5 kg x 1 x 100/80 yield x $4.00 = $2.50
  //   Bun     2     x 1 x 100/100     x $0.30 = $0.60
  //   Plate cost $3.10 (310c), margin $11.90 (1190c), 79.33%.
  const restaurantRow = { currency_code: 'USD' };
  const itemRow = { id: 41, name: 'Jerk Chicken Plate', price_cents: 1500, currency_code: 'USD' };
  const componentRows = [
    { menu_item_id: 41, inventory_item_id: 17, inventory_item_name: 'Chicken', inventory_unit: 'kg', required_quantity: '0.5', required_unit: 'kg', conversion_factor: '1', yield_percent: '80', unit_cost: '4.00' },
    { menu_item_id: 41, inventory_item_id: 18, inventory_item_name: 'Bun', inventory_unit: 'each', required_quantity: '2', required_unit: 'each', conversion_factor: '1', yield_percent: '100', unit_cost: '0.30' },
  ];

  function mockFoodCostQueries({ restaurantCurrency = 'USD', itemCurrency = 'USD', components = componentRows } = {}) {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT currency_code FROM food_restaurants')) return { rows: [{ currency_code: restaurantCurrency }] };
      if (sql.includes('FROM food_menu_items')) return { rows: [{ ...itemRow, currency_code: itemCurrency }] };
      if (sql.includes('FROM restaurant_inventory_item_mappings')) return { rows: components };
      return { rows: [] };
    });
  }

  test('computes plate cost, margin cents and margin percent from live mappings', async () => {
    mockFoodCostQueries();
    const cost = await computeMenuItemFoodCost(client, { restaurantId: 3, menuItemId: 41 });
    expect(cost.cost_cents).toBe(310);
    expect(cost.cost_currency_code).toBe('USD');
    expect(cost.margin_cents).toBe(1190);
    expect(cost.margin_percent).toBe(79.33);
    expect(cost.has_mappings).toBe(true);
    expect(cost.components).toHaveLength(2);
    expect(cost.components[0].line_cost_cents).toBe(250);
    expect(cost.components[1].line_cost_cents).toBe(60);
  });

  test('unmapped dish reports no recipe and never claims zero cost with a margin', async () => {
    mockFoodCostQueries({ components: [] });
    const cost = await computeMenuItemFoodCost(client, { restaurantId: 3, menuItemId: 41 });
    expect(cost.has_mappings).toBe(false);
    expect(cost.cost_cents).toBe(0);
    expect(cost.margin_cents).toBe(null);
    expect(cost.margin_percent).toBe(null);
  });

  test('currency mismatch never mixes currencies: margin is null', async () => {
    mockFoodCostQueries({ itemCurrency: 'EUR' });
    const cost = await computeMenuItemFoodCost(client, { restaurantId: 3, menuItemId: 41 });
    expect(cost.currency_mismatch).toBe(true);
    expect(cost.cost_cents).toBe(310);
    expect(cost.margin_cents).toBe(null);
    expect(cost.margin_percent).toBe(null);
  });

  test('zero-decimal currency uses 1 minor unit per major unit', async () => {
    mockFoodCostQueries({ restaurantCurrency: 'JPY', itemCurrency: 'JPY' });
    const cost = await computeMenuItemFoodCost(client, { restaurantId: 3, menuItemId: 41 });
    expect(cost.cost_cents).toBe(3);
    expect(cost.margin_cents).toBe(1497);
  });

  test('CLP (0 decimals, missing from the old local table) prices like JPY, not like USD', async () => {
    mockFoodCostQueries({ restaurantCurrency: 'CLP', itemCurrency: 'CLP' });
    const cost = await computeMenuItemFoodCost(client, { restaurantId: 3, menuItemId: 41 });
    // Plate cost 3.10 major units = 3 minor units at 0 decimals
    // (the old table defaulted CLP to 100 minor units per major, so
    // it reported 310). Price 1500 minor units, margin 1497.
    expect(cost.cost_cents).toBe(3);
    expect(cost.margin_cents).toBe(1497);
    expect(cost.components[0].line_cost_cents).toBe(3);
  });

  test('JOD (3 decimals, missing from the old local table) prices in fils, not cents', async () => {
    mockFoodCostQueries({ restaurantCurrency: 'JOD', itemCurrency: 'JOD' });
    const cost = await computeMenuItemFoodCost(client, { restaurantId: 3, menuItemId: 41 });
    // Plate cost 3.10 major units = 3100 fils at 3 decimals (the
    // old table defaulted JOD to 100 minor units per major, so it
    // reported 310). Lines: 2500 + 600 fils.
    expect(cost.cost_cents).toBe(3100);
    expect(cost.margin_cents).toBe(1500 - 3100);
    expect(cost.components[0].line_cost_cents).toBe(2500);
    expect(cost.components[1].line_cost_cents).toBe(600);
  });

  test('margin-sorted list puts the lowest margin first and null margins last', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT currency_code FROM food_restaurants')) return { rows: [restaurantRow] };
      if (sql.includes('FROM food_menu_items')) {
        return { rows: [
          { id: 41, name: 'Jerk Chicken Plate', price_cents: 1500, currency_code: 'USD' },
          { id: 42, name: 'House Salad', price_cents: 800, currency_code: 'USD' },
          { id: 43, name: 'Daily Special', price_cents: 2000, currency_code: 'USD' },
        ] };
      }
      if (sql.includes('FROM restaurant_inventory_item_mappings')) {
        return { rows: [
          { ...componentRows[0] },
          { ...componentRows[1] },
          { menu_item_id: 42, inventory_item_id: 19, inventory_item_name: 'Greens', inventory_unit: 'kg', required_quantity: '0.1', required_unit: 'kg', conversion_factor: '1', yield_percent: '100', unit_cost: '2.00' },
        ] };
      }
      return { rows: [] };
    });
    const costs = await listMenuFoodCosts(client, { restaurantId: 3, sort: 'margin_asc' });
    // Salad: cost 20c, margin 780c (97.5%). Chicken: 310c, margin 79.33%. Special: unmapped, null.
    expect(costs.map((c) => c.menu_item_id)).toEqual([41, 42, 43]);
    expect(costs[0].margin_percent).toBe(79.33);
    expect(costs[1].margin_percent).toBe(97.5);
    expect(costs[2].margin_percent).toBe(null);
  });
});

describe('Phase 6: FEFO lot consumption', () => {
  test('consumes the earliest-expiring lot first, then the next', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 99, inventory_item_id: 17, quantity: '2', inventory_item_name: 'Chicken', on_hand_quantity: '10' }] })
      .mockResolvedValueOnce({ rows: [{ quantity: '8' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: 201, quantity: '1.5' },
          { id: 202, quantity: '1' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await consumeInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      actorUserId: USER_ID,
    });

    expect(result).toEqual({ consumed: 1 });
    // Existing behavior is unchanged: adjustments INSERT then status update.
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO restaurant_inventory_adjustments/);
    expect(mockQuery.mock.calls[3][0]).toMatch(/SET status = 'consumed'/);
    // FEFO: the lot SELECT orders by expiry, nulls last.
    const lotSelect = mockQuery.mock.calls[4];
    expect(lotSelect[0]).toMatch(/FROM restaurant_inventory_lots/);
    expect(lotSelect[0]).toMatch(/ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC/);
    // 2 units: 1.5 from the earliest lot, 0.5 from the next; nothing more.
    const lotUpdates = mockQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE restaurant_inventory_lots SET quantity'));
    expect(lotUpdates).toHaveLength(2);
    expect(lotUpdates[0][1]).toEqual([1.5, 201]);
    expect(lotUpdates[1][1]).toEqual([0.5, 202]);
    const lotConsumptions = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO restaurant_inventory_lot_consumptions'));
    expect(lotConsumptions).toHaveLength(2);
    expect(lotConsumptions[0][1]).toEqual([5, 201, 17, 7, 1.5]);
    expect(lotConsumptions[1][1]).toEqual([5, 202, 17, 7, 0.5]);
  });

  test('pre-lot stock with no lot rows never fails the order', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 99, inventory_item_id: 17, quantity: '2', inventory_item_name: 'Chicken', on_hand_quantity: '10' }] })
      .mockResolvedValueOnce({ rows: [{ quantity: '8' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await consumeInventoryForOrder(client, { restaurantId: 5, orderId: 7, actorUserId: USER_ID });
    expect(result).toEqual({ consumed: 1 });
    expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('UPDATE restaurant_inventory_lots SET quantity'))).toHaveLength(0);
  });
});

describe('Phase 6: modifier depletion at reservation time', () => {
  test('a modifier mapping depletes its ingredient once per dish', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM restaurant_inventory_item_mappings rim')) return { rows: [] };
      if (sql.includes('FROM restaurant_inventory_modifier_mappings mm')) {
        return {
          rows: [{
            inventory_item_id: 17,
            modifier_id: 55,
            required_quantity: '0.25',
            active_inventory_item_id: 17,
            inventory_item_name: 'Chicken',
            on_hand_quantity: '10',
            reserved_quantity: '0',
          }],
        };
      }
      if (sql.startsWith('INSERT INTO restaurant_inventory_order_reservations')) {
        return { rows: [{ id: 99, inventory_item_id: 17 }] };
      }
      return { rows: [] };
    });

    const result = await reserveInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 2, modifiers: [{ modifierId: 55 }] }],
    });

    expect(result.reservations).toHaveLength(1);
    const insert = mockQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO restaurant_inventory_order_reservations'));
    expect(insert).toBeDefined();
    // 2 dishes x 0.25 kg extra chicken = 0.5 kg reserved, one row per
    // (order line, inventory item); the modifier id is in the error
    // context only, never in the reservation row.
    expect(insert[1]).toEqual([5, 7, 8, 17, 41, 0.5, null]);
  });

  test('an unmapped modifier depletes nothing and reserves nothing', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM restaurant_inventory_item_mappings rim')) return { rows: [] };
      if (sql.includes('FROM restaurant_inventory_modifier_mappings mm')) return { rows: [] };
      return { rows: [] };
    });

    const result = await reserveInventoryForOrder(client, {
      restaurantId: 5,
      orderId: 7,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 2, modifiers: [{ modifierId: 55 }] }],
    });

    expect(result).toEqual({ reservations: [] });
    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO restaurant_inventory_order_reservations'))).toBe(false);
  });
});

describe('Phase 6: auto-reorder drafts', () => {
  function mockDraftQueries(items, existingByItemId) {
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.startsWith('SELECT id, business_id FROM food_restaurants')) return { rows: [{ id: 3, business_id: 42 }] };
      if (sql.includes('FROM restaurant_inventory_items i')) return { rows: items };
      if (sql.includes('FROM restaurant_inventory_purchase_requests')) {
        const existing = existingByItemId[params[1]];
        return { rows: existing ? [existing] : [] };
      }
      if (sql.startsWith('INSERT INTO restaurant_inventory_purchase_requests')) {
        return { rows: [{ id: 501, restaurant_id: 3, item_name: params[2], requested_quantity: params[3], status: 'pending', source: 'auto_reorder', inventory_item_id: params[7], auto_reorder_key: params[8] }] };
      }
      return { rows: [] };
    });
  }

  test('drafts a pending auto_reorder request topped up to par level', async () => {
    mockDraftQueries(
      [{ id: 17, name: 'Chicken', unit: 'kg', supplier_name: 'Atlantic Foods', location_id: 7, quantity: '2', reorder_point: '5', par_level: '10', available_quantity: '2' }],
      {},
    );
    const result = await draftAutoReorderRequests(client, { restaurantId: 3, actorUserId: USER_ID });
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    const insert = mockQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO restaurant_inventory_purchase_requests'));
    expect(insert).toBeDefined();
    // par 10 - available 2 = 8 kg.
    expect(insert[1][3]).toBe(8);
    expect(insert[1][8]).toBe('auto:3:17:7');
    expect(result.created[0].status).toBe('pending');
    expect(result.created[0].source).toBe('auto_reorder');
  });

  test('without a par level the draft covers the reorder shortfall', async () => {
    mockDraftQueries(
      [{ id: 18, name: 'Buns', unit: 'each', supplier_name: null, location_id: null, quantity: '1', reorder_point: '10', par_level: null, available_quantity: '1' }],
      {},
    );
    const result = await draftAutoReorderRequests(client, { restaurantId: 3, actorUserId: USER_ID });
    expect(result.created).toHaveLength(1);
    const insert = mockQuery.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO restaurant_inventory_purchase_requests'));
    expect(insert[1][3]).toBe(9);
    expect(insert[1][8]).toBe('auto:3:18:all');
  });

  test('an item with an already-open request is skipped, never double-drafted', async () => {
    mockDraftQueries(
      [{ id: 17, name: 'Chicken', unit: 'kg', supplier_name: 'Atlantic Foods', location_id: 7, quantity: '2', reorder_point: '5', par_level: '10', available_quantity: '2' }],
      { 17: { id: 400, status: 'pending', source: 'manual' } },
    );
    const result = await draftAutoReorderRequests(client, { restaurantId: 3, actorUserId: USER_ID });
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('open_request_exists');
    expect(result.skipped[0].open_request_id).toBe(400);
    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO restaurant_inventory_purchase_requests'))).toBe(false);
  });
});

describe('Phase 6: PO approval gate (requester != approver)', () => {
  // The mocked scopeModel access row is restaurant 3; the URLs use it too.
  function mockUpdateQueries(updatedRow, withApproverRow = null) {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('UPDATE restaurant_inventory_purchase_requests SET status')) return { rows: [updatedRow] };
      if (sql.includes('SET approved_by = COALESCE')) {
        return { rows: withApproverRow ? [withApproverRow] : [] };
      }
      return { rows: [] };
    });
  }

  test('the requester cannot approve their own request: 409 and the move rolls back', async () => {
    mockUpdateQueries({ id: 77, restaurant_id: 3, status: 'approved', requested_by: USER_ID, approved_by: null });
    const response = await request(inventoryApp()).patch('/3/inventory/purchase-requests/77').send({ status: 'approved' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('purchase_approval_self_approval');
    // The approver-recording UPDATE never ran: the status move rolled back.
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('SET approved_by'))).toBe(false);
  });

  test('a second manager approves and is recorded as the approver', async () => {
    const requesterId = '00000000-0000-4000-8000-000000000999';
    mockUpdateQueries(
      { id: 77, restaurant_id: 3, status: 'approved', requested_by: requesterId, approved_by: null },
      { id: 77, restaurant_id: 3, status: 'approved', requested_by: requesterId, approved_by: USER_ID },
    );
    const response = await request(inventoryApp()).patch('/3/inventory/purchase-requests/77').send({ status: 'approved' });
    expect(response.status).toBe(200);
    expect(response.body.request.approved_by).toBe(USER_ID);
    const approverUpdate = mockQuery.mock.calls.find(([sql]) => sql.includes('SET approved_by'));
    expect(approverUpdate).toBeDefined();
    expect(approverUpdate[1]).toEqual([77, USER_ID, 3]);
  });

  test('a request cannot be created already approved', async () => {
    const response = await request(inventoryApp()).post('/3/inventory/purchase-requests').send({ itemName: 'Chicken', requestedQuantity: 5, status: 'approved' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('purchase_request_requires_approval');
    expect(mockQuery.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO restaurant_inventory_purchase_requests'))).toBe(false);
  });

  test('moving a request to received is not gated: the requester may receive', async () => {
    mockUpdateQueries({ id: 77, restaurant_id: 3, status: 'received', requested_by: USER_ID, approved_by: null });
    const response = await request(inventoryApp()).patch('/3/inventory/purchase-requests/77').send({ status: 'received' });
    expect(response.status).toBe(200);
    expect(response.body.request.status).toBe('received');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('SET approved_by'))).toBe(false);
  });
});

describe('Phase 6: hours-weighted tip-out', () => {
  const ALICE = '00000000-0000-4000-8000-0000000000a1';
  const BOB = '00000000-0000-4000-8000-0000000000a2';
  const CAROL = '00000000-0000-4000-8000-0000000000a3';
  const restaurant = { id: 3, business_id: 42, currency_code: 'USD', timezone: 'America/New_York' };

  function mockTipQueries(weightBasis) {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM restaurant_tip_pool_settings')) {
        return { rows: [{ restaurant_id: 3, pooling_enabled: true, tip_out_rules: [{ target_type: 'role', target_key: 'server', percent_bps: 1000, ...(weightBasis ? { weight_basis: weightBasis } : {}) }], updated_by: null, updated_at: null }] };
      }
      if (sql.includes('GROUP BY 1, 2')) {
        return { rows: [
          { currency: 'USD', staff_user_id: ALICE, tips_cents: 6000 },
          { currency: 'USD', staff_user_id: BOB, tips_cents: 4000 },
        ] };
      }
      if (sql.includes('FROM restaurant_declared_cash_tips')) return { rows: [] };
      if (sql.includes('FROM business_members bm')) {
        return { rows: [
          { user_id: ALICE, name: 'Alice', membership_role: 'member', job_role: 'server', hourly_wage_cents: 1500 },
          { user_id: BOB, name: 'Bob', membership_role: 'member', job_role: 'server', hourly_wage_cents: 1500 },
          { user_id: CAROL, name: 'Carol', membership_role: 'member', job_role: 'server', hourly_wage_cents: 1500 },
        ] };
      }
      if (sql.includes('FROM business_time_entries')) {
        return { rows: [
          { user_id: ALICE, hours: 10 },
          { user_id: BOB, hours: 30 },
        ] };
      }
      return { rows: [] };
    });
  }

  test('normalizeTipOutRules defaults weight_basis to equal and rejects unknown values', () => {
    expect(normalizeTipOutRules([{ target_type: 'role', target_key: 'server', percent_bps: 1000 }]))
      .toEqual([{ target_type: 'role', target_key: 'server', percent_bps: 1000, weight_basis: 'equal' }]);
    expect(normalizeTipOutRules([{ target_type: 'role', target_key: 'server', percent_bps: 1000, weight_basis: 'hours' }])[0].weight_basis).toBe('hours');
    expect(normalizeTipOutRules([{ target_type: 'role', target_key: 'server', percent_bps: 1000, weight_basis: 'gross_tips' }])[0].weight_basis).toBe('gross_tips');
    expect(() => normalizeTipOutRules([{ target_type: 'role', target_key: 'server', percent_bps: 1000, weight_basis: 'seniority' }]))
      .toThrow(/weight_basis must be 'equal', 'hours', or 'gross_tips'/);
  });

  test('hours basis splits the pot by hours worked: 10h vs 30h of a 1000c pot', async () => {
    mockTipQueries('hours');
    const result = await computeTipAllocations({ restaurant, fromDate: '2026-11-01', toDate: '2026-11-07' });
    const employees = result.currencies[0].employees;
    const alice = employees.find((e) => e.user_id === ALICE);
    const bob = employees.find((e) => e.user_id === BOB);
    // Pot is 10% of 10000c = 1000c; hours 10:30 -> 250 : 750.
    expect(alice.tip_in_cents).toBe(250);
    expect(bob.tip_in_cents).toBe(750);
    // Deductions stay gross-proportional: Alice 600, Bob 400.
    expect(alice.tip_out_cents).toBe(600);
    expect(bob.tip_out_cents).toBe(400);
    // Carol worked no hours and earned no tips: no share, not in the pool.
    expect(employees.find((e) => e.user_id === CAROL)).toBeUndefined();
  });

  test('equal basis (the default for existing rules) splits by headcount', async () => {
    mockTipQueries(null);
    const result = await computeTipAllocations({ restaurant, fromDate: '2026-11-01', toDate: '2026-11-07' });
    const employees = result.currencies[0].employees;
    expect(employees.find((e) => e.user_id === ALICE).tip_in_cents).toBe(500);
    expect(employees.find((e) => e.user_id === BOB).tip_in_cents).toBe(500);
  });

  test('gross_tips basis splits the pot by tips earned', async () => {
    mockTipQueries('gross_tips');
    const result = await computeTipAllocations({ restaurant, fromDate: '2026-11-01', toDate: '2026-11-07' });
    const employees = result.currencies[0].employees;
    // Gross 6000:4000 -> 600 : 400 of the 1000c pot.
    expect(employees.find((e) => e.user_id === ALICE).tip_in_cents).toBe(600);
    expect(employees.find((e) => e.user_id === BOB).tip_in_cents).toBe(400);
  });

  test('zero weight for every recipient falls back to equal so the pot still distributes in full', async () => {
    mockTipQueries('hours');
    // Remove all hours: both recipients weigh zero under hours.
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM restaurant_tip_pool_settings')) {
        return { rows: [{ restaurant_id: 3, pooling_enabled: true, tip_out_rules: [{ target_type: 'role', target_key: 'server', percent_bps: 1000, weight_basis: 'hours' }], updated_by: null, updated_at: null }] };
      }
      if (sql.includes('GROUP BY 1, 2')) {
        return { rows: [
          { currency: 'USD', staff_user_id: ALICE, tips_cents: 6000 },
          { currency: 'USD', staff_user_id: BOB, tips_cents: 4000 },
        ] };
      }
      if (sql.includes('FROM restaurant_declared_cash_tips')) return { rows: [] };
      if (sql.includes('FROM business_members bm')) {
        return { rows: [
          { user_id: ALICE, name: 'Alice', membership_role: 'member', job_role: 'server', hourly_wage_cents: 1500 },
          { user_id: BOB, name: 'Bob', membership_role: 'member', job_role: 'server', hourly_wage_cents: 1500 },
        ] };
      }
      if (sql.includes('FROM business_time_entries')) return { rows: [] };
      return { rows: [] };
    });
    const result = await computeTipAllocations({ restaurant, fromDate: '2026-11-01', toDate: '2026-11-07' });
    const employees = result.currencies[0].employees;
    expect(employees.find((e) => e.user_id === ALICE).tip_in_cents).toBe(500);
    expect(employees.find((e) => e.user_id === BOB).tip_in_cents).toBe(500);
  });
});
