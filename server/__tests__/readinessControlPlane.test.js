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
    const query = jest.fn().mockResolvedValue({ rows: columns });
    const complete = await adminControlPlaneSchemaStatus({ query });
    expect(complete).toEqual({ ok: true });
    expect(query.mock.calls[0][0]).toContain('pg_catalog.to_regclass');
    expect(query.mock.calls[0][0]).toContain("'public.'");
    expect(query.mock.calls[0][0]).toContain('NOT a.attisdropped');
    expect(query.mock.calls[0][0]).not.toContain('information_schema');
    expect(query.mock.calls[0][1]).toEqual(['admin_audit_log','platform_settings',
      ['target_key'],['min_numeric_value','max_numeric_value','validation_pattern','version']]);

    const incomplete = await adminControlPlaneSchemaStatus({
      query: jest.fn().mockResolvedValue({ rows: columns.slice(0, 2) }),
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.missing).toContain('platform_settings.version');
  } finally {
    process.env.NODE_ENV = previous;
  }
});
