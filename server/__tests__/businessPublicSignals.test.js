'use strict';

jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../services/socketService', () => ({
  isOnline: jest.fn(() => false),
}));

const pool = require('../db');
const socketService = require('../services/socketService');
const { getBusinessStatus, getBusinessReputation } = require('../controllers/businessPublicSignalsController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('business-scoped public signals (GV-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET status resolves owner server-side and never returns owner id', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ business_id: 42, owner_id: 'owner-uuid-secret' }],
      })
      .mockResolvedValueOnce({
        rows: [{ is_available_now: true }],
      });
    const res = mockRes();
    await getBusinessStatus({ params: { id: '42' } }, res);
    expect(res.json).toHaveBeenCalledWith({
      businessId: '42',
      online: true,
      helperStatus: 'live',
    });
    const payload = res.json.mock.calls[0][0];
    expect(payload).not.toHaveProperty('ownerId');
    expect(payload).not.toHaveProperty('userId');
    expect(socketService.isOnline).not.toHaveBeenCalled();
  });

  test('GET reputation omits userId from reputation summary', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ business_id: 7, owner_id: 'owner-uuid-secret' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'owner-uuid-secret',
          total_jobs: 10,
          completed_jobs: 9,
          cancelled_jobs: 1,
          cancellation_rate: 10,
          cancelled_24h_or_less: 0,
          cancelled_24h_to_3d: 0,
          cancelled_3d_plus: 1,
          reliability_score: 88,
          caution_level: 'none',
          last_calculated_at: '2026-01-01T00:00:00.000Z',
        }],
      });
    const res = mockRes();
    await getBusinessReputation({ params: { id: '7' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.businessId).toBe('7');
    expect(body.data).not.toHaveProperty('userId');
    expect(body.data.reliabilityScore).toBe(88);
  });

  test('unknown business returns 404 without leaking owner', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await getBusinessStatus({ params: { id: '999' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
