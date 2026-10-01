'use strict';

// Workstream B tests: approval workflow, fingerprint binding, owner
// notifications, and the notification retry job for profile-visibility
// admin controls.

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

const notificationService = require('../services/notificationService');
const approvals = require('../services/profileVisibilityApprovals');
const notifications = require('../services/profileVisibilityNotifications');
const retryJob = require('../jobs/profileVisibilityNotificationRetry');

function resDouble() {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  return res;
}

beforeEach(() => {
  resetMocks();
  notificationService.sendNotification.mockReset();
});

const PAYLOAD_A = { items: [{ profile_type: 'business', profile_id: 'b-1', is_visible: false }] };
const PAYLOAD_B = { items: [{ profile_type: 'business', profile_id: 'b-1', is_visible: true }] };

describe('approval request idempotent replay', () => {
  test('same idempotency key returns the existing record without a second row', async () => {
    const createdRow = {
      id: 'a-1', action_type: 'bulk', payload: PAYLOAD_A,
      fingerprint: approvals.computeFingerprint('bulk', PAYLOAD_A),
      idempotency_key: 'key-1', requested_by: 'admin-1', status: 'pending',
    };
    // First request: insert succeeds.
    mockQuery.mockResolvedValueOnce({ rows: [createdRow] });
    const first = await approvals.requestApproval({
      actionType: 'bulk', payload: PAYLOAD_A, requestedBy: 'admin-1', idempotencyKey: 'key-1',
    });
    expect(first.created).toBe(true);
    expect(first.approval.id).toBe('a-1');

    // Replay: insert conflicts (no row), existing record returned.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [createdRow] });
    const second = await approvals.requestApproval({
      actionType: 'bulk', payload: PAYLOAD_A, requestedBy: 'admin-1', idempotencyKey: 'key-1',
    });
    expect(second.created).toBe(false);
    expect(second.approval.id).toBe('a-1');
    // Every request issues its conflict-guarded INSERT; the replay adds
    // exactly one SELECT and no new approval row (created=false proves it).
    const inserts = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO profile_visibility_approvals/.test(sql));
    const selects = mockQuery.mock.calls.filter(([sql]) => /SELECT \* FROM profile_visibility_approvals/.test(sql));
    expect(inserts).toHaveLength(2);
    expect(selects).toHaveLength(1);
  });
});

describe('reviewApproval separation of duties', () => {
  test('the requesting admin cannot review their own request (403)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'a-1', requested_by: 'admin-1', status: 'pending', action_type: 'bulk', payload: PAYLOAD_A }],
    });
    await expect(
      approvals.reviewApproval({ approvalId: 'a-1', reviewerId: 'admin-1', decision: 'approved' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'separation_of_duties' });
  });

  test('a second admin can approve a pending request', async () => {
    const row = { id: 'a-1', requested_by: 'admin-1', status: 'pending', action_type: 'single', payload: {} };
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...row, status: 'approved' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log insert
    const result = await approvals.reviewApproval({
      approvalId: 'a-1', reviewerId: 'admin-2', decision: 'approved', note: 'looks fine',
    });
    expect(result.approval.status).toBe('approved');
  });

  test('reviewApprovalCtrl surfaces the 403 to the HTTP layer', async () => {
    const controller = require('../controllers/profileVisibilityApprovalsController');
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'a-1', requested_by: 'admin-1', status: 'pending', action_type: 'bulk', payload: PAYLOAD_A }],
    });
    const res = resDouble();
    await controller.reviewApprovalCtrl(
      { params: { id: '00000000-0000-4000-8000-000000000001' }, body: { decision: 'approved' }, user: { id: 'admin-1' } },
      res
    );
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('separation_of_duties');
  });

  test('requestApprovalCtrl 409s on a duplicate idempotency key', async () => {
    const controller = require('../controllers/profileVisibilityApprovalsController');
    const row = {
      id: 'a-1', action_type: 'single', payload: {},
      fingerprint: 'f', idempotency_key: 'dup', requested_by: 'admin-1', status: 'pending',
    };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    const res = resDouble();
    await controller.requestApprovalCtrl(
      { body: { action_type: 'single', payload: {}, idempotency_key: 'dup' }, user: { id: 'admin-1' } },
      res
    );
    expect(res.statusCode).toBe(409);
    expect(res.payload.approval.id).toBe('a-1');
  });
});

