'use strict';

/**
 * Tests for the settings change-management API (Worker A).
 * DB is mocked through ./setup like the neighboring controller tests:
 * pool.query and client.query share the same mockQuery, so transactional
 * call sequences are asserted in order with mockResolvedValueOnce.
 */

const { mockQuery, resetMocks } = require('./setup');
const settingsChangeController = require('../controllers/settingsChangeController');

const PROPOSER_ID = '00000000-0000-4000-8000-000000000101';
const APPROVER_ID = '00000000-0000-4000-8000-000000000102';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function requestDouble({ userId = PROPOSER_ID, params = {}, body = {}, query = {}, isSuper = false } = {}) {
  return {
    user: { id: userId, role: isSuper ? 'super_admin' : 'admin' },
    isSuper,
    params,
    body,
    query,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'admin-test' },
  };
}

function sqlCalls(fragment) {
  return mockQuery.mock.calls.filter(([sql]) => new RegExp(fragment).test(String(sql)));
}

function auditActions() {
  return sqlCalls('INSERT INTO admin_audit_log').map(([, params]) => params[1]);
}

const settingRow = {
  key: 'bid_expiry_hours',
  value: '72',
  value_type: 'number',
  min_numeric_value: 1,
  max_numeric_value: 720,
  version: 3,
};

const proposedRequest = {
  id: REQUEST_ID,
  kind: 'setting',
  key: 'bid_expiry_hours',
  proposed_value: '48',
  reason: 'Lower max bid window',
  status: 'proposed',
  proposed_by: PROPOSER_ID,
  reviewed_by: null,
  decided_at: null,
  effective_at: null,
  rollout_percent: null,
  rollout_segment: null,
};

beforeEach(() => {
  resetMocks();
});

describe('proposeChange', () => {
  test('creates a change request with status proposed and audits it (201)', async () => {
    const created = { ...proposedRequest, created_at: new Date().toISOString() };
    mockQuery
      .mockResolvedValueOnce({ rows: [settingRow] }) // SELECT platform_settings
      .mockResolvedValueOnce({ rows: [created] }); // INSERT settings_change_requests

    const res = responseDouble();
    await settingsChangeController.proposeChange(
      requestDouble({
        body: {
          kind: 'setting',
          key: 'bid_expiry_hours',
          proposed_value: 48,
          reason: 'Lower max bid window',
        },
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ status: 'proposed', key: 'bid_expiry_hours' }),
      })
    );
    expect(auditActions()).toContain('settings_change_proposed');
  });

  test('a future effective_at proposal starts as proposed, never scheduled (separation of duties)', async () => {
    const created = {
      ...proposedRequest,
      kind: 'flag',
      key: 'new_dashboard',
      status: 'proposed',
      effective_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ key: 'new_dashboard' }] }) // SELECT feature_flags
      .mockResolvedValueOnce({ rows: [created] }); // INSERT

    const res = responseDouble();
    await settingsChangeController.proposeChange(
      requestDouble({
        body: {
          kind: 'flag',
          key: 'new_dashboard',
          proposed_value: true,
          reason: 'Roll out gradually',
          effective_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    // The status the controller actually passed to the INSERT (5th parameter).
    expect(mockQuery.mock.calls[1][1][4]).toBe('proposed');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ status: 'proposed' }) })
    );
  });

  test('rejects a blank reason with 400', async () => {
    const res = responseDouble();
    await settingsChangeController.proposeChange(
      requestDouble({
        body: { kind: 'setting', key: 'bid_expiry_hours', proposed_value: 48, reason: '  ' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'reason_required' }));
    expect(sqlCalls('INSERT INTO settings_change_requests')).toHaveLength(0);
  });

  test('rejects an invalid proposed value with 400 invalid_setting_value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [settingRow] }); // SELECT platform_settings

    const res = responseDouble();
    await settingsChangeController.proposeChange(
      requestDouble({
        body: { kind: 'setting', key: 'bid_expiry_hours', proposed_value: '9999999', reason: 'Too high' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_setting_value' }));
    expect(sqlCalls('INSERT INTO settings_change_requests')).toHaveLength(0);
  });

  test('returns 404 for an unknown setting key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT platform_settings -> missing

    const res = responseDouble();
    await settingsChangeController.proposeChange(
      requestDouble({
        body: { kind: 'setting', key: 'nope_not_a_key', proposed_value: '1', reason: 'x' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'setting_not_found' }));
  });
});

describe('approveChange', () => {
  test('applies immediately for a due request: applied status + version bump + audit', async () => {
    const applied = { ...proposedRequest, status: 'applied', reviewed_by: APPROVER_ID };
    mockQuery
      .mockResolvedValueOnce({ rows: [proposedRequest] }) // getChangeRequest
      .mockResolvedValueOnce({ rows: [] }) // UPDATE ... status='approved'
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...proposedRequest, status: 'approved', reviewed_by: APPROVER_ID }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [settingRow] }) // SELECT platform_settings FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE platform_settings
      .mockResolvedValueOnce({ rows: [] }) // audit INSERT (platform_setting_updated)
      .mockResolvedValueOnce({ rows: [applied] }); // UPDATE settings_change_requests RETURNING *

    const res = responseDouble();
    await settingsChangeController.approveChange(
      requestDouble({ userId: APPROVER_ID, params: { id: REQUEST_ID } }),
      res
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        applied: true,
        request: expect.objectContaining({ status: 'applied' }),
      })
    );
    // Version bump uses the same versioning expression as updateSetting.
    expect(
      sqlCalls('UPDATE platform_settings').some(([sql]) => /COALESCE\(version, 1\) \+ 1/.test(String(sql)))
    ).toBe(true);
    const actions = auditActions();
    expect(actions).toContain('platform_setting_updated');
    expect(actions).toContain('settings_change_applied');
    expect(actions).toContain('settings_change_approved');
  });

  test('separation of duties: proposer cannot approve their own request (403)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...proposedRequest, proposed_by: APPROVER_ID }],
    });

    const res = responseDouble();
    await settingsChangeController.approveChange(
      requestDouble({ userId: APPROVER_ID, params: { id: REQUEST_ID } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'separation_of_duties' }));
    expect(sqlCalls('UPDATE platform_settings')).toHaveLength(0);
  });

  test('rejects approving an already-applied request (409)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...proposedRequest, status: 'applied' }],
    });

    const res = responseDouble();
    await settingsChangeController.approveChange(
      requestDouble({ userId: APPROVER_ID, params: { id: REQUEST_ID } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'change_request_not_applicable' })
    );
  });
});

