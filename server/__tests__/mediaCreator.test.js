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

test('only lets a currently verified creator accept a sponsorship', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery
    .mockResolvedValueOnce({ rows: [{ creator_actor_id: 'actor-1' }] })
    .mockResolvedValueOnce({ rows: [{ owner_user_id: 'creator-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'actor-1', owner_user_id: 'creator-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 's-1', status: 'accepted' }] });
  const res = resMock();
  await creator.acceptSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'creator-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorship: { id: 's-1', status: 'accepted' } });
  expect(client.release).toHaveBeenCalled();
});

test('blocks sponsorship settlement after creator verification is revoked', async () => {
  const pool = require('../db');
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 's-1', creator_actor_id: 'actor-1', creator_user_id: 'creator-1', amount_cents: 900, currency_code: 'USD', status: 'accepted' }] });
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery
    .mockResolvedValueOnce({ rows: [{ owner_user_id: 'creator-1' }] })
    .mockResolvedValueOnce({ rows: [] });
  const next = jest.fn();
  await creator.settleSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'sponsor-1' } }, resMock(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_unverified' }));
  expect(client.release).toHaveBeenCalled();
});

test('lists sponsorship offers for either the sponsor or creator owner', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 's-1', status: 'accepted', creator_user_id: 'creator-1' }] });
  const res = resMock();
  await creator.listSponsorships({ user: { id: 'creator-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorships: [{ id: 's-1', status: 'accepted', creator_user_id: 'creator-1' }] });
  expect(mockQuery.mock.calls[0][0]).toContain('s.sponsor_user_id = $1 OR a.owner_user_id = $1');
});

test('lists an applicant’s awarded work with its latest deliverable state', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', status: 'awarded', deliverable_status: 'submitted' }] });
  const res = resMock();
  await creator.listMyApplications({ user: { id: 'creator-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ applications: [{ id: 'app-1', status: 'awarded', deliverable_status: 'submitted' }] });
  expect(mockQuery.mock.calls[0][0]).toContain('media_creator_deliverables');
});

test('cancels an unsettled sponsorship for one of its parties', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 's-1', status: 'cancelled' }] });
  const res = resMock();
  await creator.cancelSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'sponsor-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorship: { id: 's-1', status: 'cancelled' } });
  expect(mockQuery.mock.calls[0][0]).toContain("s.status IN ('pending_credit','accepted')");
});
