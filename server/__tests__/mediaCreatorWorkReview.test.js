"use strict";
const { mockQuery, resetMocks } = require('./setup');
const creator = require('../controllers/mediaCreatorController');
const admin = require('../controllers/mediaCreatorWorkAdminController');
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
beforeEach(() => resetMocks());

test('delivered sponsorship cancellation preserves its reservation for administrator review', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (q.includes('SELECT s.*, a.owner_user_id')) return { rows: [{ id: 's-1', status: 'delivered', creator_user_id: 'creator', sponsor_user_id: 'payer', credit_reservation_id: 'hold-1' }] };
    if (q.includes('INSERT INTO media_creator_work_reviews')) return { rows: [{ id: 'review-1', kind: 'sponsorship', status: 'open' }] };
    return { rows: [] };
  });
  const res = response(); const next = jest.fn();
  await creator.cancelSponsorship({ user: { id: 'payer' }, params: { sponsorshipId: 's-1' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ workReview: expect.objectContaining({ status: 'open' }) }));
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('oxsteed_credit_reservations'))).toBe(false);
});

test('pending work review prevents sponsor payment before any Credit release', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (q.includes('SELECT s.*, a.owner_user_id')) return { rows: [{ id: 's-1', status: 'delivered', creator_user_id: 'creator', sponsor_user_id: 'payer' }] };
    if (q.includes('FROM media_creator_work_reviews')) return { rows: [{ id: 'review-1', status: 'open' }] };
    return { rows: [] };
  });
  const next = jest.fn();
  await creator.settleSponsorship({ user: { id: 'payer' }, params: { sponsorshipId: 's-1' } }, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_work_review_pending' }));
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('oxsteed_credit_reservations'))).toBe(false);
});

test('only the sponsor can request revisions and funds remain reserved', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (q.includes('SELECT * FROM media_creator_sponsorships')) return { rows: [{ id: 's-1', status: 'delivered' }] };
    if (q.includes('UPDATE media_creator_sponsorships')) return { rows: [{ id: 's-1', status: 'accepted', review_note: 'Please add a closeup.' }] };
    return { rows: [] };
  });
  const res = response();
  await creator.requestSponsorshipChanges({ user: { id: 'payer' }, params: { sponsorshipId: 's-1' }, body: { reason: 'Please add a closeup.' } }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith({ sponsorship: expect.objectContaining({ status: 'accepted' }) });
  expect(mockQuery.mock.calls.find(([q]) => String(q).includes('SELECT * FROM media_creator_sponsorships'))[1]).toEqual(['s-1','payer']);
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('oxsteed_credit_reservations'))).toBe(false);
});

test('gig creator must explicitly accept the award before delivery', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('SELECT ap.id')) return { rows: [{ id: 'app-1', status: 'awarded', accepted_at: null }] };
    return { rows: [] };
  });
  const next = jest.fn();
  await creator.submitDeliverable({ user: { id: 'creator' }, params: { applicationId: 'app-1' }, body: { postId: 'post-1' } }, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_deliverable_invalid' }));
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('INSERT INTO media_creator_deliverables'))).toBe(false);
});

test('admin resume retains funds and records an audited decision', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (q.includes('SELECT kind, reference_id')) return { rows: [{ kind: 'sponsorship', reference_id: 's-1' }] };
    if (q.includes('SELECT * FROM media_creator_sponsorships')) return { rows: [{ id: 's-1', status: 'delivered' }] };
    if (q.includes('SELECT * FROM media_creator_work_reviews')) return { rows: [{ id: 'review-1', kind: 'sponsorship', status: 'open' }] };
    if (q.includes('UPDATE media_creator_work_reviews')) return { rows: [{ id: 'review-1', status: 'resumed' }] };
    return { rows: [] };
  });
  const res = response(); const next = jest.fn();
  await admin.resolveWorkReview({ user: { id: 'admin' }, params: { reviewId: 'review-1' }, body: { decision: 'resume', reason: 'Creator will revise.' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ workReview: expect.objectContaining({ status: 'resumed' }) });
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('INSERT INTO admin_audit_log'))).toBe(true);
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('UPDATE oxsteed_credit_accounts'))).toBe(false);
});

