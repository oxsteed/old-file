'use strict';

/**
 * Country/region improvements: country_code validation.
 *
 * createAssignment and updateAssignment must reject malformed or unknown
 * ISO-2 country codes with a 400 (invalid_country_code) instead of writing
 * them to the database. Empty input means global scope (null).
 */

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../services/corporateRolesService', () => ({
  getMaxActiveSeniority: jest.fn(),
  invalidateCache: jest.fn(),
}));

const pool = require('../db');
const ctrl = require('../controllers/corporateRolesController');

function mockRes() {
  const res = {};
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('assignment country_code validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('createAssignment rejects a malformed country code', async () => {
    const req = {
      body: { user_id: 'u-1', title_id: 1, country_code: 'USA' },
      user: { id: 'u-admin', role: 'super_admin' },
      isSuper: true,
    };
    const res = mockRes();
    await ctrl.createAssignment(req, res, (e) => { throw e; });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe('invalid_country_code');
    // No DB work should have happened
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('createAssignment rejects an unknown 2-letter code', async () => {
    const req = {
      body: { user_id: 'u-1', title_id: 1, country_code: 'XX' },
      user: { id: 'u-admin', role: 'super_admin' },
      isSuper: true,
    };
    const res = mockRes();
    await ctrl.createAssignment(req, res, (e) => { throw e; });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body.code).toBe('invalid_country_code');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('createAssignment normalizes lowercase codes to uppercase', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'u-1', role: 'employee', is_active: true }] }) // user
        .mockResolvedValueOnce({ rows: [{ id: 1, department_id: 5, code: 'mgr', name: 'Manager', seniority_level: 4, is_csuite: false, is_active: true }] }) // title
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT
        .mockResolvedValueOnce(), // COMMIT
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const req = {
      body: { user_id: 'u-1', title_id: 1, country_code: 'us' },
      user: { id: 'u-admin', role: 'super_admin' },
      isSuper: true,
    };
    const res = mockRes();
    await ctrl.createAssignment(req, res, (e) => { throw e; });
    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = client.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO corporate_assignments'));
    expect(insertCall[1][3]).toBe('US');
  });
});
