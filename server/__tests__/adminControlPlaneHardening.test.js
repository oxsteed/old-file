'use strict';

const { mockQuery, resetMocks } = require('./setup');
const { routeQueries } = require('./helpers/sqlRouter');
const superAdminController = require('../controllers/superAdminController');

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function requestDouble(params, body) {
  return {
    user: { id: ADMIN_ID, role: 'super_admin' },
    params,
    body,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'admin-test' },
  };
}

beforeEach(() => {
  resetMocks();
});

function mockProposal(row, kind = 'setting') {
  return routeQueries(mockQuery, [
    [/SELECT \* FROM platform_settings WHERE key/, { rows: [row] }],
    [/SELECT key FROM feature_flags WHERE key/, { rows: [{ key: row.key }] }],
    [/INSERT INTO settings_change_requests/, (_sql, params) => ({ rows: [{
      id: 'proposal-1', kind, key: row.key, status: 'proposed',
      proposed_value: JSON.parse(params[2]), proposed_by: ADMIN_ID,
    }] })],
  ]);
}

function expectProposal(res, kind, key, value) {
  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'change_proposed', change_request_id: 'proposal-1',
    request: expect.objectContaining({ kind, key, status: 'proposed', proposed_value: value }),
  }));
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE (platform_settings|feature_flags)/.test(sql))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql, params]) => /INSERT INTO admin_audit_log/.test(sql) && params.includes('settings_change_proposed'))).toBe(true);
}

