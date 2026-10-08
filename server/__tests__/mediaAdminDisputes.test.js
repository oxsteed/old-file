'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/oxsteedCreditService', () => ({ listCreditDisputes: jest.fn() }));
jest.mock('../services/oxsteedCreditDisputeService', () => ({ resolveDisputeWithCompensation: jest.fn() }));

const pool = require('../db');
const { listCreditDisputes } = require('../services/oxsteedCreditService');
const { resolveDisputeWithCompensation } = require('../services/oxsteedCreditDisputeService');
const admin = require('../controllers/mediaAdminController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('Media creator dispute administration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('lists only Media payment disputes and labels their payment type', async () => {
    listCreditDisputes.mockResolvedValue({
      disputes: [{ id: 'd-1', referenceType: 'media_post_boost', status: 'open' }],
      pagination: { limit: 10, offset: 0, hasMore: false, nextOffset: null },
    });
    const res = response();

    await admin.listCreatorDisputes({ query: { status: 'open', limit: '10', offset: '0' } }, res, jest.fn());

    expect(listCreditDisputes).toHaveBeenCalledWith(expect.objectContaining({
      referenceTypes: ['media_creator_tip', 'media_creator_sponsorship', 'media_post_boost'],
      status: 'open',
      limit: '10',
      offset: '0',
      includePagination: true,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      disputes: [{ id: 'd-1', referenceType: 'media_post_boost', status: 'open', mediaKind: 'boost' }],
    }));
  });

  test('preserves an operational flag-queue failure', async () => {
    pool.query.mockRejectedValueOnce({
      status: 503,
      isOperational: true,
      code: 'credit_queue_unavailable',
      message: 'The dispute queue is temporarily unavailable.',
    });
    const res = response();

    await admin.listFlags({ query: {} }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'The dispute queue is temporarily unavailable.',
      code: 'credit_queue_unavailable',
    });
  });

  test('moves a Media dispute into audited review', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'd-1', reference_type: 'media_creator_tip' }] });
    resolveDisputeWithCompensation.mockResolvedValue({ dispute: { id: 'd-1', status: 'in_review' } });
    const res = response();

    await admin.reviewCreatorDispute({
      params: { disputeId: 'd-1' },
      body: { reason: 'Review the creator delivery evidence.' },
      user: { id: 'admin-1' },
      ip: '127.0.0.1',
      get: () => null,
    }, res, jest.fn());

    expect(resolveDisputeWithCompensation).toHaveBeenCalledWith(expect.objectContaining({
      disputeId: 'd-1', adminId: 'admin-1', decision: 'in_review',
      reason: 'Review the creator delivery evidence.',
    }));
    expect(res.json).toHaveBeenCalledWith({ dispute: { id: 'd-1', status: 'in_review' } });
  });

  test('resolves only a Media dispute and forwards compensation to the shared Credit rail', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'd-1', reference_type: 'media_creator_sponsorship' }] });
    resolveDisputeWithCompensation.mockResolvedValue({
      dispute: { id: 'd-1', status: 'resolved_customer' },
      compensation: { amountCents: 2500 },
    });
    const res = response();

    await admin.resolveCreatorDispute({
      params: { disputeId: 'd-1' },
      body: { status: 'resolved_customer', reason: 'Approved partial compensation.', compensationCents: 2500 },
      user: { id: 'admin-1' },
      ip: '127.0.0.1',
      get: () => null,
    }, res, jest.fn());

    expect(resolveDisputeWithCompensation).toHaveBeenCalledWith(expect.objectContaining({
      disputeId: 'd-1', adminId: 'admin-1', decision: 'resolved_customer',
      reason: 'Approved partial compensation.', compensationCents: 2500,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ compensation: { amountCents: 2500 } }));
  });

  test('does not pass a non-Media dispute to the resolver', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const next = jest.fn();

    await admin.resolveCreatorDispute({
      params: { disputeId: 'd-other' }, body: { status: 'rejected', reason: 'Not a Media case.' },
      user: { id: 'admin-1' }, ip: '127.0.0.1', get: () => null,
    }, response(), next);

    expect(resolveDisputeWithCompensation).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'media_creator_dispute_not_found', status: 404 }));
  });
});
