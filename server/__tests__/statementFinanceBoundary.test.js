'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/permissionsService', () => ({
  getEffectivePermissions: jest.fn(),
  hasAny: jest.fn((permissions, codes) => codes.some((code) => permissions?.has?.(code) || permissions?.includes?.(code))),
}));

const permissionsService = require('../services/permissionsService');
const { getStatementCenter } = require('../services/statementCenterService');

const USER_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  resetMocks();
  permissionsService.getEffectivePermissions.mockReset();
  permissionsService.getEffectivePermissions.mockResolvedValue({ permissions: new Set() });
  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('FROM businesses b')) {
      return { rows: [{ id: 42, name: 'Acme Co', is_owner: false }] };
    }
    if (sql.includes('FROM business_members')) {
      return { rows: [{ id: 7, role: 'manager' }] };
    }
    return { rows: [] };
  });
});

test('business manager without payouts.view has no Statement Center business scope', async () => {
  permissionsService.getEffectivePermissions.mockResolvedValue({ permissions: new Set(['orders.view']) });

  const result = await getStatementCenter(USER_ID);

  expect(result.products.business.hasAccount).toBe(false);
  expect(result.products.business.scopes).toEqual([]);
  expect(permissionsService.getEffectivePermissions).toHaveBeenCalledWith(expect.objectContaining({
    businessId: 42,
    userId: USER_ID,
    role: 'manager',
    membershipId: 7,
  }));
});

test('business manager with payouts.view receives only the authorized business scope', async () => {
  permissionsService.getEffectivePermissions.mockResolvedValue({ permissions: new Set(['payouts.view']) });

  const result = await getStatementCenter(USER_ID);

  expect(result.products.business.hasAccount).toBe(true);
  expect(result.products.business.scopes).toEqual(expect.arrayContaining([
    expect.objectContaining({ businessId: '42', scopeKey: 'business:42' }),
  ]));
});

