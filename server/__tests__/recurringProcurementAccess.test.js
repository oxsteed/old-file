'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));
jest.mock('../services/permissionsService', () => ({
  getEffectivePermissions: jest.fn(),
}));

const pool = require('../db');
const permissionsService = require('../services/permissionsService');
const service = require('../services/recurringProcurementService');

function mockBusiness({ owner = 'owner-1', memberRole = 'employee', memberId = 7 } = {}) {
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM businesses b')) {
      return { rows: [{ id: 10, user_id: owner, membership_id: memberId, role: memberRole }] };
    }
    if (sql.includes('FROM sourcing_requests')) return { rows: [{ business_id: 10 }] };
    if (sql.includes('INSERT INTO logistics_recurring_procurement_programs')) {
      return { rows: [{ id: 22, business_id: 10, owner_user_id: 'buyer-1', title: 'Restock' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  permissionsService.getEffectivePermissions.mockResolvedValue({ permissions: new Set() });
});

test('business owner can create a business-scoped recurring procurement program', async () => {
  mockBusiness({ owner: 'buyer-1' });
  const row = await service.createProgram({ business_id: 10, sourcing_request_id: 9, title: 'Restock' }, 'buyer-1');
  expect(row).toMatchObject({ business_id: 10, title: 'Restock' });
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO logistics_recurring_procurement_programs'))).toBe(true);
});

test('employee scope needs a procurement permission and cannot attach a request from another business', async () => {
  mockBusiness({ owner: 'owner-1', memberRole: 'employee' });
  permissionsService.getEffectivePermissions.mockResolvedValue({ permissions: new Set(['products.manage']) });
  await expect(service.createProgram({ business_id: 10, sourcing_request_id: 9, title: 'Restock' }, 'buyer-1'))
    .resolves.toMatchObject({ business_id: 10 });

  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM businesses b')) return { rows: [{ id: 10, user_id: 'owner-1', membership_id: 7, role: 'employee' }] };
    if (sql.includes('FROM sourcing_requests')) return { rows: [{ business_id: 11 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await expect(service.createProgram({ business_id: 10, sourcing_request_id: 9, title: 'Mixed context' }, 'buyer-1'))
    .rejects.toMatchObject({ code: 'reference_mismatch', statusCode: 400 });
});

test('employee without procurement scope is denied even when active in the business', async () => {
  mockBusiness({ owner: 'owner-1', memberRole: 'employee' });
  await expect(service.createProgram({ business_id: 10, title: 'Restock' }, 'buyer-1'))
    .rejects.toMatchObject({ code: 'business_procurement_access_denied', statusCode: 403 });
});
