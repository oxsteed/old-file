'use strict';

/**
 * P2-1-F08 (remainder): "Flag business for review" used to be a dead end —
 * the flagged queue (status=flagged filter) existed but a flag could never
 * be resolved. The unflag endpoint clears admin_review_reason /
 * admin_reviewed_at with an audit row so flagged businesses can leave the
 * review queue.
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

describe('P2-1-F08: unflagBusiness resolves the review queue', () => {
  test('clears the flag and writes an audit row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'b1', business_name: 'Acme', admin_review_reason: 'suspicious menu' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'b1' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // logAdminAction

    const res = makeRes();
    await controller.unflagBusiness({ params: { id: 'b1' }, user: { id: 'a1' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/flag cleared/i) })
    );
    const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes('admin_review_reason = NULL'));
    expect(updateCall).toBeDefined();
    const auditCall = mockQuery.mock.calls.find(([sql, params]) =>
      sql.includes('INSERT INTO admin_audit_log') && params && params[1] === 'business_flag_cleared'
    );
    expect(auditCall).toBeDefined();
  });

  test('409 when the business is not flagged', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'b1', business_name: 'Acme', admin_review_reason: null }] });

    const res = makeRes();
    await controller.unflagBusiness({ params: { id: 'b1' }, user: { id: 'a1' } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_flagged' }));
  });

  test('404 when the business does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await controller.unflagBusiness({ params: { id: 'nope' }, user: { id: 'a1' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
