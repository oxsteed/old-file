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
  expect(mockQuery.mock.calls[0][0]).toContain('helper_profiles');
  expect(mockQuery.mock.calls[0][0]).toContain('is_business_verified = TRUE');
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

test('rejects an unknown deliverable review status before it can settle a gig', async () => {
  const next = jest.fn();
  await creator.reviewDeliverable({
    params: { deliverableId: 'deliverable-1' },
    body: { status: 'settle_anyway' },
    user: { id: 'owner-1' },
  }, resMock(), next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({
    code: 'media_creator_review_status_invalid',
    status: 400,
  }));
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rolls back a gig deliverable when the application transition is missing', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  client.query
    .mockResolvedValueOnce({ rows: [] }) // BEGIN is intentionally represented by the shared mock
    .mockResolvedValueOnce({ rows: [{ id: 'application-1', status: 'awarded', applicant_actor_id: 'actor-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'post-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'deliverable-1' }] })
    .mockResolvedValueOnce({ rows: [] }); // guarded application UPDATE
  const next = jest.fn();

  await creator.submitDeliverable({
    params: { applicationId: 'application-1' },
    user: { id: 'creator-1' },
    body: { postId: 'post-1', note: 'Ready for review' },
  }, resMock(), next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({
    code: 'media_creator_deliverable_transition_failed',
  }));
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});

test('rolls back when a rejected deliverable cannot transition its gig state', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'ROLLBACK') return { rows: [] };
    if (query.includes('FROM media_creator_deliverables d')) {
      return { rows: [{
        id: 'deliverable-1', application_id: 'application-1', status: 'submitted',
        applicant_user_id: 'creator-1', gig_id: 'gig-1', owner_user_id: 'owner-1',
        credit_reservation_id: null, award_amount_cents: 900,
      }] };
    }
    if (query.includes('UPDATE media_creator_deliverables')) {
      return { rows: [{ id: 'deliverable-1', status: 'rejected' }] };
    }
    if (query.includes('UPDATE media_creator_applications')) {
      return { rows: [{ id: 'application-1', status: 'rejected' }] };
    }
    if (query.includes('UPDATE media_creator_gigs')) return { rows: [] };
    return { rows: [] };
  });
  const next = jest.fn();

  await creator.reviewDeliverable({
    params: { deliverableId: 'deliverable-1' },
    body: { status: 'rejected' },
    user: { id: 'owner-1' },
  }, resMock(), next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({
    code: 'media_creator_review_transition_failed',
    status: 503,
  }));
  expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalled();
});

test('replays an identical submitted gig application without resetting its lifecycle', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'COMMIT') return { rows: [] };
    if (query.includes('FROM media_actors a')) return { rows: [{ id: 'actor-1', owner_user_id: 'creator-1' }] };
    if (query.includes('FROM media_creator_gigs')) return { rows: [{ id: 'gig-1', budget_cents: 1000, max_applications: 1, status: 'open' }] };
    if (query.includes('FROM media_creator_applications')) return { rows: [{ id: 'app-1', gig_id: 'gig-1', applicant_user_id: 'creator-1', applicant_actor_id: 'actor-1', pitch: 'I can do this', proposed_cents: 900, status: 'submitted' }] };
    return { rows: [] };
  });
  const res = resMock();
  await creator.applyToGig({
    params: { gigId: 'gig-1' },
    user: { id: 'creator-1' },
    body: { actorId: 'actor-1', pitch: 'I can do this', proposedCents: 900 },
  }, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ application: expect.objectContaining({ id: 'app-1', status: 'submitted' }), replayed: true });
  expect(mockQuery.mock.calls.map(([sql]) => String(sql))).toEqual([
    'BEGIN', expect.stringContaining('FROM media_actors a'), expect.stringContaining('FROM media_creator_gigs'),
    expect.stringContaining('FROM media_creator_applications'), 'COMMIT',
  ]);
  expect(client.release).toHaveBeenCalled();
});

test('replays an identical gig creation instead of duplicating the opportunity', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'COMMIT') return { rows: [] };
    if (query.includes('FROM media_actors a')) return { rows: [{ id: 'actor-1', owner_user_id: 'owner-1' }] };
    if (query.includes('FROM media_creator_gigs')) return { rows: [{ id: 'gig-1', owner_user_id: 'owner-1', owner_actor_id: 'actor-1', title: 'Local launch', brief: 'Launch support', budget_cents: 900, max_applications: 25, linked_post_id: null, idempotency_key: 'gig-key-1', status: 'open' }] };
    return { rows: [] };
  });
  const res = resMock();
  await creator.createGig({
    user: { id: 'owner-1' },
    body: { title: 'Local launch', brief: 'Launch support', budgetCents: 900, idempotencyKey: 'gig-key-1' },
    get: (header) => header === 'Idempotency-Key' ? 'gig-key-1' : null,
  }, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ gig: expect.objectContaining({ id: 'gig-1', status: 'open' }), replayed: true });
  expect(client.release).toHaveBeenCalled();
});

