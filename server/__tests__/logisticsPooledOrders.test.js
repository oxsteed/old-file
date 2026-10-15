'use strict';

// Phase 1 (logistics refactor): searchable campaign endpoints, paginated
// envelope with legacy-shape backward compatibility, and safe public
// visibility (guests must not see draft campaigns).

jest.mock('../services/pooledOrderService', () => ({
  listPooledOrders: jest.fn(),
  listOrganizerCampaigns: jest.fn(),
  getPooledOrder: jest.fn(),
  createPooledOrder: jest.fn(),
  joinPooledOrder: jest.fn(),
  updatePooledOrderStatus: jest.fn(),
  submitCampaignForReview: jest.fn(),
  reviewCampaign: jest.fn(),
  getApprovalHistory: jest.fn(),
  describeActions: jest.fn(),
  REVIEW_OPS_ROLES: ['sourcing_operator', 'logistics_coordinator'],
}));

// The controller resolves the viewer's logistics role for draft visibility;
// stub it so tests don't touch the database.
jest.mock('../middleware/requireLogisticsAccess', () => ({
  resolveLogisticsRole: jest.fn().mockResolvedValue('individual_buyer'),
}));

jest.mock('../db', () => ({ query: jest.fn() }));

const express = require('express');
const request = require('supertest');
const pooledOrderService = require('../services/pooledOrderService');
const pooledCtrl = require('../controllers/logisticsPooledOrdersController');

function buildApp(asUser) {
  const app = express();
  app.use(express.json());
  if (asUser) {
    app.use((req, _res, next) => { req.user = { id: 'user-1' }; next(); });
  }
  app.get('/campaigns', pooledCtrl.listPooledOrders);
  app.get('/campaigns/:id', pooledCtrl.getPooledOrder);
  app.get('/organizer/campaigns', pooledCtrl.listOrganizerCampaigns);
  app.post('/campaigns/:id/submit', pooledCtrl.submitForReview);
  app.post('/campaigns/:id/review', pooledCtrl.reviewCampaign);
  app.get('/campaigns/:id/approval-history', pooledCtrl.getApprovalHistory);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message, code: err.code, fields: err.fields });
  });
  return app;
}

const guestApp = () => buildApp(false);
const authedApp = () => buildApp(true);

const sampleOrders = [
  { id: 1, title: 'Steel beams', status: 'open' },
  { id: 2, title: 'Copper wire', status: 'pledging' },
];

beforeEach(() => {
  jest.clearAllMocks();
  pooledOrderService.listPooledOrders.mockResolvedValue({ orders: sampleOrders, total: 42 });
  pooledOrderService.listOrganizerCampaigns.mockResolvedValue({ orders: sampleOrders, total: 42 });
  pooledOrderService.describeActions.mockResolvedValue({ actions: [], blockers: [] });
  pooledOrderService.getApprovalHistory.mockResolvedValue([]);
});

describe('GET /campaigns — legacy shape (no pagination params)', () => {
  test('returns the existing { success, orders, total } shape unchanged', async () => {
    const res = await request(guestApp()).get('/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toEqual(sampleOrders);
    expect(res.body.total).toBe(42);
    expect(res.body.data).toBeUndefined();
    expect(res.body.pagination).toBeUndefined();
  });

  test('passes defaults and guest draft exclusion to the service', async () => {
    await request(guestApp()).get('/campaigns');
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        open: null,
        publicSafe: true,
        excludeDrafts: true,
        search: null,
        laneId: undefined,
        status: undefined,
      })
    );
  });

  test('legacy limit/offset still work without triggering the new envelope', async () => {
    // offset without page/limit keeps the legacy shape.
    const res = await request(guestApp()).get('/campaigns').query({ offset: 20 });
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual(sampleOrders);
    expect(res.body.pagination).toBeUndefined();
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 })
    );
  });
});

