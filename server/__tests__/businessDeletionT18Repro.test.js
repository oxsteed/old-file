'use strict';

/**
 * Contract test for audit finding T18-F01.
 *
 * The client sent { reason } but the server required { confirmed }. The
 * contract is now { reason, confirmed: true } for delete actions, and the
 * reason is recorded in the audit log.
 */

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/businessModerationController');

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

describe('T18-F01: business deletion client/API contract', () => {
  test('delete with { reason, confirmed: true } succeeds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'b1', business_name: 'Acme', is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b1' }] })
      .mockResolvedValueOnce({ rows: [] }); // logAdminAction

    const res = makeRes();
    await controller.deleteBusiness(
      { params: { id: 'b1' }, body: { reason: 'fraud', confirmed: true }, user: { id: 'a1' } },
      res
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/deleted/i) })
    );
  });

  test('delete without confirmed is rejected with 400', async () => {
    const res = makeRes();
    await controller.deleteBusiness(
      { params: { id: 'b1' }, body: { reason: 'fraud' }, user: { id: 'a1' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