test('only lets a currently verified creator accept a sponsorship and reserve its funds', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  const credit = require('../services/oxsteedCreditService');
  const enabled = jest.spyOn(credit, 'assertCreditRailEnabled').mockResolvedValue(undefined);
  const unfrozen = jest.spyOn(credit, 'assertCreditRailNotFrozen').mockResolvedValue(undefined);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query.includes('SELECT s.*, a.owner_user_id AS creator_user_id')) return { rows: [{ id: 's-1', creator_actor_id: 'actor-1', creator_user_id: 'creator-1', sponsor_user_id: 'sponsor-1', amount_cents: 900, currency_code: 'USD', status: 'pending_credit' }] };
    if (query.includes('SELECT owner_user_id FROM media_actors')) return { rows: [{ owner_user_id: 'creator-1' }] };
    if (query.includes('FROM media_actors a')) return { rows: [{ id: 'actor-1', owner_user_id: 'creator-1' }] };
    if (query.includes('SELECT a.* FROM oxsteed_credit_accounts')) return { rows: [{ id: 11, account_type: 'customer_wallet', balance_cents: 2000, reserved_cents: 0, status: 'active', currency_code: 'USD' }] };
    if (query.includes('SELECT id, balance_cents, reserved_cents, status')) return { rows: [{ id: 11, account_type: 'customer_wallet', balance_cents: 2000, reserved_cents: 0, status: 'active', currency_code: 'USD' }] };
    if (query.includes('INSERT INTO oxsteed_credit_reservations')) return { rows: [{ id: 'reservation-1', account_id: 11, amount_cents: 900, status: 'active' }] };
    if (query.includes('UPDATE media_creator_sponsorships')) return { rows: [{ id: 's-1', status: 'accepted', credit_reservation_id: 'reservation-1' }] };
    return { rows: [] };
  });
  const res = resMock();
  const next = jest.fn();
  await creator.acceptSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'creator-1' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    sponsorship: expect.objectContaining({ id: 's-1', status: 'accepted' }),
    reservation: expect.objectContaining({ id: 'reservation-1' }),
  }));
  enabled.mockRestore();
  unfrozen.mockRestore();
  expect(client.release).toHaveBeenCalled();
});

test('replays an identical sponsorship offer instead of creating a duplicate', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'COMMIT') return { rows: [] };
    if (query.includes('SELECT owner_user_id FROM media_actors')) return { rows: [{ owner_user_id: 'creator-1' }] };
    if (query.includes('FROM media_actors a')) return { rows: [{ id: 'actor-1', owner_user_id: 'creator-1' }] };
    if (query.includes('FROM media_creator_sponsorships')) return { rows: [{
      id: 's-1', sponsor_user_id: 'sponsor-1', creator_actor_id: 'actor-1',
      amount_cents: 900, brief: 'Launch brief', idempotency_key: 'sponsor-key-1', status: 'pending_credit',
    }] };
    return { rows: [] };
  });
  const res = resMock();

  await creator.createSponsorship({
    user: { id: 'sponsor-1' },
    body: { actorId: 'actor-1', amountCents: 900, brief: 'Launch brief', idempotencyKey: 'sponsor-key-1' },
    get: (header) => header === 'Idempotency-Key' ? 'sponsor-key-1' : null,
  }, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith({ sponsorship: expect.objectContaining({ id: 's-1' }), replayed: true });
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalled();
});

test('blocks sponsorship settlement after creator verification is revoked', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query.includes('SELECT s.*, a.owner_user_id AS creator_user_id')) return { rows: [{ id: 's-1', creator_actor_id: 'actor-1', creator_user_id: 'creator-1', sponsor_user_id: 'sponsor-1', amount_cents: 900, currency_code: 'USD', status: 'delivered', credit_reservation_id: 'reservation-1' }] };
    if (query.includes('SELECT owner_user_id FROM media_actors')) return { rows: [{ owner_user_id: 'creator-1' }] };
    if (query.includes('SELECT a.* FROM media_actors')) return { rows: [] };
    return { rows: [] };
  });
  const next = jest.fn();
  await creator.settleSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'sponsor-1' } }, resMock(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_unverified' }));
  expect(client.release).toHaveBeenCalled();
});