describe('previewChange', () => {
  test('returns the expected preview shape with affected consumers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [proposedRequest] }) // getChangeRequest
      .mockResolvedValueOnce({ rows: [settingRow] }); // SELECT platform_settings

    const res = responseDouble();
    await settingsChangeController.previewChange(
      requestDouble({ params: { id: REQUEST_ID } }),
      res
    );

    expect(res.json).toHaveBeenCalledWith({
      key: 'bid_expiry_hours',
      kind: 'setting',
      current_value: '72',
      current_version: 3,
      proposed_value: '48',
      affected_consumers: 'bid expiry worker',
    });
  });

  test('returns 404 for an unknown request id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = responseDouble();
    await settingsChangeController.previewChange(
      requestDouble({ params: { id: REQUEST_ID } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'change_request_not_found' })
    );
  });
});

describe('cancelChange', () => {
  test('forbids cancel by an uninvolved non-super admin (403)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [proposedRequest] });

    const res = responseDouble();
    await settingsChangeController.cancelChange(
      requestDouble({ userId: APPROVER_ID, params: { id: REQUEST_ID } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'cancel_not_allowed' }));
    expect(sqlCalls("status = 'cancelled'")).toHaveLength(0);
  });

  test('allows the proposer to cancel (cancelled + audit)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [proposedRequest] })
      .mockResolvedValueOnce({ rows: [{ ...proposedRequest, status: 'cancelled' }] });

    const res = responseDouble();
    await settingsChangeController.cancelChange(
      requestDouble({ userId: PROPOSER_ID, params: { id: REQUEST_ID } }),
      res
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ status: 'cancelled' }) })
    );
    expect(auditActions()).toContain('settings_change_cancelled');
  });
});

describe('rejectChange / scheduleChange', () => {
  test('reject requires a reason and audits', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [proposedRequest] })
      .mockResolvedValueOnce({ rows: [{ ...proposedRequest, status: 'rejected', reviewed_by: APPROVER_ID }] });

    const res = responseDouble();
    await settingsChangeController.rejectChange(
      requestDouble({ userId: APPROVER_ID, params: { id: REQUEST_ID }, body: { reason: 'Too risky' } }),
      res
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ status: 'rejected' }) })
    );
    expect(auditActions()).toContain('settings_change_rejected');
  });

  test('schedule requires a future effective_at', async () => {
    const res = responseDouble();
    await settingsChangeController.scheduleChange(
      requestDouble({
        userId: APPROVER_ID,
        params: { id: REQUEST_ID },
        body: { effective_at: new Date(Date.now() - 1000).toISOString() },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_effective_at' }));
  });
});

describe('listChanges', () => {
  test('lists newest first with pagination metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [proposedRequest] }) // page query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] }); // count query

    const res = responseDouble();
    await settingsChangeController.listChanges(requestDouble({ query: { page: '1', limit: '10' } }), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ requests: [proposedRequest], page: 1, limit: 10, total: 1 })
    );
    expect(sqlCalls('ORDER BY created_at DESC')).toHaveLength(1);
  });

  test('rejects an invalid status filter', async () => {
    const res = responseDouble();
    await settingsChangeController.listChanges(
      requestDouble({ query: { status: 'bogus' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_status' }));
  });
});
