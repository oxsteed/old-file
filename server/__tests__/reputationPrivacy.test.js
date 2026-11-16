'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));

const pool = require('../db');
const controller = require('../controllers/reputationController');

function responseDouble() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('reputation enforcement privacy boundaries', () => {
  test('a customer cannot inspect another account restrictions', async () => {
    const res = responseDouble();
    await controller.checkRestrictions({
      user: { id: 'viewer', role: 'customer' },
      params: { userId: 'other' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('an account can inspect its own restrictions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ restrictions: { bidding: true } }] });
    const res = responseDouble();
    await controller.checkRestrictions({
      user: { id: 'self', role: 'customer' },
      params: { userId: 'self' },
    }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ hasRestrictions: true }),
    }));
  });

  test('platform admins may inspect another account restrictions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = responseDouble();
    await controller.checkRestrictions({
      user: { id: 'admin', role: 'admin' },
      params: { userId: 'other' },
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'other', hasRestrictions: false }),
    }));
  });

  test('a customer cannot inspect another account cancellation-fee history', async () => {
    const res = responseDouble();
    await controller.getFeeHistory({
      user: { id: 'viewer', role: 'customer' },
      params: { userId: 'other' },
      query: {},
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('an account may inspect its own cancellation-fee history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'self' }] })
      .mockResolvedValueOnce({ rows: [{ cancellation_count: '0', total_fees_paid_cents: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = responseDouble();
    await controller.getFeeHistory({
      user: { id: 'self', role: 'customer' },
      params: { userId: 'self' },
      query: {},
    }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'self', totalFeesPaidCents: 0 }),
    }));
  });
});