test('fails closed when a sponsorship active reservation does not match its durable payment link', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  const credit = require('../services/oxsteedCreditService');
  const enabled = jest.spyOn(credit, 'assertCreditRailEnabled').mockResolvedValue(undefined);
  const unfrozen = jest.spyOn(credit, 'assertCreditRailNotFrozen').mockResolvedValue(undefined);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'COMMIT') return { rows: [] };
    if (query.includes('SELECT s.*, a.owner_user_id AS creator_user_id')) {
      return { rows: [{ id: 's-1', creator_actor_id: 'actor-1', creator_user_id: 'creator-1', sponsor_user_id: 'sponsor-1', amount_cents: 900, currency_code: 'USD', status: 'delivered', credit_reservation_id: 'reservation-1' }] };
    }
    if (query.includes('SELECT owner_user_id FROM media_actors')) return { rows: [{ owner_user_id: 'creator-1' }] };
    if (query.includes('FROM media_actors a')) return { rows: [{ id: 'actor-1', owner_user_id: 'creator-1' }] };
    if (query.includes('FROM oxsteed_credit_reservations')) {
      return { rows: [{ id: 'different-reservation', account_id: 11, amount_cents: 900, status: 'active' }] };
    }
    return { rows: [] };
  });
  const next = jest.fn();
  await creator.settleSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'sponsor-1' } }, resMock(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_reservation_mismatch' }));
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE oxsteed_credit_accounts'))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('media_creator_sponsorship'))).toBe(true);
  enabled.mockRestore();
  unfrozen.mockRestore();
  expect(client.release).toHaveBeenCalled();
});

test('accepts only a published ready post as a sponsorship deliverable', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query.includes('SELECT s.*, a.owner_user_id AS creator_user_id')) {
      return { rows: [{ id: 's-1', creator_actor_id: 'actor-1', creator_user_id: 'creator-1', status: 'accepted' }] };
    }
    if (query.includes('SELECT p.id')) return { rows: [{ id: 'post-1' }] };
    if (query.includes("SET status = 'delivered'")) return { rows: [{ id: 's-1', status: 'delivered', delivery_post_id: 'post-1' }] };
    return { rows: [] };
  });
  const res = resMock();
  const next = jest.fn();
  await creator.submitSponsorshipDeliverable({
    params: { sponsorshipId: 's-1' },
    user: { id: 'creator-1' },
    body: { postId: 'post-1', note: 'Ready for review' },
  }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({ sponsorship: expect.objectContaining({ status: 'delivered', delivery_post_id: 'post-1' }) });
  expect(client.query.mock.calls.some(([sql]) => String(sql).includes("processing_status = 'ready'"))).toBe(true);
  expect(client.release).toHaveBeenCalled();
});

test('submits gig deliverables with application and deliverable updates in one transaction', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'COMMIT') return { rows: [] };
    if (query.includes('SELECT ap.id, ap.status, ap.applicant_actor_id')) return { rows: [{ id: 'app-1', status: 'awarded', applicant_actor_id: 'actor-1' }] };
    if (query.includes('SELECT p.id FROM media_posts')) return { rows: [{ id: 'post-1' }] };
    if (query.includes('INSERT INTO media_creator_deliverables')) return { rows: [{ id: 'deliverable-1', application_id: 'app-1', status: 'submitted' }] };
    if (query.includes("SET status = 'delivered'")) return { rows: [{ id: 'app-1', status: 'delivered' }] };
    return { rows: [] };
  });
  const res = resMock();
  const next = jest.fn();
  await creator.submitDeliverable({
    params: { applicationId: 'app-1' },
    user: { id: 'creator-1' },
    body: { postId: 'post-1', note: 'Ready for review' },
  }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith({ deliverable: expect.objectContaining({ id: 'deliverable-1' }) });
  expect(mockQuery.mock.calls.map(([sql]) => String(sql))).toEqual([
    'BEGIN', expect.stringContaining('SELECT ap.id, ap.status'), expect.stringContaining('SELECT p.id FROM media_posts'),
    expect.stringContaining('INSERT INTO media_creator_deliverables'), expect.stringContaining('UPDATE media_creator_applications'), 'COMMIT',
  ]);
  expect(client.release).toHaveBeenCalled();
});

