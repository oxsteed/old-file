'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));
jest.mock('../services/logisticsTransitionGuards', () => ({ registerLogisticsGuards: jest.fn() }));
jest.mock('../services/logisticsAccessService', () => ({
  evaluateAccess: jest.fn().mockResolvedValue({ allowed: true }),
}));
jest.mock('../services/logisticsPricingService', () => ({ calculateLandedCost: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn() }));

const pool = require('../db');
const service = require('../services/pooledOrderService');

function setup({ order, next = { id: 18, status: 'draft', approval_state: 'draft', current_committed_qty: 0 } }) {
  const client = { query: jest.fn(), release: jest.fn() };
  client.query.mockImplementation(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('SELECT * FROM pooled_orders')) return { rows: [order] };
    if (text.includes('INSERT INTO pooled_orders')) return { rows: [next] };
    throw new Error(`Unexpected client query: ${text}`);
  });
  pool.connect.mockResolvedValue(client);
  pool.query.mockImplementation(async (text) => {
    if (text.includes('FROM logistics_lanes')) return { rows: [{ id: order.lane_id, requires_business_verification: false }] };
    if (text.includes('FROM businesses')) return { rows: [] };
    throw new Error(`Unexpected pool query: ${text}`);
  });
  return client;
}

beforeEach(() => jest.clearAllMocks());

test('rollover creates a clean draft and does not carry supplier quote, participation, or approval state', async () => {
  const order = {
    id: 17,
    organizer_user_id: 'organizer-1',
    organizer_business_id: null,
    lane_id: 3,
    supplier_product_id: 9,
    supplier_quote_id: 42,
    title: 'Solar lanterns',
    description: 'Community pool',
    target_moq: 100,
    current_committed_qty: 20,
    unit_product_cost_usd: '12.5000',
    unit_freight_est_usd: '2.0000',
    close_date: '2026-01-01T00:00:00.000Z',
    status: 'pledging',
    approval_state: 'approved',
    deposit_pct: '0.30',
    max_participants: 25,
    expected_ship_date: null,
    expected_arrival_date: null,
    cancellation_policy: 'Refund before lock',
    destination_warehouse_id: 5,
    notes: 'Original note',
  };
  const client = setup({ order });
  const result = await service.rolloverCampaign(17, 'organizer-1', {
    userCountry: 'US', userRole: 'organizer', data: { title: 'Solar lanterns next round' },
  });
  expect(result).toEqual(expect.objectContaining({ id: 18, status: 'draft', approval_state: 'draft' }));
  const insert = client.query.mock.calls.find(([text]) => text.includes('INSERT INTO pooled_orders'));
  expect(insert).toBeTruthy();
  expect(insert[1]).toEqual(expect.arrayContaining(['Solar lanterns next round', 3, 9, 'organizer-1', 100]));
  expect(insert[1]).not.toContain(42);
  expect(client.query.mock.calls.map(([text]) => text)).toContain('COMMIT');
});

test('rollover rejects an active campaign and a foreign organizer', async () => {
  const active = {
    id: 17, organizer_user_id: 'organizer-1', lane_id: 3, target_moq: 100,
    current_committed_qty: 20, close_date: '2099-01-01T00:00:00.000Z', status: 'pledging',
  };
  setup({ order: active });
  await expect(service.rolloverCampaign(17, 'organizer-1', { userCountry: 'US', userRole: 'organizer' }))
    .rejects.toMatchObject({ code: 'campaign_not_rolloverable', status: 409 });

  const expired = { ...active, close_date: '2026-01-01T00:00:00.000Z' };
  setup({ order: expired });
  await expect(service.rolloverCampaign(17, 'different-user', { userCountry: 'US', userRole: 'individual_buyer' }))
    .rejects.toMatchObject({ code: 'not_owner', status: 403 });

  setup({ order: { ...expired, organizer_user_id: 'organizer-1' } });
  await expect(service.rolloverCampaign(17, 'organizer-1', { userCountry: 'US', userRole: 'individual_buyer' }))
    .rejects.toMatchObject({ code: 'organizer_access_required', status: 403 });
});
