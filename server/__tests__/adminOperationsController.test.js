'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/adminOperationsController');

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function columnsFor(table) {
  const statuses = new Set([
    'delivery_jobs', 'jobs', 'food_orders', 'support_tickets', 'support_queue',
    'payments', 'disputes', 'queue_events', 'oxsteed_credit_reconciliation_runs',
    'oxsteed_credit_disputes',
  ]);
  if (statuses.has(table)) return ['status', 'created_at'];
  if (table === 'delivery_issues') return ['status'];
  if (table === 'delivery_event_deliveries') return ['status'];
  if (table === 'business_integrations') return ['is_connected', 'is_enabled'];
  if (table === 'webhook_delivery_log') return ['completed_at', 'next_retry_at'];
  return [];
}

beforeEach(() => resetMocks());

test('returns bounded operational sections without exposing records', async () => {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('information_schema.columns')) {
      return { rows: columnsFor(params[0]).map((column_name) => ({ column_name })) };
    }
    if (text.includes('GROUP BY')) {
      return { rows: [{ status: 'posted', count: '3' }, { status: 'delivered', count: '2' }] };
    }
    if (text.includes('COUNT(*)')) return { rows: [{ count: '4' }] };
    return { rows: [] };
  });

  const res = responseDouble();
  await controller.getOverview({ isSuper: true, user: { id: 'admin-1' }, correlationId: 'corr-1' }, res);

  const payload = res.json.mock.calls[0][0];
  expect(Object.keys(payload.sections)).toEqual([
    'delivery', 'jobs', 'orders', 'support', 'payments', 'disputes',
    'queues', 'integrations', 'credit', 'sla', 'risk', 'dataGovernance',
    'changeControl', 'observability', 'crm',
  ]);
  expect(payload.sections.delivery.available).toBe(true);
  expect(payload.sections.delivery.statuses.statuses).toEqual({ posted: 3, delivered: 2 });
  expect(payload.sections.delivery.openIssues.count).toBe(4);
  expect(payload.sections.delivery).toEqual(expect.objectContaining({
    source: 'delivery_jobs',
    route: '/delivery/operations',
    correlation_id: 'corr-1',
  }));
  expect(payload.correlation_id).toBe('corr-1');
  expect(JSON.stringify(payload)).not.toContain('customer@example.com');
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('LIMIT 50'))).toBe(true);
});

test('redacts financial and credit sections when the admin lacks access', async () => {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('admin_permission_grants')) return { rows: [] };
    if (text.includes('information_schema.columns')) {
      return { rows: columnsFor(params[0]).map((column_name) => ({ column_name })) };
    }
    if (text.includes('GROUP BY')) return { rows: [{ status: 'open', count: '1' }] };
    if (text.includes('COUNT(*)')) return { rows: [{ count: '1' }] };
    return { rows: [] };
  });

  const res = responseDouble();
  await controller.getOverview({ isSuper: false, user: { id: 'admin-2' } }, res);

  const { sections } = res.json.mock.calls[0][0];
  expect(Object.values(sections).every((section) => section.correlation_id === 'unknown')).toBe(true);
  expect(sections.payments).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
  expect(sections.credit).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
  expect(sections.integrations).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
  expect(sections.changeControl).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
  expect(sections.jobs.available).toBe(true);
});

test('does not expose global operational sections from a regional grant', async () => {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('admin_permission_grants')) return { rows: [{ id: 1, region_id: 9 }] };
    if (text.includes('information_schema.columns')) {
      return { rows: columnsFor(params[0]).map((column_name) => ({ column_name })) };
    }
    if (text.includes('GROUP BY')) return { rows: [{ status: 'open', count: '1' }] };
    if (text.includes('COUNT(*)')) return { rows: [{ count: '1' }] };
    return { rows: [] };
  });

  const res = responseDouble();
  await controller.getOverview({ isSuper: false, user: { id: 'admin-3' } }, res);

  const { sections } = res.json.mock.calls[0][0];
  expect(sections.payments).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
  expect(sections.integrations).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
  expect(sections.changeControl).toEqual(expect.objectContaining({ available: false, reason: 'permission_required' }));
});