test('lists sponsorship offers for either the sponsor or creator owner', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 's-1', status: 'accepted', creator_user_id: 'creator-1' }] });
  const res = resMock();
  await creator.listSponsorships({ user: { id: 'creator-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorships: [{ id: 's-1', status: 'accepted', creator_user_id: 'creator-1' }] });
  expect(mockQuery.mock.calls[0][0]).toContain('s.sponsor_user_id = $1 OR a.owner_user_id = $1');
});

test('lists creator payment history across tips, sponsorships and boosts', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    { kind: 'boost', id: 'boost-1', status: 'active', amount_cents: 700, currency_code: 'USD' },
  ] });
  const res = resMock();
  await creator.listCreatorPayments({ user: { id: 'viewer-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ payments: [{ kind: 'boost', id: 'boost-1', status: 'active', amount_cents: 700, currency_code: 'USD' }] });
  expect(mockQuery.mock.calls[0][0]).toContain("'tip'::text AS kind");
  expect(mockQuery.mock.calls[0][0]).toContain("'sponsorship'::text AS kind");
  expect(mockQuery.mock.calls[0][0]).toContain("'boost'::text AS kind");
});

test('lists an applicant’s awarded work with its latest deliverable state', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'app-1', status: 'awarded', deliverable_status: 'submitted' }] });
  const res = resMock();
  await creator.listMyApplications({ user: { id: 'creator-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ applications: [{ id: 'app-1', status: 'awarded', deliverable_status: 'submitted' }] });
  expect(mockQuery.mock.calls[0][0]).toContain('media_creator_deliverables');
});

test('cancels an unsettled sponsorship for one of its parties', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query.includes('SELECT s.*, a.owner_user_id AS creator_user_id')) return { rows: [{ id: 's-1', status: 'pending_credit', sponsor_user_id: 'sponsor-1', creator_user_id: 'creator-1' }] };
    if (query.includes('UPDATE media_creator_sponsorships')) return { rows: [{ id: 's-1', status: 'cancelled' }] };
    return { rows: [] };
  });
  const res = resMock();
  await creator.cancelSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'sponsor-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorship: { id: 's-1', status: 'cancelled' } });
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('FOR UPDATE OF s'))).toBe(true);
});

test('replays sponsorship cancellation without releasing Credit twice', async () => {
  const pool = require('../db');
  const client = { query: mockQuery, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(client);
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query === 'BEGIN' || query === 'COMMIT') return { rows: [] };
    if (query.includes('SELECT s.*, a.owner_user_id AS creator_user_id')) {
      return { rows: [{ id: 's-1', status: 'cancelled', sponsor_user_id: 'sponsor-1', creator_user_id: 'creator-1' }] };
    }
    return { rows: [] };
  });
  const res = resMock();
  await creator.cancelSponsorship({ params: { sponsorshipId: 's-1' }, user: { id: 'sponsor-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorship: expect.objectContaining({ id: 's-1', status: 'cancelled' }), replayed: true });
  expect(mockQuery.mock.calls.map(([sql]) => String(sql))).toEqual([
    'BEGIN', expect.stringContaining('SELECT s.*, a.owner_user_id AS creator_user_id'), 'COMMIT',
  ]);
  expect(client.release).toHaveBeenCalled();
});

test('replays boost cancellation after the first cancellation', async () => {
  const pool = require('../db');
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'boost-1', status: 'cancelled', purchaser_user_id: 'buyer-1' }] });
  const res = resMock();
  await creator.cancelBoost({ params: { boostId: 'boost-1' }, user: { id: 'buyer-1' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ boost: expect.objectContaining({ id: 'boost-1', status: 'cancelled' }), replayed: true });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('opens an idempotent dispute only for the payer\'s settled creator payment', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111', payer_user_id: 'payer-1', transaction_id: 'tx-1', payment_status: 'posted' }] });
  const openCreditDispute = jest.spyOn(require('../services/oxsteedCreditService'), 'openCreditDispute')
    .mockResolvedValueOnce({ replayed: false, dispute: { id: 'case-1', status: 'open' } });
  const next = jest.fn();
  const res = resMock();
  await creator.openCreatorDispute({
    params: { kind: 'tip', id: '11111111-1111-4111-8111-111111111111' },
    user: { id: 'payer-1' },
    body: { description: 'The creator payment needs review.' },
    get: (header) => header === 'Idempotency-Key' ? 'creator-dispute-1' : null,
    ip: '127.0.0.1',
  }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(openCreditDispute).toHaveBeenCalledWith(expect.objectContaining({
    customerId: 'payer-1', transactionId: 'tx-1', idempotencyKey: 'creator-dispute-1', disputeType: 'incorrect_amount',
  }));
  expect(res.status).toHaveBeenCalledWith(201);
  openCreditDispute.mockRestore();
});

test('does not allow a creator dispute to target an unrelated payment kind', async () => {
  const next = jest.fn();
  await creator.openCreatorDispute({ params: { kind: 'refund', id: '11111111-1111-4111-8111-111111111111' }, user: { id: 'payer-1' }, body: {}, get: () => null }, resMock(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_dispute_type_invalid' }));
  expect(mockQuery).not.toHaveBeenCalled();
});