describe('admin control-plane hardening', () => {
  test('rejects an out-of-range setting without proposing or updating it', async () => {
    mockProposal({ key: 'bid_expiry_hours', value: '72', value_type: 'number', min_numeric_value: 1, max_numeric_value: 720, version: 3 });
    const res = responseDouble();
    await superAdminController.updateSetting(requestDouble({ key: 'bid_expiry_hours' }, { value: '0' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_setting_value' }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE platform_settings|INSERT INTO settings_change_requests/.test(sql))).toBe(false);
  });

  test('queues and audits a valid setting without applying it', async () => {
    mockProposal({ key: 'support_email', value: 'old@example.com', value_type: 'text', version: 1 });
    const res = responseDouble();
    await superAdminController.updateSetting(requestDouble({ key: 'support_email' }, { value: 'new@example.com' }), res);
    expectProposal(res, 'setting', 'support_email', 'new@example.com');
  });

  test('rejects non-boolean feature flag payloads instead of coercing strings', async () => {
    const res = responseDouble();
    await superAdminController.updateFeatureFlag(
      requestDouble({ key: 'maintenance_rollout' }, { enabled: 'not-a-boolean' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_feature_flag_value' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('proposes false when a valid string feature flag payload is supplied', async () => {
    mockProposal({ key: 'maintenance_rollout' }, 'flag');
    const res = responseDouble();
    await superAdminController.updateFeatureFlag(requestDouble({ key: 'maintenance_rollout' }, { enabled: 'false' }), res);
    expectProposal(res, 'flag', 'maintenance_rollout', false);
  });

  test('proposes a platform setting rollback as a change request (no immediate apply)', async () => {
    // ADM-034/ADM-128: rollback no longer applies immediately; it proposes a
    // change request restoring the audited prior value, which a different
    // admin must approve.
    routeQueries(mockQuery, [
      [/SELECT \* FROM platform_settings WHERE key/, { rows: [{ key: 'bid_expiry_hours', value: '24', value_type: 'number', min_numeric_value: 1, max_numeric_value: 720, version: 4 }] }],
      [/SELECT before_state/, { rows: [{ before_state: { value: '72' } }] }],
      [/INSERT INTO settings_change_requests/, (_sql, params) => ({ rows: [{
        id: 'proposal-1', kind: 'setting', key: 'bid_expiry_hours', status: 'proposed',
        proposed_value: JSON.parse(params[2]), proposed_by: ADMIN_ID,
      }] })],
    ]);

    const res = responseDouble();
    await superAdminController.rollbackSetting(
      requestDouble({ key: 'bid_expiry_hours' }, {}),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'change_proposed',
      change_request_id: 'proposal-1',
      request: expect.objectContaining({ status: 'proposed', proposed_value: '72' }),
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE platform_settings/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql, params]) => /INSERT INTO admin_audit_log/.test(sql) && params.includes('settings_change_proposed'))).toBe(true);
  });

  test('refuses a rollback when no audited prior state exists', async () => {
    routeQueries(mockQuery, [
      [/SELECT \* FROM platform_settings WHERE key/, { rows: [{ key: 'support_email', value: 'new@example.com', value_type: 'text', version: 2 }] }],
      [/SELECT before_state/, { rows: [] }],
    ]);

    const res = responseDouble();
    await superAdminController.rollbackSetting(
      requestDouble({ key: 'support_email' }, {}),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'rollback_unavailable' }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE platform_settings|INSERT INTO settings_change_requests/.test(sql))).toBe(false);
  });

  test('proposes a feature flag rollback as a change request (no immediate flip)', async () => {
    // ADM-034/ADM-128: flag rollback no longer flips immediately; it proposes
    // a change request restoring the audited prior state.
    routeQueries(mockQuery, [
      [/SELECT is_enabled FROM feature_flags WHERE key/, { rows: [{ key: 'new_dashboard', is_enabled: true }] }],
      [/SELECT before_state/, { rows: [{ before_state: { is_enabled: false } }] }],
      [/SELECT key FROM feature_flags WHERE key/, { rows: [{ key: 'new_dashboard' }] }],
      [/INSERT INTO settings_change_requests/, (_sql, params) => ({ rows: [{
        id: 'proposal-2', kind: 'flag', key: 'new_dashboard', status: 'proposed',
        proposed_value: JSON.parse(params[2]), proposed_by: ADMIN_ID,
      }] })],
    ]);

    const res = responseDouble();
    await superAdminController.rollbackFeatureFlag(
      requestDouble({ key: 'new_dashboard' }, {}),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'change_proposed',
      change_request_id: 'proposal-2',
      request: expect.objectContaining({ status: 'proposed', proposed_value: false }),
    }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE feature_flags/.test(sql))).toBe(false);
  });

  test('proposes a zero escrow delay when the row carries migration 591 metadata', async () => {
    mockProposal({ key: 'escrow_release_delay_hrs', value: '48', value_type: 'number', min_numeric_value: 0, max_numeric_value: 720, version: 2 });
    const res = responseDouble();
    await superAdminController.updateSetting(requestDouble({ key: 'escrow_release_delay_hrs' }, { value: '0' }), res);
    expectProposal(res, 'setting', 'escrow_release_delay_hrs', '0');
  });

  test('proposes a zero escrow delay via fallback bounds when row metadata is absent', async () => {
    mockProposal({ key: 'escrow_release_delay_hrs', value: '48', value_type: 'number', min_numeric_value: null, max_numeric_value: null, version: 2 });
    const res = responseDouble();
    await superAdminController.updateSetting(requestDouble({ key: 'escrow_release_delay_hrs' }, { value: 0 }), res);
    expectProposal(res, 'setting', 'escrow_release_delay_hrs', '0');
  });

  test('still rejects out-of-range escrow delays on both sides of the reconciled bounds', async () => {
    for (const badValue of ['-1', '721']) {
      resetMocks();
      mockQuery
        .mockResolvedValueOnce({ rows: [{
          key: 'escrow_release_delay_hrs',
          value: '48',
          value_type: 'number',
          min_numeric_value: null,
          max_numeric_value: null,
          version: 2,
        }] })
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const res = responseDouble();
      await superAdminController.updateSetting(
        requestDouble({ key: 'escrow_release_delay_hrs' }, { value: badValue }),
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_setting_value' }));
      expect(mockQuery.mock.calls.some(([sql]) => /UPDATE platform_settings/.test(sql))).toBe(false);
    }
  });
});