describe('GET /campaigns — search and filters', () => {
  test('search is forwarded and matched against title/description server-side', async () => {
    await request(guestApp()).get('/campaigns').query({ search: 'steel' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'steel' })
    );
  });

  test('blank search is treated as no search', async () => {
    await request(guestApp()).get('/campaigns').query({ search: '   ' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ search: null })
    );
  });

  test('lane filter accepts ?lane= and the legacy ?lane_id= alias', async () => {
    await request(guestApp()).get('/campaigns').query({ lane: '3' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ laneId: 3 })
    );
    await request(guestApp()).get('/campaigns').query({ lane_id: '4' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ laneId: 4 })
    );
  });

  test('non-numeric lane is ignored instead of crashing the query', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ lane: 'abc' });
    expect(res.status).toBe(200);
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ laneId: undefined })
    );
  });

  test('status filter is forwarded', async () => {
    await request(guestApp()).get('/campaigns').query({ status: 'pledging' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pledging' })
    );
  });
});

describe('GET /campaigns — paginated envelope', () => {
  test('?page=&limit= returns data + pagination and keeps legacy fields', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ page: '2', limit: '10' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(sampleOrders);
    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 42, totalPages: 5 });
    // Backward compatibility: legacy fields still present.
    expect(res.body.orders).toEqual(sampleOrders);
    expect(res.body.total).toBe(42);
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10 })
    );
  });

  test('limit alone opts into pagination with page 1', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ limit: '5' });
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 0 })
    );
  });

  test('legacy limit+offset without page keeps the explicit offset', async () => {
    const res = await request(guestApp()).get('/campaigns').query({ limit: '20', offset: '40' });
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 3, limit: 20 });
    expect(res.body.orders).toEqual(sampleOrders);
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 40 })
    );
  });

  test('limit is capped at 100', async () => {
    await request(guestApp()).get('/campaigns').query({ limit: '500' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0 })
    );
  });

  test('page defaults to 1 and is clamped to >= 1', async () => {
    await request(guestApp()).get('/campaigns').query({ page: '0', limit: '10' });
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 })
    );
  });
});

describe('GET /campaigns — visibility', () => {
  test('drafts are excluded on the public endpoint even for authenticated users', async () => {
    // Phase 2: organizers list their own drafts through the scoped
    // /organizer/campaigns endpoint; the public board never enumerates them.
    await request(authedApp()).get('/campaigns');
    expect(pooledOrderService.listPooledOrders).toHaveBeenCalledWith(
      expect.objectContaining({ excludeDrafts: true })
    );
  });
});

describe('GET /organizer/campaigns — scoped organizer listing', () => {
  test('returns only the authenticated organizer campaigns', async () => {
    const res = await request(authedApp()).get('/organizer/campaigns').query({ limit: '5' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(pooledOrderService.listOrganizerCampaigns).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ limit: 5, offset: 0 })
    );
  });
});

