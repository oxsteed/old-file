'use strict';

const { mockQuery, resetMocks } = require('./setup');
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

describe('admin control-plane hardening', () => {
  test('rejects an out-of-range setting and rolls back without updating it', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        key: 'bid_expiry_hours',
        value: '72',
        value_type: 'number',
        min_numeric_value: 1,
        max_numeric_value: 720,
        version: 3,
      }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = responseDouble();
    await superAdminController.updateSetting(
      requestDouble({ key: 'bid_expiry_hours' }, { value: '0' }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_setting_value' }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE platform_settings/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /^ROLLBACK/.test(String(sql).trim()))).toBe(true);
  });

  test('commits a valid setting and its audit row in one transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{
        key: 'support_email',
        value: 'old@example.com',
        value_type: 'text',
        version: 1,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = responseDouble();
    await superAdminController.updateSetting(
      requestDouble({ key: 'support_email' }, { value: 'new@example.com' }),
      res,
    );

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Setting "support_email" updated.' });
    expect(mockQuery.mock.calls.some(([sql, params]) => /INSERT INTO admin_audit_log/.test(sql) && params.includes('support_email'))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /^COMMIT/.test(String(sql).trim()))).toBe(true);
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

  test('preserves false when a valid string feature flag payload is supplied', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = responseDouble();
    await superAdminController.updateFeatureFlag(
      requestDouble({ key: 'maintenance_rollout' }, { enabled: 'false' }),
      res,
    );

    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE feature_flags/.test(sql));
    expect(updateCall?.[1]).toContain(false);
    expect(res.json).toHaveBeenCalledWith({ message: 'Feature flag "maintenance_rollout" set to false.' });
  });

  test('rolls a platform setting back through the audited prior value', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ key: 'bid_expiry_hours', value: '24', value_type: 'number', min_numeric_value: 1, max_numeric_value: 720, version: 4 }] })
      .mockResolvedValueOnce({ rows: [{ before_state: { value: '72' } }] })
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = responseDouble();
    await superAdminController.rollbackSetting(
      requestDouble({ key: 'bid_expiry_hours' }, {}),
      res,
    );

    expect(res.json).toHaveBeenCalledWith({ message: 'Setting "bid_expiry_hours" rolled back.', value: '72' });
    expect(mockQuery.mock.calls.some(([sql, params]) => /INSERT INTO admin_audit_log/.test(sql) && params.includes('platform_setting_rollback'))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /^COMMIT/.test(String(sql).trim()))).toBe(true);
  });

  test('refuses a rollback when no audited prior state exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ key: 'support_email', value: 'new@example.com', value_type: 'text', version: 2 }] })
      .mockResolvedValueOnce({ rows: [] }) // history
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = responseDouble();
    await superAdminController.rollbackSetting(
      requestDouble({ key: 'support_email' }, {}),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'rollback_unavailable' }));
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE platform_settings/.test(sql))).toBe(false);
  });

  test('accepts a zero escrow delay when the row carries migration 591 metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{
        key: 'escrow_release_delay_hrs',
        value: '48',
        value_type: 'number',
        min_numeric_value: 0,
        max_numeric_value: 720,
        version: 2,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = responseDouble();
    await superAdminController.updateSetting(
      requestDouble({ key: 'escrow_release_delay_hrs' }, { value: '0' }),
      res,
    );

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Setting "escrow_release_delay_hrs" updated.' });
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE platform_settings/.test(sql));
    expect(updateCall?.[1]?.[0]).toBe('0');
  });

  test('accepts a zero escrow delay via fallback bounds when row metadata is absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{
        key: 'escrow_release_delay_hrs',
        value: '48',
        value_type: 'number',
        min_numeric_value: null,
        max_numeric_value: null,
        version: 2,
      }] })
      .mockResolvedValueOnce({ rows: [] }) // update
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const res = responseDouble();
    await superAdminController.updateSetting(
      requestDouble({ key: 'escrow_release_delay_hrs' }, { value: 0 }),
      res,
    );

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Setting "escrow_release_delay_hrs" updated.' });
  });

  test('still rejects out-of-range escrow delays on both sides of the reconciled bounds', async () => {
    for (const badValue of ['-1', '721']) {
      resetMocks();
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
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
