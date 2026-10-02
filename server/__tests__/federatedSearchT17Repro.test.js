'use strict';

/**
 * Reproduction test for audit finding T17-F01.
 *
 * The federated search returned messages and payments to anyone holding the
 * search-log permission, without the message/finance grants. A search
 * permission must not become alternate access to private messages or
 * financial records.
 */

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/adminSearchController');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('T17-F01: federated search scopes entity types by grant', () => {
  test('explicitly requesting messages without manage_support returns 403', async () => {
    // Grant check returns no rows.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = {
      query: { q: 'hello', types: 'messages' },
      user: { id: 'admin-1', role: 'admin' },
    };
    const res = makeRes();
    await controller.search(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/manage_support/) })
    );
  });

  test('explicitly requesting payments without view_financials returns 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = {
      query: { q: 'invoice', types: 'payments' },
      user: { id: 'admin-1', role: 'admin' },
    };
    const res = makeRes();
    await controller.search(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/view_financials/) })
    );
  });

  test('default search excludes restricted types when grants are missing', async () => {
    // Two grant checks (messages, payments) return no rows; then the entity
    // queries run. We only care that messages/payments queries were skipped.
    mockQuery.mockImplementation(async (text) => {
      if (text.includes('admin_permission_grants')) return { rows: [] };
      return { rows: [] };
    });

    const req = {
      query: { q: 'test' },
      user: { id: 'admin-1', role: 'admin' },
    };
    const res = makeRes();
    await controller.search(req, res);

    const queries = mockQuery.mock.calls.map(c => c[0]);
    const messageQueries = queries.filter(q => q.includes('FROM messages'));
    const paymentQueries = queries.filter(q => q.includes('FROM payments') || q.includes('marketplace_transactions'));
    expect(messageQueries).toHaveLength(0);
    expect(paymentQueries).toHaveLength(0);
    expect(res.json).toHaveBeenCalled();
  });
});
