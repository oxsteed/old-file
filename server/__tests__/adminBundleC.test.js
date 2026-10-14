'use strict';

/**
 * Bundle C — Broken admin pages (ADM-032, ADM-005 client-side, ADM-010,
 * ADM-011, ADM-012/ADM-013, ADM-122).
 *
 * Unit tests over the fixed SQL/response shapes, using the shared mocked
 * pg pool from ./setup. No real database required.
 */

const { mockQuery, resetMocks } = require('./setup');

const adminController = require('../controllers/adminController');
const { getOrder } = require('../controllers/adminOrdersController');
const consultingController = require('../controllers/adminConsultingController');
const supportController = require('../controllers/supportController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  resetMocks();
});

describe('ADM-032: market ZIP page uses real columns (zip_codes / is_active)', () => {
  test('getMarkets selects zip_codes and is_active, not zipcodes/active', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] }) // tableExists
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await adminController.getMarkets({}, res);

    expect(res.json).toHaveBeenCalledWith({ markets: [] });
    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('zip_codes');
    expect(sql).toContain('is_active');
    expect(sql).not.toMatch(/zipcodes/i);
    expect(sql).not.toMatch(/[, ]active[, ]/);
  });

  test('addZipCodes updates zip_codes and returns real columns', async () => {
    const updated = { id: 1, name: 'M', state: 'OH', zip_codes: ['45501'], is_active: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] }) // tableExists
      .mockResolvedValueOnce({ rows: [updated] });

    const res = makeRes();
    await adminController.addZipCodes(
      { params: { marketId: '1' }, body: { zipCodes: ['45501'] }, user: { id: 'admin-1' } },
      res
    );

    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('zip_codes');
    expect(sql).toContain('is_active');
    expect(sql).not.toMatch(/zipcodes/i);
    expect(res.json).toHaveBeenCalledWith({ market: updated });
  });

  test('removeZipCodes updates zip_codes and returns real columns', async () => {
    const updated = { id: 1, name: 'M', state: 'OH', zip_codes: [], is_active: true };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '1': 1 }] }) // tableExists
      .mockResolvedValueOnce({ rows: [updated] });

    const res = makeRes();
    await adminController.removeZipCodes(
      { params: { marketId: '1' }, body: { zipCodes: ['45501'] }, user: { id: 'admin-1' } },
      res
    );

    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('zip_codes');
    expect(sql).toContain('is_active');
    expect(sql).not.toMatch(/zipcodes/i);
    expect(res.json).toHaveBeenCalledWith({ market: updated });
  });
});

describe('ADM-010: getOrder handles JSONB shipping_address without JSON.parse', () => {
  test('returns already-parsed JSONB object directly (no 500)', async () => {
    const address = { street: '1 Main St', city: 'Springfield', state: 'OH', zip: '45501' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, shipping_address: address, email: 'c@x.com' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await getOrder({ params: { orderId: '7' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ shippingAddress: address }),
      })
    );
  });

  test('still parses legacy string payloads', async () => {
    const address = { street: '2 Oak Ave' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 8, shipping_address: JSON.stringify(address) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await getOrder({ params: { orderId: '8' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shippingAddress: address }),
      })
    );
  });

  test('null shipping_address becomes {}', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 9, shipping_address: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await getOrder({ params: { orderId: '9' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shippingAddress: {} }),
      })
    );
  });
});

