'use strict';

const { mockQuery, resetMocks } = require('./setup');
const creator = require('../controllers/mediaCreatorController');

const resMock = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

beforeEach(() => resetMocks());

test('lists only the open creator opportunities returned by the API query', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'gig-1', status: 'open', title: 'Local launch' }] });
  const res = resMock();
  await creator.listGigs({ query: { limit: '12' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ gigs: [{ id: 'gig-1', status: 'open', title: 'Local launch' }] });
  expect(mockQuery.mock.calls[0][0]).toContain("g.status = 'open'");
});

test('rejects a tip target that is not a currently verified creator actor', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const client = { query: mockQuery, release: jest.fn() };
  const pool = require('../db');
  pool.connect.mockResolvedValueOnce(client);
  const next = jest.fn();
  await creator.createTip({
    user: { id: 'viewer-1' },
    body: { actorId: 'actor-1', amountCents: 500, idempotencyKey: 'tip-1' },
    get: () => null,
  }, resMock(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_actor_not_found' }));
  expect(client.release).toHaveBeenCalled();
});