test('admin cannot change a completed work-review decision on replay', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (q.includes('SELECT kind, reference_id')) return { rows: [{ kind: 'gig', reference_id: 'g-1' }] };
    if (q.includes('SELECT * FROM media_creator_gigs')) return { rows: [{ id: 'g-1', status: 'cancelled' }] };
    if (q.includes('SELECT * FROM media_creator_work_reviews')) return { rows: [{ id: 'r-1', status: 'released', decision_reason: 'Release agreed.' }] };
    return { rows: [] };
  });
  const next = jest.fn();
  await admin.resolveWorkReview({ user: { id: 'admin' }, params: { reviewId: 'r-1' }, body: { decision: 'resume', reason: 'Resume instead.' } }, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_work_review_conflict' }));
  expect(mockQuery).toHaveBeenLastCalledWith('ROLLBACK');
});


test('creator decline releases the unaccepted award once and notifies its buyer', async () => {
  mockQuery.mockImplementation(async sql => {
    const q = String(sql);
    if (q.includes('SELECT ap.*, g.status')) return { rows: [{ id: 'app', gig_id: 'gig', status: 'awarded', gig_status: 'awarded', owner_user_id: 'payer', credit_reservation_id: 'hold', award_amount_cents: 400, accepted_at: null }] };
    if (q.includes('FROM oxsteed_credit_reservations')) return { rows: [{ id: 'hold', account_id: 'wallet', amount_cents: 400, status: 'active' }] };
    if (q.includes('UPDATE oxsteed_credit_accounts')) return { rows: [{ id: 'wallet' }] };
    if (q.includes('UPDATE media_creator_applications')) return { rows: [{ id: 'app', status: 'withdrawn' }] };
    if (q.includes('UPDATE media_creator_gigs')) return { rows: [{ id: 'gig' }] };
    return { rows: [] };
  });
  const res = response(); const next = jest.fn();
  await creator.declineApplication({ user: { id: 'creator' }, params: { applicationId: 'app' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ application: { id: 'app', status: 'withdrawn' } });
  expect(mockQuery.mock.calls.filter(([q]) => String(q).includes('UPDATE oxsteed_credit_accounts'))).toHaveLength(1);
  expect(mockQuery).toHaveBeenLastCalledWith('COMMIT');
});

test('lost-response decline replay does not release its reservation twice', async () => {
  mockQuery.mockImplementation(async sql => String(sql).includes('SELECT ap.*, g.status') ? { rows: [{ id: 'app', status: 'withdrawn', gig_status: 'cancelled', accepted_at: null }] } : { rows: [] });
  const res = response(); const next = jest.fn();
  await creator.declineApplication({ user: { id: 'creator' }, params: { applicationId: 'app' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ replayed: true }));
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('oxsteed_credit_reservations'))).toBe(false);
});

test('decline cannot undo an already accepted award', async () => {
  mockQuery.mockImplementation(async sql => String(sql).includes('SELECT ap.*, g.status') ? { rows: [{ id: 'app', status: 'awarded', gig_status: 'awarded', accepted_at: new Date() }] } : { rows: [] });
  const next = jest.fn();
  await creator.declineApplication({ user: { id: 'creator' }, params: { applicationId: 'app' } }, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_application_state_invalid' }));
  expect(mockQuery.mock.calls.some(([q]) => String(q).includes('oxsteed_credit_reservations'))).toBe(false);
});

test('unrelated account cannot decline a known creator application', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const next = jest.fn();
  await creator.declineApplication({ user: { id: 'intruder' }, params: { applicationId: 'app' } }, response(), next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_application_not_found' }));
  expect(mockQuery.mock.calls[1][0]).toContain('ap.applicant_user_id = $2');
  expect(mockQuery.mock.calls[1][1]).toEqual(['app','intruder']);
});