describe('ADM-011: consultant BIGINT id goes into consultant_id, not UUID consultant_assigned_id', () => {
  const body = {
    first_name: 'A', last_name: 'B', email: 'ab@example.com',
    consultant_id: 42, status: 'pending',
  };

  test('createSessionManually inserts into consultant_id column', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // consultant exists
      .mockResolvedValueOnce({ rows: [{ id: 100 }] }); // INSERT

    const res = makeRes();
    await consultingController.createSessionManually(
      { body, user: { id: 'admin-1' } },
      res
    );

    const insertSql = mockQuery.mock.calls[1][0];
    expect(insertSql).toContain('consultant_id');
    expect(insertSql).not.toContain('consultant_assigned_id');
    expect(mockQuery.mock.calls[1][1]).toContain(42);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('createSessionManually 400s on unknown consultant instead of 500ing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // consultant missing

    const res = makeRes();
    await consultingController.createSessionManually(
      { body, user: { id: 'admin-1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('consultant_id') })
    );
  });

  test('updateRequestStatusById updates consultant_id column', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] }) // existing session
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // consultant exists
      .mockResolvedValueOnce({ rows: [{ id: 5, status: 'scheduled' }] }); // UPDATE

    const res = makeRes();
    await consultingController.updateRequestStatusById(
      { params: { id: '5' }, body: { status: 'scheduled', consultant_id: 42 }, user: { id: 'admin-1' } },
      res
    );

    const updateSql = mockQuery.mock.calls[2][0];
    expect(updateSql).toContain('consultant_id = $');
    expect(updateSql).not.toContain('consultant_assigned_id');
  });

  test('updateRequestStatusById 400s on unknown consultant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] }); // consultant missing

    const res = makeRes();
    await consultingController.updateRequestStatusById(
      { params: { id: '5' }, body: { status: 'scheduled', consultant_id: 424242 }, user: { id: 'admin-1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('ADM-012/ADM-013: complete/no-show update consulting_sessions.status', () => {
  test('completeSession sets consulting_sessions.status = completed without a scheduled row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 11, status: 'scheduled' }] }) // session exists
      .mockResolvedValueOnce({ rows: [{ id: 11, status: 'completed' }] }) // main update
      .mockResolvedValueOnce({ rows: [] }); // mirror update (no scheduled row)

    const res = makeRes();
    await consultingController.completeSession(
      { params: { sessionId: '11' }, user: { id: 'admin-1' } },
      res
    );

    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/UPDATE\s+consulting_sessions\b/);
    expect(updateSql).toContain("'completed'");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ status: 'completed' }) })
    );
  });

  test('completeSession 404s when the session does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await consultingController.completeSession(
      { params: { sessionId: '999' }, user: { id: 'admin-1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('markNoShow sets consulting_sessions.status = no_show without a scheduled row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, status: 'scheduled' }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, status: 'no_show' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await consultingController.markNoShow(
      { params: { sessionId: '12' }, user: { id: 'admin-1' } },
      res
    );

    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/UPDATE\s+consulting_sessions\b/);
    expect(updateSql).toContain("'no_show'");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ status: 'no_show' }) })
    );
  });

  test('markNoShow keeps the mirror table row in sync when one exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 13, status: 'scheduled' }] })
      .mockResolvedValueOnce({ rows: [{ id: 13, status: 'no_show' }] })
      .mockResolvedValueOnce({ rows: [{ id: 99, status: 'no_show' }] });

    const res = makeRes();
    await consultingController.markNoShow(
      { params: { sessionId: '13' }, user: { id: 'admin-1' } },
      res
    );

    const mirrorSql = mockQuery.mock.calls[2][0];
    expect(mirrorSql).toContain('consulting_sessions_scheduled');
    expect(mirrorSql).toContain("'no_show'");
  });
});

describe('ADM-122: ticket inbox count query joins users for regional admins', () => {
  const regionalReq = () => ({
    user: { role: 'admin', id: 'admin-9' },
    query: {},
    assigned_regions: [
      {
        id: 1,
        boundary_definition: { type: 'zip_range', ranges: [{ start: 10000, end: 20000 }] },
      },
    ],
  });

  test('count query includes the users join so u.* references resolve', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // list
      .mockResolvedValueOnce({ rows: [{ total: '3' }] }); // count

    const res = makeRes();
    await supportController.listTickets(regionalReq(), res);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const countSql = mockQuery.mock.calls[1][0];
    expect(countSql).toContain('LEFT JOIN users u ON t.user_id = u.id');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ total: 3 })
    );
  });

  test('list query and count query share the same WHERE fragment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = makeRes();
    await supportController.listTickets(regionalReq(), res);

    const listSql = mockQuery.mock.calls[0][0];
    const countSql = mockQuery.mock.calls[1][0];
    // Both reference the regional scope on the u alias...
    expect(listSql).toContain('u.zip_code');
    expect(countSql).toContain('u.zip_code');
    // ...and both resolve the alias through the same join.
    expect(countSql).toContain('LEFT JOIN users u ON t.user_id = u.id');
  });
});
