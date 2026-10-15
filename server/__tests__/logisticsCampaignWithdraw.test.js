'use strict';

/**
 * Withdraw endpoint + review-decision notifications (logistics pooled orders).
 *
 * Two layers, kept in one file:
 *  1. Service layer (pooledOrderService) with a mocked pool: withdraw guards,
 *     the reserved 'withdrawn' decision recorded in the approval history,
 *     and sendNotification triggered by review decisions (approve /
 *     request_changes / reject).
 *  2. Controller layer (logisticsPooledOrdersController) with a mocked
 *     service: the POST /campaigns/:id/withdraw route wiring and error
 *     mapping.
 */

// ─── Service-layer mocks ────────────────────────────────────────────
const mockQuery = jest.fn();
const mockClient = { query: mockQuery, release: jest.fn() };
jest.mock('../db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));
jest.mock('../services/logisticsAuditService', () => ({
  logLogisticsAction: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../db');
const notificationService = require('../services/notificationService');
// The controller-layer mock below replaces pooledOrderService with a
// jest.fn() facade; the service-layer tests must bypass it explicitly.
const realService = jest.requireActual('../services/pooledOrderService');

const flushNotifications = () =>
  new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

function campaignRow(overrides = {}) {
  return {
    id: 9,
    title: 'Steel beams',
    status: 'draft',
    approval_state: 'pending_review',
    organizer_user_id: 'owner-1',
    ...overrides,
  };
}

function mockCampaignSelect(row) {
  mockQuery.mockImplementation(async (sql) => {
    const text = String(sql);
    if (/SELECT \* FROM pooled_orders WHERE id = \$1 FOR UPDATE/.test(text)) {
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO logistics_campaign_approval_decisions/.test(text)) {
      return { rows: [{ id: 77, pooled_order_id: 9, decision: 'withdrawn' }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  notificationService.sendNotification.mockResolvedValue({ success: true });
  mockCampaignSelect(campaignRow());
});

describe('withdrawCampaign — service guards', () => {
  test('404 when the campaign does not exist', async () => {
    mockCampaignSelect(null);
    await expect(realService.withdrawCampaign(9, 'owner-1'))
      .rejects.toMatchObject({ status: 404, code: 'pooled_order_not_found' });
    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  test('403 when the caller is not the organizer', async () => {
    await expect(realService.withdrawCampaign(9, 'someone-else'))
      .rejects.toMatchObject({ status: 403, code: 'not_owner' });
  });

  test('409 when the campaign is already approved (not after approval)', async () => {
    mockCampaignSelect(campaignRow({ approval_state: 'approved', status: 'open' }));
    await expect(realService.withdrawCampaign(9, 'owner-1'))
      .rejects.toMatchObject({ status: 409, code: 'campaign_not_pending_review' });
  });

  test('409 when the campaign is still a draft', async () => {
    mockCampaignSelect(campaignRow({ approval_state: 'draft' }));
    await expect(realService.withdrawCampaign(9, 'owner-1'))
      .rejects.toMatchObject({ status: 409, code: 'campaign_not_pending_review' });
  });

  test('409 when revisions were already requested', async () => {
    mockCampaignSelect(campaignRow({ approval_state: 'revisions_requested' }));
    await expect(realService.withdrawCampaign(9, 'owner-1'))
      .rejects.toMatchObject({ status: 409, code: 'campaign_not_pending_review' });
  });
});

describe('withdrawCampaign — success path', () => {
  test('returns the campaign to draft and records the withdrawn decision', async () => {
    const order = await realService.withdrawCampaign(9, 'owner-1');

    expect(order.approval_state).toBe('draft');
    expect(order.latest_decision).toMatchObject({ id: 77 });

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SET approval_state = 'draft'"));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual([9]);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO logistics_campaign_approval_decisions'));
    expect(insertCall).toBeTruthy();
    // (pooled_order_id, decision, from_state, to_state, decided_by_user_id, reason)
    expect(insertCall[1]).toEqual([9, 'withdrawn', 'pending_review', 'draft', 'owner-1', null]);

    expect(mockQuery).toHaveBeenCalledWith('COMMIT');
    expect(notificationService.sendNotification).not.toHaveBeenCalled();
  });
});

describe('reviewCampaign — reject decision', () => {
  test('reject requires a reason', async () => {
    await expect(realService.reviewCampaign(9, 'ops-1', { decision: 'reject' }))
      .rejects.toMatchObject({ status: 400, code: 'review_reason_required' });
  });

  test('reject moves the campaign to rejected', async () => {
    const order = await realService.reviewCampaign(9, 'ops-1', {
      decision: 'reject', reason: 'Out of scope for this lane.',
    });
    expect(order.approval_state).toBe('rejected');
    await flushNotifications();
    expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        type: 'logistics_campaign_rejected',
      })
    );
  });

  test('organizer cannot review their own campaign', async () => {
    await expect(realService.reviewCampaign(9, 'owner-1', { decision: 'approve' }))
      .rejects.toMatchObject({ status: 403, code: 'self_approval' });
  });

  test('unknown decisions are still rejected', async () => {
    await expect(realService.reviewCampaign(9, 'ops-1', { decision: 'archive' }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_review_decision' });
  });
});

describe('reviewCampaign — organizer notifications', () => {
  test('approve notifies the organizer with the campaign title', async () => {
    const order = await realService.reviewCampaign(9, 'ops-1', { decision: 'approve' });
    expect(order.approval_state).toBe('approved');
    await flushNotifications();

    expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
    const call = notificationService.sendNotification.mock.calls[0][0];
    expect(call.userId).toBe('owner-1');
    expect(call.type).toBe('logistics_campaign_approved');
    expect(call.body).toContain('Steel beams');
    expect(call.action_url).toBe('/logistics/campaigns/9');
    expect(call.idempotencyKey).toContain('logistics:review:9:');
    expect(call.data).toMatchObject({ campaign_id: '9', decision: 'approve' });
  });

  test('request_changes notifies with the reviewer note', async () => {
    await realService.reviewCampaign(9, 'ops-1', {
      decision: 'request_changes', reason: 'Add the HS code.',
    });
    await flushNotifications();

    const call = notificationService.sendNotification.mock.calls[0][0];
    expect(call.type).toBe('logistics_campaign_revisions_requested');
    expect(call.body).toContain('Steel beams');
    expect(call.body).toContain('Add the HS code.');
  });

  test('a notification failure never breaks the review', async () => {
    notificationService.sendNotification.mockRejectedValueOnce(new Error('smtp down'));
    const order = await realService.reviewCampaign(9, 'ops-1', { decision: 'approve' });
    await flushNotifications();
    expect(order.approval_state).toBe('approved');
  });
});

describe('describeActions — withdraw / reject affordances', () => {
  const order = campaignRow();

  test('owner sees withdraw_from_review while pending review', async () => {
    const { actions } = await realService.describeActions(order, {
      isOwner: true, isOps: false, isAdmin: false, userId: 'owner-1',
    });
    expect(actions).toContain('withdraw_from_review');
    expect(actions).not.toContain('submit_for_review');
  });

  test('owner does not see withdraw_from_review once approved', async () => {
    const { actions } = await realService.describeActions(
      campaignRow({ approval_state: 'approved' }),
      { isOwner: true, isOps: false, isAdmin: false, userId: 'owner-1' }
    );
    expect(actions).not.toContain('withdraw_from_review');
  });

  test('operations sees reject_campaign while pending review', async () => {
    const { actions } = await realService.describeActions(order, {
      isOwner: false, isOps: true, isAdmin: false,
    });
    expect(actions).toEqual(
      expect.arrayContaining(['approve_campaign', 'request_revisions', 'reject_campaign'])
    );
  });
});

// ─── Controller layer: route wiring + error mapping ────────────────
jest.mock('../services/pooledOrderService', () => {
  const actual = jest.requireActual('../services/pooledOrderService');
  return { ...actual, withdrawCampaign: jest.fn() };
});
jest.mock('../middleware/requireLogisticsAccess', () => ({
  resolveLogisticsRole: jest.fn().mockResolvedValue('individual_buyer'),
}));

const express = require('express');
const request = require('supertest');
const pooledCtrl = require('../controllers/logisticsPooledOrdersController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'owner-1' }; next(); });
  app.post('/campaigns/:id/withdraw', pooledCtrl.withdrawCampaign);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500)
      .json({ error: err.message, code: err.code });
  });
  return app;
}

describe('POST /campaigns/:id/withdraw — controller', () => {
  test('delegates to the service and returns the updated campaign', async () => {
    const svc = require('../services/pooledOrderService');
    svc.withdrawCampaign.mockResolvedValue({ id: 9, approval_state: 'draft' });

    const res = await request(buildApp()).post('/campaigns/9/withdraw');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.approval_state).toBe('draft');
    expect(svc.withdrawCampaign).toHaveBeenCalledWith('9', 'owner-1');
  });

  test('maps not_owner to 403', async () => {
    const svc = require('../services/pooledOrderService');
    const err = new Error('Only the campaign organizer can withdraw it from review');
    err.code = 'not_owner';
    svc.withdrawCampaign.mockRejectedValue(err);

    const res = await request(buildApp()).post('/campaigns/9/withdraw');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  test('maps campaign_not_pending_review to 409', async () => {
    const svc = require('../services/pooledOrderService');
    const err = new Error('Only campaigns pending review can be withdrawn');
    err.code = 'campaign_not_pending_review';
    svc.withdrawCampaign.mockRejectedValue(err);

    const res = await request(buildApp()).post('/campaigns/9/withdraw');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('campaign_not_pending_review');
  });
});
