'use strict';

const service = require('../services/restaurantHQService');

describe('restaurant HQ rollup service', () => {
  test('validates a distinct bounded source and target store set', () => {
    expect(service.normalizePublishRequest({ sourceLocationId: '4', targetLocationIds: ['5', '6'] })).toEqual({ sourceLocationId: 4, targetLocationIds: [5, 6] });
    expect(() => service.normalizePublishRequest({ sourceLocationId: 4, targetLocationIds: [4] })).toThrow('source store cannot be a target');
    expect(() => service.normalizePublishRequest({ sourceLocationId: 4, targetLocationIds: [5, 5] })).toThrow('Target stores must be unique');
  });

  test('shapes store comparisons without customer identity', () => {
    expect(service.storeShape({ id: 4, display_name: 'Downtown', address_city: 'Boston', address_state: 'MA', timezone: 'America/New_York', status: 'active' }, [{ currency_code: 'USD', order_count: '3', net_collected_cents: '4200' }], { latestAuditScorePercent: '92.5', openFindings: '1' })).toEqual({
      id: 4, name: 'Downtown', city: 'Boston', state: 'MA', timezone: 'America/New_York', status: 'active',
      sales: [{ currencyCode: 'USD', orderCount: 3, netCollectedCents: 4200 }],
      health: { latestAuditScorePercent: 92.5, openFindings: 1 },
      compliance: { checklistCompletionPercent: null, checklistRuns: 0, trainingCompletionPercent: null, trainingAssignments: 0, overdueTraining: 0 },
    });
  });

  test('rollup query is explicitly constrained to the business and accessible stores', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ restaurant_id: 4, currency_code: 'USD', order_count: 3, net_collected_cents: 4200 }] })
      .mockResolvedValueOnce({ rows: [{ restaurant_id: 4, latest_audit_score_percent: '92.5', open_findings: 1 }] })
      .mockResolvedValueOnce({ rows: [{ restaurant_id: 4, checklist_runs: 4, checklist_completion_percent: '75.0', training_assignments: 5, training_completion_percent: '80.0', overdue_training: 1 }] }) };
    const result = await service.rollup(client, { businessId: 8, restaurantIds: [4], from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' });
    expect(result.salesRows[0].restaurant_id).toBe(4);
    expect(result.complianceRows[0].training_assignments).toBe(5);
    expect(client.query.mock.calls[0][1]).toEqual([8, [4], '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z']);
  });

  test('publishes only existing source overrides to same-restaurant targets', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 4, name: 'Source', status: 'active' }, { id: 5, name: 'Target', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ location_id: 5, menu_item_id: 22 }, { location_id: 5, menu_item_id: 23 }] }) };
    await expect(service.publishMenuOverrides(client, { restaurantId: 9, sourceLocationId: 4, targetLocationIds: [5], actorUserId: 'user-1' })).resolves.toEqual({
      sourceLocationId: 4,
      targets: [{ locationId: 5, copiedOverrides: 2 }],
    });
    expect(client.query.mock.calls[0][1]).toEqual([9, [4, 5]]);
    expect(client.query.mock.calls[1][1]).toEqual([9, 4, [5], 'user-1']);
    expect(client.query.mock.calls[1][0]).toContain('restaurant_store_menu_overrides');
  });

  test('location rollups group sales by accessible store ids', async () => {
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ location_id: 7, currency_code: 'USD', order_count: 2, net_collected_cents: 2500 }] })
      .mockResolvedValueOnce({ rows: [{ location_id: 7, latest_audit_score_percent: '91.0', open_findings: 1 }] })
      .mockResolvedValueOnce({ rows: [{ location_id: 7, checklist_runs: 3, checklist_completion_percent: '66.7', training_assignments: 2, training_completion_percent: '50.0', overdue_training: 1 }] })
    };
    const result = await service.rollupLocations(client, { restaurantId: 3, locationIds: [7], from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' });
    expect(result.salesRows[0].location_id).toBe(7);
    expect(client.query.mock.calls[0][1]).toEqual([3, [7], '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z']);
    expect(client.query.mock.calls[1][0]).toContain('restaurant_locations');
  });
});