describe('fingerprint binding', () => {
  test('verification fails when the payload differs from what was reviewed', async () => {
    const approval = {
      id: 'a-1', action_type: 'bulk', status: 'approved',
      fingerprint: approvals.computeFingerprint('bulk', PAYLOAD_A),
    };
    mockQuery.mockResolvedValueOnce({ rows: [approval] });
    const result = await approvals.verifyApprovalForAction({
      approvalId: 'a-1', actionType: 'bulk', payload: PAYLOAD_B,
    });
    expect(result).toBeNull();
  });

  test('verification succeeds when the payload matches exactly', async () => {
    const approval = {
      id: 'a-1', action_type: 'bulk', status: 'approved',
      fingerprint: approvals.computeFingerprint('bulk', PAYLOAD_A),
    };
    mockQuery.mockResolvedValueOnce({ rows: [approval] });
    const result = await approvals.verifyApprovalForAction({
      approvalId: 'a-1', actionType: 'bulk', payload: JSON.parse(JSON.stringify(PAYLOAD_A)),
    });
    expect(result && result.id).toBe('a-1');
  });

  test('verification rejects a non-approved approval', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'a-1', action_type: 'bulk', status: 'consumed',
               fingerprint: approvals.computeFingerprint('bulk', PAYLOAD_A) }],
    });
    const result = await approvals.verifyApprovalForAction({
      approvalId: 'a-1', actionType: 'bulk', payload: PAYLOAD_A,
    });
    expect(result).toBeNull();
  });
});

describe('consume-once semantics', () => {
  test('consumeApproval only works from approved, once', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a-1', status: 'consumed' }] });
    expect(await approvals.consumeApproval('a-1')).toMatchObject({ status: 'consumed' });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await approvals.consumeApproval('a-1')).toBeNull();
  });
});

