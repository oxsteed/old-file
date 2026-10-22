'use strict';

const service = require('../services/restaurantDeliveryMarketplaceService');

describe('restaurant delivery marketplace contracts', () => {
  test('accepts supported providers and only dynamic secret references', () => {
    expect(service.normalizeProvider('Uber_Eats')).toBe('uber_eats');
    expect(service.normalizeSecretRef('{{resolve:secretsmanager:prod/uber:SecretString:token}}', 'token')).toContain('secretsmanager');
    expect(() => service.normalizeProvider('doordash_live')).toThrow(/Unsupported/);
    expect(() => service.normalizeSecretRef('plaintext-token', 'token')).toThrow(/dynamic reference/);
  });

  test('builds a safe menu snapshot from available items only', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { category_id: 1, category_name: 'Mains', item_id: 2, item_name: 'Soup', description: null, price_cents: 1200, currency_code: 'USD', is_available: true, tags: [] },
      { category_id: 1, category_name: 'Mains', item_id: 3, item_name: 'Sold out', description: null, price_cents: 900, currency_code: 'USD', is_available: false, tags: [] },
    ] }) };
    const snapshot = await service.menuSnapshot(client, 9);
    expect(client.query.mock.calls[0][0]).toContain("i.publication_status = 'published'");
    expect(client.query.mock.calls[0][0]).toContain('i.archived_at IS NULL');
    expect(snapshot).toEqual([{ id: 1, name: 'Mains', items: [{ id: 2, name: 'Soup', description: null, priceCents: 1200, currencyCode: 'USD', tags: [] }] }]);
  });

  test('requires an enabled integration before accepting an external order', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(service.ingestOrder(client, {
      restaurantId: 9, provider: 'grubhub', externalOrderId: 'gh-1', currencyCode: 'USD', totalCents: 1200,
    })).rejects.toMatchObject({ code: 'delivery_provider_disabled' });
  });
});
