'use strict';

const service = require('../services/restaurantAccountingService');

const integrationRow = {
  id: 11, restaurant_id: 3, provider: 'quickbooks', status: 'active',
  external_company_id: 'company-1',
  access_token_ref: '{{resolve:secretsmanager:prod/qb:SecretString:access}}',
  refresh_token_ref: '{{resolve:secretsmanager:prod/qb:SecretString:refresh}}',
  account_mapping: service.DEFAULT_MAPPING,
};

const exportRow = {
  id: 21, restaurant_id: 3, integration_id: 11,
  period_from: '2026-10-01', period_to: '2026-10-31', currency_code: 'USD',
  idempotency_key: 'export-1', status: 'pending',
  payload: { lines: [{ account: '4000', debit: '0.00', credit: '10.00' }] }, attempts: 0,
};

test('accounting providers, periods, mappings, and secret references are bounded', () => {
  expect(service.normalizeProvider(' XERO ')).toBe('xero');
  expect(service.normalizeDate('2026-02-28', 'period')).toBe('2026-02-28');
  expect(() => service.normalizeDate('2026-02-29', 'period')).toThrow(/period/);
  expect(() => service.normalizeSecretRef('plain-token', 'accessTokenRef')).toThrow(/dynamic reference/);
  expect(service.normalizeMapping({ sales: 'Income' })).toMatchObject({ sales: 'Income', taxPayable: '2100' });
  expect(() => service.normalizeMapping({ sales: 'bad code!' })).toThrow(/mapping/);
});

test('integration shaping exposes configuration state without token references', () => {
  const shaped = service.shapeIntegration(integrationRow);
  expect(shaped).toMatchObject({ provider: 'quickbooks', status: 'active', credentialsConfigured: true, accountMapping: service.DEFAULT_MAPPING });
  expect(JSON.stringify(shaped)).not.toContain('SecretString');
});

test('upserting an integration shapes the database row returned by postgres', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [integrationRow] }) };
  const result = await service.upsertIntegration(client, {
    restaurantId: 3,
    provider: 'quickbooks',
    status: 'active',
    externalCompanyId: 'company-1',
    accessTokenRef: integrationRow.access_token_ref,
    refreshTokenRef: integrationRow.refresh_token_ref,
    actorUserId: 'user-1',
  });

  expect(result).toMatchObject({ id: 11, restaurantId: 3, provider: 'quickbooks', status: 'active', credentialsConfigured: true });
  expect(result).not.toHaveProperty('accessTokenRef');
});

test('queueing a journal is currency-scoped and idempotent', async () => {
  const client = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [integrationRow] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [exportRow] }) };
  const result = await service.queueExport(client, {
    restaurantId: 3, provider: 'quickbooks', periodFrom: '2026-10-01', periodTo: '2026-10-31',
    currencyCode: 'usd', idempotencyKey: 'export-1', actorUserId: 'user-1',
    lines: [{ date: '2026-10-01', reference: 'OX-1', description: 'Sale', account: '4000', debit: '0.00', credit: '10.00', currency: 'USD', location: 'Main' }],
  });
  expect(result).toMatchObject({ replayed: false, export: { id: 21, currencyCode: 'USD', lineCount: 1 } });
  expect(client.query.mock.calls[0][1]).toEqual([3, 'quickbooks']);
  expect(client.query.mock.calls[2][1][5]).toBe('export-1');
});

test('a replay returns the existing export without inserting another batch', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [integrationRow] }).mockResolvedValueOnce({ rows: [exportRow] }) };
  const result = await service.queueExport(client, {
    restaurantId: 3, provider: 'quickbooks', periodFrom: '2026-10-01', periodTo: '2026-10-31',
    currencyCode: 'USD', idempotencyKey: 'export-1', lines: [{ date: '2026-10-01', account: '4000', debit: '0.00', credit: '10.00', currency: 'USD' }],
  });
  expect(result.replayed).toBe(true);
  expect(client.query).toHaveBeenCalledTimes(2);
});

test('listing exports is provider-filtered and bounded without exposing payloads', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [exportRow] }) };
  const result = await service.listExports(client, 3, { provider: 'xero', limit: '999' });
  expect(result).toEqual([expect.objectContaining({ id: 21, status: 'pending', lineCount: 1 })]);
  expect(result[0].payload).toBeUndefined();
  expect(client.query.mock.calls[0][1]).toEqual([3, 'xero', 100]);
});

test('posted batches require external evidence and remain immutable', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ rows: [exportRow] }) };
  await expect(service.updateExportStatus(client, { restaurantId: 3, exportId: 21, status: 'posted' })).rejects.toMatchObject({ code: 'accounting_external_id_required' });
  client.query.mockReset().mockResolvedValueOnce({ rows: [{ ...exportRow, status: 'posted' }] });
  await expect(service.updateExportStatus(client, { restaurantId: 3, exportId: 21, status: 'failed', lastError: 'provider timeout' })).rejects.toMatchObject({ code: 'accounting_export_immutable' });
});
