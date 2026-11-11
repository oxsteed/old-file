'use strict';

const { mockQuery, resetMocks } = require('./setup');
const pool = require('../db');
const property = require('../controllers/propertyOperationsController');
const trades = require('../controllers/tradesOperationsController');
const professional = require('../controllers/professionalOperationsController');

beforeEach(() => resetMocks());

function response() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

function installWorkspaceClient(settingsTable) {
  const client = {
    query: jest.fn(async (sql) => {
      if (String(sql).includes(`FROM ${settingsTable}`)) return { rows: [{}] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  mockQuery.mockResolvedValue({ rows: [{ id: 7, business_name: 'Live business', active_template: 'default', is_active: true }] });
  return client;
}

describe('public business workspaces only resolve live public businesses', () => {
  test.each([
    ['property', property.getPublicWorkspace, 'property_operation_settings'],
    ['trades', trades.getPublicWorkspace, 'trades_operation_settings'],
    ['professional', professional.getPublicWorkspace, 'professional_operation_settings'],
  ])('%s workspace applies the public business visibility contract', async (_name, handler, settingsTable) => {
    const client = installWorkspaceClient(settingsTable);
    const req = { params: { businessId: '7' } };
    const res = response();
    const next = jest.fn();

    await handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const businessQuery = mockQuery.mock.calls[0][0];
    expect(businessQuery).toMatch(/b\.deleted_at IS NULL/);
    expect(businessQuery).toMatch(/b\.is_listed = TRUE/);
    expect(businessQuery).toMatch(/COALESCE\(b\.is_hidden_by_admin, FALSE\) = FALSE/);
    expect(businessQuery).toMatch(/b\.business_kind = 'service'/);
    expect(businessQuery).toMatch(/u\.is_active = TRUE/);
    expect(client.release).toHaveBeenCalled();
  });

  test.each([
    ['trades', trades.createDiagnosticRequest],
    ['professional', professional.createEngagementRequest],
  ])('%s anonymous intake uses the public business visibility contract', async (_name, handler) => {
    mockQuery.mockResolvedValue({ rows: [] });
    const req = { params: { businessId: '7' }, body: {} };
    const res = response();
    const next = jest.fn();

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_found' }));
    const businessQuery = mockQuery.mock.calls[0][0];
    expect(businessQuery).toMatch(/b\.deleted_at IS NULL/);
    expect(businessQuery).toMatch(/b\.is_listed = TRUE/);
    expect(businessQuery).toMatch(/b\.business_kind = 'service'/);
    expect(res.json).not.toHaveBeenCalled();
  });
});
