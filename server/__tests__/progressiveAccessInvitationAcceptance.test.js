'use strict';

/** WP-009: invitation acceptance stays bound to the intended account. */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/businessAuditLog', () => ({ logBusinessAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/permissionsService', () => ({ invalidateCache: jest.fn() }));

const pool = require('../db');
const { acceptInvitation } = require('../controllers/businessMembersController');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('invitation acceptance account binding', () => {
  test('wrong account cannot consume a pending invite', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await acceptInvitation({
      user: { id: 'wrong-user', email: 'wrong@example.invalid' },
      params: { id: '42' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    const update = pool.query.mock.calls[0];
    expect(update[0]).toContain("(member_id = $1 OR invite_email = $3)");
    expect(update[0]).toContain("status    = 'pending'");
    expect(update[0]).toContain('(expires_at IS NULL OR expires_at > NOW())');
    expect(update[1]).toEqual(['wrong-user', '42', 'wrong@example.invalid']);
  });

  test('an expired invite is reported without changing membership', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] });
    const res = response();

    await acceptInvitation({
      user: { id: 'invitee', email: 'invitee@example.invalid' },
      params: { id: '42' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(410);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][0]).toContain('expires_at IS NOT NULL AND expires_at <= NOW()');
  });

  test('the state transition is a single conditional update, so revoke/expiry races cannot double-accept', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 42, business_id: 7, role: 'representative' }],
    });
    const res = response();

    await acceptInvitation({
      user: { id: 'invitee', email: 'invitee@example.invalid' },
      params: { id: '42' },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain("SET status      = 'active'");
    expect(pool.query.mock.calls[0][0]).toContain("status    = 'pending'");
  });
});