describe('GET /campaigns/:id — visibility', () => {
  test('guest requesting a draft campaign gets 404 (no existence leak)', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Draft widgets', status: 'draft', approval_state: 'draft', organizer_user_id: 'user-9',
    });
    const res = await request(guestApp()).get('/campaigns/9');
    expect(res.status).toBe(404);
  });

  test('guest requesting an in-review campaign gets 404 (no existence leak)', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Pending widgets', status: 'draft', approval_state: 'pending_review', organizer_user_id: 'user-9',
    });
    const res = await request(guestApp()).get('/campaigns/9');
    expect(res.status).toBe(404);
  });

  test('guest can still fetch a published campaign', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Steel beams', status: 'open', approval_state: 'approved', organizer_user_id: 'user-9',
    });
    const res = await request(guestApp()).get('/campaigns/9');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(9);
  });

  test('authenticated organizer can fetch their own draft', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Draft widgets', status: 'draft', approval_state: 'draft', organizer_user_id: 'user-1',
    });
    const res = await request(authedApp()).get('/campaigns/9');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
    // Server-derived capabilities are attached for the organizer.
    expect(pooledOrderService.describeActions).toHaveBeenCalled();
    expect(pooledOrderService.getApprovalHistory).toHaveBeenCalledWith(9);
  });

  test('authenticated non-owner cannot fetch someone else\u2019s draft', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue({
      id: 9, title: 'Draft widgets', status: 'draft', approval_state: 'draft', organizer_user_id: 'user-9',
    });
    const res = await request(authedApp()).get('/campaigns/9');
    expect(res.status).toBe(404);
  });

  test('missing campaign still 404s for guests', async () => {
    pooledOrderService.getPooledOrder.mockResolvedValue(null);
    const res = await request(guestApp()).get('/campaigns/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /campaigns/:id/submit — draft submission', () => {
  test('organizer submission returns the pending campaign', async () => {
    pooledOrderService.submitCampaignForReview.mockResolvedValue({
      id: 9, approval_state: 'pending_review', status: 'draft',
    });
    const res = await request(authedApp()).post('/campaigns/9/submit');
    expect(res.status).toBe(200);
    expect(res.body.data.approval_state).toBe('pending_review');
    expect(pooledOrderService.submitCampaignForReview).toHaveBeenCalledWith(
      '9', 'user-1', expect.objectContaining({ userRole: 'individual_buyer' })
    );
  });

  test('submission blockers surface as 422 with details', async () => {
    const blockers = [{ code: 'missing_title', field: 'title', message: 'Add a campaign title.' }];
    const err = new Error('Campaign is not ready for review');
    err.code = 'approval_blockers';
    err.status = 422;
    err.details = { blockers };
    pooledOrderService.submitCampaignForReview.mockRejectedValue(err);
    const res = await request(authedApp()).post('/campaigns/9/submit');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('approval_blockers');
    expect(res.body.fields.blockers).toEqual(blockers);
  });

  test('non-owner submission is forbidden', async () => {
    const err = new Error('Only the campaign organizer can submit it for review');
    err.code = 'not_owner';
    err.status = 403;
    pooledOrderService.submitCampaignForReview.mockRejectedValue(err);
    const res = await request(authedApp()).post('/campaigns/9/submit');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });
});

describe('POST /campaigns/:id/review — operations review', () => {
  test('approving publishes the campaign', async () => {
    pooledOrderService.reviewCampaign.mockResolvedValue({
      id: 9, approval_state: 'approved', status: 'open',
    });
    const res = await request(authedApp()).post('/campaigns/9/review').send({ decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.data.approval_state).toBe('approved');
    expect(pooledOrderService.reviewCampaign).toHaveBeenCalledWith(
      '9', 'user-1', { decision: 'approve', reason: undefined }
    );
  });

  test('requesting revisions without a reason is rejected', async () => {
    const err = new Error('A reason is required when requesting revisions');
    err.code = 'review_reason_required';
    err.status = 400;
    pooledOrderService.reviewCampaign.mockRejectedValue(err);
    const res = await request(authedApp()).post('/campaigns/9/review').send({ decision: 'request_changes' });
    expect(res.status).toBe(400);
  });

  test('an invalid decision is rejected', async () => {
    // Decision validation lives in the service: it throws before any write.
    const err = new Error('decision must be approve or request_changes');
    err.code = 'invalid_review_decision';
    err.status = 400;
    pooledOrderService.reviewCampaign.mockRejectedValue(err);
    const res = await request(authedApp()).post('/campaigns/9/review').send({ decision: 'maybe' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(pooledOrderService.reviewCampaign).toHaveBeenCalledWith(
      '9', 'user-1', { decision: 'maybe', reason: undefined }
    );
  });

  test('self-review is forbidden even for operations staff', async () => {
    const err = new Error('Reviewers cannot approve their own campaign');
    err.code = 'self_approval';
    err.status = 403;
    pooledOrderService.reviewCampaign.mockRejectedValue(err);
    const res = await request(authedApp()).post('/campaigns/9/review').send({ decision: 'approve' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('self_approval');
  });
});

describe('GET /campaigns/:id/approval-history', () => {
  const db = require('../db');

  test('organizer can read the approval history', async () => {
    db.query.mockResolvedValue({
      rows: [{ id: 9, organizer_user_id: 'user-1', approval_state: 'pending_review' }],
    });
    pooledOrderService.getApprovalHistory.mockResolvedValue([
      { id: 1, decision: 'submitted_for_review', reviewer_name: 'Emile J' },
    ]);
    const res = await request(authedApp()).get('/campaigns/9/approval-history');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('non-owner non-ops gets 404 on an unapproved campaign (no leak)', async () => {
    db.query.mockResolvedValue({
      rows: [{ id: 9, organizer_user_id: 'user-9', approval_state: 'draft' }],
    });
    const res = await request(authedApp()).get('/campaigns/9/approval-history');
    expect(res.status).toBe(404);
  });

  test('missing campaign 404s', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(authedApp()).get('/campaigns/999/approval-history');
    expect(res.status).toBe(404);
  });
});
