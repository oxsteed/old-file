'use strict';

jest.mock('../services/businessSetupReadiness', () => ({ loadBusinessSetupReadiness: jest.fn(), isBusinessPublished: business => business.setup_status === 'active' }));
const { loadBusinessSetupReadiness } = require('../services/businessSetupReadiness');
const { collectBusinessOperations, businessTimezone } = require('../services/businessOperationsSummary');
const userId = '10000000-0000-4000-8000-000000000001';
const all = ['business.view', 'calendar.view_all', 'calendar.view_self', 'calendar.manage_all', 'calendar.manage_self', 'messages.view_all', 'messages.view_assigned', 'messages.reply', 'invoices.view', 'business.edit_profile', 'analytics.view_financial'];

function fixture({ role = 'owner', permissions = all, kind = 'service', fail = null, invalid = null } = {}) {
  const db = { query: jest.fn(async (sql, params) => {
    if (fail && sql.includes(fail)) throw Error('Synthetic private SQL failure');
    if (sql.includes('FROM businesses WHERE')) return { rows: [{ timezone: 'America/New_York', business_kind: kind }] };
    if (sql.includes('business_appointments')) return { rows: [{ today_count: params[2] ? 8 : 3, pending_count: 6, pending_self_count: 2, ...(invalid ? { [invalid]: null } : {}) }] };
    if (sql.includes('business_conversations')) return { rows: [{ unanswered_count: params[2] ? 7 : 1 }] };
    if (sql.includes('business_invoices')) return { rows: [{ overdue_count: 4 }] };
    throw Error('Unexpected activity query');
  }) };
  return { db, options: { db, businessId: 4, userId, role, permissions: new Set(permissions), now: new Date('2026-03-08T16:00:00Z'), log: { warn: jest.fn() } } };
}

beforeEach(() => loadBusinessSetupReadiness.mockReset().mockResolvedValue({ business: { setup_status: 'active' }, readyToPublish: true }));

test('owners get operational priorities and invoice counts without mixed-currency financial totals', async () => {
  const f = fixture();
  const result = await collectBusinessOperations(f.options);
  expect(result.sections.bookings.today).toBe(8);
  expect(result.sections.messages.unanswered).toBe(7);
  expect(result.sections.invoices).toEqual({ available: true, status: 'ready', overdue: 4 });
  expect(result.tasks.map(task => task.type)).toEqual(['confirmBookings', 'replyToMessages', 'followUpInvoices']);
  expect(result.partial).toBe(false);
  expect(result.canViewAnalytics).toBe(true);
  expect(f.db.query.mock.calls.every(([sql]) => !/SUM\(/i.test(sql))).toBe(true);
});

test('self calendars and assigned conversations use the authenticated viewer, never the owner', async () => {
  const f = fixture({ role: 'employee', permissions: ['business.view', 'calendar.view_self', 'calendar.manage_self', 'messages.view_assigned', 'messages.reply', 'invoices.view'] });
  const result = await collectBusinessOperations(f.options);
  expect(result.sections.bookings).toMatchObject({ scope: 'self', today: 3 });
  expect(result.sections.messages).toMatchObject({ scope: 'assigned', unanswered: 1 });
  expect(result.sections.invoices.available).toBe(false);
  expect(result.tasks.map(task => task.count)).toEqual([2, 1]);
  for (const table of ['business_appointments', 'business_conversations']) {
    expect(f.db.query.mock.calls.find(([sql]) => sql.includes(table))[1].slice(0, 3)).toEqual([4, userId, false]);
  }
  expect(f.db.query.mock.calls.some(([sql]) => sql.includes('business_invoices'))).toBe(false);
  expect(loadBusinessSetupReadiness).not.toHaveBeenCalled();
});

test('permission overrides suppress restricted sources and actions even for a manager', async () => {
  const f = fixture({ role: 'manager', permissions: ['business.view', 'calendar.view_all'] });
  const result = await collectBusinessOperations(f.options);
  expect(result.sections.bookings.today).toBe(8);
  expect(result.tasks).toEqual([]);
  expect(result.sections.messages.available).toBe(false);
  expect(result.sections.invoices.available).toBe(false);
  expect(result.canViewAnalytics).toBe(false);
  expect(f.db.query).toHaveBeenCalledTimes(2);
});

test('denied workspace access performs no data reads', async () => {
  const f = fixture({ permissions: [] });
  await expect(collectBusinessOperations(f.options)).rejects.toMatchObject({ statusCode: 403 });
  expect(f.db.query).not.toHaveBeenCalled();
});

test('unavailable sources are explicit and cannot become reassuring zeroes', async () => {
  const f = fixture({ fail: 'business_conversations' });
  const result = await collectBusinessOperations(f.options);
  expect(result.partial).toBe(true);
  expect(result.sections.messages).toEqual({ available: true, scope: 'all', status: 'unavailable' });
  expect(result.tasks.some(task => task.type === 'replyToMessages')).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private SQL');
  expect(f.options.log.warn).toHaveBeenCalledWith(expect.any(String), { businessId: 4, source: 'messages' });
  const invalid = await collectBusinessOperations(fixture({ invalid: 'today_count' }).options);
  expect(invalid.sections.bookings.status).toBe('unavailable');
});

test('one request clock and business time zone govern all dated counts', async () => {
  const f = fixture();
  const result = await collectBusinessOperations(f.options);
  expect(result).toMatchObject({ generatedAt: '2026-03-08T16:00:00.000Z', timezone: 'America/New_York' });
  const bookings = f.db.query.mock.calls.find(([sql]) => sql.includes('business_appointments'));
  expect(bookings[1].slice(3)).toEqual([result.generatedAt, result.timezone]);
  const invoices = f.db.query.mock.calls.find(([sql]) => sql.includes('business_invoices'));
  expect(invoices[1].slice(1)).toEqual([result.generatedAt, result.timezone]);
  expect(businessTimezone('Invalid/Zone')).toBe('UTC');
  expect(businessTimezone(' America/New_York ')).toBe('America/New_York');
});

test('setup actions reflect saved readiness and do not tell managers to perform owner-only publication', async () => {
  loadBusinessSetupReadiness.mockResolvedValue({ business: { setup_status: 'draft' }, readyToPublish: true });
  expect((await collectBusinessOperations(fixture().options)).tasks.some(task => task.type === 'reviewSetup')).toBe(true);
  expect((await collectBusinessOperations(fixture({ role: 'manager' }).options)).tasks.some(task => task.type === 'reviewSetup')).toBe(false);
  loadBusinessSetupReadiness.mockResolvedValue({ business: { setup_status: 'draft' }, readyToPublish: false });
  expect((await collectBusinessOperations(fixture({ role: 'manager' }).options)).tasks.some(task => task.type === 'reviewSetup')).toBe(true);
});

test('restaurants keep their dedicated operational workspace without service booking or client-invoice widgets', async () => {
  const f = fixture({ kind: 'restaurant' });
  const result = await collectBusinessOperations(f.options);
  expect(result.businessKind).toBe('restaurant');
  expect(result.sections.bookings.available).toBe(false);
  expect(result.sections.invoices.available).toBe(false);
  expect(f.db.query.mock.calls.some(([sql]) => /business_appointments|business_invoices/.test(sql))).toBe(false);
});
