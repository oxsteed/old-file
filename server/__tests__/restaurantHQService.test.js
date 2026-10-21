'use strict';

const service = require('../services/restaurantHQService');

describe('restaurant HQ rollup service', () => {
  test('shapes store comparisons without customer identity', () => {
    expect(service.storeShape({ id: 4, display_name: 'Downtown', address_city: 'Boston', address_state: 'MA', timezone: 'America/New_York', status: 'active' }, [{ currency_code: 'USD', order_count: '3', net_collected_cents: '4200' }], { latestAuditScorePercent: '92.5', openFindings: '1' })).toEqual({
      id: 4, name: 'Downtown', city: 'Boston', state: 'MA', timezone: 'America/New_York', status: 'active',
      sales: [{ currencyCode: 'USD', orderCount: 3, netCollectedCents: 4200 }],
      health: { latestAuditScorePercent: 92.5, openFindings: 1 },
    });
  });

  test('rollup query is explicitly constrained to the business and accessible stores', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ restaurant_id: 4, currency_code: 'USD', order_count: 3, net_collected_cents: 4200 }] })
      .mockResolvedValueOnce({ rows: [{ restaurant_id: 4, latest_audit_score_percent: '92.5', open_findings: 1 }] }) };
    const result = await service.rollup(client, { businessId: 8, restaurantIds: [4], from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' });
    expect(result.salesRows[0].restaurant_id).toBe(4);
    expect(client.query.mock.calls[0][1]).toEqual([8, [4], '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z']);
  });
});
