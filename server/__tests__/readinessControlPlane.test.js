'use strict';

const { adminControlPlaneSchemaStatus } = require('../services/readinessService');

const columns = [
  { table_name: 'admin_audit_log', column_name: 'target_key' },
  { table_name: 'platform_settings', column_name: 'min_numeric_value' },
  { table_name: 'platform_settings', column_name: 'max_numeric_value' },
  { table_name: 'platform_settings', column_name: 'validation_pattern' },
  { table_name: 'platform_settings', column_name: 'version' },
];

test('production control-plane readiness detects an incomplete additive schema', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const complete = await adminControlPlaneSchemaStatus({
      query: jest.fn().mockResolvedValue({ rows: columns }),
    });
    expect(complete).toEqual({ ok: true });

    const incomplete = await adminControlPlaneSchemaStatus({
      query: jest.fn().mockResolvedValue({ rows: columns.slice(0, 2) }),
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.missing).toContain('platform_settings.version');
  } finally {
    process.env.NODE_ENV = previous;
  }
});
