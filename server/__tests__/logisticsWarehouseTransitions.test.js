'use strict';

/**
 * Warehouse enforcement coverage:
 *  - warehouseService.receiveInventory / reconcileReceipt route status
 *    changes through the canonical inventory_receipt machine
 *    (fake pg client, real applyTransition)
 *  - warehouseService.transitionDeliveryOrder routes status changes through
 *    the canonical delivery_order machine
 *  - DELIVERY_TRANSITIONS graph edges exercised by the new transition path
 */

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));

const sm = require('../services/logisticsStateMachine');
const pool = require('../db');
const warehouseService = require('../services/warehouseService');

function mockClientFor(status) {
  const queries = [];
  const client = {
    query: jest.fn(async (text, params) => {
      queries.push({ text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SELECT')) return { rows: status === null ? [] : [{ status }] };
      if (text.startsWith('UPDATE')) return { rows: [{ id: 42, status: params[0] }] };
      throw new Error(`unexpected query: ${text}`);
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return { client, queries };
}

beforeEach(() => { jest.clearAllMocks(); });

// ─── 1. receiveInventory ──────────────────────────────────────────

describe('receiveInventory', () => {
  test('expected → receiving when quantities match; stamps receipt metadata', async () => {
    const { queries } = mockClientFor('expected');
    const record = await warehouseService.receiveInventory(42, {
      receivedQty: 100, shortageQty: 0, damagedQty: 0,
      storageLocation: 'A-12', notes: 'all good', actorUserId: 'u7',
    });
    expect(record).toMatchObject({ id: 42, status: 'receiving' });
    const select = queries.find((q) => q.text.startsWith('SELECT'));
    expect(select.text).toContain('FROM inventory_receipts');
    expect(select.text).toContain('FOR UPDATE');
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('inventory_receipts');
    expect(update.text).toContain('received_at = NOW()');
    expect(update.text).toContain('received_by = $6');
    expect(update.params).toEqual(['receiving', 100, 0, 0, 'A-12', 'u7', 'all good', 42]);
    expect(queries.map((q) => q.text)).toContain('COMMIT');
  });

  test('expected → discrepancy when a shortage is found (new canonical edge)', async () => {
    const { queries } = mockClientFor('expected');
    const record = await warehouseService.receiveInventory(42, {
      receivedQty: 90, shortageQty: 10, damagedQty: 0, actorUserId: 'u7',
    });
    expect(record).toMatchObject({ status: 'discrepancy' });
    expect(queries.map((q) => q.text)).toContain('COMMIT');
  });

  test('receiving → discrepancy on a second receive with damage', async () => {
    mockClientFor('receiving');
    const record = await warehouseService.receiveInventory(42, {
      receivedQty: 95, shortageQty: 0, damagedQty: 5, actorUserId: 'u7',
    });
    expect(record).toMatchObject({ status: 'discrepancy' });
  });

  test('closed receipt cannot be received again: 409 + rollback, no UPDATE', async () => {
    const { queries } = mockClientFor('closed');
    await expect(
      warehouseService.receiveInventory(42, { receivedQty: 100, actorUserId: 'u7' })
    ).rejects.toMatchObject({
      code: 'invalid_transition', status: 409,
      details: { from: 'closed', to: 'receiving' },
    });
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
    expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  test('missing receipt: 404', async () => {
    mockClientFor(null);
    await expect(
      warehouseService.receiveInventory(999, { receivedQty: 100, actorUserId: 'u7' })
    ).rejects.toMatchObject({ code: 'inventory_receipt_not_found', status: 404 });
  });
});

// ─── 2. reconcileReceipt ──────────────────────────────────────────

describe('reconcileReceipt', () => {
  test('discrepancy → reconciled appends notes and stamps reconciled_at', async () => {
    const { queries } = mockClientFor('discrepancy');
    const record = await warehouseService.reconcileReceipt(42, 'u7', 'shortage explained by supplier');
    expect(record).toMatchObject({ status: 'reconciled' });
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('reconciled_at = NOW()');
    expect(update.text).toContain("COALESCE(discrepancy_notes,'')");
    expect(update.params).toEqual(['reconciled', '\nshortage explained by supplier', 42]);
  });

  test('receiving → reconciled is legal', async () => {
    mockClientFor('receiving');
    const record = await warehouseService.reconcileReceipt(42, 'u7', null);
    expect(record).toMatchObject({ status: 'reconciled' });
  });

  test('expected → reconciled is illegal (must receive first)', async () => {
    mockClientFor('expected');
    await expect(
      warehouseService.reconcileReceipt(42, 'u7', null)
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
  });
});

// ─── 3. transitionDeliveryOrder ───────────────────────────────────

describe('transitionDeliveryOrder', () => {
  test('pending → assigned records carrier/tracking/assignee', async () => {
    const { queries } = mockClientFor('pending');
    const record = await warehouseService.transitionDeliveryOrder(55, 'assigned', 'u7', {
      carrier: 'DHL', trackingNumber: 'TRK-1', assignedTo: 'driver-9',
    });
    expect(record).toMatchObject({ status: 'assigned' });
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('delivery_orders');
    expect(update.text).toContain('carrier = $2');
    expect(update.text).toContain('tracking_number = $3');
    expect(update.text).toContain('assigned_to = $4');
    expect(update.params).toEqual(['assigned', 'DHL', 'TRK-1', 'driver-9', 55]);
    expect(update.text).not.toContain('delivered_at');
  });

  test('in_transit → delivered stamps delivered_at', async () => {
    const { queries } = mockClientFor('in_transit');
    const record = await warehouseService.transitionDeliveryOrder(55, 'delivered', 'u7', {
      notes: 'left at reception',
    });
    expect(record).toMatchObject({ status: 'delivered' });
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('delivered_at = NOW()');
    expect(update.text).toContain("COALESCE(delivery_notes,'')");
    expect(update.params).toEqual(['delivered', '\nleft at reception', 55]);
  });

  test('pending → delivered is illegal (must assign first)', async () => {
    mockClientFor('pending');
    await expect(
      warehouseService.transitionDeliveryOrder(55, 'delivered', 'u7')
    ).rejects.toMatchObject({
      code: 'invalid_transition', status: 409,
      details: { from: 'pending', to: 'delivered', allowed: ['assigned', 'cancelled'] },
    });
  });

  test('failed → pending retries the delivery', async () => {
    mockClientFor('failed');
    const record = await warehouseService.transitionDeliveryOrder(55, 'pending', 'u7');
    expect(record).toMatchObject({ status: 'pending' });
  });

  test('delivered is terminal: cannot move again', async () => {
    mockClientFor('delivered');
    await expect(
      warehouseService.transitionDeliveryOrder(55, 'in_transit', 'u7')
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
  });

  test('missing delivery: 404', async () => {
    mockClientFor(null);
    await expect(
      warehouseService.transitionDeliveryOrder(999, 'assigned', 'u7')
    ).rejects.toMatchObject({ code: 'delivery_order_not_found', status: 404 });
  });
});

// ─── 4. Delivery graph exercised by the transition path ───────────

describe('DELIVERY_TRANSITIONS', () => {
  test('full lifecycle pending → assigned → in_transit → delivered', () => {
    const m = sm.delivery;
    expect(m.canTransition('pending', 'assigned')).toBe(true);
    expect(m.canTransition('assigned', 'in_transit')).toBe(true);
    expect(m.canTransition('in_transit', 'delivered')).toBe(true);
    expect(m.canTransition('delivered', 'pending')).toBe(false);
  });

  test('failure recovery and cancellation edges', () => {
    const m = sm.delivery;
    expect(m.canTransition('in_transit', 'failed')).toBe(true);
    expect(m.canTransition('failed', 'pending')).toBe(true);
    expect(m.canTransition('failed', 'cancelled')).toBe(true);
    expect(m.canTransition('pending', 'cancelled')).toBe(true);
    expect(m.canTransition('assigned', 'cancelled')).toBe(true);
    expect(m.canTransition('cancelled', 'pending')).toBe(false);
  });

  test('machineFor resolves delivery_order to the delivery machine', () => {
    expect(sm.machineFor('delivery_order')).toBe(sm.delivery);
    expect(sm.machineFor('inventory_receipt')).toBe(sm.receipt);
  });

  test('ops sees delivery actions; guest sees blockers', () => {
    const ops = { logisticsRole: 'warehouse_operator', userId: 'u7', isAdmin: false };
    const { actions, blockers } = sm.getAvailableActions('delivery_order', 'pending', ops);
    expect(actions).toEqual([
      { action: 'assign_delivery', to: 'assigned' },
      { action: 'cancel_delivery', to: 'cancelled' },
    ]);
    expect(blockers).toEqual([]);
  });
});
