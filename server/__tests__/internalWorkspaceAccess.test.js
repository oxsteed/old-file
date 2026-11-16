'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/corporateRolesService', () => ({
  getCatalog: jest.fn(),
  getEffectiveCorporatePermissions: jest.fn(),
}));

const db = require('../db');
const corporateRolesService = require('../services/corporateRolesService');
const controller = require('../controllers/internalWorkspacesController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

const catalog = {
  departments: [{ id: 7, code: 'finance', name: 'Finance', permissions: ['finance.view_payouts'] }],
  titles: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  corporateRolesService.getCatalog.mockResolvedValue(catalog);
  corporateRolesService.getEffectiveCorporatePermissions.mockResolvedValue({
    permissions: new Set(['finance.view_payouts']),
    assignments: [{ department_code: 'finance', title_code: 'controller' }],
  });
});

test('a consumer with the same location preference cannot enter an internal workspace', async () => {
  const res = response();
  const next = jest.fn();
  await controller.getWorkspaceDashboard({
    params: { workspace: 'finance' },
    user: { id: 'customer-1', role: 'customer', country: 'US', state: 'OH', city: 'Columbus' },
  }, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
  expect(corporateRolesService.getCatalog).not.toHaveBeenCalled();
  expect(db.query).not.toHaveBeenCalled();
});

test('an active employee assignment can enter the matching workspace', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ 1: 1 }] })
    .mockResolvedValueOnce({ rows: [{ user_id: 'employee-1', role: 'employee' }] });
  const res = response();
  const next = jest.fn();

  await controller.getWorkspaceDashboard({
    params: { workspace: 'finance' },
    user: { id: 'employee-1', role: 'employee', internal_access_route: 'finance' },
    query: {},
  }, res, next);

  expect(res.status).not.toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ workspace: 'finance' }),
  }));
});

test('removing the assignment denies the internal workspace before reading its roster', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  const res = response();
  const next = jest.fn();

  await controller.getWorkspaceDashboard({
    params: { workspace: 'finance' },
    user: { id: 'employee-1', role: 'employee', internal_access_route: 'finance' },
  }, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'forbidden' }));
  expect(corporateRolesService.getCatalog).not.toHaveBeenCalled();
  expect(db.query).toHaveBeenCalledTimes(1);
});