describe('enforceVisibilityApproval middleware', () => {
  const { enforceVisibilityApproval } = require('../middleware/profileVisibilityApproval');

  test('bulk actions without an approval get a 409 with approval_required', async () => {
    const middleware = enforceVisibilityApproval('bulk');
    const res = resDouble();
    const next = jest.fn();
    await middleware({ body: { items: Array(12).fill({ profile_type: 'business', profile_id: 'x', is_visible: false }) } }, res, next);
    expect(res.statusCode).toBe(409);
    expect(res.payload.approval_required).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  test('small bulk actions at/below the threshold skip the gate', async () => {
    const middleware = enforceVisibilityApproval('bulk', { bulkThreshold: 10 });
    const next = jest.fn();
    await middleware({ body: { items: [{ profile_type: 'helper', profile_id: 'h1', is_visible: true }] } }, resDouble(), next);
    expect(next).toHaveBeenCalled();
  });

  test('a matching approved approval attaches req.visibilityApproval', async () => {
    // More than bulkThreshold items so the approval gate engages.
    const bigA = { items: Array.from({ length: 12 }, (_, i) => ({ profile_type: 'business', profile_id: `b-${i}`, is_visible: false })) };
    const approval = {
      id: 'a-1', action_type: 'bulk', status: 'approved',
      fingerprint: approvals.computeFingerprint('bulk', bigA),
    };
    mockQuery.mockResolvedValueOnce({ rows: [approval] });
    const middleware = enforceVisibilityApproval('bulk');
    const res = resDouble();
    const next = jest.fn();
    const req = { body: { ...bigA, approval_id: 'a-1' } };
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.visibilityApproval.id).toBe('a-1');
  });

  test('an approval bound to a different payload is rejected', async () => {
    const bigA = { items: Array.from({ length: 12 }, (_, i) => ({ profile_type: 'business', profile_id: `b-${i}`, is_visible: false })) };
    const bigB = { items: Array.from({ length: 12 }, (_, i) => ({ profile_type: 'business', profile_id: `b-${i}`, is_visible: true })) };
    const approval = {
      id: 'a-1', action_type: 'bulk', status: 'approved',
      fingerprint: approvals.computeFingerprint('bulk', bigA),
    };
    mockQuery.mockResolvedValueOnce({ rows: [approval] });
    const middleware = enforceVisibilityApproval('bulk');
    const res = resDouble();
    const next = jest.fn();
    await middleware({ body: { ...bigB, approval_id: 'a-1' } }, res, next);
    expect(res.statusCode).toBe(409);
    expect(res.payload.approval_required).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('owner notifications', () => {
  test('a notification row is written on hide and marked sent', async () => {
    // owner lookup, delivery-row insert, mark sent
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1', display_name: 'Cafe Lumiere' }] });
    const notifRow = { id: 'n-1', profile_type: 'business', profile_id: 'b-1', action: 'hidden',
                       recipient_user_id: 'user-1', status: 'pending', delivery_key: 'dlk-1' };
    mockQuery.mockResolvedValueOnce({ rows: [notifRow] });
    notificationService.sendNotification.mockResolvedValue({ success: true, notificationId: 42 });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...notifRow, status: 'sent' }] });

    const result = await notifications.notifyOwnerOfVisibilityChange({
      profileType: 'business', profileId: 'b-1', isVisible: false, actorId: 'admin-9',
    });

    expect(result.delivered).toBe(true);
    expect(notificationService.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      type: 'profile_visibility_changed',
      data: expect.objectContaining({ profile_type: 'business', profile_id: 'b-1', is_visible: false }),
    }));
    expect(mockQuery.mock.calls[2][0]).toMatch(/SET status = \$2/);
  });

  test('send failures are recorded on the row instead of thrown', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1', display_name: 'Cafe Lumiere' }] });
    const notifRow = { id: 'n-2', profile_type: 'business', profile_id: 'b-1', action: 'restored',
                       recipient_user_id: 'user-1', status: 'pending', delivery_key: 'dlk-2' };
    mockQuery.mockResolvedValueOnce({ rows: [notifRow] });
    notificationService.sendNotification.mockResolvedValue({ success: false, error: 'provider down' });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...notifRow, status: 'failed' }] });

    const result = await notifications.notifyOwnerOfVisibilityChange({
      profileType: 'business', profileId: 'b-1', isVisible: true,
    });
    expect(result.delivered).toBe(false);
    expect(mockQuery.mock.calls[2][1]).toEqual(expect.arrayContaining(['n-2', 'failed', 'provider down']));
  });

  test('duplicate delivery keys do not insert a second row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 'user-1', display_name: 'Cafe Lumiere' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // insert conflicted
    const existing = { id: 'n-0', profile_type: 'business', profile_id: 'b-1', action: 'hidden',
                       recipient_user_id: 'user-1', status: 'sent', delivery_key: 'dlk-0' };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const result = await notifications.notifyOwnerOfVisibilityChange({
      profileType: 'business', profileId: 'b-1', isVisible: false, idempotencyKey: 'dlk-0',
    });
    expect(result.delivered).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(notificationService.sendNotification).not.toHaveBeenCalled();
  });
});

describe('notification retry job', () => {
  test('processes a failed row and marks it sent', async () => {
    const row = {
      id: 'n-9', profile_type: 'helper', profile_id: 'h-9', action: 'hidden',
      recipient_user_id: 'user-9', delivery_key: 'dlk-9', attempts: 2,
    };
    mockQuery
      .mockResolvedValueOnce({})                 // BEGIN
      .mockResolvedValueOnce({ rows: [row] })    // claim failed rows
      .mockResolvedValueOnce({})                 // UPDATE sent
      .mockResolvedValueOnce({});                // COMMIT
    notificationService.sendNotification.mockResolvedValue({ success: true });

    const summary = await retryJob.processNotificationRetries();

    expect(summary.sent).toBe(1);
    expect(notificationService.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-9', type: 'profile_visibility_changed', idempotencyKey: 'dlk-9',
    }));
    const updateSql = mockQuery.mock.calls[2][0];
    expect(updateSql).toMatch(/SET status = 'sent'/);
  });
});
