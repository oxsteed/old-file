'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));

const pool = require('../db');
const { skipVerification } = require('../controllers/diditController');

function mockReq(userId = 'u1') {
  return { user: { id: userId } };
}
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('skipVerification', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('403 when didit_enforcement_required', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ didit_enforcement_required: true, didit_status: 'skipped', email_verified: true }],
    });
    const req = mockReq();
    const res = mockRes();
    await skipVerification(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('403 when the account email is not verified', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ didit_enforcement_required: false, didit_status: 'pending', email_verified: false }],
    });
    const req = mockReq();
    const res = mockRes();
    await skipVerification(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DIDIT_EMAIL_UNVERIFIED' }));
  });

  test('updates to skipped when enforcement off and DIDIT_ALLOW_USER_SKIP not false', async () => {
    delete process.env.DIDIT_ALLOW_USER_SKIP;
    pool.query
      .mockResolvedValueOnce({
        rows: [{ didit_enforcement_required: false, didit_status: 'pending', email_verified: true }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const req = mockReq();
    const res = mockRes();
    await skipVerification(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, status: 'skipped' }));
  });
});
