'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));
jest.mock('../services/logisticsStateMachine', () => ({ applyTransition: jest.fn() }));
jest.mock('../services/recurringProcurementService', () => ({
  assertBusinessProcurementAccess: jest.fn(),
  listProcurementBusinessIds: jest.fn(),
  hasBusinessProcurementAccess: jest.fn(),
}));

const pool = require('../db');
const recurring = require('../services/recurringProcurementService');
const service = require('../services/sourcingService');

beforeEach(() => {
  jest.clearAllMocks();
  recurring.listProcurementBusinessIds.mockResolvedValue([10]);
  recurring.assertBusinessProcurementAccess.mockResolvedValue(undefined);
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes("nextval('sourcing_request_seq')")) return { rows: [{ seq: 12 }] };
    if (sql.includes('COUNT(*)')) return { rows: [{ count: '1' }] };
    if (sql.includes('SELECT sr.*')) return { rows: [{ id: 4, business_id: 10, user_id: 'owner-1' }] };
    if (sql.includes('INSERT INTO sourcing_requests')) return { rows: [{ id: 4, business_id: 10, user_id: 'member-1' }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
});

test('business-scoped sourcing requests require procurement authority', async () => {
  await service.createSourcingRequest({ business_id: 10, title: 'A restock', category: 'food' }, 'member-1');
  expect(recurring.assertBusinessProcurementAccess).toHaveBeenCalledWith(10, 'member-1');
});

test('procurement members see their own requests plus requests for authorized businesses', async () => {
  const result = await service.listSourcingRequests({ userId: 'member-1', limit: 20, offset: 0 });
  expect(result.requests).toHaveLength(1);
  expect(recurring.listProcurementBusinessIds).toHaveBeenCalledWith('member-1');
  const listQuery = pool.query.mock.calls.find(([sql]) => sql.includes('SELECT sr.*'))?.[0];
  expect(listQuery).toContain('business_id = ANY');
});
