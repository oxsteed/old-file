'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return { ...actual, hasGlobalGrant: jest.fn() };
});
jest.mock('../utils/schemaProbe', () => ({
  tableExists: jest.fn().mockResolvedValue(true),
  columnExists: jest.fn().mockResolvedValue(true),
  probeSchema: jest.fn().mockResolvedValue({}),
  userIdEq: jest.fn((column) => `${column} = $1`),
  ACTIVE_JOB_STATUS_SQL_IN: '',
}));

const { hasGlobalGrant } = require('../middleware/adminAuth');
const superCtrl = require('../controllers/superAdminController');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function makeReq(role = 'admin') {
  return {
    user: { id: 'admin-1', role },
    query: {},
  };
}

function installQueries() {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT COUNT(*) FROM users')) return { rows: [{ count: '1' }] };
    if (text.includes('COUNT(*) FILTER')) return { rows: [{ total: '1', active: '1', suspended: '0', helpers: '0', customers: '1', new_this_week: '1' }] };
    if (text.includes('SELECT u.id')) return { rows: [{ id: 'user-1', email: 'user@example.test', role: 'customer', earnings_total: '0' }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  installQueries();
  hasGlobalGrant.mockResolvedValue(false);
});

test('manage_users-only admins do not receive payout totals in the user list query', async () => {
  const res = makeRes();
  await superCtrl.getUsers(makeReq(), res);

  const userQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SELECT u.id'))?.[0];
  expect(userQuery).toBeDefined();
  expect(userQuery).not.toContain('FROM payouts');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    users: expect.arrayContaining([expect.objectContaining({ earnings_total: '0' })]),
  }));
  expect(hasGlobalGrant).toHaveBeenCalledWith('admin-1', 'view_financials');
});

test('a financial-grant admin keeps the payout total field', async () => {
  hasGlobalGrant.mockResolvedValue(true);
  const res = makeRes();
  await superCtrl.getUsers(makeReq(), res);

  const userQuery = mockQuery.mock.calls.find(([sql]) => String(sql).includes('SELECT u.id'))?.[0];
  expect(userQuery).toContain('FROM payouts');
});
