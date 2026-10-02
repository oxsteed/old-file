'use strict';

/**
 * E05 — ticket list/detail honor the regional scope (controller level).
 */

const { mockQuery, resetMocks } = require('./setup');

const supportController = require('../controllers/supportController');

const REGION_US = {
  id: 7,
  name: 'US South',
  boundary_definition: { type: 'country_only', countries: ['US'] },
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (sql.trimStart().startsWith('SELECT COUNT(*)')) return { rows: [{ total: 0 }] };
    return { rows: [], rowCount: 0 };
  });
});

describe('E05 ticket list scoping', () => {
  test('regional admin list query is restricted to their region', async () => {
    const req = {
      user: { id: 'admin-1', role: 'admin' },
      isSuper: false,
      assigned_regions: [REGION_US],
      query: {},
    };
    const res = mockRes();
    await supportController.listTickets(req, res);

    const dataSql = mockQuery.mock.calls[0][0];
    expect(dataSql).toContain('u.id IS NOT NULL');
    expect(dataSql).toContain('UPPER(u.country)');
    expect(mockQuery.mock.calls[0][1]).toContain('US');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ tickets: [], total: 0 })
    );
  });

  test('regional admin with no regions sees no tickets', async () => {
    const req = {
      user: { id: 'admin-1', role: 'admin' },
      isSuper: false,
      assigned_regions: [],
      query: {},
    };
    const res = mockRes();
    await supportController.listTickets(req, res);

    const dataSql = mockQuery.mock.calls[0][0];
    expect(dataSql).toContain('FALSE');
  });

  test('super-admin list query stays unscoped', async () => {
    const req = {
      user: { id: 'super-1', role: 'super_admin' },
      isSuper: true,
      query: {},
    };
    const res = mockRes();
    await supportController.listTickets(req, res);

    const dataSql = mockQuery.mock.calls[0][0];
    expect(dataSql).not.toContain('u.id IS NOT NULL');
    expect(dataSql).not.toContain('FALSE');
  });

  test('missing scope fails closed with 503, not unscoped data', async () => {
    const req = {
      user: { id: 'admin-1', role: 'admin' },
      isSuper: false,
      // assigned_regions never loaded by the route
      query: {},
    };
    const res = mockRes();
    await supportController.listTickets(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SCOPE_UNAVAILABLE' })
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('E05 ticket detail scoping', () => {
  test('regional admin is denied a ticket outside their region', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM support_tickets')) {
        return { rows: [{ id: 't1', user_id: 'user-ca', ticket_number: 1 }] };
      }
      if (sql.includes('FROM users WHERE id')) {
        return { rows: [{ id: 'user-ca', country: 'CA' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const req = {
      user: { id: 'admin-1', role: 'admin' },
      isSuper: false,
      assigned_regions: [REGION_US],
      params: { ticketId: 't1' },
    };
    const res = mockRes();
    await supportController.getTicketAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('outside your assigned region') })
    );
  });

  test('regional admin can open a ticket inside their region', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM support_tickets')) {
        return { rows: [{ id: 't1', user_id: 'user-us', ticket_number: 1 }] };
      }
      if (sql.includes('FROM users WHERE id')) {
        return { rows: [{ id: 'user-us', country: 'US' }] };
      }
      if (sql.includes('FROM support_messages')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const req = {
      user: { id: 'admin-1', role: 'admin' },
      isSuper: false,
      assigned_regions: [REGION_US],
      params: { ticketId: 't1' },
    };
    const res = mockRes();
    await supportController.getTicketAdmin(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: expect.objectContaining({ id: 't1' }) })
    );
  });
});
